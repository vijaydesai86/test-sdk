import { StockDataService } from './stockDataService';
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
        return {
          success: true,
          data: history,
          message: `Retrieved ${history.prices?.length || 0} ${range} price points for ${symbol}`,
        };
      }
      case 'get_company_overview': {
        const symbol = args.symbol || '';
        const overview = await stockService.getCompanyOverview(symbol);
        return {
          success: true,
          data: overview,
          message: `Retrieved company overview for ${overview.name} (${symbol})`,
        };
      }
      case 'get_basic_financials': {
        const symbol = args.symbol || '';
        const metrics = await stockService.getBasicFinancials(symbol);
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
        return {
          success: true,
          data: ratings,
          message: `Retrieved analyst ratings for ${symbol}`,
        };
      }
      case 'get_analyst_recommendations': {
        const symbol = args.symbol || '';
        const recs = await stockService.getAnalystRecommendations(symbol);
        return {
          success: true,
          data: recs,
          message: `Retrieved analyst recommendations for ${symbol}`,
        };
      }
      case 'get_price_targets': {
        const symbol = args.symbol || '';
        const targets = await stockService.getPriceTargets(symbol);
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
        return {
          success: true,
          data: earnings,
          message: `Retrieved earnings history for ${symbol}`,
        };
      }
      case 'get_income_statement': {
        const symbol = args.symbol || '';
        const income = await stockService.getIncomeStatement(symbol);
        return {
          success: true,
          data: income,
          message: `Retrieved income statement for ${symbol}`,
        };
      }
      case 'get_balance_sheet': {
        const symbol = args.symbol || '';
        const balanceSheet = await stockService.getBalanceSheet(symbol);
        return {
          success: true,
          data: balanceSheet,
          message: `Retrieved balance sheet for ${symbol}`,
        };
      }
      case 'get_cash_flow': {
        const symbol = args.symbol || '';
        const cashFlow = await stockService.getCashFlow(symbol);
        return {
          success: true,
          data: cashFlow,
          message: `Retrieved cash flow data for ${symbol}`,
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
