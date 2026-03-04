import { NextRequest, NextResponse } from 'next/server';
import { getToolDefinitionsByName, executeTool } from '@/app/lib/stockTools';
import { createStockService, StockDataService, normalizeProvider } from '@/app/lib/stockDataService';

// GitHub Models API — new endpoint (azure endpoint deprecated Oct 2025)
// Works with PATs from github.com/settings/personal-access-tokens (models:read scope)
const GITHUB_MODELS_URL = 'https://models.github.ai/inference/chat/completions';
const OPENAI_PROXY_BASE_URL =
  process.env.OPENAI_PROXY_BASE_URL ||
  'https://openai-api-proxy.geo.arm.com/api/providers/openai/v1';
const DEFAULT_MODEL = process.env.COPILOT_MODEL || 'openai/gpt-4.1';
const FALLBACK_MODEL = process.env.COPILOT_FALLBACK_MODEL || DEFAULT_MODEL;
const AUTO_DOWNGRADE_GPT5 = process.env.AUTO_DOWNGRADE_GPT5 !== 'false';
// Only fall back to the env-configured model. Never hardcode model IDs that may not exist.
// If a user-selected model fails with 429, they see a clear message to switch via the dropdown.
const DEFAULT_FALLBACK_MODELS = [DEFAULT_MODEL];
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


