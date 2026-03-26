/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getToolDefinitionsByName, executeTool, type LLMFiller } from '@/app/lib/stockTools';
import { createStockService, StockDataService } from '@/app/lib/stockDataService';

// GitHub Models API — new endpoint (azure endpoint deprecated Oct 2025)
// Works with PATs from github.com/settings/personal-access-tokens (models:read scope)
const GITHUB_MODELS_URL = 'https://models.github.ai/inference/chat/completions';
const DEFAULT_MODEL = process.env.COPILOT_MODEL || 'openai/gpt-4.1';
const FALLBACK_MODEL = process.env.COPILOT_FALLBACK_MODEL || DEFAULT_MODEL;
// Gap-fill uses a lighter model so it doesn't burn the user's main model quota.
// gpt-4.1-mini has a separate (much higher) rate limit on GitHub Models.
// Override with FILL_MODEL env var if needed.
const FILL_MODEL = process.env.FILL_MODEL || 'openai/gpt-4.1-mini';

// Gemini API — OpenAI-compatible endpoint; same request/response format as GitHub Models.
// Auth: GEMINI_TOKEN (Bearer). Get a key at: https://aistudio.google.com/api-keys
// IMPORTANT: use a key created at aistudio.google.com, NOT Google Cloud Console —
// AI Studio keys come with free-tier quotas automatically allocated.
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
// Default Gemini model. Override with GEMINI_MODEL env var.
// gemini-2.5-flash is the recommended default — it has free-tier quota on AI Studio keys
// (5 RPM / 250K TPM / 20 RPD as of 2026-03).
// gemini-2.0-flash has 0 free-tier quota on most projects and will always 429.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
// Automatic Gemini model fallback list — tried in order when a model is rate-limited (429),
// temporarily unavailable (503), or returns an invalid-model error (400).
// Order: start with best reasoning quality, fall through to higher-RPM / higher-RPD models.
// All entries below have confirmed free-tier quota on AI Studio keys (as of 2026-03):
//   gemini-2.5-flash       5 RPM / 250K TPM / 20 RPD
//   gemini-2.5-flash-lite 10 RPM / 250K TPM / 20 RPD
//   gemini-3.0-flash       5 RPM / 250K TPM / 20 RPD
//   gemini-3.1-flash-lite 15 RPM / 250K TPM / 500 RPD  ← highest RPD
const GEMINI_FALLBACK_MODELS = [
  GEMINI_MODEL,              // env override or gemini-2.5-flash (default)
  'gemini-2.5-flash-lite',   // 10 RPM — handles per-minute bursts
  'gemini-3.0-flash',        // separate quota pool from 2.x models
  'gemini-3.1-flash-lite',   // 15 RPM / 500 RPD — best free-tier daily allowance
];

