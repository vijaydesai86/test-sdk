import { promises as fs } from 'fs';
import path from 'path';
import { StockDataService, normalizeProvider } from './stockDataService';
import { saveReport } from './reportGenerator';

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

const stopwords = new Set([
  'stocks',
  'stock',
  'sector',
  'theme',
  'report',
  'the',
  'and',
  'for',
  'of',
  'in',
]);

const REPORTS_DIR = process.env.REPORTS_DIR || (process.env.VERCEL ? '/tmp/reports' : 'reports');
const CACHE_DIR = path.join(REPORTS_DIR, 'cache');
const CACHE_TTL_MS = Number(process.env.STOCK_CACHE_TTL_MS || 1000 * 60 * 60 * 24 * 7);
const DEFAULT_SOURCE = (() => {
  const p = normalizeProvider();
  if (p === 'finnhub') return 'Finnhub';
  if (p === 'hybrid') return 'Alpha Vantage / Finnhub';
  return 'Alpha Vantage';
})();
const SOURCE_LEGEND = (() => {
  const provider = normalizeProvider();
  if (provider === 'hybrid') return '_Legend: Alpha Vantage is primary; Finnhub fills gaps._';
  if (provider === 'finnhub') return '_Legend: Finnhub provider._';
  return '_Legend: Alpha Vantage provider._';
})();

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

/**
 * Write a single data value to the file-based symbol cache.
 * Called by individual tool handlers so that data pre-fetched by the LLM
 * (e.g. during comparison report setup) is available to report generators
 * without additional API calls, eliminating rate-limit-induced N/As.
 */
const cacheToolResult = async (symbol: string, key: string, data: any) => {
  if (!symbol || data == null) return;
  try {
    const upperSymbol = symbol.toUpperCase();
    const cache = await loadSymbolCache(upperSymbol);
    setCachedValue(cache, key, data);
    await saveSymbolCache(upperSymbol, cache);
  } catch {
    // best-effort; do not fail the tool call on cache write errors
  }
};

