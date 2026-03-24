/* eslint-disable @typescript-eslint/no-explicit-any */
import { promises as fs } from 'fs';
import path from 'path';
import { StockDataService, SecEdgarService, FredService, CoinGeckoService } from './stockDataService';
import { buildStockReport, buildComparisonReport, buildSectorReport, buildDeepSectorReport, saveReport, MoatAnalysis } from './reportGenerator';

/**
 * OpenAI-compatible tool definitions for stock information
 */
export function getToolDefinitions() {
  return buildToolDefinitions();
}

export function getToolDefinitionsByName(toolNames?: string[]) {
  const definitions = buildToolDefinitions();
  if (!toolNames || toolNames.length === 0) {
    return definitions;
  }
  const allowList = new Set(toolNames);
  return definitions.filter((tool) => allowList.has(tool.function.name));
}

const REPORTS_DIR = process.env.REPORTS_DIR || (process.env.VERCEL ? '/tmp/reports' : 'reports');
const CACHE_DIR = path.join(REPORTS_DIR, 'cache');
const CACHE_TTL_MS = Number(process.env.STOCK_CACHE_TTL_MS || 1000 * 60 * 60 * 24 * 7);
// Number of companies to include in comparison/sector/deep-sector reports.
// Override via NUM_COMPANIES env var (e.g. set to 5 for faster reports, 15 for broader coverage).
// Optimal value: 10 gives a good balance between breadth and API rate limits.
const NUM_COMPANIES = Math.max(2, Number(process.env.NUM_COMPANIES || 10));
// Number of recursive refinement passes in deep sector research.
// Each pass feeds the previous analysis as context, progressively deepening insights.
// Override via DEEP_RESEARCH_DEPTH env var (1 = single pass, 3 = very thorough but slower).
// Optimal value: 2 gives meaningfully richer analysis with only one extra LLM call.
const DEEP_RESEARCH_DEPTH = Math.max(1, Number(process.env.DEEP_RESEARCH_DEPTH || 2));
const DEFAULT_SOURCE = (() => {
  const provider = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase();
  if (provider === 'finnhub') return 'Finnhub';
  return 'Alpha Vantage';
})();
const SOURCE_LEGEND = (() => {
  const provider = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase();
  if (provider === 'hybrid') return '_Legend: Alpha Vantage is primary; Finnhub fills gaps._';
  if (provider === 'finnhub') return '_Legend: Finnhub provider._';
  return '_Legend: Alpha Vantage provider._';
})();

/**
 * Callback that makes a targeted LLM call and returns the raw response string.
 * Used to resolve ambiguous or informal company names/tickers to official US
 * exchange symbols before making any market-data API calls.
 */
export type LLMFiller = (prompt: string) => Promise<string>;

/** Optional options passed to executeTool for report generation tools. */
export interface ExecuteToolOptions {
  /** When provided, called to resolve tickers that the search API could not validate. */
  llmFill?: LLMFiller;
}

/** Parses and cleans an LLM response expected to be JSON. Returns null if unparseable. */
function parseLLMFillJSON(response: string): any | null {
  try {
    const cleaned = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Builds a prompt asking the LLM to map each query to its official US stock ticker.
 * Used when the market-data search API returns no candidates (e.g. 'GOOGLE' → 'GOOGL').
 */
function buildTickerResolutionPrompt(queries: string[]): string {
  const shape = Object.fromEntries(queries.map((q) => [q, 'TICKER | null']));
  return (
    `You are a financial data assistant. For each of the following company names or informal tickers, ` +
    `identify the correct official US stock exchange ticker symbol.\n\n` +
    `Inputs: ${JSON.stringify(queries)}\n\n` +
    `RULES:\n` +
    `- Return the primary US-listed ticker (e.g. "GOOGL" for Google/Alphabet, "MSFT" for Microsoft)\n` +
    `- For share-class ambiguity, prefer the more liquid class (e.g. GOOGL over GOOG)\n` +
    `- Return null for any input you cannot identify with certainty\n\n` +
    `Respond ONLY with valid JSON:\n` +
    JSON.stringify(shape, null, 2)
  );
}

/**
 * Builds a prompt asking the LLM to identify the top N publicly-traded US companies
 * for a given sector or investment theme.
 */
function buildSectorCompaniesPrompt(sector: string, count: number): string {
  return (
    `You are a financial analyst. Identify the top ${count} publicly-traded US companies that are leading players in the "${sector}" sector or investment theme.\n\n` +
    `RULES:\n` +
    `- Return ONLY official US stock exchange ticker symbols (NYSE/NASDAQ)\n` +
    `- Select companies that are pure-play or significantly exposed to "${sector}"\n` +
    `- Prefer large-cap, highly liquid stocks — avoid micro-caps and OTC stocks\n` +
    `- For broad themes, include the most representative market leaders\n\n` +
    `Respond ONLY with a valid JSON array of exactly ${count} ticker symbols (no markdown, no explanation):\n` +
    `["TICK1", "TICK2", "TICK3"]`
  );
}

/** Prior-pass context fed into subsequent refinement passes for recursive deep research. */
export interface DeepSectorPassContext {
  dependencyAnalysis?: string;
  ecosystemDiagram?: string;
  refinementNotes?: string;
  companySnapshots?: Record<string, string>;
  universe?: string[];
  passIndex?: number;
}

/**
 * Builds a prompt that asks the LLM to:
 *   1. Analyse sector ecosystem dependencies (supply chain, customers, market, news)
 *   2. Produce a Mermaid diagram of the sector ecosystem
 *   3. Refine the candidate list to the best `finalCount` companies
 *   4. Explain the selection rationale
 *
 * The prompt feeds real company overview and news-sentiment data gathered in Phase 2
 * so that the LLM can ground its analysis in actual data rather than training memory.
 *
 * When `previousPass` is supplied (recursive depth > 1), the prior analysis is included
 * so the LLM can deepen and further refine the results from the previous pass.
 */
function buildDeepSectorDependencyPrompt(
  sector: string,
  finalCount: number,
  candidates: Array<{ symbol: string; overview: any; news: any; peers: any }>,
  previousPass?: DeepSectorPassContext
): string {
  const summaries = candidates
    .map(({ symbol, overview, news, peers }) => {
      const name = overview?.name || symbol;
      const desc = overview?.description
        ? String(overview.description).slice(0, 250)
        : 'No description available';
      const sectorInfo =
        overview?.sector
          ? `Sector: ${overview.sector} | Industry: ${overview.industry || 'N/A'}`
          : 'Sector: N/A';
      const sentiment =
        news?.overallSentimentLabel || news?.sentiment || 'Unknown';
      const peerList = Array.isArray(peers?.peers)
        ? peers.peers.slice(0, 5).join(', ')
        : 'N/A';
      return (
        `Ticker: ${symbol} | ${name}\n` +
        `  ${sectorInfo}\n` +
        `  Description: ${desc}\n` +
        `  News sentiment: ${sentiment}\n` +
        `  Peers: ${peerList}`
      );
    })
    .join('\n\n');

  const symbolList = candidates.map((c) => c.symbol).join(', ');

  const previousPassSection = previousPass
    ? (
        `\nPREVIOUS PASS ANALYSIS (pass ${(previousPass.passIndex ?? 0) + 1} — deepen and further refine this):\n` +
        (previousPass.universe?.length
          ? `  Previously refined universe: ${previousPass.universe.join(', ')}\n`
          : '') +
        (previousPass.dependencyAnalysis
          ? `  Prior dependency analysis: ${previousPass.dependencyAnalysis.slice(0, 600)}\n`
          : '') +
        (previousPass.refinementNotes
          ? `  Prior rationale: ${previousPass.refinementNotes.slice(0, 400)}\n`
          : '') +
        `\nUsing the prior analysis above, produce a DEEPER and MORE PRECISE analysis. ` +
        `Correct any gaps, refine the company selection, and expand the ecosystem diagram.\n`
      )
    : '';

  return (
    `You are a senior equity research analyst. Your task is to perform a deep sector ecosystem analysis for the "${sector}" sector.\n\n` +
    `CANDIDATE COMPANIES: ${symbolList}\n\n` +
    `COMPANY DATA:\n${summaries}\n` +
    previousPassSection +
    `\nTASKS:\n` +
    `1. ECOSYSTEM ANALYSIS: Write a structured analysis using EXACTLY these four ### markdown subsection headers (one paragraph each):\n` +
    `   ### 🔗 Supply Chain & Dependencies\n` +
    `   (key supplier/input relationships, who depends on whom, upstream/downstream links)\n` +
    `   ### 👥 Customer & Revenue Exposure\n` +
    `   (major end-markets, B2B vs consumer split, revenue concentration, geographic exposure)\n` +
    `   ### 📊 Market & Macro Factors\n` +
    `   (regulation, commodity prices, interest rates, geopolitics affecting the sector)\n` +
    `   ### ⚔️ Competitive Dynamics & Sentiment\n` +
    `   (competitive moats, market-share battles, news sentiment themes across candidates)\n\n` +
    `2. ECOSYSTEM DIAGRAM: Create a concise Mermaid diagram (graph LR direction) showing the most important\n` +
    `   supplier-company-customer relationships or competitive positioning. Keep it to at most 15 nodes.\n` +
    `   Use plain node names without special characters.\n\n` +
    `3. REFINEMENT: Select the best ${finalCount} companies from the candidates for deep financial analysis.\n` +
    `   Criteria: sector relevance, financial strength, market leadership, and portfolio diversification.\n\n` +
    `4. RATIONALE: For EVERY candidate, write exactly one line in this format — no extra text:\n` +
    `   ✅ TICKER (Company Name) — reason this company was selected\n` +
    `   ❌ TICKER (Company Name) — reason this company was excluded\n\n` +
    `5. COMPANY SNAPSHOTS: For each company in the FINAL refined list only, provide a 1-2 sentence summary\n` +
    `   of their role in the sector and key investment relevance. Use the company ticker as the key.\n\n` +
    `Respond ONLY with valid JSON (no markdown fences, no explanation outside the JSON):\n` +
    `{"refinedList":["TICK1","TICK2"],"dependencyAnalysis":"### 🔗 Supply Chain & Dependencies\\n\\ntext...\\n\\n### 👥 Customer & Revenue Exposure\\n\\ntext...","ecosystemDiagram":"graph LR\\n  NodeA-->NodeB","refinementNotes":"✅ TICK1 (Name) — reason\\n❌ TICK2 (Name) — reason","companySnapshots":{"TICK1":"1-2 sentence snapshot...","TICK2":"1-2 sentence snapshot..."}}`
  );
}

/**
 * Builds a prompt for the LLM to assess the competitive moat of a single company.
 * Returns a JSON object with moatType, moatStrength, moatScore, barriers, narrative, and bestFor.
 */
function buildMoatAnalysisPrompt(
  symbol: string,
  overview: any,
  basicFinancials: any,
): string {
  const name = overview?.name || symbol;
  const sector = overview?.sector || 'N/A';
  const industry = overview?.industry || 'N/A';
  const description = overview?.description
    ? String(overview.description).slice(0, 400)
    : 'No description available';
  const grossMargin = overview?.grossMarginTTM ?? basicFinancials?.metric?.grossMarginTTM ?? null;
  const operatingMargin = overview?.operatingMargin ?? basicFinancials?.metric?.operatingMarginTTM;
  const roe = overview?.returnOnEquity ?? basicFinancials?.metric?.roeTTM;
  const revenueGrowth = basicFinancials?.metric?.revenueGrowthTTM ?? overview?.quarterlyRevenueGrowth;

  const fmt = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 'N/A';
    const pct = Math.abs(n) <= 1 ? n * 100 : n;
    return `${pct.toFixed(1)}%`;
  };

  return (
    `You are a senior equity research analyst specialising in Warren Buffett-style economic moat analysis.\n\n` +
    `Assess the competitive moat for the following company and return a JSON object.\n\n` +
    `Company: ${name} (${symbol})\n` +
    `Sector: ${sector}\n` +
    `Industry: ${industry}\n` +
    `Description: ${description}\n` +
    `Gross Margin (TTM): ${fmt(grossMargin)}\n` +
    `Operating Margin (TTM): ${fmt(operatingMargin)}\n` +
    `ROE (TTM): ${fmt(roe)}\n` +
    `Revenue Growth (TTM): ${fmt(revenueGrowth)}\n\n` +
    `MOAT FRAMEWORK:\n` +
    `- Network Effects: value grows as more users/customers join\n` +
    `- Cost Advantage: structurally lower costs than peers\n` +
    `- Switching Costs: expensive or painful for customers to leave\n` +
    `- Intangible Assets: brands, patents, regulatory licenses\n` +
    `- Efficient Scale: niche market where competition is uneconomic\n` +
    `- Mixed: combination of two or more of the above\n` +
    `- None: no durable competitive advantage identified\n\n` +
    `SCORING:\n` +
    `- moatScore 0-30 = None (easily competed away)\n` +
    `- moatScore 31-60 = Narrow (3-10 year advantage)\n` +
    `- moatScore 61-100 = Wide (10+ year durable advantage)\n\n` +
    `Respond ONLY with valid JSON (no markdown, no extra text):\n` +
    `{"moatType":"<Network Effects|Cost Advantage|Switching Costs|Intangible Assets|Efficient Scale|Mixed|None>","moatStrength":"<Wide|Narrow|None>","moatScore":<0-100>,"barriers":["<specific barrier 1>","<specific barrier 2>"],"narrative":"<2-4 sentence analysis of moat sources and sustainability>","bestFor":"<1-2 sentences: what this company excels at and who it is best for>"}`
  );
}

/**
 * Builds a single LLM call that assesses the competitive moat for a batch of companies.
 * Returns a JSON object keyed by ticker symbol.
 */
function buildBatchMoatAnalysisPrompt(
  companies: Array<{ symbol: string; overview: any; basicFinancials: any }>
): string {
  const fmt = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 'N/A';
    const pct = Math.abs(n) <= 1 ? n * 100 : n;
    return `${pct.toFixed(1)}%`;
  };

  const summaries = companies.map(({ symbol, overview, basicFinancials }) => {
    const name = overview?.name || symbol;
    const sector = overview?.sector || 'N/A';
    const industry = overview?.industry || 'N/A';
    const description = overview?.description ? String(overview.description).slice(0, 200) : '';
    const grossMargin = overview?.grossMarginTTM ?? basicFinancials?.metric?.grossMarginTTM ?? null;
    const operatingMargin = overview?.operatingMargin ?? basicFinancials?.metric?.operatingMarginTTM;
    const roe = overview?.returnOnEquity ?? basicFinancials?.metric?.roeTTM;
    const revenueGrowth = basicFinancials?.metric?.revenueGrowthTTM ?? overview?.quarterlyRevenueGrowth;
    return (
      `${symbol}: ${name} | ${sector} / ${industry}\n` +
      `  ${description}\n` +
      `  Gross Margin: ${fmt(grossMargin)} | Operating Margin: ${fmt(operatingMargin)} | ROE: ${fmt(roe)} | Rev Growth: ${fmt(revenueGrowth)}`
    );
  }).join('\n\n');

  const exampleTicker = companies[0]?.symbol || 'TICK';
  const shapeExample = `{"${exampleTicker}":{"moatType":"Mixed","moatStrength":"Wide","moatScore":82,"barriers":["Brand","Ecosystem lock-in"],"narrative":"...","bestFor":"..."}}`;

  return (
    `You are a senior equity research analyst specialising in Warren Buffett-style economic moat analysis.\n\n` +
    `Assess the competitive moat for EACH of the following companies.\n\n` +
    `COMPANY DATA:\n${summaries}\n\n` +
    `MOAT FRAMEWORK: Network Effects | Cost Advantage | Switching Costs | Intangible Assets | Efficient Scale | Mixed | None\n` +
    `MOAT STRENGTH: Wide (score 61-100, 10+ yr advantage) | Narrow (31-60, 3-10 yr) | None (0-30)\n\n` +
    `Respond ONLY with valid JSON keyed by ticker symbol (no markdown, no extra text):\n` +
    shapeExample
  );
}