// LLM provider selection — mirrors the STOCK_DATA_PROVIDER pattern for data services.
// - 'github' (default): GitHub Models API only (GITHUB_TOKEN required)
// - 'gemini':           Gemini API only (GEMINI_TOKEN required)
// - 'hybrid':           GitHub Models primary; Gemini auto-fallback on HTTP 429 rate limit
type LLMProviderType = 'github' | 'gemini' | 'hybrid';
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'github').toLowerCase() as LLMProviderType;
const AUTO_DOWNGRADE_GPT5 = process.env.AUTO_DOWNGRADE_GPT5 !== 'false';
const DEFAULT_FALLBACK_MODELS = [
  DEFAULT_MODEL,
  'openai/gpt-4.1',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-sonnet',
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

const MODEL_COOLDOWN_MS = Number(process.env.LLM_MODEL_COOLDOWN_MS || 120000);
const modelCooldowns = new Map<string, number>();

function isModelCoolingDown(modelId: string): boolean {
  const until = modelCooldowns.get(modelId);
  if (!until) return false;
  if (until <= Date.now()) {
    modelCooldowns.delete(modelId);
    return false;
  }
  return true;
}

function markModelCooldown(modelId: string, retryAfterMs?: number) {
  const cooldown = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : MODEL_COOLDOWN_MS;
  modelCooldowns.set(modelId, Date.now() + cooldown);
}

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

**1b. No training-data facts.** Never use model memory/training data for numeric or time-sensitive market facts. If tools return nothing, state that the data is unavailable.

**2. Batch all parallel calls in ONE round.** Researching N stocks? Issue ALL tool calls simultaneously in a single response — never one at a time. This is critical for multi-stock reports.

**3. Match depth to the question.**
- Individual stock report: call generate_stock_report with the ticker symbol.
- Company comparison report: call generate_comparison_report with the list of ticker symbols.
- Deep research: call generate_deep_sector_report when the user asks for thematic, sector, industry, or broad deep research (e.g. "AI infrastructure", "semiconductors"). It identifies a broad candidate list, maps supply-chain/customer/market/news dependencies, refines the company list, and builds a full comparison report.
- Data-only query: call the relevant data tool (get_stock_price, get_company_overview, etc.) and answer directly.

**4. Resolve company names to tickers first.** If the user mentions company names (e.g. "Google", "Microsoft", "Apple") instead of tickers, call search_stock for each name to find the correct ticker symbol, then use those tickers in generate_stock_report or generate_comparison_report. Never guess a ticker — always confirm it with search_stock.

**5. Never skip a tool** when that data would strengthen the analysis. If a tool fails due to missing API keys, say so explicitly and continue with available data only.

**6. Report requests.** When a user asks for a report on one stock, call generate_stock_report. When asked to compare companies, call generate_comparison_report. When asked for thematic, sector, industry, or broad deep research, call generate_deep_sector_report. Always return the saved artifact path.

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
- Never use training data for numeric market facts; say "data unavailable" if tools fail.
- Batch tool calls in a single round.
- If given company names instead of tickers (e.g. "Google", "Microsoft"), call search_stock for each name first to get the correct ticker symbol, then use those tickers in report/comparison tools.
- Use tables for comparisons and show calculations.
- Return report paths when asked for reports.
- For thematic, sector, or industry research queries (e.g. "AI infrastructure", "semiconductors", "deep research on AI data center companies"), call generate_deep_sector_report — it maps dependencies and refines the company list before building the comparison.

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

  const deepSectorMatch = text.match(/deep(?:\s+sector)?(?:\s+(?:research|analysis))?(?:\s+report)?\s+(?:for|on)\s+(.+)$/i);
  if (deepSectorMatch) {
    return { type: 'deep-sector' as const, query: deepSectorMatch[1].trim() };
  }

  const compareCompanies = parseCompareRequest(text);
  if (compareCompanies) {
    return { type: 'compare' as const, companies: compareCompanies };
  }

  const sectorMatch = text.match(/(sector|theme)\s+report\s+for\s+(.+)$/i);
  if (sectorMatch) {
    return { type: 'deep-sector' as const, query: sectorMatch[2].trim() };
  }

  if (lower.includes('sector report') || lower.includes('theme report')) {
    const queryMatch = text.match(/report\s+for\s+(.+)$/i);
    if (queryMatch) {
      return { type: 'deep-sector' as const, query: queryMatch[1].trim() };
    }
  }

  const genericMatch = text.match(/report\s+for\s+(.+)$/i);
  if (genericMatch) {
    const query = genericMatch[1].trim();
    if (query.includes(' ') || /sector|theme|stocks?/i.test(query)) {
      return { type: 'deep-sector' as const, query };
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
  const unique = Array.from(new Set(combined.filter(Boolean)));
  const available = unique.filter((model) => !isModelCoolingDown(model));
  return available.length > 0 ? available : unique;
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

/**
 * Call the Gemini API using its OpenAI-compatible endpoint.
 * The request/response format is identical to the GitHub Models / OpenAI API, so
 * the same message building, tool definitions, and response parsing all work unchanged.
 * Auth uses GEMINI_TOKEN (Bearer) — key obtained at https://aistudio.google.com/api-keys
 * Model names use Gemini format, e.g. 'gemini-2.0-flash' (set via GEMINI_MODEL env var).
 */
async function callGeminiAPI(
  messages: ChatMessage[],
  geminiToken: string,
  model: string,
  tools: ReturnType<typeof getToolDefinitionsByName>
): Promise<any> {
  const body: Record<string, unknown> = { model, messages };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${geminiToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Gemini API ${response.status}: ${errorText}`);
    if (response.status === 401) {
      throw new Error(
        'Gemini API authentication failed (401). ' +
        'Your GEMINI_TOKEN may be invalid or expired. ' +
        'Get a new key at https://aistudio.google.com/api-keys. ' +
        `API response: ${errorText}`
      );
    }
    if (response.status === 429) {
      let retryAfterMs: number | undefined;
      let waitMsg = '';
      try {
        const errorJson = JSON.parse(errorText);
        // Check structured RetryInfo details from Gemini response
        const details: any[] = errorJson?.error?.details || [];
        for (const detail of details) {
          if (detail['@type']?.includes('RetryInfo') && detail.retryDelay) {
            const match = String(detail.retryDelay).match(/^(\d+(?:\.\d+)?)s?$/);
            if (match) {
              retryAfterMs = Math.ceil(parseFloat(match[1]) * 1000);
              waitMsg = ` Please retry in ${Math.ceil(parseFloat(match[1]))} second(s).`;
            }
          }
        }
        // Also check plain-text hint in the message field
        if (!retryAfterMs) {
          const msgMatch = String(errorJson?.error?.message || '').match(/please retry in (\d+(?:\.\d+)?)s/i);
          if (msgMatch) {
            retryAfterMs = Math.ceil(parseFloat(msgMatch[1]) * 1000);
            waitMsg = ` Please retry in ${Math.ceil(parseFloat(msgMatch[1]))} second(s).`;
          }
        }
      } catch {
        // ignore JSON parse errors
      }
      const err = new Error(
        `Gemini API rate limit reached (429) for model '${model}'.${waitMsg}`
      ) as Error & { statusCode: number; retryAfterMs?: number };
      err.statusCode = 429;
      if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
      throw err;
    }
    if (response.status === 503) {
      const err = new Error(
        `Gemini API model '${model}' temporarily unavailable (503) — high demand. Will try next model.`
      ) as Error & { statusCode: number };
      err.statusCode = 503;
      throw err;
    }
    if (response.status === 400) {
      const err = new Error(
        `Gemini API bad request (400). Model '${model}' may be invalid — check GEMINI_MODEL env var. ` +
        `API response: ${errorText}`
      ) as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    }
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Call Gemini with automatic model fallback on retriable errors.
 * Steps through GEMINI_FALLBACK_MODELS in order, trying each on:
 *   429 — quota/rate-limit exhausted (separate quota pool per model)
 *   503 — model temporarily unavailable due to high demand
 *   400 — model ID not found / invalid (skip to the next valid model)
 * Any other error (401 auth, 5xx non-503, etc.) is thrown immediately.
 */
async function callGeminiWithFallback(
  messages: ChatMessage[],
  geminiToken: string,
  tools: ReturnType<typeof getToolDefinitionsByName>
): Promise<any> {
  // Status codes that mean "this model can't serve right now — try the next one"
  const RETRIABLE = new Set([429, 503, 400]);
  let lastErr: any;
  for (const model of GEMINI_FALLBACK_MODELS) {
    try {
      return await callGeminiAPI(messages, geminiToken, model, tools);
    } catch (err: any) {
      lastErr = err;
      if (!RETRIABLE.has(err?.statusCode)) throw err;
      const isLast = model === GEMINI_FALLBACK_MODELS[GEMINI_FALLBACK_MODELS.length - 1];
      if (!isLast) {
        console.info(`Gemini model '${model}' unavailable (${err?.statusCode}) — trying next model`);
        // Honor the provider's requested retry delay before moving on (capped at 10 s).
        const delayMs = Math.min(err?.retryAfterMs ?? 0, 10000);
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastErr;
}

/**
 * Make a targeted LLM call — used for ticker resolution (resolving informal company
 * names or wrong tickers to official US exchange symbols before any API call).
 * Returns the raw response string (expected to be valid JSON).
 * Failures are caught and return '{}' so callers can continue gracefully.
 *
 * Provider selection mirrors LLM_PROVIDER:
 * - 'github':  GitHub Models FILL_MODEL (gpt-4.1-mini) — separate quota from main model
 * - 'gemini':  callGeminiWithFallback — tries GEMINI_FALLBACK_MODELS in order
 * - 'hybrid':  GitHub Models primary; auto-falls back to Gemini (with model fallback) on 429
 * On 429, waits for the provider's requested retryDelay (capped at 10 s) and retries once.
 */
async function callLLMForDataFill(
  prompt: string,
  githubToken: string | undefined,
  geminiToken: string | undefined,
): Promise<string> {
  const fillMessages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a financial data assistant. ' +
        'Use ONLY the facts explicitly provided in the prompt. Do not use training data for numeric values. ' +
        'For ticker-resolution prompts you may rely on publicly listed tickers, but return null if unsure. ' +
        'Return null for any value you cannot confirm. ' +
        'Respond ONLY with valid JSON — no markdown, no explanation.',
    },
    { role: 'user', content: prompt },
  ];

  const attempt = async (): Promise<string> => {
    let result: any;
    if (LLM_PROVIDER === 'gemini') {
      if (!geminiToken) return '{}';
      result = await callGeminiWithFallback(fillMessages, geminiToken, []);
    } else if (LLM_PROVIDER === 'hybrid') {
      if (githubToken) {
        try {
          result = await callGitHubModelsAPI(fillMessages, githubToken, FILL_MODEL, []);
        } catch (err: any) {
          // Hybrid: auto-fall back to Gemini (with model fallback) when GitHub is rate-limited
          if (err?.statusCode === 429 && geminiToken) {
            result = await callGeminiWithFallback(fillMessages, geminiToken, []);
          } else {
            throw err;
          }
        }
      } else if (geminiToken) {
        result = await callGeminiWithFallback(fillMessages, geminiToken, []);
      } else {
        return '{}';
      }
    } else {
      // Default: github mode
      if (!githubToken) return '{}';
      result = await callGitHubModelsAPI(fillMessages, githubToken, FILL_MODEL, []);
    }
    return String(result.choices?.[0]?.message?.content || '{}');
  };

  try {
    return await attempt();
  } catch (err: any) {
    if (err?.statusCode === 429) {
      // Honor the provider's requested retry delay; cap at 10 s to avoid stalling requests.
      // Falls back to 2 s for providers that don't include a retry hint.
      const delayMs = Math.min(err?.retryAfterMs ?? 2000, 10000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        return await attempt();
      } catch {
        return '{}';
      }
    }
    return '{}';
  }
}

/** Creates an LLMFiller callback bound to the active tokens. */
function createLLMFiller(
  githubToken: string | undefined,
  geminiToken: string | undefined,
): LLMFiller | undefined {
  if (!githubToken && !geminiToken) return undefined;
  return (prompt: string) => callLLMForDataFill(prompt, githubToken, geminiToken);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, sessionId, model } = body;

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Check if GitHub token is available
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.COPILOT_GITHUB_TOKEN;
    // Check if Gemini token is available (never exposed client-side — server env only)
    const geminiToken = process.env.GEMINI_TOKEN;

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

      const llmFill = createLLMFiller(githubToken, geminiToken);

      const toolResult = reportRequest.type === 'compare'
        ? await executeTool(
            'generate_comparison_report',
            { companies: reportRequest.companies, range: timeframe || '1y' },
            stockService,
            { llmFill }
          )
        : reportRequest.type === 'deep-sector'
          ? await executeTool(
              'generate_deep_sector_report',
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
        provider: LLM_PROVIDER,
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
        provider: LLM_PROVIDER,
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
    if (AUTO_DOWNGRADE_GPT5 && /gpt-5/i.test(activeModel)) {
      activeModel = DEFAULT_MODEL;
    }
    if (isModelCoolingDown(activeModel)) {
      const fallbackModels = buildFallbackModels(activeModel);
      activeModel = fallbackModels[0] || activeModel;
    }
    let toolDefinitionsUsed = toolDefinitions;
    const fallbackModels = buildFallbackModels(activeModel);
    let fallbackIndex = Math.max(0, fallbackModels.findIndex((item) => item === activeModel));
    // Collect report artifacts generated by the model during the tool loop
    const reportArtifacts: Array<{ filename: string; content: string; downloadUrl: string }> = [];

    // LLM provider selection — mirrors STOCK_DATA_PROVIDER pattern.
    // Closes over githubToken and geminiToken from the request scope (never client-side).
    const callProvider = async (
      messages: ChatMessage[],
      modelId: string,
      tools: ReturnType<typeof getToolDefinitionsByName>
    ) => {
      if (LLM_PROVIDER === 'gemini') {
        // Gemini-only mode: all LLM calls go to Gemini API with automatic model fallback
        if (!geminiToken) {
          const err = new Error(
            'Gemini token not configured. Set GEMINI_TOKEN environment variable.'
          ) as Error & { statusCode: number };
          err.statusCode = 503;
          throw err;
        }
        return callGeminiWithFallback(messages, geminiToken, tools);
      }

      if (LLM_PROVIDER === 'hybrid') {
        // Hybrid mode: GitHub Models primary, Gemini auto-fallback on HTTP 429.
        // Uses callGeminiWithFallback so gemini-2.0-flash → gemini-1.5-flash if needed.
        // The model-switching fallback chain (fallbackModels) still applies to non-429 errors.
        if (githubToken) {
          try {
            return await callGitHubModelsAPI(messages, githubToken, modelId, tools);
          } catch (err: any) {
            // Automatically fall back to Gemini when GitHub Models is rate-limited
            if (err?.statusCode === 429 && geminiToken) {
              console.info('GitHub Models rate limit hit — falling back to Gemini API');
              // callGeminiWithFallback steps through GEMINI_FALLBACK_MODELS internally.
              // Any remaining error propagates with retryAfterMs for the outer loop to honor.
              return await callGeminiWithFallback(messages, geminiToken, tools);
            }
            throw err;
          }
        }
        // No GitHub token; use Gemini directly if available
        if (geminiToken) {
          return callGeminiWithFallback(messages, geminiToken, tools);
        }
        const err = new Error(
          'No LLM provider tokens configured. Set GITHUB_TOKEN and/or GEMINI_TOKEN.'
        ) as Error & { statusCode: number };
        err.statusCode = 503;
        throw err;
      }

      // Default: github mode — GitHub Models only
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
          result = await callProvider(retryMessages, activeModel, retryTools);
          toolDefinitionsUsed = retryTools;
          break;
        } catch (error: any) {
          const isRateLimit = error?.statusCode === 429 || error?.statusCode === 503;
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
            markModelCooldown(activeModel, error?.retryAfterMs);
            if (fallbackIndex < fallbackModels.length - 1) {
              fallbackIndex += 1;
              activeModel = fallbackModels[fallbackIndex];
              // Honor the provider's requested retry delay (e.g. Gemini RetryInfo), capped at 10 s.
              const delayMs = Math.min(error?.retryAfterMs ?? 0, 10000);
              if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
              }
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
        const loopLLMFill = createLLMFiller(githubToken, geminiToken);
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
      provider: LLM_PROVIDER,
      model: activeModel,
      rounds,
      toolCalls: totalToolCalls,
      toolsProvided: toolDefinitionsUsed.length,
    });

    return NextResponse.json({
      response: assistantContent || "I apologize, but I couldn't generate a response. Please try again.",
      sessionId: currentSessionId,
      model: activeModel,
      provider: LLM_PROVIDER,
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
      if (LLM_PROVIDER === 'gemini') {
        details = 'Please set GEMINI_TOKEN in your Vercel environment variables. Get a key at: https://aistudio.google.com/api-keys';
      } else if (LLM_PROVIDER === 'hybrid') {
        details = 'Please set GITHUB_TOKEN and/or GEMINI_TOKEN in your Vercel environment variables.';
      } else {
        details =
          'Please set GITHUB_TOKEN in your Vercel environment variables. Get a personal access token at: https://github.com/settings/personal-access-tokens — this uses your existing GitHub Copilot subscription.';
      }
    } else {
      details = 'Make sure your LLM provider tokens (GITHUB_TOKEN and/or GEMINI_TOKEN) and ALPHA_VANTAGE_API_KEY are set in your Vercel environment variables.';
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
