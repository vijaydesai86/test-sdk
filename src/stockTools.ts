import { defineTool } from '@github/copilot-sdk';
import { StockDataService } from './stockDataService';

/**
 * Create stock information tools for GitHub Copilot SDK
 */
export function createStockTools(stockService: StockDataService) {
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
    description: 'Get historical price data for a US stock. Returns up to 30 data points of open, high, low, close, and volume.',
    parameters: {
      symbol: { type: 'string', description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")' },
      range: { type: 'string', description: 'Time range: "daily", "weekly", or "monthly". Default is "daily"' },
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
    description: 'Get a curated list of top stocks in a specific sector or theme. Available: ai, semiconductor, data center, ai data center, pharma, cybersecurity, cloud, ev, fintech, renewable.',
    parameters: {
      sector: { type: 'string', description: 'Sector or theme name (e.g., "ai", "semiconductor", "pharma", "cybersecurity")' },
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

  return [
    searchStockTool,
    getCurrentPriceTool,
    getPriceHistoryTool,
    getCompanyOverviewTool,
    getInsiderTradingTool,
    getAnalystRatingsTool,
    getEarningsHistoryTool,
    getIncomeStatementTool,
    getBalanceSheetTool,
    getCashFlowTool,
    getSectorPerformanceTool,
    getStocksBySectorTool,
    getTopGainersLosersTool,
    getNewsSentimentTool,
  ];
}
