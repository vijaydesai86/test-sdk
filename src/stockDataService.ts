import axios from 'axios';

export interface StockDataService {
  getStockPrice(symbol: string): Promise<any>;
  getPriceHistory(symbol: string, range?: string): Promise<any>;
  getCompanyOverview(symbol: string): Promise<any>;
  getInsiderTrading(symbol: string): Promise<any>;
  getAnalystRatings(symbol: string): Promise<any>;
  searchStock(query: string): Promise<any>;
}

/**
 * Stock data service using Alpha Vantage API (free tier)
 * Note: Alpha Vantage free tier has a limit of 5 API calls per minute
 */
export class AlphaVantageService implements StockDataService {
  private apiKey: string;
  private baseUrl = 'https://www.alphavantage.co/query';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ALPHA_VANTAGE_API_KEY || 'demo';
  }

  private async makeRequest(params: Record<string, string>): Promise<any> {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          ...params,
          apikey: this.apiKey,
        },
        timeout: 10000,
      });
      return response.data;
    } catch (error: any) {
      console.error('API request failed:', error.message);
      throw new Error(`Failed to fetch data: ${error.message}`);
    }
  }

  async getStockPrice(symbol: string): Promise<any> {
    const data = await this.makeRequest({
      function: 'GLOBAL_QUOTE',
      symbol: symbol.toUpperCase(),
    });

    if (data['Global Quote']) {
      const quote = data['Global Quote'];
      return {
        symbol: quote['01. symbol'],
        price: quote['05. price'],
        change: quote['09. change'],
        changePercent: quote['10. change percent'],
        volume: quote['06. volume'],
        latestTradingDay: quote['07. latest trading day'],
      };
    }
    throw new Error('Unable to fetch stock price');
  }

  async getPriceHistory(symbol: string, range: string = 'daily'): Promise<any> {
    let functionName = 'TIME_SERIES_DAILY';
    if (range === 'weekly') functionName = 'TIME_SERIES_WEEKLY';
    if (range === 'monthly') functionName = 'TIME_SERIES_MONTHLY';

    const data = await this.makeRequest({
      function: functionName,
      symbol: symbol.toUpperCase(),
    });

    // Parse the time series data
    const timeSeriesKey = Object.keys(data).find(key => key.includes('Time Series'));
    if (timeSeriesKey) {
      const timeSeries = data[timeSeriesKey];
      const prices = Object.entries(timeSeries).slice(0, 30).map(([date, values]: [string, any]) => ({
        date,
        open: values['1. open'],
        high: values['2. high'],
        low: values['3. low'],
        close: values['4. close'],
        volume: values['5. volume'],
      }));
      return {
        symbol: symbol.toUpperCase(),
        prices,
      };
    }
    throw new Error('Unable to fetch price history');
  }

  async getCompanyOverview(symbol: string): Promise<any> {
    const data = await this.makeRequest({
      function: 'OVERVIEW',
      symbol: symbol.toUpperCase(),
    });

    if (data.Symbol) {
      return {
        symbol: data.Symbol,
        name: data.Name,
        description: data.Description,
        sector: data.Sector,
        industry: data.Industry,
        marketCapitalization: data.MarketCapitalization,
        eps: data.EPS,
        peRatio: data.PERatio,
        pegRatio: data.PEGRatio,
        dividendYield: data.DividendYield,
        '52WeekHigh': data['52WeekHigh'],
        '52WeekLow': data['52WeekLow'],
        profitMargin: data.ProfitMargin,
        operatingMargin: data.OperatingMarginTTM,
        returnOnEquity: data.ReturnOnEquityTTM,
        revenuePerShare: data.RevenuePerShareTTM,
        quarterlyEarningsGrowth: data.QuarterlyEarningsGrowthYOY,
        quarterlyRevenueGrowth: data.QuarterlyRevenueGrowthYOY,
        analystTargetPrice: data.AnalystTargetPrice,
      };
    }
    throw new Error('Unable to fetch company overview');
  }

  async getInsiderTrading(symbol: string): Promise<any> {
    // Note: Alpha Vantage free tier doesn't provide insider trading data
    // This is a placeholder that returns information about the limitation
    return {
      symbol: symbol.toUpperCase(),
      message: 'Insider trading data requires a premium API subscription. Alpha Vantage free tier does not include this data.',
      suggestion: 'Consider using Financial Modeling Prep API or SEC EDGAR for insider trading information.',
    };
  }

  async getAnalystRatings(symbol: string): Promise<any> {
    // Note: Alpha Vantage free tier has limited analyst data
    // The company overview includes analyst target price
    const overview = await this.getCompanyOverview(symbol);
    return {
      symbol: symbol.toUpperCase(),
      analystTargetPrice: overview.analystTargetPrice,
      message: 'Full analyst ratings require a premium API subscription.',
    };
  }

  async searchStock(query: string): Promise<any> {
    const data = await this.makeRequest({
      function: 'SYMBOL_SEARCH',
      keywords: query,
    });

    if (data.bestMatches) {
      const matches = data.bestMatches.slice(0, 5).map((match: any) => ({
        symbol: match['1. symbol'],
        name: match['2. name'],
        type: match['3. type'],
        region: match['4. region'],
        currency: match['8. currency'],
      }));
      return { results: matches };
    }
    throw new Error('Unable to search stocks');
  }
}

