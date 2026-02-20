import { StockDataService } from './stockDataService';
import { buildSectorReport, buildStockReport, saveReport } from './reportGenerator';

/**
 * OpenAI-compatible tool definitions for stock information
 */
export function getToolDefinitions() {
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
        description: 'Get up to 30 OHLCV data points (daily/weekly/monthly) for trend and technical analysis.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Ticker symbol (e.g. AAPL)' },
            range: { type: 'string', description: '"daily", "weekly", or "monthly". Default: "daily"' },
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
        const [
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
        ] = await Promise.all([
          stockService.getStockPrice(symbol),
          stockService.getPriceHistory(symbol, 'daily'),
          stockService.getCompanyOverview(symbol),
          stockService.getBasicFinancials(symbol),
          stockService.getEarningsHistory(symbol),
          stockService.getIncomeStatement(symbol),
          stockService.getBalanceSheet(symbol),
          stockService.getCashFlow(symbol),
          stockService.getAnalystRatings(symbol),
          stockService.getAnalystRecommendations(symbol),
          stockService.getPriceTargets(symbol),
          stockService.getPeers(symbol),
          stockService.getNewsSentiment(symbol),
          stockService.getCompanyNews(symbol, 30),
        ]);

        const content = buildStockReport({
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
        const saved = await saveReport(content, `${symbol}-stock-report`);
        return {
          success: true,
          data: { content, ...saved, downloadUrl: `/api/reports/${saved.filename}` },
          message: `Saved stock report to ${saved.filePath}`,
        };
      }
      case 'generate_sector_report': {
        const query = args.query || '';
        const limit = Number(args.limit || 12);
        const notes: string[] = [];

        let universe: string[] = [];
        try {
          const sectorResults = await stockService.getStocksBySector(query);
          universe = (sectorResults.results || []).map((item: any) => item.symbol).filter(Boolean).slice(0, limit);
          if (universe.length > 0) {
            notes.push(`Universe built from sector screening for "${query}".`);
          }
        } catch (error: any) {
          notes.push(`Sector screening unavailable: ${error.message}`);
        }

        if (universe.length === 0) {
          const searchResults = await stockService.searchCompanies(query);
          universe = (searchResults.results || []).map((item: any) => item.symbol).filter(Boolean).slice(0, limit);
          if (universe.length > 0) {
            notes.push(`Universe built from multi-source search for "${query}".`);
          }
        }

        if (universe.length === 0) {
          const newsResults = await stockService.searchNews(query, 14);
          const headlines = (newsResults.articles || []).map((a: any) => a.title || '').filter(Boolean).slice(0, 10);
          notes.push(`News scan headlines: ${headlines.join('; ') || 'N/A'}`);
        }

        const items = [] as any[];
        for (const symbol of universe) {
          const [price, overview, basicFinancials, analystRatings, priceTargets, newsSentiment] = await Promise.all([
            stockService.getStockPrice(symbol),
            stockService.getCompanyOverview(symbol),
            stockService.getBasicFinancials(symbol),
            stockService.getAnalystRatings(symbol),
            stockService.getPriceTargets(symbol),
            stockService.getNewsSentiment(symbol),
          ]);
          items.push({ symbol, price, overview, basicFinancials, analystRatings, priceTargets, newsSentiment });
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
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
