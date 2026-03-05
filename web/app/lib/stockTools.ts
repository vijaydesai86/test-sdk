/* eslint-disable @typescript-eslint/no-explicit-any */
import { promises as fs } from 'fs';
import path from 'path';
import { StockDataService } from './stockDataService';
import { buildStockReport, buildComparisonReport, buildSectorReport, buildDeepSectorReport, saveReport } from './reportGenerator';

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

/**
 * Builds a prompt that asks the LLM to:
 *   1. Analyse sector ecosystem dependencies (supply chain, customers, market, news)
 *   2. Produce a Mermaid diagram of the sector ecosystem
 *   3. Refine the candidate list to the best `finalCount` companies
 *   4. Explain the selection rationale
 *
 * The prompt feeds real company overview and news-sentiment data gathered in Phase 2
 * so that the LLM can ground its analysis in actual data rather than training memory.
 */
function buildDeepSectorDependencyPrompt(
  sector: string,
  finalCount: number,
  candidates: Array<{ symbol: string; overview: any; news: any; peers: any }>
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

  return (
    `You are a senior equity research analyst. Your task is to perform a deep sector ecosystem analysis for the "${sector}" sector.\n\n` +
    `CANDIDATE COMPANIES: ${symbolList}\n\n` +
    `COMPANY DATA:\n${summaries}\n\n` +
    `TASKS:\n` +
    `1. ECOSYSTEM ANALYSIS: Write a 2-3 paragraph narrative covering:\n` +
    `   - Supply chain relationships (who supplies inputs to whom, key upstream/downstream dependencies)\n` +
    `   - Customer / revenue dependencies (major end-markets, B2B vs consumer exposure)\n` +
    `   - Key market / macro factors affecting the whole sector (regulation, commodities, rates, geopolitics)\n` +
    `   - Competitive dynamics and news sentiment themes across the candidates\n\n` +
    `2. ECOSYSTEM DIAGRAM: Create a concise Mermaid diagram (graph LR direction) showing the most important\n` +
    `   supplier-company-customer relationships or competitive positioning. Keep it to at most 15 nodes.\n` +
    `   Use plain node names without special characters.\n\n` +
    `3. REFINEMENT: Select the best ${finalCount} companies from the candidates for deep financial analysis.\n` +
    `   Criteria: sector relevance, financial strength, market leadership, and portfolio diversification.\n\n` +
    `4. RATIONALE: Briefly explain why each company was kept or excluded.\n\n` +
    `Respond ONLY with valid JSON (no markdown fences, no explanation outside the JSON):\n` +
    `{"refinedList":["TICK1","TICK2"],"dependencyAnalysis":"narrative...","ecosystemDiagram":"graph LR\\n  NodeA-->NodeB","refinementNotes":"rationale..."}`
  );
}


type CacheEntry = { updatedAt: string; data: any };
type SymbolCache = Record<string, CacheEntry>;

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
            companies: { type: 'array', items: { type: 'string' }, description: 'Company names or tickers (2-6 items)' },
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
              description: 'Number of top companies to include (default: 5, min: 2, max: 6)',
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
          'Phase 3: AI maps supply-chain, customer, market and news dependencies, draws a sector dependency diagram, and refines the company list. ' +
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
              description: 'Number of companies in the refined final list (default: 5, min: 3, max: 8)',
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
      case 'search_news': {
        const news = await stockService.searchNews(args.query || '', args.days ? Number(args.days) : undefined);
        return {
          success: true,
          data: news,
          message: `Retrieved news for query: ${args.query || ''}`,
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
        });

        const content = notes.length
          ? reportBody.replace(
              '## 📊 Snapshot',
              `## ⚠️ Data Gaps\n${notes.map((item) => `- ${item}`).join('\n')}\n\n## 📊 Snapshot`
            )
          : reportBody;

        const sourceSection = sources.size
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
        if (companies.length < 2 || companies.length > 6) {
          return { success: false, error: 'Provide between 2 and 6 company names or tickers.' };
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
        const count = Math.min(6, Math.max(2, Number(args.count) || 5));
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
        const finalCount = Math.min(8, Math.max(3, Number(args.count) || 5));
        // Fetch roughly 2x candidates for screening; cap at 12 to avoid rate limits.
        const initialCount = Math.min(12, finalCount * 2);
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
        let universe: string[] = [];
        let dependencyAnalysis: string | undefined;
        let ecosystemDiagram: string | undefined;
        let refinementNotes: string | undefined;

        {
          const depPrompt = buildDeepSectorDependencyPrompt(sector, finalCount, ecosystemData);
          try {
            const raw = await options.llmFill(depPrompt);
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object') {
              if (Array.isArray(parsed.refinedList)) {
                universe = parsed.refinedList
                  .map((t: any) => String(t || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase())
                  .filter((t: string) => t.length > 0)
                  .slice(0, finalCount);
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
            }
          } catch {
            // Fall through — will use initial candidates below
          }
        }

        // Fall back to the initial list if refinement failed
        if (universe.length < 2) {
          universe = initialCandidates.slice(0, finalCount);
        }

        // ── Phase 4: Fetch full comparison data for the refined universe ──────────
        const notes: string[] = [
          `Universe refined through deep sector analysis for: "${sector}"`,
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
