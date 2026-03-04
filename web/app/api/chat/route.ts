import { NextRequest, NextResponse } from 'next/server';
import { getToolDefinitionsByName, executeTool } from '@/app/lib/stockTools';
import { createStockService, StockDataService, normalizeProvider } from '@/app/lib/stockDataService';
import { saveReport } from '@/app/lib/reportGenerator';

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
const TOOL_RESULT_MAX_DEPTH = 5;
const TOOL_RESULT_MAX_ARRAY = 60;
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


const SYSTEM_PROMPT = `You are an elite buy-side equity research analyst. You have access to real-time financial data tools. Your job is to gather data intelligently and produce institutional-quality research.

══════════════════════════════════════════════════════
YOU ARE THE INTELLIGENCE — NOT A DISPATCHER
══════════════════════════════════════════════════════

For every report or analysis request, YOU gather the data yourself using individual tools, YOU reason about it, YOU fill every gap, and YOU write the full report. End every report by calling save_report(title, content) to create the downloadable artifact.

Do NOT call generate_stock_report or generate_comparison_report for user-facing reports — those are fallback-only tools. The LLM-composed report is always richer and more complete.

══════════════════════════════════════════════════════
RULE 1 — BATCH ALL CALLS IN ONE ROUND
══════════════════════════════════════════════════════

Issue EVERY tool call you need simultaneously in a single response. For N companies, fire all N × tools at once. Never call tools one at a time when they can be parallelised.

══════════════════════════════════════════════════════
RULE 2 — USE EVERY RELEVANT TOOL
══════════════════════════════════════════════════════

For each stock in a report, call ALL of these in one parallel round:
  get_stock_price • get_company_overview • get_basic_financials
  get_earnings_history • get_income_statement • get_balance_sheet • get_cash_flow
  get_price_history(range:"1y") • get_analyst_ratings • get_analyst_recommendations
  get_price_targets • get_peers • get_insider_trading • get_news_sentiment

For company names (not exact tickers): call search_stock first to resolve the real ticker, then fire all data tools.

══════════════════════════════════════════════════════
RULE 3 — FILL EVERY GAP BEFORE WRITING
══════════════════════════════════════════════════════

After each tool round, scan every field in every result. If any key metric is null or 'N/A':
  1. Try get_basic_financials for the ticker — it has margins, ROE, PE, growth rates.
  2. Try get_company_overview — it has revenue, market cap, sector, EPS.
  3. Try search_stock — it often fills sector/industry gaps.
  4. Only mark a field as unavailable if ALL relevant tools have been tried and returned nothing.

Never invent, estimate, or guess. Real data or genuinely unavailable — nothing in between.

══════════════════════════════════════════════════════
RULE 4 — WRITE THE REPORT YOURSELF
══════════════════════════════════════════════════════

After data is complete, compose the full markdown and call save_report. Use these exact sections in this order:

SINGLE-STOCK REPORT (all 15 sections required):
  # {SYMBOL} — {Name} Comprehensive Equity Research Report
  Generated: {ISO date}

  ## 📊 Snapshot           — price (change%), mkt cap, sector, industry, 52-wk high/low, beta
  [CHART: Price History]   ← right here, see RULE 5

  ## 🏢 Business Overview  — company description, business model, revenue segments, website
  ## 🧩 Competitive Landscape — industry focus, sector, peer set (from get_peers)
  ## ✨ KPI Dashboard       — markdown table: Price, Mkt Cap, 52W Range, Revenue TTM, Gross Margin, Op Margin, ROE
  ## 📈 Price & EPS Trends  [CHART: Price History] [CHART: Quarterly EPS] [CHART: P/E Trend]
  ## 📊 Revenue & Margin Trends [CHART: Revenue Trend] [CHART: Margin Trends]
  ## 💰 Financials          — ### Income Statement (last 4 qtrs table: Quarter | Revenue | Gross Profit | Op Income | Net Income | EPS)
                              ### Balance Sheet (latest: Cash | Total Debt | Net Debt | Total Assets | Equity)
                              ### Cash Flow (latest: Op CF | CapEx | FCF; show FCF = OpCF − CapEx = $X)
  ## 📊 Earnings Trend      — EPS actual vs estimate, beat/miss table (last 4–8 qtrs), then [CHART: Quarterly EPS]
  ## 🧮 Valuation & Multiples — table: P/E TTM | Forward P/E | PEG | P/S | P/B | Mkt Cap/Revenue; 52W range; % from high/low
  ## 🚀 Growth Drivers      — revenue growth TTM%, EPS growth TTM%, gross margin, op margin, price vs 50D/200D MA
  ## ⚠️ Risks & Headwinds   — elevated valuation, debt, negative growth, beta, competition, regulation
  ## 🧭 Investment Highlights — Bull Case / Bear Case / What to Watch bullets
  ## 🔮 Analyst View        — strong buy/buy/hold/sell counts, mean target, implied upside%, high/low targets
                              [CHART: Analyst Target Distribution]
  ## 🧑‍💼 Ownership & Sentiment — institutional %, insider %, short interest, news sentiment (if available)
  ## 🗓️ Guidance & Catalysts — next earnings, dividend dates, recent headlines
  ## ✅ Scorecard            — compute Growth/Profitability/Valuation/Momentum/Moat scores (0–100), write bullet summary, embed [CHART: Scorecard Radar]

COMPARISON REPORT:
  # Comparison: {Company A} vs {Company B} vs …
  ## 📊 Snapshot        — name, ticker, price, change%, mkt cap, sector (table)
  ## 📈 Key Metrics     — PE, EPS, gross margin, op margin, ROE, revenue growth (table)
  ## 🏦 Balance & Cash  — total assets, total debt, cash, FCF (table)
  ## 🔮 Analyst View    — mean target, upside%, buy/hold/sell per company (table)
  ## ✅ Verdict         — winner per category + overall pick with rationale

══════════════════════════════════════════════════════
OUTPUT STANDARDS
══════════════════════════════════════════════════════
- Tables for every multi-field comparison — write "N/A" only after ALL tools tried and returned nothing
- Bold key metrics; emoji section markers; ### sub-headers inside long sections
- Show FCF calculations: FCF = OpCF − CapEx = $X − $Y = $Z
- Prices: 2 decimal places; percentages: 1 decimal; market caps: $B / $M
- Cite data source after each data-heavy section
- Non-report questions (price, quick analysis): 2–5 lines, no report structure needed

══════════════════════════════════════════════════════
RULE 5 — EMBED ALL 7 INTERACTIVE CHARTS IN EVERY SINGLE-STOCK REPORT
══════════════════════════════════════════════════════

Embed \`\`\`chart code blocks with valid ECharts JSON. Use ONLY real values from tool results — no placeholders.
Omit a chart only when the tool returned zero data points.

CHART 1 — Price History (line) — place right after ## 📊 Snapshot AND again in ## 📈 Price & EPS Trends
  Source: get_price_history → prices[]. Use up to 52 evenly-spaced points oldest→newest. Format dates "MMM 'YY".
\`\`\`chart
{"title":{"text":"Price History (1Y)","left":"center"},"tooltip":{"trigger":"axis"},"grid":{"left":45,"right":20,"top":40,"bottom":40},"xAxis":{"type":"category","boundaryGap":false,"data":["Mar '24","Jun '24","Sep '24","Dec '24","Mar '25"]},"yAxis":{"type":"value","scale":true},"series":[{"name":"Close","type":"line","smooth":true,"symbol":"none","lineStyle":{"color":"#6366f1","width":2},"areaStyle":{"color":{"type":"linear","x":0,"y":0,"x2":0,"y2":1,"colorStops":[{"offset":0,"color":"rgba(99,102,241,0.25)"},{"offset":1,"color":"rgba(255,255,255,0)"}]}},"data":[820.5,850.2,790.0,910.3,875.6]}]}
\`\`\`

CHART 2 — Quarterly EPS (bar) — place in ## 📈 Price & EPS Trends AND in ## 📊 Earnings Trend
  Source: get_earnings_history → quarterlyEarnings[]. Use last 8 quarters oldest→newest.
\`\`\`chart
{"title":{"text":"Quarterly EPS","left":"center"},"tooltip":{"trigger":"axis"},"grid":{"left":45,"right":20,"top":40,"bottom":40},"xAxis":{"type":"category","data":["Q1'23","Q2'23","Q3'23","Q4'23","Q1'24","Q2'24","Q3'24","Q4'24"]},"yAxis":{"type":"value","scale":true},"series":[{"name":"Reported EPS","type":"bar","barMaxWidth":32,"data":[0.45,0.51,0.58,0.61,0.68,0.72,0.78,0.89]}]}
\`\`\`

CHART 3 — P/E Trend TTM (line) — place in ## 📈 Price & EPS Trends
  Compute from price history + earnings: for each earnings quarter sum last 4 EPS → ttmEPS, find closest price, PE = price/ttmEPS.
  Only include points where ttmEPS > 0.
\`\`\`chart
{"title":{"text":"P/E Trend (TTM)","left":"center"},"tooltip":{"trigger":"axis"},"grid":{"left":45,"right":20,"top":40,"bottom":40},"xAxis":{"type":"category","data":["Q1'24","Q2'24","Q3'24","Q4'24"]},"yAxis":{"type":"value","scale":true,"name":"P/E"},"series":[{"name":"P/E TTM","type":"line","smooth":true,"symbol":"circle","symbolSize":6,"data":[32.1,35.4,38.2,37.2]}]}
\`\`\`

CHART 4 — Revenue Trend (bar) — place in ## 📊 Revenue & Margin Trends
  Source: get_income_statement → quarterlyReports[]. Last 8 quarters oldest→newest. Revenue ÷ 1,000,000 = $M.
\`\`\`chart
{"title":{"text":"Quarterly Revenue ($M)","left":"center"},"tooltip":{"trigger":"axis"},"grid":{"left":55,"right":20,"top":40,"bottom":40},"xAxis":{"type":"category","data":["Q1'23","Q2'23","Q3'23","Q4'23","Q1'24","Q2'24","Q3'24","Q4'24"]},"yAxis":{"type":"value","scale":true},"series":[{"name":"Revenue ($M)","type":"bar","barMaxWidth":32,"data":[6051,13507,18120,22103,26044,30040,35082,39331]}]}
\`\`\`

CHART 5 — Margin Trends (two lines) — place in ## 📊 Revenue & Margin Trends
  Source: get_income_statement → quarterlyReports[]. Gross Margin = grossProfit/totalRevenue×100. Op Margin = operatingIncome/totalRevenue×100.
\`\`\`chart
{"title":{"text":"Margin Trends (%)","left":"center"},"tooltip":{"trigger":"axis"},"grid":{"left":45,"right":20,"top":40,"bottom":50},"xAxis":{"type":"category","data":["Q1'23","Q2'23","Q3'23","Q4'23","Q1'24","Q2'24","Q3'24","Q4'24"]},"yAxis":{"type":"value","axisLabel":{"formatter":"{value}%"}},"legend":{"bottom":0},"series":[{"name":"Gross Margin","type":"line","smooth":true,"data":[64.6,68.2,70.1,73.8,74.6,75.1,74.6,73.5]},{"name":"Op Margin","type":"line","smooth":true,"data":[22.6,37.6,42.1,52.3,54.1,62.1,61.9,62.8]}]}
\`\`\`

CHART 6 — Analyst Target Distribution (bar) — place in ## 🔮 Analyst View
  Source: get_price_targets → targetLow, targetMean, targetMedian, targetHigh.
\`\`\`chart
{"title":{"text":"Analyst Price Targets","left":"center"},"tooltip":{"trigger":"axis"},"grid":{"left":55,"right":20,"top":40,"bottom":40},"xAxis":{"type":"category","data":["Low","Mean","Median","High"]},"yAxis":{"type":"value","scale":true,"name":"Price ($)"},"series":[{"name":"Target","type":"bar","barMaxWidth":48,"data":[130.0,175.5,172.0,220.0]}]}
\`\`\`

CHART 7 — Scorecard Radar — place in ## ✅ Scorecard
  Compute 5 scores (all clamped 0–100) from tool results. Skip any metric that is null/unavailable and average the rest.
  • Growth        = average(revenueGrowthTTM%, epsGrowthTTM%) from basicFinancials.metric — already in % units
  • Profitability  = average(grossMarginTTM%, operatingMarginTTM%, roeTTM%) from basicFinancials.metric — already in % units
  • Valuation      = clamp(100 − (peRatio ÷ 50) × 100, 0, 100) — peRatio from companyOverview.peRatio or basicFinancials.metric.peBasicExclExtraTTM
  • Momentum       = clamp(50 + price_vs_200DMA_pct, 0, 100) — price_vs_200DMA_pct = (currentPrice − 200DMA) / 200DMA × 100; 200DMA from basicFinancials.metric["200DayAveragePriceReturn"] or companyOverview["200DayMovingAverage"]
  • Moat           = average(grossMarginTTM%, operatingMarginTTM%, analyst_buy_pct) where analyst_buy_pct = (strongBuy+buy) / (strongBuy+buy+hold+sell+strongSell) × 100 from analystRatings
  Then write the computed scores as bullet points below the ## ✅ Scorecard heading, then embed the radar chart.
\`\`\`chart
{"title":{"text":"Scorecard Radar","left":"center"},"tooltip":{"trigger":"item"},"radar":{"indicator":[{"name":"Growth","max":100},{"name":"Profitability","max":100},{"name":"Valuation","max":100},{"name":"Momentum","max":100},{"name":"Moat","max":100}],"radius":"65%","splitNumber":4,"axisName":{"color":"#334155","fontSize":12},"splitLine":{"lineStyle":{"color":"#cbd5e8"}},"splitArea":{"areaStyle":{"color":["#f8fafc","#eef2ff"]}}},"series":[{"name":"Scorecard","type":"radar","data":[{"value":[73.2,45.7,25.7,0.0,48.3],"name":"Scorecard"}],"areaStyle":{"opacity":0.2},"lineStyle":{"width":2},"symbolSize":6}]}
\`\`\`
`;

