import { defineTool } from '@github/copilot-sdk';
import { StockDataService } from './stockDataService';

/**
 * Create stock information tools for GitHub Copilot SDK
 */
export function createStockTools(stockService: StockDataService) {
  // Tool to search for stock symbols
  const searchStockTool = defineTool('search_stock', {
    description: 'Search for US stock symbols by company name or ticker. Use this when the user wants to find a stock symbol or company.',
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
        return {
          success: true,
          data: results,
          message: `Found ${results.results?.length || 0} matching stocks for "${query}"`,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  });

  // Tool to get current stock price
  const getCurrentPriceTool = defineTool('get_stock_price', {
    description: 'Get the current stock price and basic quote information for a US stock. Returns current price, change, volume, and latest trading day.',
    parameters: {
      symbol: {
        type: 'string',
        description: 'Stock ticker symbol (e.g., "AAPL", "MSFT", "GOOGL")',
      },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const price = await stockService.getStockPrice(symbol);
        return {
          success: true,
          data: price,
          message: `Current price for ${symbol}: $${price.price} (${price.changePercent})`,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  });

  // Tool to get price history
  const getPriceHistoryTool = defineTool('get_price_history', {
    description: 'Get historical price data for a US stock. Returns up to 30 data points of open, high, low, close, and volume.',
    parameters: {
      symbol: {
        type: 'string',
        description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
      },
      range: {
        type: 'string',
        description: 'Time range: "daily", "weekly", or "monthly". Default is "daily"',
      },
    },
    handler: async (args: any) => {
      const { symbol, range } = args;
      try {
        const history = await stockService.getPriceHistory(symbol, range || 'daily');
        return {
          success: true,
          data: history,
          message: `Retrieved ${history.prices?.length || 0} ${range || 'daily'} price points for ${symbol}`,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  });

  // Tool to get company fundamentals (EPS, PE ratio, etc.)
  const getCompanyOverviewTool = defineTool('get_company_overview', {
    description: 'Get comprehensive company information including fundamentals like EPS, PE ratio, PEG ratio, profit margins, market cap, dividend yield, 52-week high/low, and analyst target price. Use this for fundamental analysis.',
    parameters: {
      symbol: {
        type: 'string',
        description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
      },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const overview = await stockService.getCompanyOverview(symbol);
        return {
          success: true,
          data: overview,
          message: `Retrieved company overview for ${overview.name} (${symbol})`,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  });

  // Tool to get insider trading information
  const getInsiderTradingTool = defineTool('get_insider_trading', {
    description: 'Get insider trading information for a US stock. Shows transactions by company insiders (executives, directors).',
    parameters: {
      symbol: {
        type: 'string',
        description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
      },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const insiderData = await stockService.getInsiderTrading(symbol);
        return {
          success: true,
          data: insiderData,
          message: `Retrieved insider trading data for ${symbol}`,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  });

  // Tool to get analyst ratings
  const getAnalystRatingsTool = defineTool('get_analyst_ratings', {
    description: 'Get analyst ratings and target price for a US stock. Shows consensus rating and price target.',
    parameters: {
      symbol: {
        type: 'string',
        description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
      },
    },
    handler: async (args: any) => {
      const { symbol } = args;
      try {
        const ratings = await stockService.getAnalystRatings(symbol);
        return {
          success: true,
          data: ratings,
          message: `Retrieved analyst ratings for ${symbol}`,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    },
  });

  return [
    searchStockTool,
    getCurrentPriceTool,
    getPriceHistoryTool,
    getCompanyOverviewTool,
    getInsiderTradingTool,
    getAnalystRatingsTool,
  ];
}
