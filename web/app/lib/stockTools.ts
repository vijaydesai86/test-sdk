import { StockDataService } from './stockDataService';

/**
 * OpenAI-compatible tool definitions for stock information
 */
export function getToolDefinitions() {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'search_stock',
        description: 'Search for US stock symbols by company name or ticker. Use this when the user wants to find a stock symbol or company.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Company name or stock ticker to search for (e.g., "Apple", "AAPL", "Microsoft")',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_stock_price',
        description: 'Get the current stock price and basic quote information for a US stock. Returns current price, change, volume, and latest trading day.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Stock ticker symbol (e.g., "AAPL", "MSFT", "GOOGL")',
            },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_price_history',
        description: 'Get historical price data for a US stock. Returns up to 30 data points of open, high, low, close, and volume. Use this when the user wants price charts, graphs, or historical trends.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
            },
            range: {
              type: 'string',
              description: 'Time range: "daily", "weekly", or "monthly". Default is "daily"',
            },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_company_overview',
        description: 'Get comprehensive company information including fundamentals like EPS, PE ratio, PEG ratio, profit margins, market cap, dividend yield, 52-week high/low, analyst target price, sector, industry, and business description. Use this for fundamental analysis, moat assessment, and understanding the company business model.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
            },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_insider_trading',
        description: 'Get insider ownership data for a US stock. Returns percentage of shares held by insiders and institutions, shares outstanding, float, short interest data, and recent insider buy/sell transactions when available.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
            },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_analyst_ratings',
        description: 'Get analyst ratings breakdown and consensus target price for a US stock. Returns the number of Strong Buy, Buy, Hold, Sell, and Strong Sell ratings plus the consensus price target and implied upside.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
            },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_earnings_history',
        description: 'Get historical earnings per share (EPS) data including quarterly and annual EPS, EPS estimates, and earnings surprises. Use this for EPS history, earnings trends, and beat/miss analysis.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
            },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_income_statement',
        description: 'Get quarterly and annual income statement data for a US stock. Returns revenue, gross profit, operating income, net income, and EBITDA. Use this for quarterly results documents and revenue analysis.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
            },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_balance_sheet',
        description: 'Get balance sheet data for a US stock. Returns total assets, liabilities, shareholder equity, cash, and debt levels.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
            },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_cash_flow',
        description: 'Get cash flow statement data for a US stock. Returns operating cash flow, capital expenditures, free cash flow, and dividends.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
            },
          },
          required: ['symbol'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_sector_performance',
        description: 'Get real-time sector performance data showing how different market sectors (Technology, Healthcare, Financials, Energy, etc.) are performing across various timeframes.',
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
        description: 'Get a curated list of top stocks in a specific sector or investment theme. Available sectors: ai, semiconductor, data center, ai data center, pharma, cybersecurity, cloud, ev (electric vehicles), fintech, renewable (energy). Returns key companies with descriptions.',
        parameters: {
          type: 'object',
          properties: {
            sector: {
              type: 'string',
              description: 'Sector or theme name (e.g., "ai", "semiconductor", "data center", "pharma", "cybersecurity", "cloud", "ev", "fintech", "renewable")',
            },
          },
          required: ['sector'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_top_gainers_losers',
        description: 'Get today\'s top gaining stocks, top losing stocks, and most actively traded stocks in the US market.',
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
        description: 'Get the latest news articles and AI-powered sentiment analysis for a US stock. Returns recent headlines, summaries, sentiment scores (bullish/bearish), and source URLs. Use this for market sentiment, recent developments, and news-driven analysis.',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Stock ticker symbol (e.g., "AAPL", "MSFT", "TSLA")',
            },
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
  args: Record<string, string | undefined>,
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
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
