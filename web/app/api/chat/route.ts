import { NextRequest, NextResponse } from 'next/server';
import { getToolDefinitions, executeTool } from '@/app/lib/stockTools';
import { AlphaVantageService, StockDataService } from '@/app/lib/stockDataService';

const COPILOT_CHAT_URL  = 'https://api.githubcopilot.com/chat/completions';
const COPILOT_MODELS_URL = 'https://api.githubcopilot.com/models';
const MAX_TOOL_ROUNDS   = 30;
const AUTO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Auto-model resolution ────────────────────────────────────────────────────
// Uses the real Copilot models API (api.githubcopilot.com/models).
// Model IDs have NO vendor prefix and use dots: claude-opus-4.6, gpt-5-mini.

let cachedAutoModel: string | null = null;
let autoModelCacheExpiry = 0;

/** Mirrors qualifies() in models/route.ts exactly. */
function qualifiesForAuto(model: {
  id: string;
  model_picker_enabled: boolean;
  capabilities: { supports: { tool_calls: boolean } };
}): boolean {
  if (!model.model_picker_enabled) return false;
  if (!model.capabilities?.supports?.tool_calls) return false;
  const id = model.id.toLowerCase();
  const claudeMatch = id.match(/^claude-[a-z]+-(\d+)\.(\d+)/);
  if (claudeMatch) {
    const maj = parseInt(claudeMatch[1]), min = parseInt(claudeMatch[2]);
    return maj > 4 || (maj === 4 && min >= 5);
  }
  const claudeBare = id.match(/^claude-[a-z]+-(\d+)$/);
  if (claudeBare) return parseInt(claudeBare[1]) >= 5;
  if (id.startsWith('gpt-')) {
    if (id.includes('codex') || id === 'gpt-5') return false;
    const m = id.match(/^gpt-(\d+)/);
    return !!m && parseInt(m[1]) >= 5;
  }
  if (id.startsWith('gemini-')) return true;
  return false;
}

/** Higher = more capable / preferred. */
function modelRank(id: string): number {
  const s = id.toLowerCase();
  if (s.includes('opus'))                                              return 100;
  if (s.includes('sonnet'))                                            return  90;
  if (s.startsWith('gpt-5') && !s.includes('mini'))                  return  85;
  if (s.includes('gemini') && (s.includes('pro') || s.includes('ultra'))) return 80;
  if (s.includes('gpt-5'))                                             return  75;
  if (s.includes('haiku'))                                             return  70;
  if (s.includes('gemini'))                                            return  68;
  return 50;
}

// Confirmed-working fallback (verified by live API call in this repo).
const AUTO_FALLBACK = 'claude-sonnet-4.6';

async function resolveAutoModel(token: string): Promise<string> {
  const now = Date.now();
  if (cachedAutoModel && now < autoModelCacheExpiry) return cachedAutoModel;

  try {
    const res = await fetch(COPILOT_MODELS_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) {
      const json = await res.json();
      const catalog: any[] = json.data ?? json;
      const best = catalog
        .filter((m: any) => qualifiesForAuto(m))
        .sort((a: any, b: any) => modelRank(b.id) - modelRank(a.id))[0];
      if (best) {
        cachedAutoModel = best.id;
        autoModelCacheExpiry = now + AUTO_CACHE_TTL_MS;
        console.log('[auto] resolved to:', best.id);
        return best.id;
      }
    }
  } catch (err) {
    console.error('[auto] models API error:', err);
  }

  console.warn('[auto] falling back to:', AUTO_FALLBACK);
  return AUTO_FALLBACK;
}
// ─────────────────────────────────────────────────────────────────────────────

const RATE_LIMIT_GUIDANCE =
  'This model allows 50 requests per day. ' +
  'Try switching to a different model from the dropdown, or try again tomorrow.';

// Vercel: allow up to 5 minutes for deep research requests
export const maxDuration = 300;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

// Store conversation history per session
const sessions = new Map<string, ChatMessage[]>();

const SYSTEM_PROMPT = `You are an elite buy-side equity research analyst. Produce institutional-quality, data-driven financial research — thorough, precise, and immediately actionable.

**NON-NEGOTIABLE RULES:**

**1. Fetch before you write.** Never state a fact about a stock without first calling the relevant tool. No estimates, no speculation, no filler.

**2. Batch all parallel calls in ONE round.** Researching N stocks? Issue ALL tool calls simultaneously in a single response — never one at a time. This is critical for multi-stock reports.

**3. Match depth to the question.**
- Price query: get_stock_price → short direct answer.
- Single-stock deep dive: get_stock_price + get_company_overview + get_earnings_history + get_income_statement + get_cash_flow + get_analyst_ratings + get_news_sentiment + get_price_history.
- Sector/theme report: get_stocks_by_sector → batch get_company_overview + get_stock_price for ALL stocks.
- Investment allocation: batch full data for all candidates → quantitative scoring → exact $ amounts, stop-losses, rebalancing triggers.

**4. Never skip a tool** when that data would strengthen the analysis.

**OUTPUT STANDARDS:**
- Tables for all comparisons of 2+ stocks or metrics — no empty cells.
- ### headers for sections in deep research.
- Emoji section markers: 📊 📈 💰 🏦 🔍 ⚠️ ✅ — bold key metrics.
- Show all calculations explicitly: FCF = Op.CF − CapEx = $X − $Y = $Z.
- Scoring matrix for allocations: Growth 25% / Profitability 20% / Moat 20% / Valuation 20% / Momentum 15%.
- Numbers: prices 2 decimals, % 1 decimal, large numbers 2 sig figs ($2.3B).
- Cite "Source: Alpha Vantage" after data-heavy sections.
- Length matches request: price query = 2–3 lines; full sector report = 2,000+ words.
`;