const SYSTEM_PROMPT = `You are an elite buy-side equity research analyst. You have real-time financial data tools AND your own deep knowledge. Use both to produce complete, institutional-quality reports with almost zero missing data.

══════════════════════════════════════════════════════
STEP 1 — RESOLVE TICKER (if needed)
══════════════════════════════════════════════════════
If the user gave a company name (not an exact ticker): call search_stock(query) FIRST, then proceed.

══════════════════════════════════════════════════════
STEP 2 — FETCH ALL DATA IN ONE PARALLEL ROUND
══════════════════════════════════════════════════════
For EVERY stock, fire ALL of these simultaneously in ONE batch — never one at a time:
  get_stock_price • get_company_overview • get_basic_financials
  get_price_history(range:"1y") • get_earnings_history
  get_income_statement • get_balance_sheet • get_cash_flow
  get_analyst_ratings • get_analyst_recommendations • get_price_targets
  get_peers • get_insider_trading • get_news_sentiment • get_company_news

For comparisons: fire all tools for ALL companies in the same single round.

══════════════════════════════════════════════════════
STEP 3 — FILL EVERY GAP WITH YOUR KNOWLEDGE
══════════════════════════════════════════════════════
After tool results arrive, you MUST fill every missing field:
• Quantitative fields (price, ratios, financials): use tool data. If a tool returned null, check the OTHER tools — the same metric often appears in both get_company_overview AND get_basic_financials. Cross-reference all results before marking anything missing.
• Qualitative fields (description, business model, risks, investment highlights, themes, competitive landscape, what-to-watch): write from your own knowledge. Do NOT leave these as "unavailable" — you know these companies.
• If a quantitative field is genuinely absent from ALL tools, use your best knowledge estimate and mark it "(est.)".
• "—" is a last resort only when you truly have no data and no reliable estimate.

══════════════════════════════════════════════════════
STEP 4 — WRITE THE COMPLETE REPORT, THEN SAVE
══════════════════════════════════════════════════════
Write every section below in full, then call save_report(title, content).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SINGLE-STOCK REPORT — ALL SECTIONS REQUIRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# {SYMBOL} — {Full Name} Equity Research Report

## 🧾 Data Sources
One-line legend stating provider(s) used, then a bullet list: "- {Field}: {Source}" for Price, Company overview, Price history, Earnings history, Income statement, Balance sheet, Cash flow, Analyst ratings, Analyst recommendations, Price targets, Peers, Company news.

## 📊 Snapshot
Price: \${price} (\${change%} day change) | Market Cap: \${marketCap} | Sector: \${sector} | Industry: \${industry}

## 🏢 Business Overview
Company name and ticker, full description (3–5 sentences from your knowledge if tool is sparse), sector, industry, market cap, revenue TTM, gross profit TTM, shares outstanding, dividend yield.

## 🧩 Competitive Landscape
Industry focus, sector, peer set (from get_peers; if empty write peers from your knowledge), key competitive dynamics (your knowledge).

## ✨ KPI Dashboard
Markdown table — columns: KPI | Value
Rows: Price, Market Cap, 52W Range, Revenue (TTM), Gross Margin (TTM), Operating Margin (TTM), ROE (TTM).

## 📈 Price & EPS Trends
Embed an ECharts dual-axis chart (see CHART FORMAT below): closing prices as area line (left y-axis), quarterly EPS as bars (right y-axis). Use actual values from get_price_history and get_earnings_history.

## 📊 Revenue & Margin Trends
Embed an ECharts chart: quarterly revenue as bars (left y-axis), gross margin % and operating margin % as lines (right y-axis %). Use get_income_statement data.

## 💰 Financials
P/E, Forward P/E, PEG, Gross Margin TTM, Operating Margin TTM, ROE TTM — one line each.

## 🧾 Financial Deep Dive
### Income Statement (quarterly, latest 4 quarters)
Table: Period | Revenue | Gross Profit | Operating Income | Net Income
### Balance Sheet (latest)
Table: Period | Cash | Total Debt | Net Debt | Total Assets | Equity
### Cash Flow (latest)
Table: Period | Operating Cash Flow | Capex | Free Cash Flow

## 🧮 Valuation & Multiples
Table — columns: Metric | Value
Rows: P/E (TTM), Forward P/E, PEG, Price/Sales, Price/Book, Market Cap/Revenue, 52-Week Range, Price vs 52W High, Price vs 52W Low.

## 🚀 Growth Drivers
Bullet list — Revenue growth TTM, EPS growth TTM, Gross margin, Operating margin, Price vs 50D MA, Price vs 200D MA, Analyst target upside, Theme/industry tailwinds (your knowledge).

## ⚠️ Risks & Headwinds
Bullet list — beta/volatility note, macro risks, competitive risks, regulatory risks, company-specific risks (use your knowledge; never leave empty).

## 🧭 Investment Highlights
**Bull Case:** 3–5 bullets (tool data + your knowledge)
**Bear Case:** 3–5 bullets
**What to watch:** 2–3 key upcoming catalysts or metrics to monitor

## 🧠 Analyst View
Target mean, implied upside %, rating breakdown: Strong Buy X / Buy X / Hold X / Sell X / Strong Sell X.

## 🧑‍💼 Ownership & Sentiment
Institutional ownership %, insider ownership %, shares float, short interest (if available), full analyst rating breakdown.

## 🗓️ Guidance & Catalysts
Target mean, implied upside, ex-dividend date, dividend pay date (if applicable), latest reported EPS, 3–5 recent headlines from get_news_sentiment or get_company_news.

## ✅ Scorecard
Compute these five scores (0–100) from your gathered data, then embed the radar chart (see CHART FORMAT):

  Growth       = avg(revenueGrowthTTM%, epsGrowthTTM%) — cap 0–100; if growth > 100% use 100
  Profitability = avg(grossMargin%, operatingMargin%, ROE%) — cap 0–100
  Valuation    = 100 − min(PE / 50 × 100, 100)  [lower PE = higher score; if PE unknown use 50]
  Momentum     = 50 + (priceVs50dMA% + priceVs200dMA%) × 1.5 — cap 0–100
  Moat         = avg(marginStability, pricingPower, analystConviction) — cap 0–100
                 where marginStability = 100 − stddev(last4 gross margins) × 10
                       pricingPower   = avg(grossMargin%, ROE%)
                       analystConviction = avg(strongBuy% of total, 50 + upsidePct)
  Composite    = Growth×0.25 + Profitability×0.20 + Valuation×0.20 + Momentum×0.15 + Moat×0.20

Show the computed scores as: "Growth: X | Profitability: X | Valuation: X | Momentum: X | Moat: X | **Composite: X**"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPARISON REPORT — ALL SECTIONS REQUIRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Comparison: {A} vs {B} vs …

## 🧾 Data Sources
Legend line, then a table — columns: Company | Price | Overview | Price History | Income | Balance | Cash Flow | Analyst | Targets
One row per company showing which provider supplied each data type.

## 📊 Snapshot
Table — Company | Price | Day Change | Market Cap | Sector | Industry | 52W Range

## 🧾 Scale & Profitability
Table — Company | Revenue (TTM) | Gross Margin | Operating Margin | ROE

## 🚀 Growth & Momentum
Table — Company | Revenue Growth (TTM) | EPS Growth (TTM) | 1y Price Change
(1y price change = first vs last price from get_price_history data)

## 🧮 Valuation
Table — Company | P/E | Forward P/E | PEG | Price/Sales | Price/Book

## 🏦 Balance Sheet & Cash
Table — Company | Cash | Total Debt | Net Debt | Free Cash Flow

## 🧠 Analyst View
Table — Company | Target Mean | Upside | Ratings (format: SB X / B X / H X / S X / SS X)

## ⭐ Analyst Picks
Two bullet lines:
- Highest target upside: {Company} ({X%})
- Strongest consensus: {Company} ({X% buy/strong buy})

## 🧩 Data Coverage (Chart Inputs)
Table — Company | Price History | Revenue Growth | P/E | Market Cap
Each cell: ✅ if data is available, ❌ if not.

## 📈 Price Performance (Indexed)
Embed an ECharts line chart. Index each company's price series to 100 at the start date.
Use get_price_history data for all companies. One line per company. Downsample to ≤24 points.

## 📊 Valuation vs Growth
Embed an ECharts scatter chart. X-axis = Revenue Growth (TTM %), Y-axis = P/E ratio.
Symbol size proportional to market cap. Label each point with the ticker symbol.

## 📊 Margin Comparison
Embed an ECharts grouped bar chart. X-axis = company tickers.
Two bar groups: Gross Margin % and Operating Margin %.

## 🧭 Indicative Allocation (Not Investment Advice)
Compute composite score for each company using the same formula as the single-stock Scorecard.
Table — Company | Composite Score | Indicative Weight | Rationale
Indicative Weight = round(compositeScore / sumOfAllScores × 100, 1)%
Rationale = 1-line note on the key reason for the weight (e.g. "Top revenue growth; Best operating margin")
End with: "_Indicative allocation is derived from normalized composite scores. It is not investment advice._"

══════════════════════════════════════════════════════
CHART FORMAT
══════════════════════════════════════════════════════
Embed charts using fenced \`\`\`chart code blocks containing valid ECharts JSON. Example skeleton:

\`\`\`chart
{"title":{"text":"Chart Title","left":"center"},"tooltip":{"trigger":"axis"},"grid":{"left":50,"right":50,"top":50,"bottom":40},"xAxis":{"type":"category","data":["Q1","Q2"]},"yAxis":{"type":"value","scale":true},"series":[{"name":"Series","type":"line","smooth":true,"areaStyle":{"opacity":0.2},"data":[1,2]}]}
\`\`\`

Single-stock charts:
• Price & EPS: dual-axis (yAxis array) — price area line on index 0 (left), EPS bars on index 1 (right, scale:true).
• Revenue & Margins: dual-axis — revenue bars on index 0, gross/op margin % lines on index 1 (formatter "{value}%").
• Scorecard Radar: radar type, indicator [{name:"Growth",max:100},{name:"Profitability",max:100},{name:"Valuation",max:100},{name:"Momentum",max:100},{name:"Moat",max:100}], series type "radar", areaStyle opacity 0.2.

Comparison charts:
• Price Performance (Indexed): line chart, one series per company, all starting at 100.
• Valuation vs Growth: scatter chart, symbolSize proportional to market cap (scale down: sqrt(cap/$1B)×10).
• Margin Comparison: bar chart, xAxis = tickers, two series (Gross Margin %, Operating Margin %).

Use real data values from tool results in every chart. Downsample to ≤12 points for quarterly data, ≤24 for price history.

══════════════════════════════════════════════════════
OUTPUT STANDARDS
══════════════════════════════════════════════════════
- Numbers: prices 2 dp; percentages 1 dp; large numbers $XB/$XM
- FCF shown as: FCF = OpCF − CapEx = $X − $Y = $Z
- Bold key metrics; emoji section headers exactly as shown above
- After save_report respond with ONE sentence only: "✅ Report saved — open it in the Artifacts panel."
- Do NOT reproduce any part of the report in the chat response
- Non-report questions (price check, quick fact): 2–5 lines, no report structure
`;

