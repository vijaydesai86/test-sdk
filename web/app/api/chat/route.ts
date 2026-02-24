import { NextRequest, NextResponse } from 'next/server';
import { getToolDefinitionsByName, executeTool } from '@/app/lib/stockTools';
import { AlphaVantageService, StockDataService } from '@/app/lib/stockDataService';

// GitHub Models API — new endpoint (azure endpoint deprecated Oct 2025)
// Works with PATs from github.com/settings/personal-access-tokens (models:read scope)
const GITHUB_MODELS_URL = 'https://models.github.ai/inference/chat/completions';
const OPENAI_PROXY_BASE_URL =
  process.env.OPENAI_PROXY_BASE_URL ||
  'https://openai-api-proxy.geo.arm.com/api/providers/openai/v1';
const DEFAULT_MODEL = process.env.COPILOT_MODEL || 'openai/gpt-4.1';
const FALLBACK_MODEL = process.env.COPILOT_FALLBACK_MODEL || DEFAULT_MODEL;
const AUTO_DOWNGRADE_GPT5 = process.env.AUTO_DOWNGRADE_GPT5 !== 'false';
const DEFAULT_FALLBACK_MODELS = [
  DEFAULT_MODEL,
  'anthropic/claude-sonnet-4-6',
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
- Single-stock deep dive: get_stock_price + get_company_overview + get_basic_financials + get_earnings_history + get_income_statement + get_balance_sheet + get_cash_flow + get_analyst_ratings + get_analyst_recommendations + get_price_targets + get_news_sentiment + get_company_news + get_price_history.
- Peer comparison: get_peers → batch get_company_overview + get_basic_financials + get_stock_price + get_analyst_ratings for ALL peers.
- Sector/theme report: screen_stocks or get_stocks_by_sector → batch get_company_overview + get_stock_price + get_basic_financials for ALL stocks.
- News-driven theme: search_news + search_companies → build list → batch core tools.
- Investment allocation: batch full data for all candidates → quantitative scoring → exact $ amounts, stop-losses, rebalancing triggers.

**4. Never skip a tool** when that data would strengthen the analysis. If a tool fails due to missing API keys, say so explicitly and continue with available data only.

**5. No hardcoded lists.** Always derive sector, theme, and peer lists from tools like screen_stocks, search_companies, get_peers, or search_news.

**6. Report requests.** When a user asks for a full report, call generate_stock_report or generate_sector_report and return the saved artifact path.

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

const COMPACT_SYSTEM_PROMPT = `You are a buy-side equity research analyst.

Rules:
- Fetch data via tools before stating facts.
- Batch tool calls in a single round.
- Use tables for comparisons and show calculations.
- Return report paths when asked for reports.

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

function parseReportRequest(message: string) {
  const text = message.trim();
  const stockMatch = text.match(/report\s+(?:for|on)\s+([a-zA-Z]{1,6})\b/i);
  if (stockMatch) {
    return { type: 'stock' as const, symbol: stockMatch[1].toUpperCase() };
  }

  const sectorMatch = text.match(/(sector|theme)\s+report\s+for\s+(.+)$/i);
  if (sectorMatch) {
    return { type: 'sector' as const, query: sectorMatch[2].trim() };
  }

  const genericMatch = text.match(/report\s+for\s+(.+)$/i);
  if (genericMatch) {
    return { type: 'sector' as const, query: genericMatch[1].trim() };
  }

  return null;
}

function parseAnalystTrendsRequest(message: string) {
  const match = message.match(/analyst\s+(?:rating|recommendation)?\s*trends?\s+for\s+([a-zA-Z]{1,6})/i)
    || message.match(/([a-zA-Z]{1,6})\s+analyst\s+(?:rating|recommendation)?\s*trends?/i);
  if (match) {
    return { symbol: match[1].toUpperCase() };
  }
  return null;
}

function parseSymbolAfterKeyword(message: string, keyword: string) {
  const regex = new RegExp(`${keyword}\\s+(?:for|of|on)?\\s*([a-zA-Z]{1,6})`, 'i');
  const match = message.match(regex);
  if (match) {
    return { symbol: match[1].toUpperCase() };
  }
  return null;
}

function parseSearchRequest(message: string) {
  const match = message.match(/search\s+stock\s+(?:for\s+)?(.+)/i);
  if (match) return { query: match[1].trim() };
  const matchAlt = message.match(/find\s+stock\s+(?:for\s+)?(.+)/i);
  if (matchAlt) return { query: matchAlt[1].trim() };
  return null;
}

function parseNewsRequest(message: string) {
  const match = message.match(/news\s+(?:for|on)\s+([a-zA-Z]{1,6})/i);
  if (match) return { symbol: match[1].toUpperCase() };
  return null;
}

function parseSectorRequest(message: string) {
  const match = message.match(/sector\s+performance/i);
  if (match) return { type: 'performance' as const };
  const matchAlt = message.match(/stocks\s+in\s+([a-zA-Z\s&-]+)/i);
  if (matchAlt) return { type: 'stocks' as const, sector: matchAlt[1].trim() };
  return null;
}

async function handleDirectToolResponse(
  toolName: string,
  args: Record<string, any>,
  stockService: StockDataService,
  message: string,
  sessionId?: string | null,
  systemPrompt?: string
) {
  const currentSessionId = sessionId || Math.random().toString(36).substring(7);
  let conversationMessages: ChatMessage[] = sessionId ? sessions.get(sessionId) || [] : [];
  if (conversationMessages.length === 0) {
    conversationMessages.push({ role: 'system', content: systemPrompt || COMPACT_SYSTEM_PROMPT });
  }
  conversationMessages.push({ role: 'user', content: message });

  const toolResult = await executeTool(toolName, args, stockService);
  if (!toolResult.success) {
    return NextResponse.json(
      { error: toolResult.error || toolResult.message || 'Request failed' },
      { status: 500 }
    );
  }

  const responseText = JSON.stringify(toolResult.data, null, 2);
  conversationMessages.push({ role: 'assistant', content: responseText });
  sessions.set(currentSessionId, conversationMessages);

  return NextResponse.json({
    response: responseText,
    sessionId: currentSessionId,
    model: DEFAULT_MODEL,
    provider: 'direct',
    stats: {
      rounds: 0,
      toolCalls: 1,
      toolsProvided: 0,
    },
  });
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

function formatAnalystTrendResponse(symbol: string, recommendations: any[], ratings?: any): string {
  const rows = recommendations
    .map((rec) => {
      const period = rec.period || rec.date || 'N/A';
      return `| ${period} | ${rec.strongBuy ?? 'N/A'} | ${rec.buy ?? 'N/A'} | ${rec.hold ?? 'N/A'} | ${rec.sell ?? 'N/A'} | ${rec.strongSell ?? 'N/A'} |`;
    });

  const table = rows.length
    ? ['| Period | Strong Buy | Buy | Hold | Sell | Strong Sell |', '|---|---:|---:|---:|---:|---:|', ...rows].join('\n')
    : '_No analyst trend data available._';

  const snapshot = ratings
    ? `**Latest Snapshot:** Strong Buy ${ratings.strongBuy ?? 'N/A'} · Buy ${ratings.buy ?? 'N/A'} · Hold ${ratings.hold ?? 'N/A'} · Sell ${ratings.sell ?? 'N/A'} · Strong Sell ${ratings.strongSell ?? 'N/A'} · Target ${ratings.analystTargetPrice ?? 'N/A'}`
    : '';

  return [
    `## 📈 Analyst Rating Trends — ${symbol}`,
    snapshot,
    table,
    'Source: Finnhub',
  ].filter(Boolean).join('\n\n');
}

