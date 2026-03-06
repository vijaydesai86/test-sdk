/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getToolDefinitionsByName, executeTool, type LLMFiller } from '@/app/lib/stockTools';
import { createStockService, StockDataService } from '@/app/lib/stockDataService';

// GitHub Models API — new endpoint (azure endpoint deprecated Oct 2025)
// Works with PATs from github.com/settings/personal-access-tokens (models:read scope)
const GITHUB_MODELS_URL = 'https://models.github.ai/inference/chat/completions';
const OPENAI_PROXY_BASE_URL =
  process.env.OPENAI_PROXY_BASE_URL ||
  'https://openai-api-proxy.geo.arm.com/api/providers/openai/v1';
const DEFAULT_MODEL = process.env.COPILOT_MODEL || 'openai/gpt-4.1';
const FALLBACK_MODEL = process.env.COPILOT_FALLBACK_MODEL || DEFAULT_MODEL;
// Gap-fill uses a lighter model so it doesn't burn the user's main model quota.
// gpt-4.1-mini has a separate (much higher) rate limit on GitHub Models.
// Override with FILL_MODEL env var if needed.
const FILL_MODEL = process.env.FILL_MODEL || 'openai/gpt-4.1-mini';
const AUTO_DOWNGRADE_GPT5 = process.env.AUTO_DOWNGRADE_GPT5 !== 'false';
const DEFAULT_FALLBACK_MODELS = [
  DEFAULT_MODEL,
  'openai/gpt-4.1-mini',
  'google/gemini-3-flash',
];
// Allow enough rounds for multi-stock research. With parallel batching, each round
// can execute dozens of tool calls simultaneously — so 30 rounds is ample even for
// 20-stock reports (typically: 1 sector list + 2-3 batch rounds + 1 write round).
const MAX_TOOL_ROUNDS = 30;
const MAX_HISTORY_MESSAGE_CHARS = 4000;
const TOOL_RESULT_MAX_DEPTH = 3;
const TOOL_RESULT_MAX_ARRAY = 12;
const TOOL_RESULT_MAX_KEYS = 40;
const TOOL_RESULT_MAX_STRING = 500;

const RATE_LIMIT_GUIDANCE =
  'This model allows 50 requests per day. ' +
  'Try switching to a different model from the dropdown, or try again tomorrow.';

// Vercel: allow up to 5 minutes for deep research requests
export const maxDuration = 300;
export const runtime = 'nodejs';

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
- Individual stock report: call generate_stock_report with the ticker symbol.
- Company comparison report: call generate_comparison_report with the list of ticker symbols.
- Sector / thematic analysis: call generate_sector_report with the sector query (e.g. "AI data center"). It identifies the top companies and builds a full comparison report.
- Deep sector research: call generate_deep_sector_report when the user asks for deep, thorough, or comprehensive sector analysis — it identifies a broad candidate list, maps supply-chain/customer/market/news dependencies, refines the list, and builds a full comparison report.
- Data-only query: call the relevant data tool (get_stock_price, get_company_overview, etc.) and answer directly.

**4. Resolve company names to tickers first.** If the user mentions company names (e.g. "Google", "Microsoft", "Apple") instead of tickers, call search_stock for each name to find the correct ticker symbol, then use those tickers in generate_stock_report or generate_comparison_report. Never guess a ticker — always confirm it with search_stock.

**5. Never skip a tool** when that data would strengthen the analysis. If a tool fails due to missing API keys, say so explicitly and continue with available data only.

**6. Report requests.** When a user asks for a report on one stock, call generate_stock_report. When asked to compare companies, call generate_comparison_report. Always return the saved artifact path.