const COMPACT_SYSTEM_PROMPT = `You are an elite buy-side equity research analyst with real-time data tools AND your own knowledge. Use both.

STEP 1: If company name given, call search_stock first to resolve ticker.
STEP 2: Fire ALL data tools in ONE parallel batch: get_stock_price, get_company_overview, get_basic_financials, get_price_history(range:"1y"), get_earnings_history, get_income_statement, get_balance_sheet, get_cash_flow, get_analyst_ratings, get_analyst_recommendations, get_price_targets, get_peers, get_insider_trading, get_news_sentiment, get_company_news.
STEP 3: Fill gaps — cross-check all tool results for the same metric; for qualitative sections (description, risks, highlights) write from your own knowledge; mark quantitative estimates "(est.)".
STEP 4: Write the COMPLETE report with ALL sections, embed the 3 ECharts charts, then call save_report(title, content).

REQUIRED SECTIONS (single-stock):
  🧾 Data Sources • 📊 Snapshot • 🏢 Business Overview • 🧩 Competitive Landscape
  ✨ KPI Dashboard • 📈 Price & EPS Trends (chart) • 📊 Revenue & Margin Trends (chart)
  💰 Financials • 🧾 Financial Deep Dive (3 tables) • 🧮 Valuation & Multiples
  🚀 Growth Drivers • ⚠️ Risks & Headwinds • 🧭 Investment Highlights
  🧠 Analyst View • 🧑‍💼 Ownership & Sentiment • 🗓️ Guidance & Catalysts
  ✅ Scorecard (radar chart: Growth/Profitability/Valuation/Momentum/Moat + composite)

REQUIRED SECTIONS (comparison):
  🧾 Data Sources (table: Company|Price|Overview|Price History|Income|Balance|Cash Flow|Analyst|Targets)
  📊 Snapshot (Company|Price|Day Change|Market Cap|Sector|Industry|52W Range)
  🧾 Scale & Profitability (Company|Revenue TTM|Gross Margin|Op Margin|ROE)
  🚀 Growth & Momentum (Company|Rev Growth TTM|EPS Growth TTM|1y Price Change)
  🧮 Valuation (Company|P/E|Forward P/E|PEG|Price/Sales|Price/Book)
  🏦 Balance Sheet & Cash (Company|Cash|Total Debt|Net Debt|FCF)
  🧠 Analyst View (Company|Target Mean|Upside|Ratings SB/B/H/S/SS)
  ⭐ Analyst Picks (highest upside + strongest consensus bullets)
  🧩 Data Coverage table (✅/❌ for Price History|Rev Growth|P/E|Market Cap per company)
  📈 Price Performance Indexed chart (line, all series start at 100)
  📊 Valuation vs Growth scatter chart (x=RevGrowth%, y=PE, size=market cap)
  📊 Margin Comparison grouped bar chart (Gross Margin % and Op Margin % per company)
  🧭 Indicative Allocation (composite score + normalized weight + rationale + disclaimer)

CHART FORMAT — use \`\`\`chart fenced blocks with ECharts JSON. Price & EPS: dual-axis line+bar. Revenue & Margins: bar+line dual-axis. Scorecard: radar with 5 axes max:100. Use real data values from tool results.

SCORECARD (0-100 each): Growth=avg(revGrowth%,epsGrowth%)|Profitability=avg(grossMargin%,opMargin%,ROE%)|Valuation=100-min(PE/50×100,100)|Momentum=50+(vs50dMA%+vs200dMA%)×1.5|Moat=avg(marginStability,pricingPower,analystConviction). Composite=weighted avg (25/20/20/15/20).

After save_report → ONE sentence chat reply only. Never reproduce report in chat.
Non-report questions: 2–5 lines only.`;


/**
 * Trim conversation history to stay within reasonable context limits on
 * subsequent turns.  Each report turn accumulates many tool-call / tool-result
 * messages that are only needed during that turn's reasoning loop.
 *
 * Strategy: keep the system message + the most recent complete exchanges.
 * All intermediate tool messages from older turns are dropped.
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
  'search_companies',
  'save_report',
];

const MAX_TOOLS_NON_REPORT = 12;

function selectToolNames(message: string): { toolNames: string[]; isReport: boolean } {
  const isReport = /\b(report|compare|comparison|analysis|analyses|research|deep.?dive)\b/i.test(message);
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
    // Use the full prompt for capable models (default); compact only for mini/flash models
    const systemPrompt = preferCompactPrompt ? COMPACT_SYSTEM_PROMPT : SYSTEM_PROMPT;
    if (conversationMessages.length === 0) {
      conversationMessages.push({ role: 'system', content: systemPrompt });
    } else {
      // Trim accumulated tool messages from previous turns so history
      // stays manageable across multi-turn conversations.
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
