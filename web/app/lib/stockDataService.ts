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
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private lastRequestAt = new Map<string, number>();
  private static sharedCache = new Map<string, { expiresAt: number; data: any }>();
  private minIntervals = {
    alphavantage: process.env.VERCEL
      ? 0
      : Number(process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS || 12000),
  };

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ALPHA_VANTAGE_API_KEY || 'demo';
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
      const cached = this.cache.get(cacheKey) || AlphaVantageService.sharedCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.cache.set(cacheKey, cached);
        return cached.data;
      }
    }

    const data = await fetcher();
    if (ttlMs > 0) {
      const entry = { expiresAt: Date.now() + ttlMs, data };
      this.cache.set(cacheKey, entry);
      AlphaVantageService.sharedCache.set(cacheKey, entry);
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
        const data = response.data;
        if (data?.Note) {
          throw new Error(data.Note);
        }
        if (data?.Information) {
          throw new Error(data.Information);
        }
        if (data?.['Error Message']) {
          throw new Error(data['Error Message']);
        }
        return data;
      } catch (error: any) {
        console.error('API request failed:', error.message);
        throw new Error(`Failed to fetch data: ${error.message}`);
      }
    });
  }


  private buildBasicFinancialsFallback(overview: any): any {
    if (!overview) return null;
    const revenue = Number(overview.revenueTTM);
    const grossProfit = Number(overview.grossProfitTTM);
    const grossMarginTTM = Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(grossProfit)
      ? grossProfit / revenue
      : overview.profitMargin;

    return {
      symbol: overview.symbol || overview.Symbol,
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
    const now = new Date();
    const normalizedRange = range.toLowerCase();
    const rangeConfig = (() => {
      if (['1w', '1week', 'week'].includes(normalizedRange)) {
        return { functionName: 'TIME_SERIES_DAILY', outputsize: 'compact', days: 7 };
      }
      if (['1m', '1month', 'month'].includes(normalizedRange)) {
        return { functionName: 'TIME_SERIES_DAILY', outputsize: 'compact', days: 30 };
      }
      if (['3m', '3month', 'quarter'].includes(normalizedRange)) {
        return { functionName: 'TIME_SERIES_DAILY', outputsize: 'compact', days: 90 };
      }
      if (['6m', '6month'].includes(normalizedRange)) {
        return { functionName: 'TIME_SERIES_DAILY', outputsize: 'compact', days: 180 };
      }
      if (['1y', '1year', 'year'].includes(normalizedRange)) {
        return { functionName: 'TIME_SERIES_WEEKLY', outputsize: 'full', days: 365 };
      }
      if (['3y', '3year'].includes(normalizedRange)) {
        return { functionName: 'TIME_SERIES_WEEKLY', outputsize: 'full', days: 365 * 3 };
      }
      if (['5y', '5year'].includes(normalizedRange)) {
        return { functionName: 'TIME_SERIES_WEEKLY', outputsize: 'full', days: 365 * 5 };
      }
      if (['max', 'all'].includes(normalizedRange)) {
        return { functionName: 'TIME_SERIES_MONTHLY', outputsize: 'full', days: null };
      }
      if (normalizedRange === 'weekly') {
        return { functionName: 'TIME_SERIES_WEEKLY', outputsize: 'full', days: null };
      }
      if (normalizedRange === 'monthly') {
        return { functionName: 'TIME_SERIES_MONTHLY', outputsize: 'full', days: null };
      }
      return { functionName: 'TIME_SERIES_DAILY', outputsize: 'compact', days: null };
    })();

    const data = await this.makeRequest(
      {
        function: rangeConfig.functionName,
        symbol: symbol.toUpperCase(),
        outputsize: rangeConfig.outputsize,
      },
      { ttlMs: 60 * 60 * 1000 }
    );

    // Parse the time series data
    const timeSeriesKey = Object.keys(data).find(key => key.includes('Time Series'));
    if (timeSeriesKey) {
      const timeSeries = data[timeSeriesKey];
      const cutoff = rangeConfig.days
        ? new Date(now.getTime() - rangeConfig.days * 24 * 60 * 60 * 1000)
        : null;
      const prices = Object.entries(timeSeries)
        .filter(([date]) => {
          if (!cutoff) return true;
          const parsed = new Date(date);
          return !Number.isNaN(parsed.getTime()) && parsed >= cutoff;
        })
        .map(([date, values]: [string, any]) => ({
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
    const overview = await this.getCompanyOverview(symbol).catch(() => null);
    const fallback = this.buildBasicFinancialsFallback(overview);
    if (fallback) return fallback;
    return { symbol: symbol.toUpperCase(), metric: {}, series: {} };
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
    throw new Error('Analyst recommendations unavailable in Alpha-only mode');
  }

  async getPriceTargets(symbol: string): Promise<any> {
    const overview = await this.getCompanyOverview(symbol).catch(() => null);
    return {
      symbol: symbol.toUpperCase(),
      targetMean: overview?.analystTargetPrice ?? null,
    };
  }

  async getPeers(symbol: string): Promise<any> {
    const overview = await this.getCompanyOverview(symbol).catch(() => null);
    const rawQueries = [overview?.industry, overview?.sector, overview?.name, symbol]
      .filter(Boolean)
      .map((value) => String(value).trim())
      .filter(Boolean);
    const queries = Array.from(new Set(rawQueries)).slice(0, 2);
    const results = await Promise.all(
      queries.map((query) => this.searchStock(query).catch(() => ({ results: [] })))
    );
    const peers = results
      .flatMap((result) => result.results || [])
      .map((item: any) => item.symbol)
      .filter(Boolean);
    return {
      symbol: symbol.toUpperCase(),
      peers: Array.from(new Set(peers)),
    };
  }

  async searchStock(query: string): Promise<any> {
    const alphaResults = await this.makeRequest(
      {
        function: 'SYMBOL_SEARCH',
        keywords: query,
      },
      { ttlMs: 60 * 60 * 1000 }
    );

    if (alphaResults?.Note) {
      throw new Error(alphaResults.Note);
    }
    if (alphaResults?.['Error Message']) {
      throw new Error(alphaResults['Error Message']);
    }

    const alphaMatches = alphaResults?.bestMatches || [];
    const combined = alphaMatches.map((match: any) => ({
      symbol: match['1. symbol'],
      name: match['2. name'],
      type: match['3. type'],
      region: match['4. region'],
      currency: match['8. currency'],
      source: 'alphavantage',
    }));

    const seen = new Set<string>();
    const results = combined.filter((item) => {
      if (!item.symbol) return false;
      const key = item.symbol.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const usResults = results.filter((item) => {
      const region = String(item.region || '').toLowerCase();
      const currency = String(item.currency || '').toUpperCase();
      const exchange = String(item.exchange || '').toUpperCase();
      const type = String(item.type || '').toLowerCase();
      if (type && !type.includes('equity')) return false;
      return region.includes('united states')
        || currency === 'USD'
        || ['NYSE', 'NASDAQ', 'AMEX'].some((label) => exchange.includes(label));
    });

    const filtered = usResults.length ? usResults : results.filter((item) => {
      const type = String(item.type || '').toLowerCase();
      return !type || type.includes('equity');
    });
    return { results: filtered };
  }

  async searchCompanies(query: string): Promise<any> {
    return this.searchStock(query);
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
    throw new Error('Sector screening unavailable in Alpha-only mode');
  }

  async screenStocks(filters: Record<string, string | number | undefined>): Promise<any> {
    throw new Error('Stock screening unavailable in Alpha-only mode');
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
    throw new Error('News sentiment unavailable in Alpha-only mode');
  }

  async getCompanyNews(symbol: string, days: number = 30): Promise<any> {
    throw new Error('Company news unavailable in Alpha-only mode');
  }

  async searchNews(query: string, days: number = 30): Promise<any> {
    throw new Error('News search unavailable in Alpha-only mode');
  }
}