**OUTPUT STANDARDS:**
- Tables for all comparisons of 2+ stocks or metrics — no empty cells.
- ### headers for sections in deep research.
- Emoji section markers: 📊 📈 💰 🏦 🔍 ⚠️ ✅ — bold key metrics.
- Show all calculations explicitly: FCF = Op.CF − CapEx = $X − $Y = $Z.
- Numbers: prices 2 decimals, % 1 decimal, large numbers 2 sig figs ($2.3B).
- Cite "Source: Alpha Vantage" after data-heavy sections.
`;

const COMPACT_SYSTEM_PROMPT = `You are a buy-side equity research analyst.

Rules:
- Fetch data via tools before stating facts.
- Batch tool calls in a single round.
- If given company names instead of tickers (e.g. "Google", "Microsoft"), call search_stock for each name first to get the correct ticker symbol, then use those tickers in report/comparison tools.
- Use tables for comparisons and show calculations.
- Return report paths when asked for reports.
- For sector/thematic queries (e.g. "top 5 AI data center companies"), call generate_sector_report with the sector query — it identifies the top companies automatically.
- For deep/thorough/comprehensive sector research, call generate_deep_sector_report — it maps sector dependencies and refines the company list before building the comparison.

Keep answers concise unless the user requests depth.`;

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
function trimHistory(messages: ChatMessage[], maxExchanges = 2): ChatMessage[] {
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
    if (finalAssistant) return [userMsg, truncateMessageContent(finalAssistant)];
    // If no clean final assistant message yet (in-progress exchange), keep as-is
    return exchange.map(truncateMessageContent);
  };

  // Keep the last 2 complete exchanges (so there's some conversation context)
  // plus the current in-progress exchange (last one) in full.
  const keepExchanges = exchanges.slice(-maxExchanges);
  const compacted = keepExchanges.flatMap((ex, idx) =>
    // Compact all but the last exchange (which is currently being processed)
    idx < keepExchanges.length - 1 ? compactExchange(ex) : ex
  );

  return [system, ...compacted.map(truncateMessageContent)];
}

function truncateMessageContent(message: ChatMessage): ChatMessage {
  if (!message.content || message.content.length <= MAX_HISTORY_MESSAGE_CHARS) {
    return message;
  }
  return {
    ...message,
    content: `${message.content.slice(0, MAX_HISTORY_MESSAGE_CHARS)}… [truncated]`,
  };
}

function compactToolPayload(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length <= TOOL_RESULT_MAX_STRING) return value;
    return `${value.slice(0, TOOL_RESULT_MAX_STRING)}… [truncated]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const sliced = value.slice(0, TOOL_RESULT_MAX_ARRAY);
    return sliced.map((item) => compactToolPayload(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= TOOL_RESULT_MAX_DEPTH) {
      return '[truncated]';
    }
    const entries = Object.entries(value).slice(0, TOOL_RESULT_MAX_KEYS);
    return entries.reduce<Record<string, any>>((acc, [key, val]) => {
      acc[key] = compactToolPayload(val, depth + 1);
      return acc;
    }, {});
  }
  return value;
}

function isSmallContextModel(model?: string | null): boolean {
  if (!model) return false;
  return /mini|flash|gpt-5/i.test(model);
}

function isToolCallLike(content: string | null | undefined): boolean {
  if (!content) return false;
  return /"name"\s*:\s*"functions\./.test(content) || /"arguments"\s*:\s*\{/.test(content);
}

function parseCompareRequest(message: string): string[] | null {
  const text = message.trim();
  if (!/compar/i.test(text)) return null;
  // Extract comma- or "vs"-separated ticker/company tokens
  const tickerPart = text
    .replace(/^.*?compar(?:e|ison\s+of|ison)?\s+(?:companies?\s+)?/i, '')
    .replace(/\s+report.*$/i, '');
  // Tokens are already uppercased via .toUpperCase() above.
  // Allow 2–30 uppercase letters so company names ("MICROSOFT") pass
  // alongside short tickers ("AMD"). Multi-word names like "PALO ALTO"
  // split into individual tokens; resolveSymbolFromQuery handles each token
  // separately via the SYMBOL_SEARCH API.
  const tokens = tickerPart
    .split(/\s*(?:,|vs\.?|and|\s)\s*/i)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => /^[A-Z]{2,30}$/.test(t));
  return tokens.length >= 2 ? tokens : null;
}

