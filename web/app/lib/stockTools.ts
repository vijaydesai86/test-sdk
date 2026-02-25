import { StockDataService } from './stockDataService';
import { buildSectorReport, buildStockReport, buildPeerReport, saveReport } from './reportGenerator';

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
  phrases.push(...tokens);
  const unique = Array.from(new Set([query, ...phrases].filter(Boolean)));
  return unique.slice(0, 5);
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
        name: 'generate_stock_report',
        description: 'Generate a comprehensive stock research report and save it as a markdown artifact.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
            range: { type: 'string', description: 'Price history range for charts (e.g., "1y", "3y", "5y", "max"). Default is "5y"' },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_sector_report',
        description: 'Generate a comprehensive sector/theme report and save it as a markdown artifact.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Sector or theme query (e.g. "AI data center")' },
            limit: { type: 'number', description: 'Max companies to include (optional, default 12)' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'generate_peer_report',
        description: 'Generate a comprehensive peer comparison report and save it as a markdown artifact.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AMD)' },
            limit: { type: 'number', description: 'Max peers to include (optional, default 8)' },
            range: { type: 'string', description: 'Price history range for charts (e.g., "1y", "3y", "5y", "max"). Default is "5y"' },
          },
          required: ['symbol'],
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
      case 'generate_stock_report': {
        const symbol = args.symbol || '';
        const range = args.range || '5y';
        const notes: string[] = [];
        let rateLimitHit = false;
        const isRateLimit = (message: string) =>
          message.includes('frequency') || message.includes('Thank you for using Alpha Vantage');
        const safeFetch = async <T>(label: string, request: Promise<T>) => {
          if (rateLimitHit) return undefined as T;
          try {
            return await request;
          } catch (error: any) {
            const message = error?.message || 'Unavailable';
            if (isRateLimit(message)) {
              rateLimitHit = true;
              notes.push('Alpha Vantage rate limit reached; remaining sections skipped.');
              return undefined as T;
            }
            if (!message.includes('Alpha-only mode')) {
              notes.push(`${label}: ${message}`);
            }
            return undefined as T;
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

        const price = await safeFetch('Price', stockService.getStockPrice(symbol));
        const companyOverview = await safeFetch('Company overview', stockService.getCompanyOverview(symbol));
        const basicFinancials = companyOverview ? buildBasicFinancialsFallback(companyOverview) : undefined;
        const priceHistory = await safeFetch('Price history', stockService.getPriceHistory(symbol, range));
        const earningsHistory = await safeFetch('Earnings history', stockService.getEarningsHistory(symbol));
        const incomeStatement = undefined;
        const balanceSheet = undefined;
        const cashFlow = undefined;
        const analystRatings = undefined;
        const analystRecommendations = undefined;
        const priceTargets = undefined;
        const peers = undefined;
        const newsSentiment = undefined;
        const companyNews = undefined;

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

        const saved = await saveReport(content, `${symbol}-stock-report`);
        return {
          success: true,
          data: { content, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Saved stock report to ${saved.filePath}`,
        };
      }
      case 'generate_sector_report': {
        const query = args.query || '';
        const defaultLimit = process.env.VERCEL ? 3 : 4;
        const limit = Math.min(Number(args.limit || defaultLimit), defaultLimit);
        const notes: string[] = [];
        notes.push('Universe limited to the top matches to respect Alpha Vantage free-tier rate limits.');

        let universe: string[] = [];
        try {
          const searchResults = await stockService.searchStock(query);
          universe = (searchResults.results || []).map((item: any) => item.symbol).filter(Boolean).slice(0, limit);
          if (universe.length > 0) {
            notes.push(`Universe built from Alpha Vantage symbol search for "${query}".`);
          }
        } catch (error: any) {
          notes.push(`Symbol search unavailable: ${error.message}`);
        }

        if (universe.length === 0) {
          universe = await expandUniverseFromQuery(query, limit, notes, stockService);
        }

        if (universe.length === 0) {
          universe = await expandUniverseFromTopMovers(query, limit, notes, stockService);
        }

        if (universe.length === 0) {
          notes.push('No tickers matched the theme keywords on Alpha Vantage. Try a more specific query.');
        }

        const items = [] as any[];
        for (const symbol of universe) {
          try {
            const overview = await stockService.getCompanyOverview(symbol);
            const price = await stockService.getStockPrice(symbol).catch(() => null);
            const basicFinancials = await stockService.getBasicFinancials(symbol).catch(() => null);
            const analystRatings = overview ? { ...overview } : null;
            const priceTargets = overview?.analystTargetPrice
              ? { targetMean: overview.analystTargetPrice }
              : null;
            items.push({ symbol, price, overview, basicFinancials, analystRatings, priceTargets });
          } catch (error: any) {
            const message = error?.message || 'Unknown error';
            if (message.includes('429')) {
              notes.push('Alpha Vantage rate limit reached; remaining symbols skipped.');
              break;
            }
            items.push({ symbol, price: null, overview: null, basicFinancials: null, analystRatings: null, priceTargets: null });
            notes.push(`${symbol}: ${message}`);
          }
        }

        const content = buildSectorReport({
          query,
          generatedAt: new Date().toISOString(),
          universe,
          items,
          notes,
        });
        const saved = await saveReport(content, `${query}-sector-report`);
        return {
          success: true,
          data: { content, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Saved sector report to ${saved.filePath}`,
        };
      }
      case 'generate_peer_report': {
        const symbol = args.symbol || '';
        const range = args.range || '5y';
        const defaultLimit = process.env.VERCEL ? 4 : 6;
        const limit = Math.min(Number(args.limit || defaultLimit), defaultLimit);
        const notes: string[] = [];

        let peerSymbols: string[] = [];
        try {
          const peers = await stockService.getPeers(symbol);
          peerSymbols = (peers.peers || []).filter((peer: string) => peer && peer !== symbol).slice(0, limit);
        } catch (error: any) {
          notes.push(`Peers unavailable: ${error.message}`);
          try {
            const search = await stockService.searchStock(symbol);
            peerSymbols = (search.results || []).map((item: any) => item.symbol).filter(Boolean).slice(0, limit);
          } catch (searchError: any) {
            notes.push(`Peer fallback unavailable: ${searchError.message}`);
          }
        }

        const universe = [symbol.toUpperCase(), ...peerSymbols].slice(0, limit + 1);
        const items = await Promise.all(
          universe.map(async (ticker) => {
            const [price, overview, basicFinancials, priceTargets, priceHistory] = await Promise.all([
              stockService.getStockPrice(ticker).catch(() => null),
              stockService.getCompanyOverview(ticker).catch(() => null),
              stockService.getBasicFinancials(ticker).catch(() => null),
              stockService.getPriceTargets(ticker).catch(() => null),
              stockService.getPriceHistory(ticker, range).catch(() => null),
            ]);
            return { symbol: ticker, price, overview, basicFinancials, priceTargets, priceHistory };
          })
        );

        const reportBody = buildPeerReport({
          symbol: symbol.toUpperCase(),
          generatedAt: new Date().toISOString(),
          range,
          universe,
          items,
          notes,
        });

        const content = notes.length
          ? reportBody.replace(
              '## 📌 Universe Snapshot',
              `## ⚠️ Data Gaps\n${notes.map((item) => `- ${item}`).join('\n')}\n\n## 📌 Universe Snapshot`
            )
          : reportBody;

        const saved = await saveReport(content, `${symbol}-peer-report`);
        return {
          success: true,
          data: { content, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Saved peer report to ${saved.filePath}`,
        };
      }
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