/**
 * Mock service for testing without API key
 */
export class MockStockDataService implements StockDataService {
  async getStockPrice(symbol: string): Promise<any> {
    return {
      symbol: symbol.toUpperCase(),
      price: '150.25',
      change: '+2.45',
      changePercent: '+1.66%',
      volume: '45678900',
      latestTradingDay: new Date().toISOString().split('T')[0],
    };
  }

  async getPriceHistory(symbol: string, range: string = 'daily'): Promise<any> {
    const prices = Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      open: (150 + Math.random() * 10).toFixed(2),
      high: (155 + Math.random() * 10).toFixed(2),
      low: (145 + Math.random() * 10).toFixed(2),
      close: (150 + Math.random() * 10).toFixed(2),
      volume: Math.floor(40000000 + Math.random() * 10000000).toString(),
    }));
    return { symbol: symbol.toUpperCase(), prices };
  }

  async getCompanyOverview(symbol: string): Promise<any> {
    return {
      symbol: symbol.toUpperCase(),
      name: 'Example Corporation',
      description: 'A leading technology company specializing in innovative solutions.',
      sector: 'Technology',
      industry: 'Software',
      marketCapitalization: '500000000000',
      eps: '5.67',
      peRatio: '26.5',
      pegRatio: '1.8',
      dividendYield: '0.015',
      '52WeekHigh': '180.50',
      '52WeekLow': '120.30',
      profitMargin: '0.21',
      operatingMargin: '0.28',
      returnOnEquity: '0.35',
      revenuePerShare: '25.5',
      quarterlyEarningsGrowth: '0.12',
      quarterlyRevenueGrowth: '0.15',
      analystTargetPrice: '165.00',
    };
  }

  async getInsiderTrading(symbol: string): Promise<any> {
    return {
      symbol: symbol.toUpperCase(),
      transactions: [
        {
          date: '2024-01-15',
          insider: 'John Doe',
          position: 'CEO',
          transactionType: 'Purchase',
          shares: 10000,
          price: 145.50,
        },
        {
          date: '2024-01-10',
          insider: 'Jane Smith',
          position: 'CFO',
          transactionType: 'Sale',
          shares: 5000,
          price: 147.25,
        },
      ],
    };
  }

  async getAnalystRatings(symbol: string): Promise<any> {
    return {
      symbol: symbol.toUpperCase(),
      consensusRating: 'Buy',
      targetPrice: '165.00',
      ratings: {
        strongBuy: 8,
        buy: 12,
        hold: 5,
        sell: 1,
        strongSell: 0,
      },
    };
  }

  async searchStock(query: string): Promise<any> {
    return {
      results: [
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          type: 'Equity',
          region: 'United States',
          currency: 'USD',
        },
        {
          symbol: 'MSFT',
          name: 'Microsoft Corporation',
          type: 'Equity',
          region: 'United States',
          currency: 'USD',
        },
      ],
    };
  }
}