function parseReportRequest(message: string) {
  const text = message.trim();
  const lower = text.toLowerCase();

  const compareCompanies = parseCompareRequest(text);
  if (compareCompanies) {
    return { type: 'compare' as const, companies: compareCompanies };
  }

  const sectorMatch = text.match(/(sector|theme)\s+report\s+for\s+(.+)$/i);
  if (sectorMatch) {
    return { type: 'sector' as const, query: sectorMatch[2].trim() };
  }

  if (lower.includes('sector report') || lower.includes('theme report')) {
    const queryMatch = text.match(/report\s+for\s+(.+)$/i);
    if (queryMatch) {
      return { type: 'sector' as const, query: queryMatch[1].trim() };
    }
  }

  const genericMatch = text.match(/report\s+for\s+(.+)$/i);
  if (genericMatch) {
    const query = genericMatch[1].trim();
    if (query.includes(' ') || /sector|theme|stocks?/i.test(query)) {
      return { type: 'sector' as const, query };
    }
  }

  const stockMatch = text.match(/report\s+(?:for|on)\s+([a-zA-Z]{1,6})\s*$/i);
  if (stockMatch) {
    return { type: 'stock' as const, symbol: stockMatch[1].toUpperCase() };
  }

  return null;
}

function parseTimeframe(message: string) {
  const match = message.match(/\b(1w|1m|3m|6m|1y|3y|5y|max)\b/i);
  return match ? match[1].toLowerCase() : null;
}