const DEFAULT_TOOL_NAMES = [
  'search_stock',
  'get_stock_price',
  'get_company_overview',
  'get_basic_financials',
  'get_analyst_ratings',
];

const REPORT_TOOL_NAMES = [
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
  'generate_sector_report',
];

const MAX_TOOLS_NON_REPORT = 10;

function selectToolNames(message: string) {
  const text = message.toLowerCase();
  const isReport = text.includes('report');
  const selected = new Set(isReport ? REPORT_TOOL_NAMES : DEFAULT_TOOL_NAMES);

  if (text.includes('report')) {
    selected.add('generate_stock_report');
    selected.add('generate_sector_report');
  }

  if (text.includes('sector') || text.includes('theme') || text.includes('screen')) {
    selected.add('screen_stocks');
    selected.add('get_stocks_by_sector');
    selected.add('get_sector_performance');
    selected.add('search_companies');
  }

  if (text.includes('peer') || text.includes('compare')) {
    selected.add('get_peers');
  }

  if (text.includes('price') || text.includes('quote') || text.includes('trend')) {
    selected.add('get_price_history');
  }

  if (text.includes('analyst') || text.includes('rating') || text.includes('recommendation')) {
    selected.add('get_analyst_ratings');
    selected.add('get_analyst_recommendations');
    if (text.includes('target')) {
      selected.add('get_price_targets');
    }
  }

  if (text.includes('news') || text.includes('sentiment')) {
    selected.add('get_news_sentiment');
    selected.add('get_company_news');
    selected.add('search_news');
  }

  if (text.includes('earnings')) {
    selected.add('get_earnings_history');
  }

  if (text.includes('income')) {
    selected.add('get_income_statement');
  }

  if (text.includes('balance')) {
    selected.add('get_balance_sheet');
  }

  if (text.includes('cash flow')) {
    selected.add('get_cash_flow');
  }

  if (text.includes('insider')) {
    selected.add('get_insider_trading');
  }

  if (text.includes('top gainers') || text.includes('losers') || text.includes('most active')) {
    selected.add('get_top_gainers_losers');
  }

  return { toolNames: Array.from(selected), isReport };
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

    const reportRequest = parseReportRequest(message);
    if (reportRequest) {
      const currentSessionId = sessionId || Math.random().toString(36).substring(7);
      let conversationMessages: ChatMessage[] = sessionId ? sessions.get(sessionId) || [] : [];
      const systemPrompt = process.env.USE_FULL_SYSTEM_PROMPT === 'true'
        ? SYSTEM_PROMPT
        : COMPACT_SYSTEM_PROMPT;
      if (conversationMessages.length === 0) {
        conversationMessages.push({ role: 'system', content: systemPrompt });
      }

      conversationMessages.push({ role: 'user', content: message });

      const toolResult = reportRequest.type === 'stock'
        ? await executeTool('generate_stock_report', { symbol: reportRequest.symbol }, stockService)
        : await executeTool('generate_sector_report', { query: reportRequest.query }, stockService);

      if (!toolResult.success) {
        return NextResponse.json(
          { error: toolResult.error || toolResult.message || 'Report generation failed' },
          { status: 500 }
        );
      }

      const downloadUrl = toolResult.data?.downloadUrl;
      const filename = toolResult.data?.filename as string | undefined;
      const content = toolResult.data?.content as string | undefined;
      const responseText = downloadUrl
        ? `Report generated: ${downloadUrl}`
        : 'Report generated.';

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

    const topMovers = message.toLowerCase().includes('top gainers') ||
      message.toLowerCase().includes('top losers') ||
      message.toLowerCase().includes('most active');
    if (topMovers) {
      return handleDirectToolResponse('get_top_gainers_losers', {}, stockService, message, sessionId);
    }

    const sectorRequest = parseSectorRequest(message);
    if (sectorRequest?.type === 'performance') {
      return handleDirectToolResponse('get_sector_performance', {}, stockService, message, sessionId);
    }
    if (sectorRequest?.type === 'stocks' && sectorRequest.sector) {
      return handleDirectToolResponse('get_stocks_by_sector', { sector: sectorRequest.sector }, stockService, message, sessionId);
    }

    const searchRequest = parseSearchRequest(message);
    if (searchRequest) {
      return handleDirectToolResponse('search_stock', { query: searchRequest.query }, stockService, message, sessionId);
    }

    const newsRequest = parseNewsRequest(message);
    if (newsRequest) {
      return handleDirectToolResponse('get_company_news', { symbol: newsRequest.symbol, days: 14 }, stockService, message, sessionId);
    }

    const sentiment = parseSymbolAfterKeyword(message, 'sentiment');
    if (sentiment) {
      return handleDirectToolResponse('get_news_sentiment', { symbol: sentiment.symbol }, stockService, message, sessionId);
    }

    const symbolPrice = parseSymbolAfterKeyword(message, 'price') || parseSymbolAfterKeyword(message, 'quote');
    if (symbolPrice) {
      return handleDirectToolResponse('get_stock_price', { symbol: symbolPrice.symbol }, stockService, message, sessionId);
    }

    const priceHistory = parseSymbolAfterKeyword(message, 'history') || parseSymbolAfterKeyword(message, 'trend');
    if (priceHistory) {
      return handleDirectToolResponse('get_price_history', { symbol: priceHistory.symbol, range: 'daily' }, stockService, message, sessionId);
    }

    const overview = parseSymbolAfterKeyword(message, 'overview') || parseSymbolAfterKeyword(message, 'fundamentals');
    if (overview) {
      return handleDirectToolResponse('get_company_overview', { symbol: overview.symbol }, stockService, message, sessionId);
    }

    const basicFinancials = parseSymbolAfterKeyword(message, 'ratios') || parseSymbolAfterKeyword(message, 'financials');
    if (basicFinancials) {
      return handleDirectToolResponse('get_basic_financials', { symbol: basicFinancials.symbol }, stockService, message, sessionId);
    }

    const earnings = parseSymbolAfterKeyword(message, 'earnings') || parseSymbolAfterKeyword(message, 'eps');
    if (earnings) {
      return handleDirectToolResponse('get_earnings_history', { symbol: earnings.symbol }, stockService, message, sessionId);
    }

    const income = parseSymbolAfterKeyword(message, 'income');
    if (income) {
      return handleDirectToolResponse('get_income_statement', { symbol: income.symbol }, stockService, message, sessionId);
    }

    const balance = parseSymbolAfterKeyword(message, 'balance');
    if (balance) {
      return handleDirectToolResponse('get_balance_sheet', { symbol: balance.symbol }, stockService, message, sessionId);
    }

    const cashFlow = parseSymbolAfterKeyword(message, 'cash flow');
    if (cashFlow) {
      return handleDirectToolResponse('get_cash_flow', { symbol: cashFlow.symbol }, stockService, message, sessionId);
    }

    const insider = parseSymbolAfterKeyword(message, 'insider');
    if (insider) {
      return handleDirectToolResponse('get_insider_trading', { symbol: insider.symbol }, stockService, message, sessionId);
    }

    const analystRatings = parseSymbolAfterKeyword(message, 'analyst ratings') || parseSymbolAfterKeyword(message, 'ratings');
    if (analystRatings) {
      return handleDirectToolResponse('get_analyst_ratings', { symbol: analystRatings.symbol }, stockService, message, sessionId);
    }

    const priceTargets = parseSymbolAfterKeyword(message, 'price targets') || parseSymbolAfterKeyword(message, 'targets');
    if (priceTargets) {
      return handleDirectToolResponse('get_price_targets', { symbol: priceTargets.symbol }, stockService, message, sessionId);
    }

    const peers = parseSymbolAfterKeyword(message, 'peers') || parseSymbolAfterKeyword(message, 'peer');
    if (peers) {
      return handleDirectToolResponse('get_peers', { symbol: peers.symbol }, stockService, message, sessionId);
    }

    const analystTrendRequest = parseAnalystTrendsRequest(message);
    if (analystTrendRequest) {
      const currentSessionId = sessionId || Math.random().toString(36).substring(7);
      let conversationMessages: ChatMessage[] = sessionId ? sessions.get(sessionId) || [] : [];
      if (conversationMessages.length === 0) {
        conversationMessages.push({ role: 'system', content: COMPACT_SYSTEM_PROMPT });
      }
      conversationMessages.push({ role: 'user', content: message });

      const [trendResult, ratingsResult] = await Promise.all([
        executeTool('get_analyst_recommendations', { symbol: analystTrendRequest.symbol }, stockService),
        executeTool('get_analyst_ratings', { symbol: analystTrendRequest.symbol }, stockService),
      ]);

      if (!trendResult.success) {
        return NextResponse.json(
          { error: trendResult.error || trendResult.message || 'Analyst trends unavailable' },
          { status: 500 }
        );
      }

      const recommendations = trendResult.data?.recommendations || [];
      const responseText = formatAnalystTrendResponse(
        analystTrendRequest.symbol,
        recommendations,
        ratingsResult.success ? ratingsResult.data : undefined
      );

      conversationMessages.push({ role: 'assistant', content: responseText });
      sessions.set(currentSessionId, conversationMessages);

      return NextResponse.json({
        response: responseText,
        sessionId: currentSessionId,
        model: model || DEFAULT_MODEL,
        provider: provider || 'github',
        stats: {
          rounds: 0,
          toolCalls: 2,
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

    const { toolNames, isReport } = selectToolNames(message);
    let toolDefinitions = getToolDefinitionsByName(toolNames);
    if (!isReport && toolDefinitions.length > MAX_TOOLS_NON_REPORT) {
      toolDefinitions = toolDefinitions.slice(0, MAX_TOOLS_NON_REPORT);
    }

    // Call the Copilot API with tool-calling loop
    let rounds = 0;
    let totalToolCalls = 0;
    let assistantContent: string | null = null;
    let activeModel = requestedModel;
    let activeProvider = provider || 'github';
    if (AUTO_DOWNGRADE_GPT5 && /gpt-5/i.test(activeModel) && activeProvider === 'github') {
      activeModel = DEFAULT_MODEL;
    }
    let toolDefinitionsUsed = toolDefinitions;
    const fallbackModels = buildFallbackModels(activeModel);
    let fallbackIndex = Math.max(0, fallbackModels.findIndex((item) => item === activeModel));

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
          const isTokensLimit = error?.statusCode === 413;
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
            retryTools = getToolDefinitionsByName(selectToolNames(message).toolNames).slice(0, MAX_TOOLS_NON_REPORT);
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
        const toolResults = await Promise.all(
          assistantMessage.tool_calls.map(async (toolCall: { id: string; function: { name: string; arguments: string } }) => {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);
            const toolResult = await executeTool(toolName, toolArgs, stockService);
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
      details = 'Make sure GITHUB_TOKEN is set in your Vercel environment variables and that ALPHA_VANTAGE_API_KEY, FMP_API_KEY, FINNHUB_API_KEY, and NEWSAPI_KEY are configured for full data coverage.';
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