/**
 * Trim conversation history to prevent token limit errors (413) on subsequent turns.
 *
 * The app's fixed overhead per request is ~5,500 tokens (system prompt + tool
 * definitions). High/Low tier models allow 8,000 input tokens, leaving only
 * ~2,500 tokens for conversation history. A single deep-research turn accumulates
 * many tool result messages that can far exceed this budget.
 *
 * Strategy: keep the system message + only the most recent complete exchange
 * (the final user message and its final assistant reply). All intermediate tool
 * call/result messages from previous turns are dropped — they were only needed
 * during that turn's reasoning loop and have no value in later turns.
 */
function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return messages;

  const system = messages[0]; // always index 0

  // Collect complete exchanges: each exchange = one user message + everything
  // after it until (but not including) the next user message.
  const exchanges: ChatMessage[][] = [];
  let current: ChatMessage[] = [];

  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === 'user' && current.length > 0) {
      exchanges.push(current);
      current = [];
    }
    current.push(messages[i]);
  }
  if (current.length > 0) exchanges.push(current);

  if (exchanges.length === 0) return messages;

  // From each exchange, keep only the final assistant text reply (drop intermediate
  // tool_calls and tool results — they balloon in size and are not needed later).
  const compactExchange = (exchange: ChatMessage[]): ChatMessage[] => {
    const userMsg = exchange[0]; // the user message that started this exchange
    // Find the final assistant message (no tool_calls — the actual text response)
    const finalAssistant = [...exchange].reverse().find(
      (m) => m.role === 'assistant' && !m.tool_calls?.length
    );
    if (finalAssistant) return [userMsg, finalAssistant];
    // If no clean final assistant message yet (in-progress exchange), keep as-is
    return exchange;
  };

  // Keep the last 2 complete exchanges (so there's some conversation context)
  // plus the current in-progress exchange (last one) in full.
  const keepExchanges = exchanges.slice(-2);
  const compacted = keepExchanges.flatMap((ex, idx) =>
    // Compact all but the last exchange (which is currently being processed)
    idx < keepExchanges.length - 1 ? compactExchange(ex) : ex
  );

  return [system, ...compacted];
}
async function callCopilotAPI(
  messages: ChatMessage[],
  githubToken: string,
  model: string
): Promise<any> {
  const response = await fetch(COPILOT_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${githubToken}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools: getToolDefinitions(),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`GitHub Models API ${response.status}: ${errorText}`);
    if (response.status === 401) {
      throw new Error(
        'GitHub Models API authentication failed (401). ' +
        'Your GITHUB_TOKEN may be invalid, expired, or missing the required permissions. ' +
        'Please use a classic PAT from https://github.com/settings/tokens with no specific scopes needed, ' +
        'or a fine-grained PAT from https://github.com/settings/personal-access-tokens with "Models" read permission enabled. ' +
        `API response: ${errorText}`
      );
    }
    if (response.status === 403) {
      throw new Error(
        'GitHub Models API access denied (403). ' +
        'Your token does not have permission to use GitHub Models. ' +
        'If using a fine-grained PAT, enable the "Models" permission under "Account permissions". ' +
        `API response: ${errorText}`
      );
    }
    if (response.status === 429) {
      let waitSeconds: number | undefined;
      try {
        const errorJson = JSON.parse(errorText);
        const msg: string = errorJson?.error?.message || '';
        const match = msg.match(/wait (\d+) seconds/i);
        if (match) waitSeconds = parseInt(match[1], 10);
      } catch {
        // ignore JSON parse errors
      }
      let waitMsg = '';
      if (waitSeconds !== undefined) {
        if (waitSeconds < 3600) {
          waitMsg = ` Please wait approximately ${Math.ceil(waitSeconds / 60)} minute(s) before retrying.`;
        } else {
          waitMsg = ` Please wait approximately ${Math.ceil(waitSeconds / 3600)} hour(s) before retrying.`;
        }
      }
      const err = new Error(
        `Rate limit reached for this model.${waitMsg}`
      ) as Error & { statusCode: number };
      err.statusCode = 429;
      throw err;
    }
    if (response.status === 400) {
      let errorCode = '';
      try {
        const errorJson = JSON.parse(errorText);
        errorCode = errorJson?.error?.code || '';
      } catch {
        // ignore JSON parse errors
      }
      if (errorCode === 'unknown_model' || errorCode === 'model_not_found') {
        const err = new Error(
          'Model not found. Please select a different model from the dropdown.'
        ) as Error & { statusCode: number };
        err.statusCode = 400;
        throw err;
      }
    }
    if (response.status === 413) {
      const err = new Error(
        'Request too large for this model.'
      ) as Error & { statusCode: number };
      err.statusCode = 413;
      throw err;
    }
    throw new Error(`GitHub Models API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId, model } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Check if GitHub token is available
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.COPILOT_GITHUB_TOKEN;
    if (!githubToken) {
      return NextResponse.json(
        {
          error: 'GitHub token not configured',
          details: 'Please set GITHUB_TOKEN environment variable in Vercel. Get a personal access token at: https://github.com/settings/personal-access-tokens — this uses your existing GitHub Copilot subscription.',
        },
        { status: 503 }
      );
    }

    // Initialize stock service (always uses real Alpha Vantage API)
    const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!alphaVantageKey) {
      return NextResponse.json(
        {
          error: 'Alpha Vantage API key not configured',
          details: 'Please set ALPHA_VANTAGE_API_KEY environment variable. Get a free API key at: https://www.alphavantage.co/support/#api-key',
        },
        { status: 503 }
      );
    }
    const stockService: StockDataService = new AlphaVantageService(alphaVantageKey);

    // Resolve "auto" to the best available model; otherwise use the requested model.
    const requestedModel = model || 'auto';
    const resolvedModel = requestedModel === 'auto'
      ? await resolveAutoModel(githubToken)
      : requestedModel;

    // Get or create conversation history
    let conversationMessages: ChatMessage[] = sessionId ? sessions.get(sessionId) || [] : [];
    const currentSessionId = sessionId || Math.random().toString(36).substring(7);

    if (conversationMessages.length === 0) {
      conversationMessages.push({ role: 'system', content: SYSTEM_PROMPT });
    } else {
      // Trim accumulated tool messages from previous turns to stay within
      // the model's input token limit (8,000 tokens for high/low tier models,
      // minus ~5,500 tokens of fixed overhead = only ~2,500 tokens for history).
      conversationMessages = trimHistory(conversationMessages);
    }

    // Add user message
    conversationMessages.push({ role: 'user', content: message });

    // Call the Copilot API with tool-calling loop
    let rounds = 0;
    let assistantContent: string | null = null;

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const result = await callCopilotAPI(conversationMessages, githubToken, resolvedModel);
      const choices: any[] = result.choices ?? [];

      if (choices.length === 0) {
        throw new Error('No response from the model');
      }

      // Some models (e.g. claude-sonnet-4.6) return multiple choices:
      // one with content and a separate one with tool_calls.
      // Merge them into a single assistant message so the conversation
      // history remains well-formed for subsequent turns.
      const contentParts = choices
        .map((c: any) => c.message?.content)
        .filter((c: any) => typeof c === 'string' && c.length > 0);
      const allToolCalls = choices.flatMap((c: any) => c.message?.tool_calls ?? []);

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: contentParts.length > 0 ? contentParts.join('') : null,
        ...(allToolCalls.length > 0 ? { tool_calls: allToolCalls } : {}),
      };

      // Add merged assistant message to conversation
      conversationMessages.push(assistantMessage);

      // If the model wants to call tools, execute all of them in parallel
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolResults = await Promise.all(
          assistantMessage.tool_calls.map(async (toolCall: { id: string; function: { name: string; arguments: string } }) => {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);
            const toolResult = await executeTool(toolName, toolArgs, stockService);
            return {
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult),
            };
          })
        );
        conversationMessages.push(...toolResults);
        // Continue the loop so the model can process tool results
        continue;
      }

      // No tool calls — we have the final response
      assistantContent = assistantMessage.content;
      break;
    }

    // Save conversation history
    sessions.set(currentSessionId, conversationMessages);

    return NextResponse.json({
      response: assistantContent || "I apologize, but I couldn't generate a response. Please try again.",
      sessionId: currentSessionId,
      model: resolvedModel,
    });
  } catch (error: any) {
    console.error('Chat API error:', error);
    const isRateLimit = error.statusCode === 429;
    const isUnknownModel = error.statusCode === 400;
    const isTokensLimit = error.statusCode === 413;
    const statusCode = isRateLimit ? 429 : isUnknownModel ? 400 : isTokensLimit ? 413 : 500;
    let details: string;
    if (isRateLimit) {
      details = RATE_LIMIT_GUIDANCE;
    } else if (isUnknownModel) {
      details = 'Open the model dropdown and choose a different model. The model list is fetched live from the GitHub Models catalog.';
    } else if (isTokensLimit) {
      details = `The conversation history has grown too large for this model's token limit. Start a new chat to clear the history and try again.`;
    } else {
      details = 'Make sure GITHUB_TOKEN is set in your Vercel environment variables. Use a fine-grained PAT with "Models: read" permission from https://github.com/settings/personal-access-tokens.';
    }
    return NextResponse.json(
      {
        error: error.message || 'Failed to process message',
        details,
      },
      { status: statusCode }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Session cleanup error:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup session' },
      { status: 500 }
    );
  }
}
