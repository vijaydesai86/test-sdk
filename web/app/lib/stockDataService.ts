import axios from 'axios';

export interface StockDataService {
  getStockPrice(symbol: string): Promise<any>;
  getPriceHistory(symbol: string, range?: string): Promise<any>;
  getCompanyOverview(symbol: string): Promise<any>;
  getBasicFinancials(symbol: string): Promise<any>;
  getInsiderTrading(symbol: string): Promise<any>;
  getAnalystRatings(symbol: string): Promise<any>;
  getAnalystRecommendations(symbol: string): Promise<any>;
  getPriceTargets(symbol: string): Promise<any>;
  getPeers(symbol: string): Promise<any>;
  searchStock(query: string): Promise<any>;
  searchCompanies(query: string): Promise<any>;
  getEarningsHistory(symbol: string): Promise<any>;
  getIncomeStatement(symbol: string): Promise<any>;
  getBalanceSheet(symbol: string): Promise<any>;
  getCashFlow(symbol: string): Promise<any>;
  getSectorPerformance(): Promise<any>;
  getStocksBySector(sector: string): Promise<any>;
  screenStocks(filters: Record<string, string | number | undefined>): Promise<any>;
  getTopGainersLosers(): Promise<any>;
  getNewsSentiment(symbol: string): Promise<any>;
  getCompanyNews(symbol: string, days?: number): Promise<any>;
  searchNews(query: string, days?: number): Promise<any>;
}

/**
 * Stock data service using Alpha Vantage API (free tier)
 * Note: Alpha Vantage free tier has a limit of 5 API calls per minute
 */
