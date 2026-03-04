/* eslint-disable @typescript-eslint/no-explicit-any */
import { promises as fs } from 'fs';
import path from 'path';
import { StockDataService } from './stockDataService';
import { buildStockReport, buildComparisonReport, saveReport } from './reportGenerator';

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
const DEFAULT_SOURCE = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase() === 'yfinance'
  ? 'Yahoo Finance'
  : 'Alpha Vantage';
const SOURCE_LEGEND = (() => {
  const provider = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase();
  if (provider === 'hybrid') return '_Legend: Alpha Vantage is primary; Yahoo Finance fills gaps._';
  if (provider === 'yfinance') return '_Legend: Yahoo Finance provider._';
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
  if (region.includes('united states')) score += 10;
  if (currency === 'USD') score += 10;
  if (type.includes('equity')) score += 5;
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
      case 'generate_stock_report': {
        const symbolQuery = args.symbol || '';
        const resolved = await resolveSymbolFromQuery(stockService, symbolQuery);
        if (!resolved.ok || !resolved.symbol) {
          const candidates = (resolved.candidates || [])
            .map((item: any) => `${item.name || item.symbol} (${item.symbol})`)
            .join(', ');
          return {
            success: false,
            error: `Ambiguous company name "${symbolQuery}". Candidates: ${candidates || 'Unavailable'}`,
            data: { candidates: resolved.candidates || [] },
          };
        }
        const symbol = resolved.symbol;
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
                /yahoo finance|rate limit reached/i.test(message)
                  ? 'Yahoo Finance rate limit reached; remaining sections skipped.'
                  : 'Alpha Vantage rate limit reached; remaining sections skipped.'
              );
              return cachedValue !== null ? (cachedValue as T) : (undefined as T);
            }
            if (!message.includes('Alpha-only mode')) {
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
        const basicFinancials = companyOverview ? buildBasicFinancialsFallback(companyOverview) : undefined;
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

        const reportBody = buildStockReport({
          symbol: symbol.toUpperCase(),
          generatedAt: new Date().toISOString(),
          price,
          priceHistory,
          companyOverview,
          basicFinancials,
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

        const resolved: { query: string; symbol?: string; candidates?: any[]; reason?: string }[] = [];
        for (const query of companies) {
          const result = await resolveSymbolFromQuery(stockService, query);
          if (!result.ok || !result.symbol) {
            resolved.push({ query, candidates: result.candidates, reason: result.reason });
          } else {
            resolved.push({ query, symbol: result.symbol, candidates: result.candidates });
          }
        }

        const ambiguous = resolved.filter((row) => !row.symbol);
        if (ambiguous.length) {
          const details = ambiguous
            .map((row) => {
              const candidates = (row.candidates || [])
                .map((item: any) => `${item.name || item.symbol} (${item.symbol})`)
                .join(', ');
              return `${row.query}: ${candidates || 'Unavailable'}`;
            })
            .join(' | ');
          return {
            success: false,
            error: `Ambiguous company name(s). Candidates: ${details}`,
            data: { unresolved: ambiguous },
          };
        }

        const universe = resolved.map((row) => row.symbol as string);
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
                /yahoo finance|rate limit reached/i.test(message)
                  ? 'Yahoo Finance rate limit reached; remaining sections skipped.'
                  : 'Alpha Vantage rate limit reached; remaining sections skipped.'
              );
              return cachedValue !== null ? (cachedValue as T) : (undefined as T);
            }
            if (!message.includes('Alpha-only mode')) {
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

        const items: any[] = [];
        for (const symbol of universe) {
          const cache = await loadSymbolCache(symbol);
          const price = await safeFetch(symbol, cache, 'Price', 'price', stockService.getStockPrice(symbol));
          const overview = await safeFetch(symbol, cache, 'Company overview', 'overview', stockService.getCompanyOverview(symbol));
          const basicFinancials = overview ? buildBasicFinancialsFallback(overview) : undefined;
          const priceHistory = await safeFetch(symbol, cache, 'Price history', `priceHistory:${range}`, stockService.getPriceHistory(symbol, range));
          const incomeStatement = await safeFetch(symbol, cache, 'Income statement', 'incomeStatement', stockService.getIncomeStatement(symbol));
          const balanceSheet = await safeFetch(symbol, cache, 'Balance sheet', 'balanceSheet', stockService.getBalanceSheet(symbol));
          const cashFlow = await safeFetch(symbol, cache, 'Cash flow', 'cashFlow', stockService.getCashFlow(symbol));
          const analystRatings = await safeFetch(symbol, cache, 'Analyst ratings', 'analystRatings', stockService.getAnalystRatings(symbol));
          const priceTargets = await safeFetch(symbol, cache, 'Price targets', 'priceTargets', stockService.getPriceTargets(symbol));
          items.push({
            symbol,
            price,
            overview,
            basicFinancials,
            priceHistory,
            incomeStatement,
            balanceSheet,
            cashFlow,
            analystRatings,
            priceTargets,
          });
          await saveSymbolCache(symbol, cache);
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
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