type CacheEntry = { updatedAt: string; data: any };
type SymbolCache = Record<string, CacheEntry>;

/** Normalises a raw ticker string from LLM output to uppercase alphanumeric. */
const cleanTicker = (raw: string): string =>
  String(raw || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase();

/**
 * Parses one entry from an LLM batch moat response and returns a validated MoatAnalysis,
 * or null when the entry is missing required fields.
 */
function parseMoatEntry(m: any): MoatAnalysis | null {
  if (!m || typeof m.moatScore !== 'number') return null;
  return {
    moatType: String(m.moatType || 'N/A'),
    moatStrength: String(m.moatStrength || 'N/A'),
    moatScore: Math.min(100, Math.max(0, Math.round(Number(m.moatScore)))),
    barriers: Array.isArray(m.barriers) ? m.barriers.map(String) : [],
    narrative: String(m.narrative || ''),
    bestFor: String(m.bestFor || ''),
  };
}

const loadSymbolCache = async (symbol: string): Promise<SymbolCache> => {
  try {
    const filePath = path.join(CACHE_DIR, `${symbol.toUpperCase()}.json`);
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as SymbolCache;
  } catch {
    return {};
  }
};

const saveSymbolCache = async (symbol: string, cache: SymbolCache) => {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const filePath = path.join(CACHE_DIR, `${symbol.toUpperCase()}.json`);
  await fs.writeFile(filePath, JSON.stringify(cache, null, 2), 'utf8');
};

const getCachedValue = (cache: SymbolCache, key: string) => {
  const entry = cache[key];
  if (!entry) return null;
  const ageMs = Date.now() - new Date(entry.updatedAt).getTime();
  if (Number.isNaN(ageMs) || ageMs > CACHE_TTL_MS) return null;
  return entry.data;
};

const setCachedValue = (cache: SymbolCache, key: string, data: any) => {
  cache[key] = { updatedAt: new Date().toISOString(), data };
};

// Score a search result against the user query.
// `rank` is the 0-based position in Alpha Vantage's own result list — AV already
// ranks by relevance, so earlier results get a small bonus to act as tiebreaker.
const scoreSearchMatch = (query: string, item: any, rank = 0) => {
  const normalized = query.trim().toLowerCase();
  const symbol = String(item?.symbol || '').toLowerCase();
  const name = String(item?.name || '').toLowerCase();
  const region = String(item?.region || '').toLowerCase();
  const currency = String(item?.currency || '').toUpperCase();
  const type = String(item?.type || '').toLowerCase();

  let score = 0;
  if (symbol === normalized) score += 100;
  if (name === normalized) score += 90;
  if (name.startsWith(normalized)) score += 70;
  if (name.includes(normalized)) score += 50;
  if (symbol.startsWith(normalized)) score += 40;
  if (region.includes('united states')) score += 10;
  if (currency === 'USD') score += 10;
  if (type.includes('equity')) score += 5;
  // Trust Alpha Vantage's own ordering as a tiebreaker (first = best match per AV)
  score += Math.max(0, 8 - rank * 2);
  return score;
};

// Strip share-class suffixes so "Alphabet Inc Class A" and "Alphabet Inc Class C"
// are recognised as the same underlying company.
const baseCompanyName = (name: string) =>
  name
    .replace(/\s+(class\s+[a-z0-9]+|ordinary\s+shares?|adr|preferred|warrants?|rights?|voting).*$/i, '')
    .trim()
    .toLowerCase();

const resolveSymbolFromQuery = async (stockService: StockDataService, query: string) => {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Empty query', candidates: [] as any[] };
  }

  const stopwordSet = new Set(['stocks', 'stock', 'companies', 'company', 'compare', 'and']);
  const cleanedTokens = trimmed
    .split(/\s+/)
    .filter((token) => token && !stopwordSet.has(token.toLowerCase()));
  const cleanedQuery = cleanedTokens.length ? cleanedTokens.join(' ') : trimmed;
  const isLikelyTicker = /^[a-zA-Z]{1,6}$/.test(cleanedQuery);
  try {
    const results = await stockService.searchStock(cleanedQuery);
    const candidates = (results.results || []) as any[];
    if (!candidates.length) {
      if (isLikelyTicker) return { ok: true, symbol: cleanedQuery.toUpperCase(), candidates: [] };
      return { ok: false, reason: 'No matches found', candidates: [] };
    }
    const scored = candidates
      .map((item, i) => ({ item, score: scoreSearchMatch(trimmed, item, i) }))
      .sort((a, b) => b.score - a.score);
    const top = scored[0];
    const second = scored[1];
    // Two results are considered share-class variants of the same company (e.g.
    // GOOGL vs GOOG, BRK.A vs BRK.B) when their base names match.  In that case
    // we trust Alpha Vantage's ranking and pick the top result without flagging ambiguity.
    const sameCompany =
      second &&
      baseCompanyName(String(top.item.name || '')) === baseCompanyName(String(second.item.name || '')) &&
      // require a meaningful base name length to avoid false matches on very short names
      baseCompanyName(String(top.item.name || '')).length > 3;
    const ambiguity =
      !top ||
      top.score < 25 ||
      (!sameCompany && second && top.score - second.score < 10);
    if (ambiguity) {
      return { ok: false, reason: 'Ambiguous match', candidates: scored.slice(0, 5).map((row) => row.item) };
    }
    return { ok: true, symbol: String(top.item.symbol).toUpperCase(), candidates: scored.slice(0, 5).map((row) => row.item) };
  } catch (error: any) {
    if (isLikelyTicker) {
      return { ok: true, symbol: cleanedQuery.toUpperCase(), candidates: [] };
    }
    return { ok: false, reason: error.message || 'Search failed', candidates: [] };
  }
};

