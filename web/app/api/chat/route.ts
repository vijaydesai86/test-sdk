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
- Single-stock deep dive: get_stock_price + get_company_overview + get_basic_financials + get_earnings_history + get_income_statement + get_balance_sheet + get_cash_flow + get_price_history.
- Peer comparison: search_stock for peers → batch get_company_overview + get_basic_financials + get_stock_price.
- Sector/theme report: search_stock → batch get_company_overview + get_stock_price + get_basic_financials.
- News-driven theme: not available in Alpha-only mode.
- Investment allocation: batch full data for all candidates → quantitative scoring → exact $ amounts, stop-losses, rebalancing triggers.

**4. Never skip a tool** when that data would strengthen the analysis. If a tool fails due to missing API keys, say so explicitly and continue with available data only.

**5. No hardcoded lists.** Always derive sector, theme, and peer lists from tools like search_stock.

**6. Report requests.** When a user asks for a full report, call generate_stock_report or generate_sector_report and return the saved artifact path.

**OUTPUT STANDARDS:**
- Tables for all comparisons of 2+ stocks or metrics — no empty cells.
- ### headers for sections in deep research.
- Emoji section markers: 📊 📈 💰 🏦 🔍 ⚠️ ✅ — bold key metrics.
- Show all calculations explicitly: FCF = Op.CF − CapEx = $X − $Y = $Z.
- Scoring matrix for allocations: Growth 25% / Profitability 20% / Moat 20% / Valuation 20% / Momentum 15%.
- Numbers: prices 2 decimals, % 1 decimal, large numbers 2 sig figs ($2.3B).
- Cite "Source: Alpha Vantage" after data-heavy sections.
- Length matches request: price query = 2–3 lines; full sector report = 1,000+ words.
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
  const lower = text.toLowerCase();
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

function parseComparisonCompanies(message: string): string[] | null {
  const match = message.match(/compare(?:\s+companies)?\s+(.+)/i);
  if (!match) return null;
  let list = match[1].trim();
  const cutoffIndex = list.search(/\b(report|over|for|using|with|range|timeframe)\b/i);
  if (cutoffIndex >= 0) {
    list = list.slice(0, cutoffIndex).trim();
  }
  if (!list) return null;
  const cleaned = list.replace(/\band\b/gi, ',');
  const parts = cleaned.includes(',')
    ? cleaned.split(',')
    : cleaned.split(/\s+/);
  const stopwords = new Set(['and', 'stocks', 'stock', 'companies', 'company', 'compare']);
  const companies = parts
    .map((item) => item.trim())
    .filter((item) => item && !stopwords.has(item.toLowerCase()));
  return companies.length >= 2 ? companies : null;
}

function parseAnalystTrendsRequest(message: string) {
  const match = message.match(/analyst\s+(?:rating|recommendation)?\s*trends?\s+for\s+([a-zA-Z]{1,6})/i)
    || message.match(/([a-zA-Z]{1,6})\s+analyst\s+(?:rating|recommendation)?\s*trends?/i);
  if (match) {
    return { symbol: match[1].toUpperCase() };
  }
  return null;
}

function parseTimeframe(message: string) {
  const match = message.match(/\b(1w|1m|3m|6m|1y|3y|5y|max)\b/i);
  return match ? match[1].toLowerCase() : null;
}

function parseSymbolAfterKeyword(message: string, keyword: string) {
  const regex = new RegExp(`${keyword}\\s+(?:for|of|on)?\\s*([a-zA-Z]{1,6})`, 'i');
  const match = message.match(regex);
  if (match) {
    return { symbol: match[1].toUpperCase() };
  }
  return null;
}

function extractTicker(message: string) {
  const ignore = new Set(['EPS', 'PE', 'ETF', 'USD', 'AI', 'IPO', 'NAV']);
  const matches = message.match(/\$?([A-Z]{1,6})\b/g) || [];
  for (const raw of matches) {
    const symbol = raw.replace('$', '').toUpperCase();
    if (!ignore.has(symbol)) {
      return symbol;
    }
  }
  return null;
}