const buildSearchQueries = (query: string) => {
  const cleaned = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((token) => token && !stopwords.has(token));
  const phrases: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (i + 2 < tokens.length) {
      phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
    if (i + 1 < tokens.length) {
      phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }
  const condensed = phrases.flatMap((phrase) => [phrase.replace(/\s+/g, ''), phrase.replace(/\s+/g, '-')]);
  phrases.push(...condensed, ...tokens);
  const unique = Array.from(new Set([query, ...phrases].filter(Boolean)));
  return unique.slice(0, 8);
};

const buildThemeTokens = (query: string) => {
  const cleaned = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((token) => token && !stopwords.has(token));
  const phrases: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (i + 1 < tokens.length) {
      phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
    if (i + 2 < tokens.length) {
      phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
  }
  return { tokens, phrases };
};

const scoreThemeMatch = (
  overview: any,
  tokens: string[],
  phrases: string[]
) => {
  const text = [
    overview?.name,
    overview?.sector,
    overview?.industry,
    overview?.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!text) return 0;
  const tokenMatches = tokens.filter((token) => text.includes(token));
  const phraseMatches = phrases.filter((phrase) => text.includes(phrase));
  const tokenScore = tokenMatches.length;
  const phraseScore = phraseMatches.length * 2;
  const meaningfulTokens = tokens.filter((token) => token.length > 2);
  const meaningfulMatches = meaningfulTokens.filter((token) => text.includes(token));
  if (meaningfulTokens.length > 0 && meaningfulMatches.length === 0 && phraseMatches.length === 0) {
    return 0;
  }
  if (meaningfulTokens.length >= 2 && meaningfulMatches.length < 2 && phraseMatches.length === 0) {
    return 0;
  }
  if (tokens.length === 1 && tokenScore === 0 && phraseMatches.length === 0) {
    return 0;
  }
  return tokenScore + phraseScore;
};

const scoreSearchMatch = (query: string, item: any) => {
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
  // When the query string begins with the symbol, the query is likely a longer variant
  // of that ticker (e.g. a user typed the company's informal name that shares its prefix
  // with the symbol). Score proportionally to symbol length / query length so that a
  // longer-matching symbol ranks above a shorter one for the same query.
  if (symbol.length >= 3 && normalized.startsWith(symbol)) {
    score += Math.round(60 * symbol.length / normalized.length);
  }
  if (region.includes('united states')) score += 10;
  if (currency === 'USD') score += 10;
  if (type.includes('equity')) score += 5;
  // When stripping common corporate suffixes from the name produces an exact match with
  // the query, strongly prefer this result over others whose full name only partially
  // overlaps. Works for any company regardless of suffix convention.
  const strippedName = name
    .replace(/[\s,]+(inc\.?|corp\.?|corporation|ltd\.?|limited|llc|plc|co\.?|group|holdings?|enterprises?|international|incorporated|technologies?|tech)\s*$/i, '')
    .trim();
  if (strippedName === normalized) score += 40;
  return score;
};

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
      .map((item) => ({ item, score: scoreSearchMatch(trimmed, item) }))
      .sort((a, b) => b.score - a.score);
    const top = scored[0];
    const second = scored[1];
    const ambiguity = !top || top.score < 60 || (second && top.score - second.score < 10);
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

const expandUniverseFromQuery = async (
  query: string,
  limit: number,
  notes: string[],
  stockService: StockDataService
) => {
  const queries = buildSearchQueries(query);
  if (queries.length === 0) return [] as string[];
  const results = await Promise.all(
    queries.map((term) => stockService.searchStock(term).catch(() => ({ results: [] })))
  );
  const rawItems = results.flatMap((result: any) => (result.results || []) as any[]);
  const uniqueItems = Array.from(
    new Map(rawItems.filter((item) => item?.symbol).map((item) => [item.symbol, item])).values()
  );
  const usItems = uniqueItems.filter((item) => {
    const region = String(item.region || '').toLowerCase();
    const currency = String(item.currency || '').toUpperCase();
    const type = String(item.type || '').toLowerCase();
    return region.includes('united states') || currency === 'USD' || type.includes('equity');
  });
  const candidates = (usItems.length ? usItems : uniqueItems).slice(0, Math.max(limit * 2, 10));
  const terms = buildSearchQueries(query).map((term) => term.toLowerCase());
  const matches = candidates
    .filter((item) => {
      const text = [item.name, item.symbol]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text && terms.some((term) => text.includes(term));
    })
    .map((item) => item.symbol);
  const universe = Array.from(new Set(matches.filter(Boolean))) as string[];
  if (universe.length > 0) {
    notes.push(`Universe built from keyword-filtered search for "${query}".`);
    return universe.slice(0, limit);
  }
  const fallback = candidates.map((item) => item.symbol).filter(Boolean).slice(0, limit);
  if (fallback.length > 0) {
    notes.push(`Universe built from symbol search fallback for "${query}".`);
  }
  return fallback;
};

const expandUniverseFromTopMovers = async (
  query: string,
  limit: number,
  notes: string[],
  stockService: StockDataService
) => {
  try {
    const movers = await stockService.getTopGainersLosers();
    const candidates = Array.from(new Set([
      ...(movers.topGainers || []).map((item: any) => item.ticker),
      ...(movers.topLosers || []).map((item: any) => item.ticker),
      ...(movers.mostActive || []).map((item: any) => item.ticker),
    ].filter(Boolean)));
    const trimmed = candidates.slice(0, limit);
    if (trimmed.length > 0) {
      notes.push(`Universe built from top movers due to limited matches for "${query}".`);
      return trimmed;
    }
    if (candidates.length > 0) {
      notes.push(`Universe built from top movers due to limited matches for "${query}".`);
      return candidates.slice(0, limit);
    }
    return [];
  } catch {
    return [];
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
            query: { type: 'string', description: 'Company name or ticker (e.g. "Apple" or "MSFT" or another valid ticker)' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_sector_performance',
        description: 'Get real-time performance for all 11 GICS market sectors across multiple timeframes (1D, 5D, 1M, 3M, YTD, 1Y).',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_stocks_by_sector',
        description: 'Screen stocks by sector name using real-time data. For themes, use search_companies or search_news to build a list.',
        parameters: {
          type: 'object',
          properties: {
            sector: { type: 'string', description: 'Sector name (e.g. Technology, Healthcare)' },
          },
          required: ['sector'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'screen_stocks',
        description: 'Screen stocks with filters like sector, industry, market cap thresholds, and limit.',
        parameters: {
          type: 'object',
          properties: {
            sector: { type: 'string', description: 'Sector name filter (optional)' },
            industry: { type: 'string', description: 'Industry name filter (optional)' },
            marketCapMoreThan: { type: 'number', description: 'Minimum market cap (optional)' },
            marketCapLowerThan: { type: 'number', description: 'Maximum market cap (optional)' },
            limit: { type: 'number', description: 'Max results (optional, default 20)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_top_gainers_losers',
        description: "Get today's top 10 gaining stocks, top 10 losing stocks, and 10 most actively traded US stocks.",
        parameters: {
          type: 'object',
          properties: {},
          required: [],
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
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
            symbol: { type: 'string', description: 'Ticker symbol (e.g. "MSFT")' },
            days: { type: 'number', description: 'Lookback window in days (optional)' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'search_news',
        description: 'Search recent market news by keyword or company name.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Keyword or company name to search' },
            days: { type: 'number', description: 'Lookback window in days (optional)' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'search_companies',
        description: 'Search US-listed companies by keyword across multiple data sources.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Company name or keyword to search for' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'save_report',
        description: 'Save a completed markdown report as a downloadable artifact file. Call this AFTER you have gathered all data with individual tools and composed the full report markdown yourself. This is how every report gets saved — you write it, then save it here.',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Filename-safe title, lowercase with hyphens, e.g. "aapl-stock-report" or "aapl-msft-nvda-comparison".',
            },
            content: {
              type: 'string',
              description: 'The complete markdown report you have written.',
            },
          },
          required: ['title', 'content'],
        },
      },
    },
  ];
}

/**
 * Execute a tool by name with the given arguments
 */
export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  stockService: StockDataService
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
        const symbol = args.symbol || '';
        const price = await stockService.getStockPrice(symbol);
        await cacheToolResult(symbol, 'price', price);
        return {
          success: true,
          data: price,
          message: `Current price for ${symbol}: $${price.price} (${price.changePercent})`,
        };
      }
      case 'get_price_history': {
        const symbol = args.symbol || '';
        const range = args.range || 'daily';
        const history = await stockService.getPriceHistory(symbol, range);
        await cacheToolResult(symbol, `priceHistory:${range}`, history);
        return {
          success: true,
          data: history,
          message: `Retrieved ${history.prices?.length || 0} ${range} price points for ${symbol}`,
        };
      }
      case 'get_company_overview': {
        const symbol = args.symbol || '';
        const overview = await stockService.getCompanyOverview(symbol);
        await cacheToolResult(symbol, 'overview', overview);
        return {
          success: true,
          data: overview,
          message: `Retrieved company overview for ${overview.name} (${symbol})`,
        };
      }
      case 'get_basic_financials': {
        const symbol = args.symbol || '';
        const metrics = await stockService.getBasicFinancials(symbol);
        await cacheToolResult(symbol, 'basicFinancials', metrics);
        return {
          success: true,
          data: metrics,
          message: `Retrieved basic financials for ${symbol}`,
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
        const symbol = args.symbol || '';
        const ratings = await stockService.getAnalystRatings(symbol);
        await cacheToolResult(symbol, 'analystRatings', ratings);
        return {
          success: true,
          data: ratings,
          message: `Retrieved analyst ratings for ${symbol}`,
        };
      }
      case 'get_analyst_recommendations': {
        const symbol = args.symbol || '';
        const recs = await stockService.getAnalystRecommendations(symbol);
        await cacheToolResult(symbol, 'analystRecommendations', recs);
        return {
          success: true,
          data: recs,
          message: `Retrieved analyst recommendations for ${symbol}`,
        };
      }
      case 'get_price_targets': {
        const symbol = args.symbol || '';
        const targets = await stockService.getPriceTargets(symbol);
        await cacheToolResult(symbol, 'priceTargets', targets);
        return {
          success: true,
          data: targets,
          message: `Retrieved price targets for ${symbol}`,
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
        const symbol = args.symbol || '';
        const earnings = await stockService.getEarningsHistory(symbol);
        await cacheToolResult(symbol, 'earningsHistory', earnings);
        return {
          success: true,
          data: earnings,
          message: `Retrieved earnings history for ${symbol}`,
        };
      }
      case 'get_income_statement': {
        const symbol = args.symbol || '';
        const income = await stockService.getIncomeStatement(symbol);
        await cacheToolResult(symbol, 'incomeStatement', income);
        return {
          success: true,
          data: income,
          message: `Retrieved income statement for ${symbol}`,
        };
      }
      case 'get_balance_sheet': {
        const symbol = args.symbol || '';
        const balanceSheet = await stockService.getBalanceSheet(symbol);
        await cacheToolResult(symbol, 'balanceSheet', balanceSheet);
        return {
          success: true,
          data: balanceSheet,
          message: `Retrieved balance sheet for ${symbol}`,
        };
      }
      case 'get_cash_flow': {
        const symbol = args.symbol || '';
        const cashFlow = await stockService.getCashFlow(symbol);
        await cacheToolResult(symbol, 'cashFlow', cashFlow);
        return {
          success: true,
          data: cashFlow,
          message: `Retrieved cash flow data for ${symbol}`,
        };
      }
      case 'get_sector_performance': {
        const sectorPerf = await stockService.getSectorPerformance();
        return {
          success: true,
          data: sectorPerf,
          message: 'Retrieved sector performance data',
        };
      }
      case 'get_stocks_by_sector': {
        const sectorStocks = await stockService.getStocksBySector(args.sector || '');
        return {
          success: true,
          data: sectorStocks,
          message: `Retrieved stocks for sector: ${args.sector}`,
        };
      }
      case 'screen_stocks': {
        const results = await stockService.screenStocks(args);
        return {
          success: true,
          data: results,
          message: 'Retrieved stock screener results',
        };
      }
      case 'get_top_gainers_losers': {
        const gainersLosers = await stockService.getTopGainersLosers();
        return {
          success: true,
          data: gainersLosers,
          message: 'Retrieved top gainers, losers, and most active stocks',
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
          message: `Retrieved news for query: ${args.query}`,
        };
      }
      case 'search_companies': {
        const results = await stockService.searchCompanies(args.query || '');
        return {
          success: true,
          data: results,
          message: `Found companies for "${args.query || ''}"`,
        };
      }
      case 'save_report': {
        const rawTitle = String(args.title || 'report')
          .toLowerCase()
          .replace(/[^a-z0-9\-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        const title = rawTitle || 'report';
        const content = String(args.content || '');
        if (!content.trim()) {
          return { success: false, error: 'Report content cannot be empty.' };
        }
        const saved = await saveReport(content, title);
        return {
          success: true,
          data: { content, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Report saved: ${saved.filePath}`,
        };
      }
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