const COMPACT_SYSTEM_PROMPT = `You are a buy-side equity research analyst. Real data only — never invent or estimate figures.

YOU ARE THE REPORT WRITER. For every report or analysis: gather data with individual tools, fill every gap, compose the full markdown yourself, then call save_report(title, content). Do NOT use generate_stock_report or generate_comparison_report.

DATA RULES:
1. Batch ALL tool calls in one parallel round — never sequential when parallelisable.
2. For each stock call simultaneously: get_stock_price, get_company_overview, get_basic_financials, get_earnings_history, get_income_statement, get_balance_sheet, get_cash_flow, get_price_history(range:"1y"), get_analyst_ratings, get_analyst_recommendations, get_price_targets, get_peers, get_news_sentiment.
3. For company names: call search_stock first to resolve the ticker.
4. After results arrive — scan for null/'N/A' and make targeted follow-up calls before writing. N/A only when every tool has been tried and returned nothing real.

SINGLE-STOCK REPORT — all 15 sections in this order:
  📊 Snapshot • 🏢 Business Overview • 🧩 Competitive Landscape • ✨ KPI Dashboard
  📈 Price & EPS Trends • 📊 Revenue & Margin Trends • 💰 Financials (income/balance/cashflow tables)
  📊 Earnings Trend • 🧮 Valuation & Multiples • 🚀 Growth Drivers • ⚠️ Risks & Headwinds
  🧭 Investment Highlights • 🔮 Analyst View • 🧑‍💼 Ownership & Sentiment • 🗓️ Guidance & Catalysts • ✅ Scorecard

COMPARISON REPORT SECTIONS:
  Snapshot Table • Key Metrics Table • Balance & Cash Table • Analyst View • Verdict

ALL 7 CHARTS required in every single-stock report (use \`\`\`chart ECharts JSON, real values only):
1. Price History line — after Snapshot — get_price_history prices[], ≤52 pts oldest→newest, dates "MMM 'YY"
2. Quarterly EPS bar — in Price & EPS Trends AND Earnings Trend — get_earnings_history quarterlyEarnings[], last 8 qtrs
3. P/E Trend TTM line — in Price & EPS Trends — compute price/ttmEPS per quarter from price history + earnings
4. Revenue Trend bar — in Revenue & Margin Trends — get_income_statement quarterlyReports[], revenue ÷ 1M = $M
5. Margin Trends 2-line — in Revenue & Margin Trends — grossProfit/revenue×100 and operatingIncome/revenue×100
6. Analyst Targets bar — in Analyst View — get_price_targets targetLow/Mean/Median/High
7. Scorecard Radar — in Scorecard — 5 computed scores (Growth/Profitability/Valuation/Momentum/Moat, each 0–100)

Always end a report with: save_report(title, content)

Keep non-report answers concise (2–5 lines).`;


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