function extractQuery(message: string) {
  const cleaned = message
    .replace(/\b(show|me|the|price|quote|stock|shares|trend|history|for|of|on|in|report|analyst|rating|recommendation|target|news|sentiment|fundamentals|overview|financials|ratios|earnings|eps|income|balance|cash\s*flow|insider|peers|compare|top|gainers|losers|most|active|today|latest|sector|screen|search|company|companies)\b/gi, ' ')
    .replace(/[^a-zA-Z&.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || message.trim();
}

async function resolveSymbolFromMessage(message: string, stockService: StockDataService) {
  const ticker = extractTicker(message);
  if (ticker) return ticker;
  const query = extractQuery(message);
  try {
    const search = await stockService.searchStock(query);
    const symbol = search?.results?.[0]?.symbol;
    return symbol ? symbol.toUpperCase() : null;
  } catch {
    return null;
  }
}

function parseMarketCapFilter(message: string) {
  const match = message.match(/(market cap|mcap)\s+(over|above|greater than)\s+\$?(\d+(?:\.\d+)?)\s*([mbt])?/i);
  const matchLow = message.match(/(market cap|mcap)\s+(under|below|less than)\s+\$?(\d+(?:\.\d+)?)\s*([mbt])?/i);
  const scale = (value: number, suffix?: string) => {
    if (!suffix) return value;
    if (suffix.toLowerCase() === 'm') return value * 1e6;
    if (suffix.toLowerCase() === 'b') return value * 1e9;
    if (suffix.toLowerCase() === 't') return value * 1e12;
    return value;
  };
  const filters: Record<string, number> = {};
  if (match) {
    filters.marketCapMoreThan = scale(Number(match[3]), match[4]);
  }
  if (matchLow) {
    filters.marketCapLowerThan = scale(Number(matchLow[3]), matchLow[4]);
  }
  return filters;
}

function parseLimitFromMessage(message: string, fallback = 8) {
  const match = message.match(/\b(?:top|limit|up to)\s+(\d{1,2})\b/i);
  if (!match) return fallback;
  const value = Number(match[1]);
  if (Number.isNaN(value) || value <= 0) return fallback;
  return Math.min(Math.max(value, 2), 20);
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
  systemPrompt?: string,
  format?: (data: any) => string
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

  const downloadUrl = toolResult.data?.downloadUrl as string | undefined;
  const filename = toolResult.data?.filename as string | undefined;
  const content = toolResult.data?.content as string | undefined;
  const responseText = downloadUrl
    ? `Report generated: ${downloadUrl}`
    : format
    ? format(toolResult.data)
    : JSON.stringify(toolResult.data, null, 2);
  conversationMessages.push({ role: 'assistant', content: responseText });
  sessions.set(currentSessionId, conversationMessages);

  return NextResponse.json({
    response: responseText,
    sessionId: currentSessionId,
    model: DEFAULT_MODEL,
    provider: 'direct',
    report: filename && content ? { filename, content, downloadUrl } : null,
    stats: {
      rounds: 0,
      toolCalls: 1,
      toolsProvided: 0,
    },
  });
}

async function handleAnalystTrendRequest(
  symbol: string,
  stockService: StockDataService,
  message: string,
  sessionId?: string | null
) {
  return NextResponse.json(
    { error: 'Analyst rating trends require a premium data provider and are unavailable in Alpha-only mode.' },
    { status: 501 }
  );
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

function formatPriceResponse(data: any) {
  if (!data) return '_No price data available._';
  return [
    `## 📊 ${data.symbol || ''} Price`,
    `Price: ${data.price ?? 'N/A'}`,
    `Change: ${data.change ?? 'N/A'} (${data.changePercent ?? 'N/A'})`,
    `Volume: ${data.volume ?? 'N/A'}`,
    `Last Close: ${data.latestTradingDay ?? 'N/A'}`,
  ].join('\n');
}

function formatRatingsResponse(data: any) {
  if (!data) return '_No ratings data available._';
  return [
    `## 🧭 Analyst Ratings — ${data.symbol || ''}`,
    `Strong Buy: ${data.strongBuy ?? 'N/A'}`,
    `Buy: ${data.buy ?? 'N/A'}`,
    `Hold: ${data.hold ?? 'N/A'}`,
    `Sell: ${data.sell ?? 'N/A'}`,
    `Strong Sell: ${data.strongSell ?? 'N/A'}`,
    `Target Price: ${data.analystTargetPrice ?? 'N/A'}`,
  ].join('\n');
}

function formatMoversTable(title: string, rows: any[]) {
  if (!rows || rows.length === 0) {
    return [`### ${title}`, '_No data available._'].join('\n');
  }
  const tableRows = rows.map((row) => [
    row.ticker ?? 'N/A',
    row.price ?? 'N/A',
    row.changeAmount ?? 'N/A',
    row.changePercentage ?? 'N/A',
    row.volume ?? 'N/A',
  ].join(' | '));

  return [
    `### ${title}`,
    '| Ticker | Price | Change | Change % | Volume |',
    '|---|---:|---:|---:|---:|',
    ...tableRows.map((row) => `| ${row} |`),
  ].join('\n');
}

function formatTopMoversResponse(data: any, limit = 10) {
  if (!data) return '_No movers data available._';
  const topGainers = Array.isArray(data.topGainers) ? data.topGainers.slice(0, limit) : [];
  const topLosers = Array.isArray(data.topLosers) ? data.topLosers.slice(0, limit) : [];
  const mostActive = Array.isArray(data.mostActive) ? data.mostActive.slice(0, limit) : [];

  return [
    '## 📈 Market Movers',
    formatMoversTable('Top Gainers', topGainers),
    formatMoversTable('Top Losers', topLosers),
    formatMoversTable('Most Active', mostActive),
  ].join('\n\n');
}

async function handlePeerComparison(
  symbol: string,
  stockService: StockDataService,
  message: string,
  sessionId?: string | null
) {
  const currentSessionId = sessionId || Math.random().toString(36).substring(7);
  let conversationMessages: ChatMessage[] = sessionId ? sessions.get(sessionId) || [] : [];
  if (conversationMessages.length === 0) {
    conversationMessages.push({ role: 'system', content: COMPACT_SYSTEM_PROMPT });
  }
  conversationMessages.push({ role: 'user', content: message });

  let peers: string[] = [];
  let fallbackNote = '';
  try {
    const peerResult = await stockService.getPeers(symbol);
    peers = (peerResult?.peers || []).filter((peer: string) => peer && peer !== symbol).slice(0, 6);
  } catch (error: any) {
    fallbackNote = `Peers unavailable via Finnhub (${error.message || 'Unknown error'}). Using search results as proxy.`;
    try {
      const searchResult = await stockService.searchStock(symbol);
      peers = (searchResult?.results || [])
        .map((item: any) => item.symbol)
        .filter((peer: string) => peer && peer !== symbol)
        .slice(0, 6);
    } catch {
      peers = [];
    }
  }

  const universe = [symbol, ...peers].slice(0, 8);
  const rows = await Promise.all(
    universe.map(async (ticker) => {
      const [price, overview, basicFinancials, targets] = await Promise.all([
        stockService.getStockPrice(ticker).catch(() => null),
        stockService.getCompanyOverview(ticker).catch(() => null),
        stockService.getBasicFinancials(ticker).catch(() => null),
        stockService.getPriceTargets(ticker).catch(() => null),
      ]);
      const priceValue = Number(price?.price);
      const targetValue = Number(targets?.targetMean || overview?.analystTargetPrice);
      const upside = priceValue && targetValue
        ? `${(((targetValue - priceValue) / priceValue) * 100).toFixed(1)}%`
        : 'N/A';
      return {
        symbol: ticker,
        price: price?.price ?? 'N/A',
        marketCap: overview?.marketCapitalization ?? 'N/A',
        pe: overview?.peRatio ?? basicFinancials?.metric?.peBasicExclExtraTTM ?? 'N/A',
        target: targets?.targetMean ?? overview?.analystTargetPrice ?? 'N/A',
        upside,
      };
    })
  );

  const table = [
    '| Symbol | Price | Market Cap | P/E | Target Mean | Upside |',
    '|---|---:|---:|---:|---:|---:|',
    ...rows.map((row) => `| ${row.symbol} | ${row.price} | ${row.marketCap} | ${row.pe} | ${row.target} | ${row.upside} |`),
  ].join('\n');

  const responseText = [
    `## 🔍 Peer Comparison — ${symbol}`,
    fallbackNote,
    table,
  ].filter(Boolean).join('\n\n');

  conversationMessages.push({ role: 'assistant', content: responseText });
  sessions.set(currentSessionId, conversationMessages);

  return NextResponse.json({
    response: responseText,
    sessionId: currentSessionId,
    model: DEFAULT_MODEL,
    provider: 'direct',
    stats: {
      rounds: 0,
      toolCalls: universe.length * 4,
      toolsProvided: 0,
    },
  });
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
  'generate_peer_report',
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
    const timeframe = parseTimeframe(message);
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

      if (reportRequest.type === 'sector') {
        const toolResult = await executeTool(
          'generate_sector_report',
          { query: reportRequest.query },
          stockService
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

      const toolResult = await executeTool(
        'generate_stock_report',
        { symbol: reportRequest.symbol, range: timeframe || '5y' },
        stockService
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

    const lowerMessage = message.toLowerCase();

    const topMovers = lowerMessage.includes('top gainers') ||
      lowerMessage.includes('top losers') ||
      lowerMessage.includes('most active');
    if (topMovers) {
      const limit = parseLimitFromMessage(message, 10);
      return handleDirectToolResponse(
        'get_top_gainers_losers',
        {},
        stockService,
        message,
        sessionId,
        undefined,
        (data) => formatTopMoversResponse(data, limit)
      );
    }

    const sectorRequest = parseSectorRequest(message);
    if (sectorRequest?.type === 'performance') {
      return handleDirectToolResponse('get_sector_performance', {}, stockService, message, sessionId);
    }
    if (sectorRequest?.type === 'stocks' && sectorRequest.sector) {
      return handleDirectToolResponse('get_stocks_by_sector', { sector: sectorRequest.sector }, stockService, message, sessionId);
    }

    if (lowerMessage.includes('compare')) {
      const comparisonCompanies = parseComparisonCompanies(message);
      if (comparisonCompanies) {
        return handleDirectToolResponse(
          'generate_comparison_report',
          { companies: comparisonCompanies, range: timeframe || '1y' },
          stockService,
          message,
          sessionId
        );
      }
    }

    if (lowerMessage.includes('compare') || lowerMessage.includes('peers')) {
      const compareSymbol = await resolveSymbolFromMessage(message, stockService);
      if (compareSymbol) {
        const limit = parseLimitFromMessage(message, 8);
        return handleDirectToolResponse(
          'generate_peer_report',
          { symbol: compareSymbol, range: timeframe || '5y', limit },
          stockService,
          message,
          sessionId
        );
      }
    }

    if (lowerMessage.includes('screen')) {
      const sectorMatch = message.match(/sector\s+([a-zA-Z\s&-]+)/i);
      const industryMatch = message.match(/industry\s+([a-zA-Z\s&-]+)/i);
      const filters = {
        sector: sectorMatch?.[1]?.trim(),
        industry: industryMatch?.[1]?.trim(),
        ...parseMarketCapFilter(message),
      };
      return handleDirectToolResponse('screen_stocks', filters, stockService, message, sessionId);
    }

    const searchRequest = parseSearchRequest(message);
    if (searchRequest) {
      return handleDirectToolResponse('search_stock', { query: searchRequest.query }, stockService, message, sessionId);
    }

    if (lowerMessage.includes('search companies')) {
      const query = extractQuery(message);
      return handleDirectToolResponse('search_companies', { query }, stockService, message, sessionId);
    }

    if (lowerMessage.includes('search news') || lowerMessage.includes('news about')) {
      const query = extractQuery(message);
      return handleDirectToolResponse('search_news', { query, days: 14 }, stockService, message, sessionId);
    }

    const newsRequest = parseNewsRequest(message);
    if (newsRequest) {
      return handleDirectToolResponse('get_company_news', { symbol: newsRequest.symbol, days: 14 }, stockService, message, sessionId);
    }

    const sentiment = parseSymbolAfterKeyword(message, 'sentiment');
    if (sentiment) {
      return handleDirectToolResponse('get_news_sentiment', { symbol: sentiment.symbol }, stockService, message, sessionId);
    }

    const shouldResolveSymbol = /(price|quote|history|trend|overview|fundamentals|ratios|financials|earnings|eps|income|balance|cash flow|insider|ratings|target|peer|news|sentiment)/i.test(message);
    const inferredSymbol = shouldResolveSymbol ? await resolveSymbolFromMessage(message, stockService) : null;
    if (inferredSymbol && lowerMessage.includes('analyst') && lowerMessage.includes('trend')) {
      return handleAnalystTrendRequest(inferredSymbol, stockService, message, sessionId);
    }
    if (inferredSymbol && lowerMessage.includes('news')) {
      return handleDirectToolResponse('get_company_news', { symbol: inferredSymbol, days: 14 }, stockService, message, sessionId);
    }
    if (inferredSymbol && lowerMessage.includes('sentiment')) {
      return handleDirectToolResponse('get_news_sentiment', { symbol: inferredSymbol }, stockService, message, sessionId);
    }

    const symbolPrice = parseSymbolAfterKeyword(message, 'price') || parseSymbolAfterKeyword(message, 'quote');
    const priceSymbol = symbolPrice?.symbol || inferredSymbol;
    if (priceSymbol && (symbolPrice || lowerMessage.includes('price') || lowerMessage.includes('quote'))) {
      return handleDirectToolResponse('get_stock_price', { symbol: priceSymbol }, stockService, message, sessionId, undefined, formatPriceResponse);
    }

    const priceHistory = parseSymbolAfterKeyword(message, 'history') || parseSymbolAfterKeyword(message, 'trend');
    const historyRange = timeframe || '5y';
    const historySymbol = priceHistory?.symbol || inferredSymbol;
    if (historySymbol && (priceHistory || lowerMessage.includes('history') || lowerMessage.includes('trend'))) {
      return handleDirectToolResponse('get_price_history', { symbol: historySymbol, range: historyRange }, stockService, message, sessionId);
    }

    const overview = parseSymbolAfterKeyword(message, 'overview') || parseSymbolAfterKeyword(message, 'fundamentals');
    const overviewSymbol = overview?.symbol || inferredSymbol;
    if (overviewSymbol && (overview || lowerMessage.includes('overview') || lowerMessage.includes('fundamentals'))) {
      return handleDirectToolResponse('get_company_overview', { symbol: overviewSymbol }, stockService, message, sessionId);
    }

    const basicFinancials = parseSymbolAfterKeyword(message, 'ratios') || parseSymbolAfterKeyword(message, 'financials');
    const financialsSymbol = basicFinancials?.symbol || inferredSymbol;
    if (financialsSymbol && (basicFinancials || lowerMessage.includes('ratios') || lowerMessage.includes('financials'))) {
      return handleDirectToolResponse('get_basic_financials', { symbol: financialsSymbol }, stockService, message, sessionId);
    }

    const earnings = parseSymbolAfterKeyword(message, 'earnings') || parseSymbolAfterKeyword(message, 'eps');
    const earningsSymbol = earnings?.symbol || inferredSymbol;
    if (earningsSymbol && (earnings || lowerMessage.includes('earnings') || lowerMessage.includes('eps'))) {
      return handleDirectToolResponse('get_earnings_history', { symbol: earningsSymbol }, stockService, message, sessionId);
    }

    const income = parseSymbolAfterKeyword(message, 'income');
    const incomeSymbol = income?.symbol || inferredSymbol;
    if (incomeSymbol && (income || lowerMessage.includes('income'))) {
      return handleDirectToolResponse('get_income_statement', { symbol: incomeSymbol }, stockService, message, sessionId);
    }

    const balance = parseSymbolAfterKeyword(message, 'balance');
    const balanceSymbol = balance?.symbol || inferredSymbol;
    if (balanceSymbol && (balance || lowerMessage.includes('balance'))) {
      return handleDirectToolResponse('get_balance_sheet', { symbol: balanceSymbol }, stockService, message, sessionId);
    }

    const cashFlow = parseSymbolAfterKeyword(message, 'cash flow');
    const cashFlowSymbol = cashFlow?.symbol || inferredSymbol;
    if (cashFlowSymbol && (cashFlow || lowerMessage.includes('cash flow'))) {
      return handleDirectToolResponse('get_cash_flow', { symbol: cashFlowSymbol }, stockService, message, sessionId);
    }

    const insider = parseSymbolAfterKeyword(message, 'insider');
    const insiderSymbol = insider?.symbol || inferredSymbol;
    if (insiderSymbol && (insider || lowerMessage.includes('insider'))) {
      return handleDirectToolResponse('get_insider_trading', { symbol: insiderSymbol }, stockService, message, sessionId);
    }

    const analystRatings = parseSymbolAfterKeyword(message, 'analyst ratings') || parseSymbolAfterKeyword(message, 'ratings');
    const ratingsSymbol = analystRatings?.symbol || inferredSymbol;
    if (ratingsSymbol && (analystRatings || lowerMessage.includes('ratings'))) {
      return handleDirectToolResponse('get_analyst_ratings', { symbol: ratingsSymbol }, stockService, message, sessionId, undefined, formatRatingsResponse);
    }

    const priceTargets = parseSymbolAfterKeyword(message, 'price targets') || parseSymbolAfterKeyword(message, 'targets');
    const targetSymbol = priceTargets?.symbol || inferredSymbol;
    if (targetSymbol && (priceTargets || lowerMessage.includes('target'))) {
      return handleDirectToolResponse('get_price_targets', { symbol: targetSymbol }, stockService, message, sessionId);
    }

    const peers = parseSymbolAfterKeyword(message, 'peers') || parseSymbolAfterKeyword(message, 'peer');
    const peersSymbol = peers?.symbol || inferredSymbol;
    if (peersSymbol && (peers || lowerMessage.includes('peer'))) {
      return handleDirectToolResponse('get_peers', { symbol: peersSymbol }, stockService, message, sessionId);
    }

    const analystTrendRequest = parseAnalystTrendsRequest(message);
    if (analystTrendRequest) {
      return handleAnalystTrendRequest(analystTrendRequest.symbol, stockService, message, sessionId);
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
    let activeProvider: 'github' | 'openai-proxy' = provider === 'openai-proxy' ? 'openai-proxy' : 'github';
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