function buildToolDefinitions() {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'search_stock',
        description: 'Search for a US stock ticker by company name or partial ticker.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Company name or ticker (e.g. "Apple" or "AAPL")' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_stock_price',
        description: 'Get current price, daily change, change percent, and volume for a US stock.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_price_history',
        description: 'Get OHLCV data points for trend and technical analysis. Range supports daily/weekly/monthly or 1w, 1m, 3m, 6m, 1y, 3y, 5y, max.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
            range: { type: 'string', description: '"daily", "weekly", "monthly", "1w", "1m", "3m", "6m", "1y", "3y", "5y", "max". Default: "daily"' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_company_overview',
        description: 'Get company fundamentals: EPS, P/E, PEG, margins, ROE, ROA, market cap, dividend yield, beta, 52-week range, analyst target, insider %, institutional %, short interest, sector, industry, business description.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_basic_financials',
        description: 'Get detailed financial ratios, metrics, and historical series (including PE history) for a US stock.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_insider_trading',
        description: 'Get insider ownership %, institutional ownership %, short interest data, and recent insider buy/sell transactions.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_analyst_ratings',
        description: 'Get analyst ratings breakdown (Strong Buy/Buy/Hold/Sell/Strong Sell counts), consensus price target, and implied upside/downside.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_analyst_recommendations',
        description: 'Get analyst recommendation trends over time (strong buy/buy/hold/sell/strong sell counts).',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_price_targets',
        description: 'Get analyst price target summary (high/low/mean/median) for a US stock.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_peers',
        description: 'Get a list of peer tickers for a US stock.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_earnings_history',
        description: 'Get 8+ quarters of earnings: reported EPS, estimated EPS, surprise amount, surprise %, beat/miss/in-line.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_income_statement',
        description: 'Get quarterly and annual income statement: revenue, gross profit, operating income, net income, EBITDA.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_balance_sheet',
        description: 'Get balance sheet: total assets, liabilities, shareholder equity, cash, and long-term debt.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_cash_flow',
        description: 'Get cash flow statement: operating cash flow, CapEx, free cash flow, dividends paid.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_news_sentiment',
        description: 'Get the latest news headlines and AI sentiment scores (Bullish/Bearish/Neutral) for a US stock.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_company_news',
        description: 'Get recent company news articles for a US stock (typically last 30 days).',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
            days: { type: 'number', description: 'Lookback window in days (optional)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_stock_report',
        description: 'Generate a comprehensive stock research report and save it as a markdown artifact.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker or company name (e.g. AAPL, Apple)' },
            range: { type: 'string', description: 'Price history range for charts (e.g., "1y", "3y", "5y", "max"). Default is "5y"' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_comparison_report',
        description: 'Generate a comprehensive comparison report for multiple companies and save it as a markdown artifact.',
        parameters: {
          type: 'object',
          properties: {
            companies: { type: 'array', items: { type: 'string' }, description: `Company names or tickers (2–${NUM_COMPANIES} items)` },
            range: { type: 'string', description: 'Price history range for charts (e.g., "1y", "3y", "5y", "max"). Default is "1y"' },
          },
          required: ['companies'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_sector_report',
        description:
          'Research a sector or thematic investment theme. Uses AI to identify the top companies in the sector, then generates a full comparison-style report. ' +
          'Use this when the user asks about a sector, industry, or theme (e.g. "AI data center", "electric vehicles", "cloud computing", "semiconductor"). ' +
          'Do NOT use this for a single stock report or when the user explicitly lists specific tickers.',
        parameters: {
          type: 'object',
          properties: {
            sector: {
              type: 'string',
              description: 'Sector or thematic query, e.g. "AI data center", "electric vehicles", "cloud computing"',
            },
            count: {
              type: 'number',
              description: `Number of top companies to include (default: ${NUM_COMPANIES}, min: 2, max: ${NUM_COMPANIES})`,
            },
            range: {
              type: 'string',
              description: 'Price history range for comparison charts (e.g. "1y", "3y"). Default: "1y"',
            },
          },
          required: ['sector'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_deep_sector_report',
        description:
          'Generate a deep sector research report with full ecosystem analysis. ' +
          'Phase 1: AI identifies a broad candidate list of top companies in the sector. ' +
          'Phase 2: Real data (company overviews, news sentiment, peers) is fetched for all candidates. ' +
          `Phase 3: AI maps supply-chain, customer, market and news dependencies, draws a sector dependency diagram, and refines the company list — repeated ${DEEP_RESEARCH_DEPTH} time(s) for progressively deeper analysis. ` +
          'Phase 4: Full financial comparison report is built for the refined universe. ' +
          'Use this when the user asks for DEEP, THOROUGH or COMPREHENSIVE sector research. ' +
          'Prefer generate_sector_report for quick sector overviews.',
        parameters: {
          type: 'object',
          properties: {
            sector: {
              type: 'string',
              description: 'Sector or thematic query, e.g. "semiconductors", "AI infrastructure", "renewable energy"',
            },
            count: {
              type: 'number',
              description: `Number of companies in the refined final list (default: ${NUM_COMPANIES}, min: 3, max: ${NUM_COMPANIES})`,
            },
            range: {
              type: 'string',
              description: 'Price history range for comparison charts (e.g. "1y", "3y"). Default: "1y"',
            },
          },
          required: ['sector'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_sector_performance',
        description:
          'Get real-time sector performance across multiple timeframes (1 day, 5 day, 1 month, 3 month, YTD, 1 year). Use this to understand broad market trends by sector.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_top_gainers_losers',
        description: "Get today's top gaining, top losing, and most actively traded US stocks.",
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_dividend_history',
        description: 'Get historical dividend payments for a US stock (ex-date, pay date, amount, currency). Useful for dividend yield analysis and income investing research.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
            years: { type: 'number', description: 'Number of years of dividend history to retrieve (default: 5)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_stock_splits',
        description: 'Get the historical stock split record for a US stock (split date, from/to ratio). Useful for understanding share-price adjustments and capital structure history.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
            years: { type: 'number', description: 'Number of years of split history to retrieve (default: 10)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_earnings_calendar',
        description: 'Get upcoming earnings announcements for US stocks. Can be filtered to a specific ticker or return all upcoming earnings within a date window.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Optional: filter to a specific ticker (e.g. AAPL). Omit to get all upcoming earnings.' },
            weeks: { type: 'number', description: 'Look-ahead window in weeks (default: 4)' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_ipo_calendar',
        description: 'Get upcoming IPO listings on US exchanges (company name, ticker, date, price range, number of shares, status).',
        parameters: {
          type: 'object',
          properties: {
            weeks: { type: 'number', description: 'Look-ahead window in weeks (default: 4)' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_economic_indicators',
        description: 'Get key US macroeconomic indicators: Real GDP (quarterly), Federal Funds Rate (monthly), CPI (monthly), annual Inflation rate, and 10-year Treasury yield. Use for macro context in sector or investment theme research.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_technical_indicators',
        description: 'Get technical analysis indicators for a US stock: RSI-14 (momentum/overbought/oversold), MACD with signal line and histogram (trend direction), SMA-20 and SMA-50 (short and medium-term trend), and Bollinger Bands (volatility range). Computed from recent price history — no additional API quota consumed beyond the price fetch.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_commodity_prices',
        description: 'Get current prices for key commodity markets: crude oil (WTI), crude oil (Brent), natural gas, copper, aluminum, wheat, and corn. Use for macro context, energy sector research, or commodity-linked stock analysis.',
        parameters: {
          type: 'object',
          properties: {
            commodities: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of commodities to fetch. Supported: wti, brent, naturalGas, copper, aluminum, wheat, corn. Defaults to wti, brent, naturalGas, copper.',
            },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_forex_rate',
        description: 'Get the real-time exchange rate between two currencies (e.g. USD to EUR, USD to JPY). Useful for international company analysis, currency risk assessment, or global macro context.',
        parameters: {
          type: 'object',
          properties: {
            fromCurrency: { type: 'string', description: 'Base currency code (e.g. USD)' },
            toCurrency: { type: 'string', description: 'Quote currency code (e.g. EUR)' },
          },
          required: ['fromCurrency', 'toCurrency'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_market_status',
        description: 'Check whether the US stock market is currently open or closed, including the current trading session (pre-market, regular, after-hours) and any market holidays.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_recent_filings',
        description: 'Get the most recent SEC regulatory filings for a US company from the SEC EDGAR database (no API key required). Returns 8-K (material events), 10-K (annual report), 10-Q (quarterly report), DEF14A (proxy), and other form types with filing dates and direct EDGAR links. Essential for understanding recent material disclosures, earnings releases, acquisitions, and management changes.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'US stock ticker (e.g. AAPL)' },
            formTypes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional filter by form type (e.g. ["8-K","10-K","10-Q"]). Omit to return all recent filing types.',
            },
            count: { type: 'number', description: 'Max number of filings to return (default: 15)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_market_indicators',
        description: 'Get comprehensive US market and macroeconomic indicators from the Federal Reserve (FRED). Requires FRED_API_KEY. Returns: VIX (fear gauge), S&P 500, yield curve (10Y-2Y spread with recession signal), 10/2-year treasury yields, 3-month T-bill, Fed funds rate, unemployment, CPI, Core PCE (Fed inflation target), 30-year mortgage rate, Baa corporate bond spread, housing starts, retail sales, industrial production, and consumer sentiment. Critical for macro context in any investment thesis.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_crypto_price',
        description: 'Get detailed cryptocurrency price and market data from CoinGecko. Supports common symbols (BTC, ETH, SOL, XRP, ADA, AVAX, DOGE, etc.) or any CoinGecko coin ID. Returns: current price, market cap, rank, 24h/7d/30d/1y price changes, ATH, supply data, and a brief description. Useful for crypto-adjacent stock research (Coinbase, MicroStrategy, miners) or direct crypto analysis.',
        parameters: {
          type: 'object',
          properties: {
            coinId: { type: 'string', description: 'Crypto symbol (e.g. BTC, ETH, SOL) or CoinGecko coin ID (e.g. bitcoin, ethereum)' },
          },
          required: ['coinId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_top_cryptos',
        description: 'Get the top cryptocurrencies ranked by market capitalization from CoinGecko, with 24h/7d/30d price changes, volume, and ATH data. Use for crypto market overview or sector research.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of top cryptos to return (default: 10, max: 50)' },
          },
        },
      },
    },
  ];
}

/**
 * Execute a tool by name with the given arguments.
 * Pass `options.llmFill` to enable LLM-based gap-filling for missing report fields.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  stockService: StockDataService,
  options?: ExecuteToolOptions
): Promise<{ success: boolean; data?: any; message?: string; error?: string }> {
  try {
    switch (toolName) {
      case 'search_stock': {
        const results = await stockService.searchStock(args.query || '');
        return {
          success: true,
          data: results,
          message: `Found ${results.results?.length || 0} matching stocks for "${args.query || ''}"`,
        };
      }
      case 'get_stock_price': {
        const price = await stockService.getStockPrice(args.symbol || '');
        return {
          success: true,
          data: price,
          message: `Current price for ${args.symbol}: $${price.price} (${price.changePercent})`,
        };
      }
      case 'get_price_history': {
        const history = await stockService.getPriceHistory(args.symbol || '', args.range || 'daily');
        return {
          success: true,
          data: history,
          message: `Retrieved ${history.prices?.length || 0} ${args.range || 'daily'} price points for ${args.symbol}`,
        };
      }
      case 'get_company_overview': {
        const overview = await stockService.getCompanyOverview(args.symbol || '');
        return {
          success: true,
          data: overview,
          message: `Retrieved company overview for ${overview.name} (${args.symbol})`,
        };
      }
      case 'get_basic_financials': {
        const metrics = await stockService.getBasicFinancials(args.symbol || '');
        return {
          success: true,
          data: metrics,
          message: `Retrieved basic financials for ${args.symbol}`,
        };
      }
      case 'get_insider_trading': {
        const insiderData = await stockService.getInsiderTrading(args.symbol || '');
        return {
          success: true,
          data: insiderData,
          message: `Retrieved insider trading data for ${args.symbol}`,
        };
      }
      case 'get_analyst_ratings': {
        const ratings = await stockService.getAnalystRatings(args.symbol || '');
        return {
          success: true,
          data: ratings,
          message: `Retrieved analyst ratings for ${args.symbol}`,
        };
      }
      case 'get_analyst_recommendations': {
        const recs = await stockService.getAnalystRecommendations(args.symbol || '');
        return {
          success: true,
          data: recs,
          message: `Retrieved analyst recommendations for ${args.symbol}`,
        };
      }
      case 'get_price_targets': {
        const targets = await stockService.getPriceTargets(args.symbol || '');
        return {
          success: true,
          data: targets,
          message: `Retrieved price targets for ${args.symbol}`,
        };
      }
      case 'get_peers': {
        const peers = await stockService.getPeers(args.symbol || '');
        return {
          success: true,
          data: peers,
          message: `Retrieved peers for ${args.symbol}`,
        };
      }
      case 'get_earnings_history': {
        const earnings = await stockService.getEarningsHistory(args.symbol || '');
        return {
          success: true,
          data: earnings,
          message: `Retrieved earnings history for ${args.symbol}`,
        };
      }
      case 'get_income_statement': {
        const income = await stockService.getIncomeStatement(args.symbol || '');
        return {
          success: true,
          data: income,
          message: `Retrieved income statement for ${args.symbol}`,
        };
      }
      case 'get_balance_sheet': {
        const balanceSheet = await stockService.getBalanceSheet(args.symbol || '');
        return {
          success: true,
          data: balanceSheet,
          message: `Retrieved balance sheet for ${args.symbol}`,
        };
      }
      case 'get_cash_flow': {
        const cashFlow = await stockService.getCashFlow(args.symbol || '');
        return {
          success: true,
          data: cashFlow,
          message: `Retrieved cash flow data for ${args.symbol}`,
        };
      }
      case 'get_news_sentiment': {
        const news = await stockService.getNewsSentiment(args.symbol || '');
        return {
          success: true,
          data: news,
          message: `Retrieved news and sentiment for ${args.symbol}`,
        };
      }
      case 'get_company_news': {
        const news = await stockService.getCompanyNews(args.symbol || '', args.days ? Number(args.days) : undefined);
        return {
          success: true,
          data: news,
          message: `Retrieved company news for ${args.symbol}`,
        };
      }
      case 'get_sector_performance': {
        const data = await stockService.getSectorPerformance();
        return { success: true, data, message: 'Retrieved sector performance data' };
      }
      case 'get_top_gainers_losers': {
        const data = await stockService.getTopGainersLosers();
        return { success: true, data, message: 'Retrieved top gainers, losers, and most active stocks' };
      }
      case 'get_dividend_history': {
        const dividends = await stockService.getDividendHistory(args.symbol || '', args.years ? Number(args.years) : undefined);
        return {
          success: true,
          data: dividends,
          message: `Retrieved dividend history for ${args.symbol}`,
        };
      }
      case 'get_stock_splits': {
        const splits = await stockService.getStockSplits(args.symbol || '', args.years ? Number(args.years) : undefined);
        return {
          success: true,
          data: splits,
          message: `Retrieved stock split history for ${args.symbol}`,
        };
      }
      case 'get_earnings_calendar': {
        const calendar = await stockService.getEarningsCalendar(
          args.symbol || undefined,
          args.weeks ? Number(args.weeks) : undefined
        );
        return {
          success: true,
          data: calendar,
          message: `Retrieved upcoming earnings calendar${args.symbol ? ` for ${args.symbol}` : ''}`,
        };
      }
      case 'get_ipo_calendar': {
        const ipos = await stockService.getIpoCalendar(args.weeks ? Number(args.weeks) : undefined);
        return {
          success: true,
          data: ipos,
          message: 'Retrieved upcoming IPO calendar',
        };
      }
      case 'get_economic_indicators': {
        const economics = await stockService.getEconomicIndicators();
        return {
          success: true,
          data: economics,
          message: 'Retrieved US macroeconomic indicators',
        };
      }
      case 'get_technical_indicators': {
        const indicators = await stockService.getTechnicalIndicators(args.symbol || '');
        return {
          success: true,
          data: indicators,
          message: `Retrieved technical indicators for ${args.symbol}`,
        };
      }
      case 'get_commodity_prices': {
        const commodities = await stockService.getCommodityPrices(
          Array.isArray(args.commodities) ? args.commodities : undefined
        );
        return {
          success: true,
          data: commodities,
          message: 'Retrieved commodity prices',
        };
      }
      case 'get_forex_rate': {
        const forex = await stockService.getForexRate(args.fromCurrency || 'USD', args.toCurrency || 'EUR');
        return {
          success: true,
          data: forex,
          message: `Retrieved exchange rate for ${args.fromCurrency || 'USD'}/${args.toCurrency || 'EUR'}`,
        };
      }
      case 'get_market_status': {
        const status = await stockService.getMarketStatus();
        return {
          success: true,
          data: status,
          message: `US market is currently ${status.isOpen ? 'OPEN' : 'CLOSED'}`,
        };
      }
      case 'get_recent_filings': {
        const secEdgar = new SecEdgarService();
        const filings = await secEdgar.getRecentFilings(
          args.symbol || '',
          Array.isArray(args.formTypes) ? args.formTypes : undefined,
          args.count ? Number(args.count) : undefined
        );
        return {
          success: true,
          data: filings,
          message: `Retrieved ${filings.filings?.length ?? 0} SEC filings for ${args.symbol}`,
        };
      }
      case 'get_market_indicators': {
        const fred = new FredService();
        const indicators = await fred.getMarketIndicators();
        return {
          success: true,
          data: indicators,
          message: 'Retrieved FRED US market and macroeconomic indicators',
        };
      }
      case 'get_crypto_price': {
        const coinGecko = new CoinGeckoService();
        const price = await coinGecko.getCryptoPrice(args.coinId || '');
        return {
          success: true,
          data: price,
          message: `Retrieved crypto price for ${price.name ?? args.coinId} (${price.symbol})`,
        };
      }
      case 'get_top_cryptos': {
        const coinGecko = new CoinGeckoService();
        const cryptos = await coinGecko.getTopCryptos(args.limit ? Number(args.limit) : undefined);
        return {
          success: true,
          data: cryptos,
          message: `Retrieved top ${cryptos.length} cryptocurrencies by market cap`,
        };
      }
      case 'generate_stock_report': {
        const symbolQuery = args.symbol || '';

        // Step 1: LLM resolves the input to the correct official ticker.
        // LLM is the primary resolver — it knows that 'GOOGLE' → 'GOOGL',
        // 'Microsoft' → 'MSFT', etc., without needing an API search call.
        let symbol: string | undefined;
        if (options?.llmFill) {
          const prompt = buildTickerResolutionPrompt([symbolQuery]);
          try {
            const raw = await options.llmFill(prompt);
            const parsed = parseLLMFillJSON(raw);
            if (parsed?.[symbolQuery] && typeof parsed[symbolQuery] === 'string') {
              const llmTicker = String(parsed[symbolQuery]).replace(/[^A-Z0-9.]/gi, '').toUpperCase();
              if (llmTicker) symbol = llmTicker;
            }
          } catch {
            // LLM unavailable; fall through to API search
          }
        }

        // Step 2: LLM couldn't resolve (or not available) — fall back to AV symbol search.
        if (!symbol) {
          const apiResolved = await resolveSymbolFromQuery(stockService, symbolQuery);
          if (apiResolved.ok && apiResolved.symbol) {
            symbol = apiResolved.symbol;
          } else {
            const candidates = (apiResolved.candidates || [])
              .map((item: any) => `${item.name || item.symbol} (${item.symbol})`)
              .join(', ');
            return {
              success: false,
              error: `Could not resolve "${symbolQuery}". ${candidates ? `Did you mean: ${candidates}?` : 'No matches found.'}`,
              data: { candidates: apiResolved.candidates || [] },
            };
          }
        }
        const range = args.range || '5y';
        const notes: string[] = [];
        const sources = new Map<string, string>();
        const cache = await loadSymbolCache(symbol);
        let rateLimitHit = false;
        const isRateLimit = (message: string) =>
          message.includes('frequency') ||
          message.includes('Thank you for using Alpha Vantage') ||
          /rate limit|too many requests/i.test(message);
        const safeFetch = async <T>(label: string, key: string, request: Promise<T>) => {
          const cachedValue = getCachedValue(cache, key);
          if (cachedValue !== null) {
            if (cachedValue && typeof cachedValue === 'object' && '__source' in cachedValue) {
              sources.set(label, String((cachedValue as any).__source));
            } else if (cachedValue && typeof cachedValue === 'object') {
              sources.set(label, DEFAULT_SOURCE);
            }
            return cachedValue as T;
          }
          if (rateLimitHit) return undefined as T;
          try {
            const result = await request;
            if (result && typeof result === 'object' && '__source' in result) {
              sources.set(label, String((result as any).__source));
            } else if (result && typeof result === 'object') {
              sources.set(label, DEFAULT_SOURCE);
            }
            setCachedValue(cache, key, result);
            return result;
          } catch (error: any) {
            const message = error?.message || 'Unavailable';
            if (isRateLimit(message)) {
              rateLimitHit = true;
              notes.push(
                /finnhub|rate limit reached/i.test(message)
                  ? 'Finnhub rate limit reached; remaining sections skipped.'
                  : 'Alpha Vantage rate limit reached; remaining sections skipped.'
              );
              return cachedValue !== null ? (cachedValue as T) : (undefined as T);
            }
            if (!/unavailable (in|via) (Alpha|Finnhub)/i.test(message) && !message.includes('Alpha-only mode')) {
              notes.push(`${label}: ${message}`);
            }
            if (cachedValue && typeof cachedValue === 'object' && '__source' in cachedValue) {
              sources.set(label, String((cachedValue as any).__source));
            } else if (cachedValue && typeof cachedValue === 'object') {
              sources.set(label, DEFAULT_SOURCE);
            }
            return cachedValue !== null ? (cachedValue as T) : (undefined as T);
          }
        };
        const buildBasicFinancialsFallback = (overview: any) => {
          if (!overview) return undefined;
          const revenue = Number(overview.revenueTTM);
          const grossProfit = Number(overview.grossProfitTTM);
          const grossMarginTTM = Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(grossProfit)
            ? grossProfit / revenue
            : overview.grossMarginTTM != null
              ? Number(overview.grossMarginTTM)
              : Number(overview.profitMargin) || null;
          return {
            symbol: overview.symbol,
            metric: {
              peBasicExclExtraTTM: overview.peRatio,
              epsTTM: overview.eps,
              revenueGrowthTTM: overview.quarterlyRevenueGrowth,
              epsGrowthTTM: overview.quarterlyEarningsGrowth,
              grossMarginTTM,
              operatingMarginTTM: overview.operatingMargin,
              roeTTM: overview.returnOnEquity,
              revenuePerShareTTM: overview.revenuePerShare,
            },
            series: {},
          };
        };

        const price = await safeFetch('Price', 'price', stockService.getStockPrice(symbol));
        const companyOverview = await safeFetch('Company overview', 'overview', stockService.getCompanyOverview(symbol));
        const priceHistory = await safeFetch('Price history', `priceHistory:${range}`, stockService.getPriceHistory(symbol, range));
        const earningsHistory = await safeFetch('Earnings history', 'earningsHistory', stockService.getEarningsHistory(symbol));
        const incomeStatement = await safeFetch('Income statement', 'incomeStatement', stockService.getIncomeStatement(symbol));
        const balanceSheet = await safeFetch('Balance sheet', 'balanceSheet', stockService.getBalanceSheet(symbol));
        const cashFlow = await safeFetch('Cash flow', 'cashFlow', stockService.getCashFlow(symbol));
        const analystRatings = await safeFetch('Analyst ratings', 'analystRatings', stockService.getAnalystRatings(symbol));
        const analystRecommendations = await safeFetch(
          'Analyst recommendations',
          'analystRecommendations',
          stockService.getAnalystRecommendations(symbol)
        );
        const priceTargets = await safeFetch('Price targets', 'priceTargets', stockService.getPriceTargets(symbol));
        const peers = await safeFetch('Peers', 'peers', stockService.getPeers(symbol));
        const newsSentiment = await safeFetch('News sentiment', 'newsSentiment', stockService.getNewsSentiment(symbol));
        const companyNews = await safeFetch('Company news', 'companyNews', stockService.getCompanyNews(symbol, 14));


        // Build basic financials from the overview
        const finalBasicFinancials = companyOverview ? buildBasicFinancialsFallback(companyOverview) : undefined;

        // LLM moat analysis — best-effort; report still builds without it
        let moatAnalysis: MoatAnalysis | undefined;
        if (options?.llmFill) {
          try {
            const moatPrompt = buildMoatAnalysisPrompt(symbol, companyOverview, finalBasicFinancials);
            const raw = await options.llmFill(moatPrompt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            moatAnalysis = parseMoatEntry(parsed) ?? undefined;
          } catch {
            // LLM unavailable or invalid JSON — proceed without moat analysis
          }
        }

        const reportBody = buildStockReport({
          symbol: symbol.toUpperCase(),
          generatedAt: new Date().toISOString(),
          price,
          priceHistory,
          companyOverview,
          basicFinancials: finalBasicFinancials,
          earningsHistory,
          incomeStatement,
          balanceSheet,
          cashFlow,
          analystRatings,
          analystRecommendations,
          priceTargets,
          peers,
          newsSentiment,
          companyNews,
          moatAnalysis,
        });

        const content = notes.length
          ? reportBody.replace(
              '## 📊 Snapshot',
              `## ⚠️ Data Gaps\n${notes.map((item) => `- ${item}`).join('\n')}\n\n## 📊 Snapshot`
            )
          : reportBody;

        const debugMode = process.env.DEBUG === 'true';
        const sourceSection = debugMode && sources.size
          ? `## 🧾 Data Sources\n${SOURCE_LEGEND}\n${Array.from(sources.entries()).map(([key, value]) => `- ${key}: ${value}`).join('\n')}`
          : '';
        const finalContent = sourceSection
          ? content.replace('## 📊 Snapshot', `${sourceSection}\n\n## 📊 Snapshot`)
          : content;
        const saved = await saveReport(finalContent, `${symbol}-stock-report`);
        await saveSymbolCache(symbol, cache);
        return {
          success: true,
          data: { content: finalContent, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Saved stock report to ${saved.filePath}`,
        };
      }
      case 'generate_comparison_report': {
        const range = args.range || '1y';
        const companiesInput = Array.isArray(args.companies)
          ? args.companies
          : String(args.companies || '').split(',');
        const companies = companiesInput.map((item: string) => item.trim()).filter(Boolean);
        if (companies.length < 2 || companies.length > NUM_COMPANIES) {
          return { success: false, error: `Provide between 2 and ${NUM_COMPANIES} company names or tickers.` };
        }

        // Step 1: LLM resolves ALL inputs to official tickers in one batch call.
        // LLM is the primary resolver — no API search is needed for well-known names
        // (e.g. 'GOOGLE' → 'GOOGL', 'Microsoft' → 'MSFT').
        const resolvedMap = new Map<string, string>(); // query → official ticker
        if (options?.llmFill) {
          const prompt = buildTickerResolutionPrompt(companies);
          try {
            const raw = await options.llmFill(prompt);
            const parsed = parseLLMFillJSON(raw);
            if (parsed && typeof parsed === 'object') {
              for (const query of companies) {
                const llmTicker = parsed[query];
                if (llmTicker && typeof llmTicker === 'string') {
                  const clean = String(llmTicker).replace(/[^A-Z0-9.]/gi, '').toUpperCase();
                  if (clean) resolvedMap.set(query, clean);
                }
              }
            }
          } catch {
            // LLM unavailable; fall through to API search for all
          }
        }

        // Step 2: For anything LLM couldn't resolve, fall back to AV symbol search.
        const needsApiSearch = companies.filter((q) => !resolvedMap.has(q));
        for (const query of needsApiSearch) {
          const result = await resolveSymbolFromQuery(stockService, query);
          if (result.ok && result.symbol) {
            resolvedMap.set(query, result.symbol);
          }
        }

        // Step 3: Error if anything is still unresolved.
        const unresolved = companies.filter((q) => !resolvedMap.has(q));
        if (unresolved.length) {
          return {
            success: false,
            error: `Could not resolve to a ticker: ${unresolved.join(', ')}. Please use official ticker symbols.`,
          };
        }

        const universe = companies.map((q) => resolvedMap.get(q) as string);
        const notes: string[] = [];
        const sourceMap: Record<string, Record<string, string>> = {};
        let rateLimitHit = false;
        const isRateLimit = (message: string) =>
          message.includes('frequency') ||
          message.includes('Thank you for using Alpha Vantage') ||
          /rate limit|too many requests/i.test(message);
        const safeFetch = async <T>(
          symbol: string,
          cache: SymbolCache,
          label: string,
          key: string,
          request: Promise<T>
        ) => {
        const cachedValue = getCachedValue(cache, key);
        if (cachedValue !== null) {
          if (cachedValue && typeof cachedValue === 'object') {
            const sourceValue = '__source' in cachedValue
              ? String((cachedValue as any).__source)
              : DEFAULT_SOURCE;
            sourceMap[symbol] = sourceMap[symbol] || {};
            sourceMap[symbol][label] = sourceValue;
          }
          return cachedValue as T;
        }
          if (rateLimitHit) return undefined as T;
        try {
          const result = await request;
          if (result && typeof result === 'object') {
            const sourceValue = '__source' in result ? String((result as any).__source) : DEFAULT_SOURCE;
            sourceMap[symbol] = sourceMap[symbol] || {};
            sourceMap[symbol][label] = sourceValue;
          }
          setCachedValue(cache, key, result);
          return result;
        } catch (error: any) {
            const message = error?.message || 'Unavailable';
            if (isRateLimit(message)) {
              rateLimitHit = true;
              notes.push(
                /finnhub|rate limit reached/i.test(message)
                  ? 'Finnhub rate limit reached; remaining sections skipped.'
                  : 'Alpha Vantage rate limit reached; remaining sections skipped.'
              );
              return cachedValue !== null ? (cachedValue as T) : (undefined as T);
            }
            if (!/unavailable (in|via) (Alpha|Finnhub)/i.test(message) && !message.includes('Alpha-only mode')) {
              notes.push(`${label}: ${message}`);
            }
          if (cachedValue && typeof cachedValue === 'object') {
            const sourceValue = '__source' in cachedValue
              ? String((cachedValue as any).__source)
              : DEFAULT_SOURCE;
            sourceMap[symbol] = sourceMap[symbol] || {};
            sourceMap[symbol][label] = sourceValue;
          }
          return cachedValue !== null ? (cachedValue as T) : (undefined as T);
        }
      };
        const buildBasicFinancialsFallback = (overview: any) => {
          if (!overview) return undefined;
          const revenue = Number(overview.revenueTTM);
          const grossProfit = Number(overview.grossProfitTTM);
          const grossMarginTTM = Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(grossProfit)
            ? grossProfit / revenue
            : overview.grossMarginTTM != null
              ? Number(overview.grossMarginTTM)
              : Number(overview.profitMargin) || null;
          return {
            symbol: overview.symbol,
            metric: {
              peBasicExclExtraTTM: overview.peRatio,
              epsTTM: overview.eps,
              revenueGrowthTTM: overview.quarterlyRevenueGrowth,
              epsGrowthTTM: overview.quarterlyEarningsGrowth,
              grossMarginTTM,
              operatingMarginTTM: overview.operatingMargin,
              roeTTM: overview.returnOnEquity,
              revenuePerShareTTM: overview.revenuePerShare,
            },
            series: {},
          };
        };

        // Phase 1: Fetch all API data for all companies
        type RawCompanyData = {
          symbol: string;
          cache: SymbolCache;
          price: any;
          overview: any;
          priceHistory: any;
          incomeStatement: any;
          balanceSheet: any;
          cashFlow: any;
          analystRatings: any;
          priceTargets: any;
        };
        const rawItems: RawCompanyData[] = [];
        for (const symbol of universe) {
          const cache = await loadSymbolCache(symbol);
          const price = await safeFetch(symbol, cache, 'Price', 'price', stockService.getStockPrice(symbol));
          const overview = await safeFetch(symbol, cache, 'Company overview', 'overview', stockService.getCompanyOverview(symbol));
          const priceHistory = await safeFetch(symbol, cache, 'Price history', `priceHistory:${range}`, stockService.getPriceHistory(symbol, range));
          const incomeStatement = await safeFetch(symbol, cache, 'Income statement', 'incomeStatement', stockService.getIncomeStatement(symbol));
          const balanceSheet = await safeFetch(symbol, cache, 'Balance sheet', 'balanceSheet', stockService.getBalanceSheet(symbol));
          const cashFlow = await safeFetch(symbol, cache, 'Cash flow', 'cashFlow', stockService.getCashFlow(symbol));
          const analystRatings = await safeFetch(symbol, cache, 'Analyst ratings', 'analystRatings', stockService.getAnalystRatings(symbol));
          const priceTargets = await safeFetch(symbol, cache, 'Price targets', 'priceTargets', stockService.getPriceTargets(symbol));
          rawItems.push({ symbol, cache, price, overview, priceHistory, incomeStatement, balanceSheet, cashFlow, analystRatings, priceTargets });
        }

        // Phase 2: Build items from API data
        const items: any[] = [];
        for (const item of rawItems) {
          const { symbol } = item;
          const basicFinancials = item.overview ? buildBasicFinancialsFallback(item.overview) : undefined;
          items.push({
            symbol,
            price: item.price,
            overview: item.overview,
            basicFinancials,
            priceHistory: item.priceHistory,
            incomeStatement: item.incomeStatement,
            balanceSheet: item.balanceSheet,
            cashFlow: item.cashFlow,
            analystRatings: item.analystRatings,
            priceTargets: item.priceTargets,
          });
          await saveSymbolCache(symbol, item.cache);
        }

        // Phase 3: LLM batch moat analysis for all companies (single call)
        if (options?.llmFill && items.length > 0) {
          try {
            const moatPrompt = buildBatchMoatAnalysisPrompt(
              items.map((item) => ({ symbol: item.symbol, overview: item.overview, basicFinancials: item.basicFinancials }))
            );
            const raw = await options.llmFill(moatPrompt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object') {
              for (const sym of Object.keys(parsed)) {
                const entry = parseMoatEntry(parsed[sym]);
                if (entry) {
                  const ticker = cleanTicker(sym);
                  const target = items.find((it) => it.symbol === ticker);
                  if (target) target.moatAnalysis = entry;
                }
              }
            }
          } catch {
            // LLM unavailable or invalid JSON — proceed without moat analysis
          }
        }

        const content = buildComparisonReport({
          generatedAt: new Date().toISOString(),
          range,
          universe,
          items,
          notes,
          sources: sourceMap,
        });
        const saved = await saveReport(content, `${universe.join('-')}-comparison-report`);
        return {
          success: true,
          data: { content, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Saved comparison report to ${saved.filePath}`,
        };
      }
      case 'generate_sector_report': {
        const sector = String(args.sector || '').trim();
        if (!sector) {
          return { success: false, error: 'A sector or theme query is required.' };
        }
        const count = Math.min(NUM_COMPANIES, Math.max(2, Number(args.count) || NUM_COMPANIES));
        const range = args.range || '1y';

        // Step 1: Use LLM to identify the top companies in this sector.
        let universe: string[] = [];
        if (options?.llmFill) {
          const prompt = buildSectorCompaniesPrompt(sector, count);
          try {
            const raw = await options.llmFill(prompt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed)) {
              universe = parsed
                .map((item: any) => String(item || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase())
                .filter((t) => t.length > 0)
                .slice(0, count);
            }
          } catch {
            // LLM unavailable or returned invalid JSON; fall through
          }
        }

        if (universe.length < 2) {
          return {
            success: false,
            error:
              `Could not identify companies for sector "${sector}". ` +
              'Please provide the specific company tickers using generate_comparison_report instead.',
          };
        }

        // Step 2: Fetch comparison data for the identified companies
        // (same logic as generate_comparison_report).
        const notes: string[] = [`Universe identified by AI for sector: "${sector}"`];
        const sourceMap: Record<string, Record<string, string>> = {};
        let rateLimitHit = false;
        const isRateLimit = (message: string) =>
          message.includes('frequency') ||
          message.includes('Thank you for using Alpha Vantage') ||
          /rate limit|too many requests/i.test(message);
        const safeFetch = async <T>(
          symbol: string,
          cache: SymbolCache,
          label: string,
          key: string,
          request: Promise<T>
        ) => {
          const cachedValue = getCachedValue(cache, key);
          if (cachedValue !== null) {
            if (cachedValue && typeof cachedValue === 'object') {
              const sourceValue = '__source' in cachedValue
                ? String((cachedValue as any).__source)
                : DEFAULT_SOURCE;
              sourceMap[symbol] = sourceMap[symbol] || {};
              sourceMap[symbol][label] = sourceValue;
            }
            return cachedValue as T;
          }
          if (rateLimitHit) return undefined as T;
          try {
            const result = await request;
            if (result && typeof result === 'object') {
              const sourceValue = '__source' in result ? String((result as any).__source) : DEFAULT_SOURCE;
              sourceMap[symbol] = sourceMap[symbol] || {};
              sourceMap[symbol][label] = sourceValue;
            }
            setCachedValue(cache, key, result);
            return result;
          } catch (error: any) {
            const message = error?.message || 'Unavailable';
            if (isRateLimit(message)) {
              rateLimitHit = true;
              notes.push(
                /finnhub|rate limit reached/i.test(message)
                  ? 'Finnhub rate limit reached; remaining sections skipped.'
                  : 'Alpha Vantage rate limit reached; remaining sections skipped.'
              );
              return cachedValue !== null ? (cachedValue as T) : (undefined as T);
            }
            if (!/unavailable (in|via) (Alpha|Finnhub)/i.test(message) && !message.includes('Alpha-only mode')) {
              notes.push(`${label}: ${message}`);
            }
            if (cachedValue && typeof cachedValue === 'object') {
              const sourceValue = '__source' in cachedValue
                ? String((cachedValue as any).__source)
                : DEFAULT_SOURCE;
              sourceMap[symbol] = sourceMap[symbol] || {};
              sourceMap[symbol][label] = sourceValue;
            }
            return cachedValue !== null ? (cachedValue as T) : (undefined as T);
          }
        };
        const buildBasicFinancialsFallbackSector = (overview: any) => {
          if (!overview) return undefined;
          const revenue = Number(overview.revenueTTM);
          const grossProfit = Number(overview.grossProfitTTM);
          const grossMarginTTM =
            Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(grossProfit)
              ? grossProfit / revenue
              : overview.grossMarginTTM != null
                ? Number(overview.grossMarginTTM)
                : Number(overview.profitMargin) || null;
          return {
            symbol: overview.symbol,
            metric: {
              peBasicExclExtraTTM: overview.peRatio,
              epsTTM: overview.eps,
              revenueGrowthTTM: overview.quarterlyRevenueGrowth,
              epsGrowthTTM: overview.quarterlyEarningsGrowth,
              grossMarginTTM,
              operatingMarginTTM: overview.operatingMargin,
              roeTTM: overview.returnOnEquity,
              revenuePerShareTTM: overview.revenuePerShare,
            },
            series: {},
          };
        };

        type RawSectorItem = {
          symbol: string;
          cache: SymbolCache;
          price: any;
          overview: any;
          priceHistory: any;
          incomeStatement: any;
          balanceSheet: any;
          cashFlow: any;
          analystRatings: any;
          priceTargets: any;
        };
        const rawItems: RawSectorItem[] = [];
        for (const symbol of universe) {
          const cache = await loadSymbolCache(symbol);
          const price = await safeFetch(symbol, cache, 'Price', 'price', stockService.getStockPrice(symbol));
          const overview = await safeFetch(symbol, cache, 'Company overview', 'overview', stockService.getCompanyOverview(symbol));
          const priceHistory = await safeFetch(symbol, cache, 'Price history', `priceHistory:${range}`, stockService.getPriceHistory(symbol, range));
          const incomeStatement = await safeFetch(symbol, cache, 'Income statement', 'incomeStatement', stockService.getIncomeStatement(symbol));
          const balanceSheet = await safeFetch(symbol, cache, 'Balance sheet', 'balanceSheet', stockService.getBalanceSheet(symbol));
          const cashFlow = await safeFetch(symbol, cache, 'Cash flow', 'cashFlow', stockService.getCashFlow(symbol));
          const analystRatings = await safeFetch(symbol, cache, 'Analyst ratings', 'analystRatings', stockService.getAnalystRatings(symbol));
          const priceTargets = await safeFetch(symbol, cache, 'Price targets', 'priceTargets', stockService.getPriceTargets(symbol));
          rawItems.push({ symbol, cache, price, overview, priceHistory, incomeStatement, balanceSheet, cashFlow, analystRatings, priceTargets });
        }

        const items: any[] = [];
        for (const item of rawItems) {
          const { symbol } = item;
          const basicFinancials = item.overview ? buildBasicFinancialsFallbackSector(item.overview) : undefined;
          items.push({
            symbol,
            price: item.price,
            overview: item.overview,
            basicFinancials,
            priceHistory: item.priceHistory,
            incomeStatement: item.incomeStatement,
            balanceSheet: item.balanceSheet,
            cashFlow: item.cashFlow,
            analystRatings: item.analystRatings,
            priceTargets: item.priceTargets,
          });
          await saveSymbolCache(symbol, item.cache);
        }

        // LLM batch moat analysis for all sector companies (single call)
        if (options?.llmFill && items.length > 0) {
          try {
            const moatPrompt = buildBatchMoatAnalysisPrompt(
              items.map((item) => ({ symbol: item.symbol, overview: item.overview, basicFinancials: item.basicFinancials }))
            );
            const raw = await options.llmFill(moatPrompt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object') {
              for (const sym of Object.keys(parsed)) {
                const entry = parseMoatEntry(parsed[sym]);
                if (entry) {
                  const ticker = cleanTicker(sym);
                  const target = items.find((it) => it.symbol === ticker);
                  if (target) target.moatAnalysis = entry;
                }
              }
            }
          } catch {
            // LLM unavailable or invalid JSON — proceed without moat analysis
          }
        }

        const content = buildSectorReport({
          sectorQuery: sector,
          selectedBy: 'llm',
          generatedAt: new Date().toISOString(),
          range,
          universe,
          items,
          notes,
          sources: sourceMap,
        });
        const safeTitle = sector.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const saved = await saveReport(content, `${safeTitle}-sector-report`);
        return {
          success: true,
          data: { content, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Saved sector report for "${sector}" to ${saved.filePath}`,
        };
      }
      case 'generate_deep_sector_report': {
        const sector = String(args.sector || '').trim();
        if (!sector) {
          return { success: false, error: 'A sector or theme query is required.' };
        }
        const finalCount = Math.min(NUM_COMPANIES, Math.max(3, Number(args.count) || NUM_COMPANIES));
        // Fetch roughly 2x candidates for screening; cap at NUM_COMPANIES * 2 to avoid rate limits.
        const initialCount = Math.min(NUM_COMPANIES * 2, finalCount * 2);
        const range = args.range || '1y';

        if (!options?.llmFill) {
          return {
            success: false,
            error: 'Deep sector research requires an LLM connection. Please ensure a valid API token is configured.',
          };
        }

        // ── Phase 1: LLM identifies initial broad candidate list ────────────────
        let initialCandidates: string[] = [];
        {
          const prompt = buildSectorCompaniesPrompt(sector, initialCount);
          try {
            const raw = await options.llmFill(prompt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed)) {
              initialCandidates = parsed
                .map((item: any) => String(item || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase())
                .filter((t) => t.length > 0)
                .slice(0, initialCount);
            }
          } catch {
            // LLM unavailable or returned invalid JSON
          }
        }

        if (initialCandidates.length < 2) {
          return {
            success: false,
            error:
              `Could not identify companies for sector "${sector}". ` +
              'Please provide specific tickers using generate_comparison_report instead.',
          };
        }

        // ── Phase 2: Fetch lightweight ecosystem data for each candidate ─────────
        // overview + news sentiment + peers — used by the LLM for dependency analysis.
        // Uses cache where available; silently skips on error (rate limits, unknown tickers).
        const ecosystemData: Array<{ symbol: string; overview: any; news: any; peers: any }> = [];
        for (const sym of initialCandidates) {
          try {
            const cache = await loadSymbolCache(sym);
            const overview =
              getCachedValue(cache, 'overview') ??
              await stockService.getCompanyOverview(sym).catch(() => null);
            const news =
              getCachedValue(cache, 'newsSentiment') ??
              await stockService.getNewsSentiment(sym).catch(() => null);
            const peers =
              getCachedValue(cache, 'peers') ??
              await stockService.getPeers(sym).catch(() => null);
            // Persist anything freshly fetched back to cache (best-effort).
            const updated = await loadSymbolCache(sym);
            if (overview && !getCachedValue(updated, 'overview')) {
              setCachedValue(updated, 'overview', overview);
              await saveSymbolCache(sym, updated).catch(() => {});
            }
            ecosystemData.push({ symbol: sym, overview, news, peers });
          } catch {
            ecosystemData.push({ symbol: sym, overview: null, news: null, peers: null });
          }
        }

        // ── Phase 3: LLM builds dependency analysis and refines the list ─────────
        // Runs DEEP_RESEARCH_DEPTH times. Each pass feeds the prior analysis as context
        // so the LLM progressively deepens its insights and further refines the universe.
        let universe: string[] = [];
        let dependencyAnalysis: string | undefined;
        let ecosystemDiagram: string | undefined;
        let refinementNotes: string | undefined;
        let companySnapshots: Record<string, string> | undefined;
        let previousPass: DeepSectorPassContext | undefined;

        for (let passIndex = 0; passIndex < DEEP_RESEARCH_DEPTH; passIndex++) {
          const depPrompt = buildDeepSectorDependencyPrompt(sector, finalCount, ecosystemData, previousPass);
          try {
            const raw = await options.llmFill(depPrompt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object') {
              let passUniverse: string[] = universe;
              if (Array.isArray(parsed.refinedList)) {
                passUniverse = parsed.refinedList
                  .map((t: any) => String(t || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase())
                  .filter((t: string) => t.length > 0)
                  .slice(0, finalCount);
                if (passUniverse.length >= 2) universe = passUniverse;
              }
              if (typeof parsed.dependencyAnalysis === 'string') {
                dependencyAnalysis = parsed.dependencyAnalysis;
              }
              if (typeof parsed.ecosystemDiagram === 'string') {
                ecosystemDiagram = parsed.ecosystemDiagram;
              }
              if (typeof parsed.refinementNotes === 'string') {
                refinementNotes = parsed.refinementNotes;
              }
              if (parsed.companySnapshots && typeof parsed.companySnapshots === 'object' && !Array.isArray(parsed.companySnapshots)) {
                companySnapshots = {};
                for (const [k, v] of Object.entries(parsed.companySnapshots)) {
                  if (typeof v === 'string') companySnapshots[k.replace(/[^A-Z0-9.]/gi, '').toUpperCase()] = v;
                }
              }
              // Carry this pass's output forward as context for the next pass
              previousPass = { dependencyAnalysis, ecosystemDiagram, refinementNotes, companySnapshots, universe, passIndex };
            }
          } catch {
            // Pass failed — stop recursion and use what we have so far
            break;
          }
        }

        // Fall back to the initial list if refinement failed
        if (universe.length < 2) {
          universe = initialCandidates.slice(0, finalCount);
        }

        // ── Phase 4: Fetch full comparison data for the refined universe ──────────
        const notes: string[] = [
          `Universe refined through deep sector analysis (${DEEP_RESEARCH_DEPTH} pass${DEEP_RESEARCH_DEPTH > 1 ? 'es' : ''}) for: "${sector}"`,
          `Initial candidates: ${initialCandidates.join(', ')}`,
          `Refined universe: ${universe.join(', ')}`,
        ];
        const sourceMap: Record<string, Record<string, string>> = {};
        let rateLimitHit = false;
        const isRateLimit = (message: string) =>
          message.includes('frequency') ||
          message.includes('Thank you for using Alpha Vantage') ||
          /rate limit|too many requests/i.test(message);
        const safeFetch = async <T>(
          symbol: string,
          cache: SymbolCache,
          label: string,
          key: string,
          request: Promise<T>
        ) => {
          const cachedValue = getCachedValue(cache, key);
          if (cachedValue !== null) {
            if (cachedValue && typeof cachedValue === 'object') {
              const sourceValue = '__source' in cachedValue
                ? String((cachedValue as any).__source)
                : DEFAULT_SOURCE;
              sourceMap[symbol] = sourceMap[symbol] || {};
              sourceMap[symbol][label] = sourceValue;
            }
            return cachedValue as T;
          }
          if (rateLimitHit) return undefined as T;
          try {
            const result = await request;
            if (result && typeof result === 'object') {
              const sourceValue = '__source' in result ? String((result as any).__source) : DEFAULT_SOURCE;
              sourceMap[symbol] = sourceMap[symbol] || {};
              sourceMap[symbol][label] = sourceValue;
            }
            setCachedValue(cache, key, result);
            return result;
          } catch (error: any) {
            const message = error?.message || 'Unavailable';
            if (isRateLimit(message)) {
              rateLimitHit = true;
              notes.push(
                /finnhub|rate limit reached/i.test(message)
                  ? 'Finnhub rate limit reached; remaining sections skipped.'
                  : 'Alpha Vantage rate limit reached; remaining sections skipped.'
              );
              return cachedValue !== null ? (cachedValue as T) : (undefined as T);
            }
            if (!/unavailable (in|via) (Alpha|Finnhub)/i.test(message) && !message.includes('Alpha-only mode')) {
              notes.push(`${label}: ${message}`);
            }
            if (cachedValue && typeof cachedValue === 'object') {
              const sourceValue = '__source' in cachedValue
                ? String((cachedValue as any).__source)
                : DEFAULT_SOURCE;
              sourceMap[symbol] = sourceMap[symbol] || {};
              sourceMap[symbol][label] = sourceValue;
            }
            return cachedValue !== null ? (cachedValue as T) : (undefined as T);
          }
        };
        const buildBasicFinancialsFallbackDeep = (overview: any) => {
          if (!overview) return undefined;
          const revenue = Number(overview.revenueTTM);
          const grossProfit = Number(overview.grossProfitTTM);
          const grossMarginTTM =
            Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(grossProfit)
              ? grossProfit / revenue
              : overview.grossMarginTTM != null
                ? Number(overview.grossMarginTTM)
                : Number(overview.profitMargin) || null;
          return {
            symbol: overview.symbol,
            metric: {
              peBasicExclExtraTTM: overview.peRatio,
              epsTTM: overview.eps,
              revenueGrowthTTM: overview.quarterlyRevenueGrowth,
              epsGrowthTTM: overview.quarterlyEarningsGrowth,
              grossMarginTTM,
              operatingMarginTTM: overview.operatingMargin,
              roeTTM: overview.returnOnEquity,
              revenuePerShareTTM: overview.revenuePerShare,
            },
            series: {},
          };
        };

        type RawDeepSectorItem = {
          symbol: string;
          cache: SymbolCache;
          price: any;
          overview: any;
          priceHistory: any;
          incomeStatement: any;
          balanceSheet: any;
          cashFlow: any;
          analystRatings: any;
          priceTargets: any;
        };
        const rawItems: RawDeepSectorItem[] = [];
        for (const symbol of universe) {
          const cache = await loadSymbolCache(symbol);
          const price = await safeFetch(symbol, cache, 'Price', 'price', stockService.getStockPrice(symbol));
          const overview = await safeFetch(symbol, cache, 'Company overview', 'overview', stockService.getCompanyOverview(symbol));
          const priceHistory = await safeFetch(symbol, cache, 'Price history', `priceHistory:${range}`, stockService.getPriceHistory(symbol, range));
          const incomeStatement = await safeFetch(symbol, cache, 'Income statement', 'incomeStatement', stockService.getIncomeStatement(symbol));
          const balanceSheet = await safeFetch(symbol, cache, 'Balance sheet', 'balanceSheet', stockService.getBalanceSheet(symbol));
          const cashFlow = await safeFetch(symbol, cache, 'Cash flow', 'cashFlow', stockService.getCashFlow(symbol));
          const analystRatings = await safeFetch(symbol, cache, 'Analyst ratings', 'analystRatings', stockService.getAnalystRatings(symbol));
          const priceTargets = await safeFetch(symbol, cache, 'Price targets', 'priceTargets', stockService.getPriceTargets(symbol));
          rawItems.push({ symbol, cache, price, overview, priceHistory, incomeStatement, balanceSheet, cashFlow, analystRatings, priceTargets });
        }

        const items: any[] = [];
        for (const item of rawItems) {
          const { symbol } = item;
          const basicFinancials = item.overview ? buildBasicFinancialsFallbackDeep(item.overview) : undefined;
          items.push({
            symbol,
            price: item.price,
            overview: item.overview,
            basicFinancials,
            priceHistory: item.priceHistory,
            incomeStatement: item.incomeStatement,
            balanceSheet: item.balanceSheet,
            cashFlow: item.cashFlow,
            analystRatings: item.analystRatings,
            priceTargets: item.priceTargets,
          });
          await saveSymbolCache(symbol, item.cache);
        }

        // LLM batch moat analysis for the refined deep sector universe (single call)
        if (options?.llmFill && items.length > 0) {
          try {
            const moatPrompt = buildBatchMoatAnalysisPrompt(
              items.map((item) => ({ symbol: item.symbol, overview: item.overview, basicFinancials: item.basicFinancials }))
            );
            const raw = await options.llmFill(moatPrompt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object') {
              for (const sym of Object.keys(parsed)) {
                const entry = parseMoatEntry(parsed[sym]);
                if (entry) {
                  const ticker = cleanTicker(sym);
                  const target = items.find((it) => it.symbol === ticker);
                  if (target) target.moatAnalysis = entry;
                }
              }
            }
          } catch {
            // LLM unavailable or invalid JSON — proceed without moat analysis
          }
        }

        const content = buildDeepSectorReport({
          sectorQuery: sector,
          selectedBy: 'llm',
          generatedAt: new Date().toISOString(),
          range,
          universe,
          items,
          notes,
          sources: sourceMap,
          initialCandidates,
          dependencyAnalysis,
          ecosystemDiagram,
          refinementNotes,
          companySnapshots,
        });
        const safeTitle = sector.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const saved = await saveReport(content, `${safeTitle}-deep-sector-report`);
        return {
          success: true,
          data: { content, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Saved deep sector report for "${sector}" to ${saved.filePath}`,
        };
      }
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