function buildFallbackModels(requestedModel: string): string[] {
  const fromEnv = (process.env.COPILOT_FALLBACK_MODELS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const base = fromEnv.length > 0 ? fromEnv : DEFAULT_FALLBACK_MODELS;
  const combined = [requestedModel, ...base, FALLBACK_MODEL];
  return Array.from(new Set(combined.filter(Boolean)));
}

function selectToolNames() {
  const toolNames = [
    'search_stock',
    'get_stock_price',
    'get_company_overview',
    'get_basic_financials',
    'get_analyst_ratings',
    'get_analyst_recommendations',
    'get_price_targets',
    'get_news_sentiment',
    'get_company_news',
    'get_price_history',
    'get_earnings_history',
    'get_income_statement',
    'get_balance_sheet',
    'get_cash_flow',
    'get_peers',
    'get_insider_trading',
    'generate_stock_report',
    'generate_comparison_report',
    'generate_sector_report',
    'generate_deep_sector_report',
    'get_sector_performance',
    'get_top_gainers_losers',
  ];
  return { toolNames };
}
async function callGitHubModelsAPI(
  messages: ChatMessage[],
  githubToken: string,
  model: string,
  tools: ReturnType<typeof getToolDefinitionsByName>
): Promise<any> {
  const response = await fetch(GITHUB_MODELS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${githubToken}`,
      // GitHub API recommended headers — including User-Agent is important:
      // Node.js fetch() does NOT add a User-Agent automatically (unlike browsers),
      // so omitting it makes requests appear as anonymous bot/scraper traffic and
      // can trigger GitHub's anti-abuse 429 "scraping" response.
      'User-Agent': 'stock-report-app/1.0',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
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
    // GitHub Models returns 400 for most unknown model IDs, but 404 for certain
    // variants — treat both identically so the error is surfaced cleanly.
    if (response.status === 400 || response.status === 404) {
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

async function callOpenAIProxyAPI(
  messages: ChatMessage[],
  proxyKey: string,
  model: string,
  tools: ReturnType<typeof getToolDefinitionsByName>
): Promise<any> {
  const response = await fetch(`${OPENAI_PROXY_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${proxyKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`OpenAI Proxy API ${response.status}: ${errorText}`);
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'OpenAI Proxy authentication failed. ' +
        'Make sure OPENAI_API_KEY is set and valid for your network zone.'
      );
    }
    if (response.status === 429) {
      const err = new Error('Rate limit reached for this model.') as Error & { statusCode: number };
      err.statusCode = 429;
      throw err;
    }
    if (response.status === 413) {
      const err = new Error('Request too large for this model.') as Error & { statusCode: number };
      err.statusCode = 413;
      throw err;
    }
    throw new Error(`OpenAI Proxy API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Make a targeted LLM call — used for ticker resolution (resolving informal company
 * names or wrong tickers to official US exchange symbols before any API call).
 * Returns the raw response string (expected to be valid JSON).
 * Failures are caught and return '{}' so callers can continue gracefully.
 *
 * For GitHub Models we always use FILL_MODEL (gpt-4.1-mini by default) so the
 * ticker-resolution call draws from that model's separate, higher-quota pool rather
 * than the user's main gpt-4.1 daily quota.  On a 429 we wait 2 s and retry once
 * before giving up gracefully.
 */
async function callLLMForDataFill(
  prompt: string,
  githubToken: string | undefined,
  proxyKey: string | undefined,
  model: string,
  provider: 'github' | 'openai-proxy'
): Promise<string> {
  const fillMessages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a financial data assistant with knowledge of publicly traded companies. ' +
        'Provide factual financial data from your training. ' +
        'Return null for any value you are uncertain about. ' +
        'Respond ONLY with valid JSON — no markdown, no explanation.',
    },
    { role: 'user', content: prompt },
  ];

  // For GitHub Models, use the dedicated fill model (higher-quota pool).
  // For OpenAI proxy, respect the caller's model choice.
  const fillModel = provider === 'github' ? FILL_MODEL : model;

  const attempt = async (): Promise<string> => {
    let result: any;
    if (provider === 'openai-proxy' && proxyKey) {
      result = await callOpenAIProxyAPI(fillMessages, proxyKey, fillModel, []);
    } else if (githubToken) {
      result = await callGitHubModelsAPI(fillMessages, githubToken, fillModel, []);
    } else {
      return '{}';
    }
    return String(result.choices?.[0]?.message?.content || '{}');
  };

  try {
    return await attempt();
  } catch (err: any) {
    if (err?.statusCode === 429) {
      // Brief pause, then one retry — handles transient per-minute bursts.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        return await attempt();
      } catch {
        return '{}';
      }
    }
    return '{}';
  }
}

/** Creates an LLMFiller callback bound to the current model and provider. */
function createLLMFiller(
  githubToken: string | undefined,
  proxyKey: string | undefined,
  model: string,
  provider: 'github' | 'openai-proxy'
): LLMFiller | undefined {
  if (!githubToken && !proxyKey) return undefined;
  return (prompt: string) => callLLMForDataFill(prompt, githubToken, proxyKey, model, provider);
}

export async function POST(request: NextRequest) {
  let provider: string | undefined;
  try {
    const body = await request.json();
    const { message, sessionId, model } = body;
    provider = body.provider;

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Check if GitHub token is available
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.COPILOT_GITHUB_TOKEN;
    const proxyKey = process.env.OPENAI_API_KEY || process.env.OPENAI_TOKEN;

    // Initialize stock service (always uses real Alpha Vantage API)
    const dataProvider = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase();
    const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (dataProvider !== 'finnhub' && !alphaVantageKey) {
      return NextResponse.json(
        {
          error: 'Alpha Vantage API key not configured',
          details: 'Please set ALPHA_VANTAGE_API_KEY environment variable for Alpha Vantage or hybrid mode.',
        },
        { status: 503 }
      );
    }
    const stockService: StockDataService = createStockService(alphaVantageKey);

    const reportRequest = parseReportRequest(message);
    const timeframe = parseTimeframe(message);
    if (reportRequest) {
      const currentSessionId = sessionId || Math.random().toString(36).substring(7);
      const conversationMessages: ChatMessage[] = sessionId ? sessions.get(sessionId) || [] : [];
      const systemPrompt = process.env.USE_FULL_SYSTEM_PROMPT === 'true'
        ? SYSTEM_PROMPT
        : COMPACT_SYSTEM_PROMPT;
      if (conversationMessages.length === 0) {
        conversationMessages.push({ role: 'system', content: systemPrompt });
      }

      conversationMessages.push({ role: 'user', content: message });

      const directProvider: 'github' | 'openai-proxy' = provider === 'openai-proxy' ? 'openai-proxy' : 'github';
      const directModel = model || DEFAULT_MODEL;
      const llmFill = createLLMFiller(githubToken, proxyKey, directModel, directProvider);

      const toolResult = reportRequest.type === 'compare'
        ? await executeTool(
            'generate_comparison_report',
            { companies: reportRequest.companies, range: timeframe || '1y' },
            stockService,
            { llmFill }
          )
        : reportRequest.type === 'sector'
          ? await executeTool(
              'generate_sector_report',
              { sector: reportRequest.query, range: timeframe || '1y' },
              stockService,
              { llmFill }
            )
          : await executeTool(
              'generate_stock_report',
              { symbol: (reportRequest as any).symbol, range: timeframe || '5y' },
              stockService,
              { llmFill }
            );

      if (!toolResult.success) {
        return NextResponse.json(
          { error: toolResult.error || toolResult.message || 'Report generation failed' },
          { status: 500 }
        );
      }

      const downloadUrl = toolResult.data?.downloadUrl;
      const filename = toolResult.data?.filename as string | undefined;
      const content = toolResult.data?.content as string | undefined;
      const responseText = 'Report ready — open the **Artifacts** panel to view it.';

      conversationMessages.push({ role: 'assistant', content: responseText });
      sessions.set(currentSessionId, conversationMessages);

      console.info('Chat request stats', {
        provider: provider || 'github',
        model: model || DEFAULT_MODEL,
        rounds: 0,
        toolCalls: 1,
        toolsProvided: 0,
        directReport: reportRequest.type,
      });

      return NextResponse.json({
        response: responseText,
        sessionId: currentSessionId,
        model: model || DEFAULT_MODEL,
        provider: provider || 'github',
        report: filename && content ? { filename, content, downloadUrl } : null,
        stats: {
          rounds: 0,
          toolCalls: 1,
          toolsProvided: 0,
        },
      });
    }

    // Get or create conversation history
    let conversationMessages: ChatMessage[] = sessionId ? sessions.get(sessionId) || [] : [];
    const currentSessionId = sessionId || Math.random().toString(36).substring(7);

    const requestedModel = model || DEFAULT_MODEL;
    const preferCompactPrompt = isSmallContextModel(requestedModel);
    const systemPrompt = process.env.USE_FULL_SYSTEM_PROMPT === 'true' && !preferCompactPrompt
      ? SYSTEM_PROMPT
      : COMPACT_SYSTEM_PROMPT;
    if (conversationMessages.length === 0) {
      conversationMessages.push({ role: 'system', content: systemPrompt });
    } else {
      // Trim accumulated tool messages from previous turns to stay within
      // the model's input token limit (8,000 tokens for high/low tier models,
      // minus ~5,500 tokens of fixed overhead = only ~2,500 tokens for history).
      const maxExchanges = isSmallContextModel(model) ? 1 : 2;
      conversationMessages = trimHistory(conversationMessages, maxExchanges);
    }

    // Add user message
    conversationMessages.push({ role: 'user', content: message });

    const { toolNames } = selectToolNames();
    const toolDefinitions = getToolDefinitionsByName(toolNames);

    // Call the Copilot API with tool-calling loop
    let rounds = 0;
    let totalToolCalls = 0;
    let assistantContent: string | null = null;
    let activeModel = requestedModel;
    let activeProvider: 'github' | 'openai-proxy' = provider === 'openai-proxy' ? 'openai-proxy' : 'github';
    if (AUTO_DOWNGRADE_GPT5 && /gpt-5/i.test(activeModel) && activeProvider === 'github') {
      activeModel = DEFAULT_MODEL;
    }
    let toolDefinitionsUsed = toolDefinitions;
    const fallbackModels = buildFallbackModels(activeModel);
    let fallbackIndex = Math.max(0, fallbackModels.findIndex((item) => item === activeModel));
    // Collect report artifacts generated by the model during the tool loop
    const reportArtifacts: Array<{ filename: string; content: string; downloadUrl: string }> = [];

    const callProvider = async (
      messages: ChatMessage[],
      providerId: 'github' | 'openai-proxy',
      modelId: string,
      tools: ReturnType<typeof getToolDefinitionsByName>
    ) => {
      if (providerId === 'openai-proxy') {
        if (!proxyKey) {
          const err = new Error('OpenAI proxy key not configured') as Error & { statusCode: number };
          err.statusCode = 503;
          throw err;
        }
        return callOpenAIProxyAPI(messages, proxyKey, modelId, tools);
      }
      if (!githubToken) {
        const err = new Error('GitHub token not configured') as Error & { statusCode: number };
        err.statusCode = 503;
        throw err;
      }
      return callGitHubModelsAPI(messages, githubToken, modelId, tools);
    };

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      let result: any;
      let attempt = 0;
      let retryMessages = conversationMessages;
      let retryTools = toolDefinitions;
      while (attempt < 2) {
        try {
          result = await callProvider(retryMessages, activeProvider, activeModel, retryTools);
          toolDefinitionsUsed = retryTools;
          break;
        } catch (error: any) {
          const isRateLimit = error?.statusCode === 429;
          const isUnknownModel = error?.statusCode === 400;
          const isTokensLimit = error?.statusCode === 413;
          // Unknown model: skip to the next fallback without counting as an attempt —
          // retrying with the same invalid model ID would always fail.
          if (isUnknownModel) {
            if (fallbackIndex < fallbackModels.length - 1) {
              fallbackIndex += 1;
              activeModel = fallbackModels[fallbackIndex];
              continue;
            }
            throw error;
          }
          if (attempt === 0 && isRateLimit) {
            if (fallbackIndex < fallbackModels.length - 1) {
              fallbackIndex += 1;
              activeModel = fallbackModels[fallbackIndex];
              attempt++;
              continue;
            }
            if (activeProvider !== 'openai-proxy' && proxyKey) {
              activeProvider = 'openai-proxy';
              attempt++;
              continue;
            }
          }
          if (attempt === 0 && isTokensLimit) {
            retryMessages = [
              { role: 'system', content: COMPACT_SYSTEM_PROMPT },
              { role: 'user', content: message },
            ];
            retryTools = getToolDefinitionsByName(selectToolNames().toolNames);
            attempt++;
            continue;
          }
          throw error;
        }
      }
      const choice = result.choices?.[0];

      if (!choice) {
        throw new Error('No response from the model');
      }

      const assistantMessage = choice.message;

      // Add assistant message to conversation
      conversationMessages.push(assistantMessage);

      // If the model wants to call tools, execute all of them in parallel
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        totalToolCalls += assistantMessage.tool_calls.length;
        const loopLLMFill = createLLMFiller(githubToken, proxyKey, activeModel, activeProvider);
        const toolResults = await Promise.all(
          assistantMessage.tool_calls.map(async (toolCall: { id: string; function: { name: string; arguments: string } }) => {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);
            const toolResult = await executeTool(toolName, toolArgs, stockService, { llmFill: loopLLMFill });
            // Collect report artifacts; strip full content from model response to avoid echoing
            if (
              (toolName === 'generate_stock_report' || toolName === 'generate_comparison_report' || toolName === 'generate_sector_report' || toolName === 'generate_deep_sector_report') &&
              toolResult.success && toolResult.data?.filename && toolResult.data?.content
            ) {
              reportArtifacts.push({
                filename: toolResult.data.filename as string,
                content: toolResult.data.content as string,
                downloadUrl: toolResult.data.downloadUrl as string,
              });
              return {
                role: 'tool' as const,
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  success: true,
                  message: `Report saved to Artifacts panel: ${toolResult.data.filename}`,
                  filename: toolResult.data.filename,
                  downloadUrl: toolResult.data.downloadUrl,
                }),
              };
            }
            return {
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: JSON.stringify(compactToolPayload(toolResult)),
            };
          })
        );
        conversationMessages.push(...toolResults);
        // Continue the loop so the model can process tool results
        continue;
      }

      // No tool calls — we have the final response
      assistantContent = assistantMessage.content;
      if (isToolCallLike(assistantContent)) {
        const err = new Error('Model returned tool calls as plain text.') as Error & { statusCode: number };
        err.statusCode = 422;
        throw err;
      }
      break;
    }

    // Save conversation history
    sessions.set(currentSessionId, conversationMessages);

    console.info('Chat request stats', {
      provider: activeProvider,
      model: activeModel,
      rounds,
      toolCalls: totalToolCalls,
      toolsProvided: toolDefinitionsUsed.length,
    });

    return NextResponse.json({
      response: assistantContent || "I apologize, but I couldn't generate a response. Please try again.",
      sessionId: currentSessionId,
      model: activeModel,
      provider: activeProvider,
      reports: reportArtifacts.length > 0 ? reportArtifacts : undefined,
      stats: {
        rounds,
        toolCalls: totalToolCalls,
        toolsProvided: toolDefinitionsUsed.length,
      },
    });
  } catch (error: any) {
    console.error('Chat API error:', error);
    const isRateLimit = error.statusCode === 429;
    const isUnknownModel = error.statusCode === 400;
    const isTokensLimit = error.statusCode === 413;
    const isToolCallText = error.statusCode === 422;
    const isMissingKey = error.statusCode === 503;
    const statusCode = error.statusCode || (isRateLimit
      ? 429
      : isUnknownModel
      ? 400
      : isTokensLimit
      ? 413
      : isToolCallText
      ? 422
      : 500);
    let details: string;
    if (isRateLimit) {
      details = RATE_LIMIT_GUIDANCE;
    } else if (isUnknownModel) {
      details = 'Open the model dropdown and choose a different model. The model list is fetched live from the GitHub Models catalog.';
    } else if (isTokensLimit) {
      details = `The conversation history has grown too large for this model's token limit. Start a new chat to clear the history and try again.`;
    } else if (isToolCallText) {
      details = 'This model returned tool calls as plain text. Switch to a tool-calling model from the dropdown (for example, GPT-4.1 or Claude Sonnet).';
    } else if (isMissingKey) {
      details =
        error.message === 'OpenAI proxy key not configured'
          ? 'Please set OPENAI_API_KEY in your Vercel environment variables.'
          : 'Please set GITHUB_TOKEN in your Vercel environment variables. Get a personal access token at: https://github.com/settings/personal-access-tokens — this uses your existing GitHub Copilot subscription.';
    } else if (provider === 'openai-proxy') {
      details =
        'Make sure OPENAI_API_KEY is set in your Vercel environment variables, and that the proxy URL is reachable from this deployment. ' +
        'If you see TLS errors, install Arm root certificates for the runtime environment.';
    } else {
      details = 'Make sure GITHUB_TOKEN and ALPHA_VANTAGE_API_KEY are set in your Vercel environment variables.';
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