/**
 * When the LLM writes save_report("title", `content`) or save_report("title", "content")
 * as plain text instead of making a proper tool call, extract the arguments so the server
 * can execute the save itself and return a proper artifact.
 */
function extractSaveReportCall(
  text: string
): { title: string; reportContent: string; stripped: string } | null {
  const CALL_PREFIX = 'save_report(';
  const callIdx = text.indexOf(CALL_PREFIX);
  if (callIdx === -1) return null;

  const inner = text.slice(callIdx + CALL_PREFIX.length).trimStart();

  // Extract title (single or double quoted)
  const titleMatch = inner.match(/^["']([^"']+)["']\s*,\s*/);
  if (!titleMatch) return null;

  const title = titleMatch[1];
  const afterTitle = inner.slice(titleMatch[0].length);

  let reportContent: string;
  if (afterTitle.startsWith('`')) {
    // Template-literal style: the closing delimiter is the backtick immediately before the
    // trailing `)` at the end of the text — anchoring to `\s*)\s*$` is robust against
    // backticks appearing inside the report content (e.g. inline code spans).
    const closingMatch = afterTitle.match(/`\s*\)\s*$/);
    if (!closingMatch || closingMatch.index === undefined || closingMatch.index === 0) return null;
    reportContent = afterTitle.slice(1, closingMatch.index);
  } else if (afterTitle.startsWith('"')) {
    const closingMatch = afterTitle.match(/"\s*\)\s*$/);
    if (!closingMatch || closingMatch.index === undefined || closingMatch.index === 0) return null;
    reportContent = afterTitle.slice(1, closingMatch.index);
  } else {
    return null;
  }

  if (!reportContent.trim()) return null;

  // Everything before the save_report(...) call is the conversational part
  const stripped = text.slice(0, callIdx).trimEnd();
  return { title, reportContent, stripped };
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

// Tools available for quick questions (price, search, overview)
const DEFAULT_TOOL_NAMES = [
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
  'get_peers',
];

// Full tool set for deep research, reports, and comparisons
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
  'search_news',
  'get_price_history',
  'get_earnings_history',
  'get_income_statement',
  'get_balance_sheet',
  'get_cash_flow',
  'get_peers',
  'get_insider_trading',
  'get_sector_performance',
  'get_stocks_by_sector',
  'get_top_gainers_losers',
  'screen_stocks',
  'search_companies',
  'save_report',
];

const MAX_TOOLS_NON_REPORT = 12;

function selectToolNames(message: string): { toolNames: string[]; isReport: boolean } {
  const isReport = /\b(report|compare|comparison|analysis|analyses)\b/i.test(message);
  const toolNames = isReport ? REPORT_TOOL_NAMES : DEFAULT_TOOL_NAMES;
  return { toolNames, isReport };
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

    // Initialize stock service — validate that the required API key is present
    const dataProvider = normalizeProvider();
    const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (dataProvider === 'finnhub' && !finnhubKey) {
      return NextResponse.json(
        {
          error: 'Finnhub API key not configured',
          details: 'Please set FINNHUB_API_KEY in your Vercel environment variables.',
        },
        { status: 503 }
      );
    }
    if (dataProvider !== 'finnhub' && !alphaVantageKey) {
      return NextResponse.json(
        {
          error: 'Alpha Vantage API key not configured',
          details: 'Please set ALPHA_VANTAGE_API_KEY in your Vercel environment variables.',
        },
        { status: 503 }
      );
    }
    const stockService: StockDataService = createStockService(alphaVantageKey, finnhubKey);

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
    // Capture the first report artifact produced by any generate_*_report tool call
    let reportArtifact: { filename: string; content: string; downloadUrl: string } | null = null;
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
            // Capture report artifact from any generate_*_report tool call before compacting
            if (
              !reportArtifact &&
              toolResult.success &&
              toolResult.data?.filename &&
              toolResult.data?.content &&
              toolResult.data?.downloadUrl
            ) {
              reportArtifact = {
                filename: toolResult.data.filename,
                content: toolResult.data.content,
                downloadUrl: toolResult.data.downloadUrl,
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

    // If the model wrote save_report(...) as plain text instead of calling it as a tool,
    // execute the save now so the report still appears as a proper artifact.
    if (!reportArtifact && assistantContent) {
      const extracted = extractSaveReportCall(assistantContent);
      if (extracted) {
        const rawTitle = extracted.title
          .toLowerCase()
          .replace(/[^a-z0-9\-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        const title = rawTitle || 'report';
        try {
          const saved = await saveReport(extracted.reportContent, title);
          reportArtifact = {
            filename: saved.filename,
            content: extracted.reportContent,
            downloadUrl: `/api/reports/${saved.filename}`,
          };
          // Strip the raw save_report(...) call from the displayed response
          assistantContent = extracted.stripped || assistantContent;
        } catch (saveErr: any) {
          console.warn('Failed to save plain-text report artifact', {
            title: extracted.title,
            contentLength: extracted.reportContent.length,
            error: saveErr?.message,
          });
          // Leave content unchanged so the user still sees the report text
        }
      }
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
      report: reportArtifact,
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