export class AlphaVantageService implements StockDataService {
  private apiKey: string;
  private baseUrl = 'https://www.alphavantage.co/query';
  private finnhubApiKey?: string;
  private fmpApiKey?: string;
  private newsApiKey?: string;
  private finnhubBaseUrl = 'https://finnhub.io/api/v1';
  private fmpBaseUrl = 'https://financialmodelingprep.com/api/v3';
  private newsApiBaseUrl = 'https://newsapi.org/v2';
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private lastRequestAt = new Map<string, number>();
  private minIntervals = {
    alphavantage: Number(process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS || 12000),
    finnhub: Number(process.env.FINNHUB_MIN_INTERVAL_MS || 1000),
    fmp: Number(process.env.FMP_MIN_INTERVAL_MS || 1000),
    newsapi: Number(process.env.NEWSAPI_MIN_INTERVAL_MS || 1000),
  };

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ALPHA_VANTAGE_API_KEY || 'demo';
    this.finnhubApiKey = process.env.FINNHUB_API_KEY;
    this.fmpApiKey = process.env.FMP_API_KEY;
    this.newsApiKey = process.env.NEWSAPI_KEY;
  }

  private buildCacheKey(prefix: string, params: Record<string, string>): string {
    const sorted: Record<string, string> = {};
    Object.keys(params).sort().forEach((key) => {
      sorted[key] = params[key];
    });
    return `${prefix}:${JSON.stringify(sorted)}`;
  }

  private async throttle(provider: string, minIntervalMs: number): Promise<void> {
    if (minIntervalMs <= 0) return;
    const last = this.lastRequestAt.get(provider) || 0;
    const now = Date.now();
    const wait = minIntervalMs - (now - last);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestAt.set(provider, Date.now());
  }

  private async fetchWithCache(
    cacheKey: string,
    ttlMs: number,
    fetcher: () => Promise<any>
  ): Promise<any> {
    if (ttlMs > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
      }
    }

    const data = await fetcher();
    if (ttlMs > 0) {
      this.cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, data });
    }
    return data;
  }

  private async makeRequest(
    params: Record<string, string>,
    options: { ttlMs?: number; cacheKey?: string } = {}
  ): Promise<any> {
    const cacheKey = options.cacheKey || this.buildCacheKey('alphavantage', params);
    const ttlMs = options.ttlMs || 0;

    return this.fetchWithCache(cacheKey, ttlMs, async () => {
      await this.throttle('alphavantage', this.minIntervals.alphavantage);
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
    });
  }

  private async makeFinnhubRequest(
    path: string,
    params: Record<string, string> = {},
    options: { ttlMs?: number; cacheKey?: string } = {}
  ): Promise<any> {
    if (!this.finnhubApiKey) {
      throw new Error('FINNHUB_API_KEY is required for this request');
    }
    const cacheKey = options.cacheKey || this.buildCacheKey(`finnhub:${path}`, params);
    const ttlMs = options.ttlMs || 0;

    return this.fetchWithCache(cacheKey, ttlMs, async () => {
      await this.throttle('finnhub', this.minIntervals.finnhub);
      try {
        const response = await axios.get(`${this.finnhubBaseUrl}${path}`, {
          params: {
            ...params,
            token: this.finnhubApiKey,
          },
          timeout: 10000,
        });
        return response.data;
      } catch (error: any) {
        console.error('Finnhub API request failed:', error.message);
        throw new Error(`Finnhub request failed: ${error.message}`);
      }
    });
  }

  private async makeFmpRequest(
    path: string,
    params: Record<string, string> = {},
    options: { ttlMs?: number; cacheKey?: string } = {}
  ): Promise<any> {
    if (!this.fmpApiKey) {
      throw new Error('FMP_API_KEY is required for this request');
    }
    const cacheKey = options.cacheKey || this.buildCacheKey(`fmp:${path}`, params);
    const ttlMs = options.ttlMs || 0;

    return this.fetchWithCache(cacheKey, ttlMs, async () => {
      await this.throttle('fmp', this.minIntervals.fmp);
      try {
        const response = await axios.get(`${this.fmpBaseUrl}${path}`, {
          params: {
            ...params,
            apikey: this.fmpApiKey,
          },
          timeout: 10000,
        });
        return response.data;
      } catch (error: any) {
        console.error('FMP API request failed:', error.message);
        throw new Error(`FMP request failed: ${error.message}`);
      }
    });
  }

  private async makeNewsApiRequest(
    params: Record<string, string>,
    options: { ttlMs?: number; cacheKey?: string } = {}
  ): Promise<any> {
    if (!this.newsApiKey) {
      throw new Error('NEWSAPI_KEY is required for this request');
    }
    const cacheKey = options.cacheKey || this.buildCacheKey('newsapi:everything', params);
    const ttlMs = options.ttlMs || 0;

    return this.fetchWithCache(cacheKey, ttlMs, async () => {
      await this.throttle('newsapi', this.minIntervals.newsapi);
      try {
        const response = await axios.get(`${this.newsApiBaseUrl}/everything`, {
          params: {
            ...params,
            apiKey: this.newsApiKey,
          },
          timeout: 10000,
        });
        return response.data;
      } catch (error: any) {
        console.error('NewsAPI request failed:', error.message);
        throw new Error(`NewsAPI request failed: ${error.message}`);
      }
    });
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  async getStockPrice(symbol: string): Promise<any> {
    const data = await this.makeRequest(
      {
        function: 'GLOBAL_QUOTE',
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 30000 }
    );

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

    const data = await this.makeRequest(
      {
        function: functionName,
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 60 * 60 * 1000 }
    );

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
    const data = await this.makeRequest(
      {
        function: 'OVERVIEW',
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 6 * 60 * 60 * 1000 }
    );

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
        forwardPE: data.ForwardPE,
        pegRatio: data.PEGRatio,
        bookValue: data.BookValue,
        dividendPerShare: data.DividendPerShare,
        dividendYield: data.DividendYield,
        revenueTTM: data.RevenueTTM,
        grossProfitTTM: data.GrossProfitTTM,
        '52WeekHigh': data['52WeekHigh'],
        '52WeekLow': data['52WeekLow'],
        '50DayMovingAverage': data['50DayMovingAverage'],
        '200DayMovingAverage': data['200DayMovingAverage'],
        beta: data.Beta,
        profitMargin: data.ProfitMargin,
        operatingMargin: data.OperatingMarginTTM,
        returnOnAssets: data.ReturnOnAssetsTTM,
        returnOnEquity: data.ReturnOnEquityTTM,
        revenuePerShare: data.RevenuePerShareTTM,
        quarterlyEarningsGrowth: data.QuarterlyEarningsGrowthYOY,
        quarterlyRevenueGrowth: data.QuarterlyRevenueGrowthYOY,
        sharesOutstanding: data.SharesOutstanding,
        sharesFloat: data.SharesFloat,
        percentInsiders: data.PercentInsiders,
        percentInstitutions: data.PercentInstitutions,
        shortRatio: data.ShortRatio,
        shortPercentFloat: data.ShortPercentFloat,
        shortPercentOutstanding: data.ShortPercentOutstanding,
        analystTargetPrice: data.AnalystTargetPrice,
        analystRatingStrongBuy: data.AnalystRatingStrongBuy,
        analystRatingBuy: data.AnalystRatingBuy,
        analystRatingHold: data.AnalystRatingHold,
        analystRatingSell: data.AnalystRatingSell,
        analystRatingStrongSell: data.AnalystRatingStrongSell,
        exDividendDate: data.ExDividendDate,
        dividendDate: data.DividendDate,
      };
    }
    throw new Error('Unable to fetch company overview');
  }

  async getBasicFinancials(symbol: string): Promise<any> {
    const data = await this.makeFinnhubRequest(
      '/stock/metric',
      {
        symbol: symbol.toUpperCase(),
        metric: 'all',
      },
      { ttlMs: 6 * 60 * 60 * 1000 }
    );

    if (data && (data.metric || data.series)) {
      return {
        symbol: symbol.toUpperCase(),
        metric: data.metric || {},
        series: data.series || {},
      };
    }
    throw new Error('Unable to fetch basic financials');
  }

  async getInsiderTrading(symbol: string): Promise<any> {
    const overviewData = await this.makeRequest(
      {
        function: 'OVERVIEW',
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 6 * 60 * 60 * 1000 }
    );

    const result: any = {
      symbol: symbol.toUpperCase(),
      insiderOwnership: overviewData.PercentInsiders ? `${overviewData.PercentInsiders}%` : 'N/A',
      institutionalOwnership: overviewData.PercentInstitutions ? `${overviewData.PercentInstitutions}%` : 'N/A',
      sharesOutstanding: overviewData.SharesOutstanding || 'N/A',
      sharesFloat: overviewData.SharesFloat || 'N/A',
      shortRatio: overviewData.ShortRatio || 'N/A',
      shortPercentFloat: overviewData.ShortPercentFloat ? `${overviewData.ShortPercentFloat}%` : 'N/A',
      shortPercentOutstanding: overviewData.ShortPercentOutstanding ? `${overviewData.ShortPercentOutstanding}%` : 'N/A',
    };

    try {
      const txnData = await this.makeRequest({
        function: 'INSIDER_TRANSACTIONS',
        symbol: symbol.toUpperCase(),
      }, { ttlMs: 6 * 60 * 60 * 1000 });
      if (txnData.data && Array.isArray(txnData.data) && txnData.data.length > 0) {
        result.recentTransactions = txnData.data.slice(0, 15).map((t: any) => ({
          transactionDate: t.transaction_date,
          insider: t.executive,
          title: t.executive_title,
          transactionType: t.acquisition_or_disposal === 'A' ? 'Purchase' : 'Sale',
          shares: t.shares,
          sharePrice: t.share_price,
          totalValue: t.shares && t.share_price ? (Number(t.shares) * Number(t.share_price)).toFixed(0) : 'N/A',
        }));
      }
    } catch {
      // Premium endpoint unavailable — ownership data above is still returned
    }

    return result;
  }

  async getAnalystRatings(symbol: string): Promise<any> {
    const data = await this.makeRequest(
      {
        function: 'OVERVIEW',
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 6 * 60 * 60 * 1000 }
    );

    return {
      symbol: symbol.toUpperCase(),
      analystTargetPrice: data.AnalystTargetPrice || 'N/A',
      strongBuy: data.AnalystRatingStrongBuy || 'N/A',
      buy: data.AnalystRatingBuy || 'N/A',
      hold: data.AnalystRatingHold || 'N/A',
      sell: data.AnalystRatingSell || 'N/A',
      strongSell: data.AnalystRatingStrongSell || 'N/A',
      movingAverage50Day: data['50DayMovingAverage'] || 'N/A',
      upside: data.AnalystTargetPrice && data['50DayMovingAverage']
        ? `${(((Number(data.AnalystTargetPrice) / Number(data['50DayMovingAverage'])) - 1) * 100).toFixed(1)}% (vs 50-day MA)`
        : 'N/A',
    };
  }

  async getAnalystRecommendations(symbol: string): Promise<any> {
    const data = await this.makeFinnhubRequest(
      '/stock/recommendation',
      {
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 60 * 60 * 1000 }
    );

    if (Array.isArray(data)) {
      return {
        symbol: symbol.toUpperCase(),
        recommendations: data.slice(0, 12),
      };
    }
    throw new Error('Unable to fetch analyst recommendations');
  }

  async getPriceTargets(symbol: string): Promise<any> {
    const data = await this.makeFinnhubRequest(
      '/stock/price-target',
      {
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 60 * 60 * 1000 }
    );

    if (data && Object.keys(data).length > 0) {
      return {
        symbol: symbol.toUpperCase(),
        ...data,
      };
    }
    throw new Error('Unable to fetch price targets');
  }

  async getPeers(symbol: string): Promise<any> {
    const data = await this.makeFinnhubRequest(
      '/stock/peers',
      {
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 6 * 60 * 60 * 1000 }
    );

    if (Array.isArray(data)) {
      return {
        symbol: symbol.toUpperCase(),
        peers: data,
      };
    }
    throw new Error('Unable to fetch peers');
  }

  async searchStock(query: string): Promise<any> {
    const [searchResults, alphaResults] = await Promise.all([
      this.searchCompanies(query),
      this.makeRequest(
        {
          function: 'SYMBOL_SEARCH',
          keywords: query,
        },
        { ttlMs: 60 * 60 * 1000 }
      ).catch(() => null),
    ]);

    const alphaMatches = alphaResults?.bestMatches || [];
    const combined = [
      ...(searchResults.results || []),
      ...alphaMatches.map((match: any) => ({
        symbol: match['1. symbol'],
        name: match['2. name'],
        type: match['3. type'],
        region: match['4. region'],
        currency: match['8. currency'],
        source: 'alphavantage',
      })),
    ];

    const seen = new Set<string>();
    const results = combined.filter((item) => {
      if (!item.symbol) return false;
      const key = item.symbol.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (results.length > 0) {
      return { results };
    }
    throw new Error('Unable to search stocks');
  }

  async searchCompanies(query: string): Promise<any> {
    const [fmpResults, finnhubResults] = await Promise.all([
      this.fmpApiKey
        ? this.makeFmpRequest('/search', { query, limit: '10' }, { ttlMs: 60 * 60 * 1000 })
        : Promise.resolve([]),
      this.finnhubApiKey
        ? this.makeFinnhubRequest('/search', { q: query }, { ttlMs: 60 * 60 * 1000 })
        : Promise.resolve({ result: [] }),
    ]);

    const fmp = Array.isArray(fmpResults)
      ? fmpResults.map((item: any) => ({
        symbol: item.symbol,
        name: item.name,
        exchange: item.exchangeShortName,
        type: item.type,
        source: 'fmp',
      }))
      : [];

    const finnhub = Array.isArray(finnhubResults?.result)
      ? finnhubResults.result.map((item: any) => ({
        symbol: item.symbol,
        name: item.description,
        exchange: item.exchange,
        type: item.type,
        source: 'finnhub',
      }))
      : [];

    const combined = [...fmp, ...finnhub];
    const seen = new Set<string>();
    const results = combined.filter((item) => {
      if (!item.symbol) return false;
      const key = item.symbol.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { results };
  }

  async getEarningsHistory(symbol: string): Promise<any> {
    const data = await this.makeRequest(
      {
        function: 'EARNINGS',
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 6 * 60 * 60 * 1000 }
    );

    if (data.quarterlyEarnings) {
      return {
        symbol: symbol.toUpperCase(),
        annualEarnings: (data.annualEarnings || []).slice(0, 10).map((e: any) => ({
          fiscalYear: e.fiscalDateEnding,
          reportedEPS: e.reportedEPS,
        })),
        quarterlyEarnings: data.quarterlyEarnings.slice(0, 12).map((e: any) => ({
          fiscalQuarter: e.fiscalDateEnding,
          reportedEPS: e.reportedEPS,
          estimatedEPS: e.estimatedEPS,
          surprise: e.surprise,
          surprisePercentage: e.surprisePercentage,
        })),
      };
    }
    throw new Error('Unable to fetch earnings history');
  }

  async getIncomeStatement(symbol: string): Promise<any> {
    const data = await this.makeRequest(
      {
        function: 'INCOME_STATEMENT',
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 6 * 60 * 60 * 1000 }
    );

    if (data.quarterlyReports) {
      return {
        symbol: symbol.toUpperCase(),
        annualReports: (data.annualReports || []).slice(0, 5).map((r: any) => ({
          fiscalYear: r.fiscalDateEnding,
          totalRevenue: r.totalRevenue,
          grossProfit: r.grossProfit,
          operatingIncome: r.operatingIncome,
          netIncome: r.netIncome,
          ebitda: r.ebitda,
        })),
        quarterlyReports: data.quarterlyReports.slice(0, 8).map((r: any) => ({
          fiscalQuarter: r.fiscalDateEnding,
          totalRevenue: r.totalRevenue,
          grossProfit: r.grossProfit,
          operatingIncome: r.operatingIncome,
          netIncome: r.netIncome,
          ebitda: r.ebitda,
        })),
      };
    }
    throw new Error('Unable to fetch income statement');
  }

  async getBalanceSheet(symbol: string): Promise<any> {
    const data = await this.makeRequest(
      {
        function: 'BALANCE_SHEET',
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 6 * 60 * 60 * 1000 }
    );

    if (data.quarterlyReports) {
      return {
        symbol: symbol.toUpperCase(),
        quarterlyReports: data.quarterlyReports.slice(0, 4).map((r: any) => ({
          fiscalQuarter: r.fiscalDateEnding,
          totalAssets: r.totalAssets,
          totalLiabilities: r.totalLiabilities,
          totalShareholderEquity: r.totalShareholderEquity,
          cashAndEquivalents: r.cashAndCashEquivalentsAtCarryingValue,
          longTermDebt: r.longTermDebt,
        })),
      };
    }
    throw new Error('Unable to fetch balance sheet');
  }

  async getCashFlow(symbol: string): Promise<any> {
    const data = await this.makeRequest(
      {
        function: 'CASH_FLOW',
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 6 * 60 * 60 * 1000 }
    );

    if (data.quarterlyReports) {
      return {
        symbol: symbol.toUpperCase(),
        quarterlyReports: data.quarterlyReports.slice(0, 4).map((r: any) => ({
          fiscalQuarter: r.fiscalDateEnding,
          operatingCashflow: r.operatingCashflow,
          capitalExpenditures: r.capitalExpenditures,
          freeCashFlow: r.operatingCashflow && r.capitalExpenditures
            ? (Number(r.operatingCashflow) - Math.abs(Number(r.capitalExpenditures))).toString()
            : 'N/A',
          dividendPayout: r.dividendPayout,
        })),
      };
    }
    throw new Error('Unable to fetch cash flow data');
  }

  async getSectorPerformance(): Promise<any> {
    const data = await this.makeRequest(
      {
        function: 'SECTOR',
      },
      { ttlMs: 15 * 60 * 1000 }
    );

    return {
      realTimePerformance: data['Rank A: Real-Time Performance'] || {},
      oneDayPerformance: data['Rank B: 1 Day Performance'] || {},
      fiveDayPerformance: data['Rank C: 5 Day Performance'] || {},
      oneMonthPerformance: data['Rank D: 1 Month Performance'] || {},
      threeMonthPerformance: data['Rank E: 3 Month Performance'] || {},
      yearToDatePerformance: data['Rank F: Year-to-Date (YTD) Performance'] || {},
      oneYearPerformance: data['Rank G: 1 Year Performance'] || {},
    };
  }

  async getStocksBySector(sector: string): Promise<any> {
    return this.screenStocks({ sector, limit: 20 });
  }

  async screenStocks(filters: Record<string, string | number | undefined>): Promise<any> {
    const params: Record<string, string> = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        params[key] = String(value);
      }
    });

    const data = await this.makeFmpRequest('/stock-screener', params, { ttlMs: 15 * 60 * 1000 });

    if (Array.isArray(data)) {
      return {
        filters,
        results: data,
      };
    }
    throw new Error('Unable to screen stocks');
  }

  async getTopGainersLosers(): Promise<any> {
    const data = await this.makeRequest(
      {
        function: 'TOP_GAINERS_LOSERS',
      },
      { ttlMs: 5 * 60 * 1000 }
    );

    return {
      topGainers: (data.top_gainers || []).slice(0, 10).map((s: any) => ({
        ticker: s.ticker,
        price: s.price,
        changeAmount: s.change_amount,
        changePercentage: s.change_percentage,
        volume: s.volume,
      })),
      topLosers: (data.top_losers || []).slice(0, 10).map((s: any) => ({
        ticker: s.ticker,
        price: s.price,
        changeAmount: s.change_amount,
        changePercentage: s.change_percentage,
        volume: s.volume,
      })),
      mostActive: (data.most_actively_traded || []).slice(0, 10).map((s: any) => ({
        ticker: s.ticker,
        price: s.price,
        changeAmount: s.change_amount,
        changePercentage: s.change_percentage,
        volume: s.volume,
      })),
    };
  }

  async getNewsSentiment(symbol: string): Promise<any> {
    const data = await this.makeFinnhubRequest(
      '/news-sentiment',
      {
        symbol: symbol.toUpperCase(),
      },
      { ttlMs: 10 * 60 * 1000 }
    );

    if (data && Object.keys(data).length > 0) {
      return {
        symbol: symbol.toUpperCase(),
        sentiment: data,
      };
    }
    throw new Error('Unable to fetch news sentiment');
  }

  async getCompanyNews(symbol: string, days: number = 30): Promise<any> {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(toDate.getDate() - days);

    const data = await this.makeFinnhubRequest(
      '/company-news',
      {
        symbol: symbol.toUpperCase(),
        from: this.formatDate(fromDate),
        to: this.formatDate(toDate),
      },
      { ttlMs: 10 * 60 * 1000 }
    );

    if (Array.isArray(data)) {
      return {
        symbol: symbol.toUpperCase(),
        articles: data.slice(0, 20),
      };
    }
    throw new Error('Unable to fetch company news');
  }

  async searchNews(query: string, days: number = 30): Promise<any> {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(toDate.getDate() - days);

    const data = await this.makeNewsApiRequest(
      {
        q: query,
        from: this.formatDate(fromDate),
        to: this.formatDate(toDate),
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: '20',
      },
      { ttlMs: 10 * 60 * 1000 }
    );

    if (data?.articles) {
      return {
        query,
        totalResults: data.totalResults,
        articles: data.articles.map((article: any) => ({
          source: article.source?.name,
          author: article.author,
          title: article.title,
          description: article.description,
          url: article.url,
          publishedAt: article.publishedAt,
        })),
      };
    }
    throw new Error('Unable to fetch news articles');
  }
}
