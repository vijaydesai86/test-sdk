import { defineTool } from '@github/copilot-sdk';
import { StockDataService } from './stockDataService';
import { buildSectorReport, buildStockReport, buildPeerReport, saveReport } from './reportGenerator';

/**
 * Create stock information tools for GitHub Copilot SDK
 */
export function createStockTools(stockService: StockDataService) {
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

  const expandUniverseFromQuery = async (query: string, limit: number, notes: string[]) => {
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

  const expandUniverseFromTopMovers = async (query: string, limit: number, notes: string[]) => {
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

  const searchStockTool = defineTool('search_stock', {
    description: 'Search for US stock symbols by company name or ticker.',
    parameters: {
      query: {
        type: 'string',
        description: 'Company name or stock ticker to search for (e.g., "Apple", "AAPL", "Microsoft")',
      },
    },
    handler: async (args: any) => {
      const { query } = args;
      try {
        const results = await stockService.searchStock(query);
        return { success: true, data: results, message: `Found ${results.results?.length || 0} matching stocks for "${query}"` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getCurrentPriceTool = defineTool('get_stock_price', {
    description: 'Get the current stock price and basic quote information for a US stock.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT", "GOOGL")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const price = await stockService.getStockPrice(symbol);
        return { success: true, data: price, message: `Current price for ${symbol}: $${price.price} (${price.changePercent})` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getPriceHistoryTool = defineTool('get_price_history', {
    description: 'Get historical price data for a US stock. Range supports daily/weekly/monthly or 1w, 1m, 3m, 6m, 1y, 3y, 5y, max.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
      range: { type: 'string', description: 'Time range: "daily", "weekly", "monthly", "1w", "1m", "3m", "6m", "1y", "3y", "5y", "max". Default is "daily"' },
    },
    handler: async (args: any) => {
      const { symbol, range } = args;
      try {
        const history = await stockService.getPriceHistory(symbol, range || 'daily');
        return { success: true, data: history, message: `Retrieved ${history.prices?.length || 0} ${range || 'daily'} price points for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getCompanyOverviewTool = defineTool('get_company_overview', {
    description: 'Get comprehensive company information including fundamentals like EPS, PE ratio, PEG ratio, profit margins, market cap, dividend yield, 52-week high/low, and analyst target price.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const overview = await stockService.getCompanyOverview(symbol);
        return { success: true, data: overview, message: `Retrieved company overview for ${overview.name} (${symbol})` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getBasicFinancialsTool = defineTool('get_basic_financials', {
    description: 'Get detailed financial ratios, metrics, and historical series (including PE history) for a US stock.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const metrics = await stockService.getBasicFinancials(symbol);
        return { success: true, data: metrics, message: `Retrieved basic financials for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getInsiderTradingTool = defineTool('get_insider_trading', {
    description: 'Get insider ownership data for a US stock. Returns insider %, institutional %, short interest, and recent insider transactions.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const insiderData = await stockService.getInsiderTrading(symbol);
        return { success: true, data: insiderData, message: `Retrieved insider trading data for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getAnalystRatingsTool = defineTool('get_analyst_ratings', {
    description: 'Get full analyst ratings breakdown (Strong Buy/Buy/Hold/Sell/Strong Sell) and consensus target price with upside.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const ratings = await stockService.getAnalystRatings(symbol);
        return { success: true, data: ratings, message: `Retrieved analyst ratings for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getAnalystRecommendationsTool = defineTool('get_analyst_recommendations', {
    description: 'Get analyst recommendation trends over time (strong buy/buy/hold/sell/strong sell counts).',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const recs = await stockService.getAnalystRecommendations(symbol);
        return { success: true, data: recs, message: `Retrieved analyst recommendations for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getPriceTargetsTool = defineTool('get_price_targets', {
    description: 'Get analyst price target summary (high/low/mean/median) for a US stock.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const targets = await stockService.getPriceTargets(symbol);
        return { success: true, data: targets, message: `Retrieved price targets for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getPeersTool = defineTool('get_peers', {
    description: 'Get a list of peer tickers for a US stock.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const peers = await stockService.getPeers(symbol);
        return { success: true, data: peers, message: `Retrieved peers for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getEarningsHistoryTool = defineTool('get_earnings_history', {
    description: 'Get historical earnings per share (EPS) data including quarterly and annual EPS, estimates, and earnings surprises.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const earnings = await stockService.getEarningsHistory(symbol);
        return { success: true, data: earnings, message: `Retrieved earnings history for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getIncomeStatementTool = defineTool('get_income_statement', {
    description: 'Get quarterly and annual income statement data. Returns revenue, gross profit, operating income, net income, and EBITDA.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const income = await stockService.getIncomeStatement(symbol);
        return { success: true, data: income, message: `Retrieved income statement for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getBalanceSheetTool = defineTool('get_balance_sheet', {
    description: 'Get balance sheet data. Returns total assets, liabilities, shareholder equity, cash, and debt levels.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const balanceSheet = await stockService.getBalanceSheet(symbol);
        return { success: true, data: balanceSheet, message: `Retrieved balance sheet for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getCashFlowTool = defineTool('get_cash_flow', {
    description: 'Get cash flow statement data. Returns operating cash flow, capital expenditures, free cash flow, and dividends.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const cashFlow = await stockService.getCashFlow(symbol);
        return { success: true, data: cashFlow, message: `Retrieved cash flow data for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getSectorPerformanceTool = defineTool('get_sector_performance', {
    description: 'Get real-time sector performance data showing how different market sectors are performing across various timeframes.',
    parameters: {},
    handler: async () => {
      try {
        const sectorPerf = await stockService.getSectorPerformance();
        return { success: true, data: sectorPerf, message: 'Retrieved sector performance data' };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getStocksBySectorTool = defineTool('get_stocks_by_sector', {
    description: 'Screen stocks by sector name using real-time data. For themes, use `search_companies` or `search_news` to build a list.',
    parameters: {
      sector: { type: 'string', description: 'Sector name (e.g., "Technology", "Healthcare", "Financial Services")' },
    },
    handler: async (args: any) => {
      const { sector } = args;
      try {
        const sectorStocks = await stockService.getStocksBySector(sector);
        return { success: true, data: sectorStocks, message: `Retrieved stocks for sector: ${sector}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const screenStocksTool = defineTool('screen_stocks', {
    description: 'Screen stocks with filters like sector, industry, market cap thresholds, and limit.',
    parameters: {
      sector: { type: 'string', description: 'Sector name filter (optional)' },
      industry: { type: 'string', description: 'Industry name filter (optional)' },
      marketCapMoreThan: { type: 'number', description: 'Minimum market cap (optional)' },
      marketCapLowerThan: { type: 'number', description: 'Maximum market cap (optional)' },
      limit: { type: 'number', description: 'Max results (optional, default 20)' },
    },
    handler: async (args: any) => {
      try {
        const results = await stockService.screenStocks(args);
        return { success: true, data: results, message: 'Retrieved stock screener results' };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getTopGainersLosersTool = defineTool('get_top_gainers_losers', {
    description: 'Get today\'s top gaining stocks, top losing stocks, and most actively traded stocks in the US market.',
    parameters: {},
    handler: async () => {
      try {
        const gainersLosers = await stockService.getTopGainersLosers();
        return { success: true, data: gainersLosers, message: 'Retrieved top gainers, losers, and most active stocks' };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getNewsSentimentTool = defineTool('get_news_sentiment', {
    description: 'Get the latest news articles and AI-powered sentiment analysis for a US stock. Returns headlines, summaries, and sentiment scores.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT", "TSLA")' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const news = await stockService.getNewsSentiment(symbol);
        return { success: true, data: news, message: `Retrieved news and sentiment for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const getCompanyNewsTool = defineTool('get_company_news', {
    description: 'Get recent company news articles for a US stock (typically last 30 days).',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
      days: { type: 'number', description: 'Lookback window in days (optional)' },
    },
    handler: async (args: any) => {
      const { symbol, days } = args;
      try {
        const news = await stockService.getCompanyNews(symbol, days);
        return { success: true, data: news, message: `Retrieved company news for ${symbol}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const searchNewsTool = defineTool('search_news', {
    description: 'Search recent market news by keyword or company name.',
    parameters: {
      query: { type: 'string', description: 'Keyword or company name to search' },
      days: { type: 'number', description: 'Lookback window in days (optional)' },
    },
    handler: async (args: any) => {
      const { query, days } = args;
      try {
        const news = await stockService.searchNews(query, days);
        return { success: true, data: news, message: `Retrieved news for query: ${query}` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const searchCompaniesTool = defineTool('search_companies', {
    description: 'Search US-listed companies by keyword across multiple data sources.',
    parameters: {
      query: { type: 'string', description: 'Company name or keyword to search for' },
    },
    handler: async (args: any) => {
      const { query } = args;
      try {
        const results = await stockService.searchCompanies(query);
        return { success: true, data: results, message: `Found companies for "${query}"` };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const generateStockReportTool = defineTool('generate_stock_report', {
    description: 'Generate a comprehensive stock research report and save it as a markdown artifact.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL")' },
      range: { type: 'string', description: 'Price history range for charts (e.g., "1y", "3y", "5y", "max"). Default is "5y"' },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      const range = args.range || '5y';
      try {
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
            notes.push(`${label}: ${message}`);
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
          data: { content, ...saved },
          message: `Saved stock report to ${saved.filePath}`,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  const generatePeerReportTool = defineTool('generate_peer_report', {
    description: 'Generate a comprehensive peer comparison report and save it as a markdown artifact.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AMD")' },
      limit: { type: 'number', description: 'Max peers to include (optional, default 8)' },
      range: { type: 'string', description: 'Price history range for charts (e.g., "1y", "3y", "5y", "max"). Default is "5y"' },
    },
    handler: async (args: any) => {
      const symbol = args.symbol as string;
      const range = args.range || '5y';
      const limit = Math.min(Number(args.limit || 6), 6);
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
          const [price, overview, basicFinancials, priceTargets, companyNews] = await Promise.all([
            stockService.getStockPrice(ticker).catch(() => null),
            stockService.getCompanyOverview(ticker).catch(() => null),
            stockService.getBasicFinancials(ticker).catch(() => null),
            stockService.getPriceTargets(ticker).catch(() => null),
            stockService.getCompanyNews(ticker, 14).catch(() => null),
          ]);
          return { symbol: ticker, price, overview, basicFinancials, priceTargets, companyNews };
        })
      );

      const content = buildPeerReport({
        symbol: symbol.toUpperCase(),
        generatedAt: new Date().toISOString(),
        range,
        universe,
        items,
        notes,
      });

      const saved = await saveReport(content, `${symbol}-peer-report`);
      return {
        success: true,
        data: { content, ...saved },
        message: `Saved peer report to ${saved.filePath}`,
      };
    },
  });

  const generateSectorReportTool = defineTool('generate_sector_report', {
    description: 'Generate a comprehensive sector/theme report and save it as a markdown artifact.',
    parameters: {
      query: { type: 'string', description: 'Sector or theme query (e.g., "AI data center", "Semiconductors")' },
      limit: { type: 'number', description: 'Max companies to include (optional, default 4)' },
    },
    handler: async (args: any) => {
      const query = args.query as string;
      const limit = Math.min(Number(args.limit || 4), 4);

      try {
        let universe: string[] = [];
        const notes: string[] = [];
        notes.push('Universe limited to the top matches to respect Alpha Vantage free-tier rate limits.');

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
          universe = await expandUniverseFromQuery(query, limit, notes);
        }

        if (universe.length === 0) {
          universe = await expandUniverseFromTopMovers(query, limit, notes);
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
          data: { content, ...saved },
          message: `Saved sector report to ${saved.filePath}`,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  return [
    searchStockTool,
    getCurrentPriceTool,
    getPriceHistoryTool,
    getCompanyOverviewTool,
    getBasicFinancialsTool,
    getInsiderTradingTool,
    getAnalystRatingsTool,
    getAnalystRecommendationsTool,
    getPriceTargetsTool,
    getPeersTool,
    getEarningsHistoryTool,
    getIncomeStatementTool,
    getBalanceSheetTool,
    getCashFlowTool,
    getSectorPerformanceTool,
    getStocksBySectorTool,
    screenStocksTool,
    getTopGainersLosersTool,
    getNewsSentimentTool,
    getCompanyNewsTool,
    searchNewsTool,
    searchCompaniesTool,
    generateStockReportTool,
    generatePeerReportTool,
    generateSectorReportTool,
  ];
}
