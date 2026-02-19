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
        description: 'Get historical price data for a US stock. Returns up to 30 data points of open, high, low, close, and volume.',
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
        description: 'Get comprehensive company information including fundamentals like EPS, PE ratio, PEG ratio, profit margins, market cap, dividend yield, 52-week high/low, and analyst target price. Use this for fundamental analysis.',
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
        description: 'Get insider trading information for a US stock. Shows transactions by company insiders (executives, directors).',
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
        description: 'Get analyst ratings and target price for a US stock. Shows consensus rating and price target.',
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
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
