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
  getEarningsHistory(symbol: string): Promise<any>;
  getIncomeStatement(symbol: string): Promise<any>;
  getBalanceSheet(symbol: string): Promise<any>;
  getCashFlow(symbol: string): Promise<any>;
  getSectorPerformance(): Promise<any>;
  getTopGainersLosers(): Promise<any>;
  getNewsSentiment(symbol: string): Promise<any>;
  getCompanyNews(symbol: string, days?: number): Promise<any>;
  searchNews(query: string, days?: number): Promise<any>;
}

type Provider = 'alphavantage' | 'finnhub' | 'hybrid';
const PROVIDER_ENV = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase() as Provider;

/**
 * Stock data service using Alpha Vantage API (free tier)
 * Note: Alpha Vantage free tier has a limit of 5 API calls per minute
 */
export class AlphaVantageService implements StockDataService {
  private apiKey: string;
  private baseUrl = 'https://www.alphavantage.co/query';
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private static sharedCache = new Map<string, { expiresAt: number; data: any }>();
  private minIntervals = {
    alphavantage: Number(process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS || 1200),
  };

  // ── Circuit breaker ───────────────────────────────────────────────────────
  // Static so it is shared across all instances in the same process.
  // When > Date.now() every makeRequest call throws immediately without
  // throttling, letting HybridStockDataService fall back to Finnhub in 0 ms.
  private static rateLimitedUntilMs = 0;
  private static readonly DAILY_LIMIT_LOCKOUT_MS = 60 * 60 * 1000; // 1 h
  private static readonly PER_MINUTE_LOCKOUT_MS = 65 * 1000;        // 65 s
  // ─────────────────────────────────────────────────────────────────────────

  // ── Queue-based throttle ─────────────────────────────────────────────────
  // Prevents the race condition where concurrent callers (e.g. Promise.all)
  // all read the same lastRequestAt timestamp and fire simultaneously.
  private throttleQueue = Promise.resolve();
  // ─────────────────────────────────────────────────────────────────────────

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

  private throttle(minIntervalMs: number): Promise<void> {
    if (minIntervalMs <= 0) return Promise.resolve();
    const slot = this.throttleQueue.then(
      () => new Promise<void>(resolve => setTimeout(resolve, minIntervalMs))
    );
    this.throttleQueue = slot;
    return slot;
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
      // ── Circuit breaker ──────────────────────────────────────────────────
      if (AlphaVantageService.rateLimitedUntilMs > Date.now()) {
        throw new Error(
          'Unavailable via Alpha Vantage: rate limit active — falling back to alternative source'
        );
      }
      // ────────────────────────────────────────────────────────────────────

      await this.throttle(this.minIntervals.alphavantage);
      try {
        const response = await axios.get(this.baseUrl, {
          params: {
            ...params,
            apikey: this.apiKey,
          },
          timeout: 10000,
        });
        const data = response.data;

        // Detect rate-limit messages (AV returns HTTP 200 even when limited).
        const limitMsg: string = (data?.Note || data?.Information || '') as string;
        if (limitMsg) {
          const isDaily = /per day|\d+ requests per day/i.test(limitMsg);
          AlphaVantageService.rateLimitedUntilMs =
            Date.now() +
            (isDaily
              ? AlphaVantageService.DAILY_LIMIT_LOCKOUT_MS
              : AlphaVantageService.PER_MINUTE_LOCKOUT_MS);
          throw new Error(
            'Unavailable via Alpha Vantage: rate limit active — falling back to alternative source'
          );
        }

        if (data?.['Error Message']) {
          throw new Error(data['Error Message']);
        }
        return data;
      } catch (error: any) {
        if ((error.message as string).startsWith('Unavailable via Alpha Vantage:')) throw error;
        console.error('Alpha Vantage API error:', error.message);
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
        // TIME_SERIES_WEEKLY returns full history on the free tier; no outputsize param needed
        return { functionName: 'TIME_SERIES_WEEKLY', outputsize: '', days: 365 };
      }
      if (['3y', '3year'].includes(normalizedRange)) {
        return { functionName: 'TIME_SERIES_WEEKLY', outputsize: '', days: 365 * 3 };
      }
      if (['5y', '5year'].includes(normalizedRange)) {
        return { functionName: 'TIME_SERIES_WEEKLY', outputsize: '', days: 365 * 5 };
      }
      if (['max', 'all'].includes(normalizedRange)) {
        // TIME_SERIES_MONTHLY returns entire price history on the free tier
        return { functionName: 'TIME_SERIES_MONTHLY', outputsize: '', days: null };
      }
      if (normalizedRange === 'weekly') {
        return { functionName: 'TIME_SERIES_WEEKLY', outputsize: '', days: null };
      }
      if (normalizedRange === 'monthly') {
        return { functionName: 'TIME_SERIES_MONTHLY', outputsize: '', days: null };
      }
      return { functionName: 'TIME_SERIES_DAILY', outputsize: 'compact', days: null };
    })();

    const requestParams: Record<string, string> = {
      function: rangeConfig.functionName,
      symbol: symbol.toUpperCase(),
    };
    // TIME_SERIES_DAILY supports outputsize=compact|full; weekly/monthly always return full history
    if (rangeConfig.outputsize) {
      requestParams.outputsize = rangeConfig.outputsize;
    }
    const data = await this.makeRequest(requestParams, { ttlMs: 60 * 60 * 1000 });

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
    throw new Error('Unavailable via Alpha Vantage: company data not found');
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
    const results = combined.filter((item: { symbol?: string }) => {
      if (!item.symbol) return false;
      const key = item.symbol.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const usResults = results.filter((item: { region?: string; currency?: string; exchange?: string; type?: string }) => {
      const region = String(item.region || '').toLowerCase();
      const currency = String(item.currency || '').toUpperCase();
      const exchange = String(item.exchange || '').toUpperCase();
      const type = String(item.type || '').toLowerCase();
      if (type && !type.includes('equity')) return false;
      return region.includes('united states')
        || currency === 'USD'
        || ['NYSE', 'NASDAQ', 'AMEX'].some((label) => exchange.includes(label));
    });

    const filtered = usResults.length
      ? usResults
      : results.filter((item: { type?: string }) => {
      const type = String(item.type || '').toLowerCase();
      return !type || type.includes('equity');
    });
    return { results: filtered };
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


export class FinnhubService implements StockDataService {
  private apiKey: string;
  private baseUrl = 'https://finnhub.io/api/v1';
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private minIntervalMs = Number(process.env.FINNHUB_MIN_INTERVAL_MS || 500);

  // ── Circuit breaker ───────────────────────────────────────────────────────
  private static rateLimitedUntilMs = 0;
  private static readonly RATE_LIMIT_LOCKOUT_MS = 65 * 1000;
  // ─────────────────────────────────────────────────────────────────────────

  // ── Queue-based throttle ─────────────────────────────────────────────────
  private throttleQueue = Promise.resolve();
  // ─────────────────────────────────────────────────────────────────────────

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.FINNHUB_API_KEY || '';
  }

  private throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return Promise.resolve();
    const slot = this.throttleQueue.then(
      () => new Promise<void>(resolve => setTimeout(resolve, this.minIntervalMs))
    );
    this.throttleQueue = slot;
    return slot;
  }

  private async makeRequest(path: string, params: Record<string, string> = {}, ttlMs = 0): Promise<any> {
    const cacheKey = `finnhub:${path}:${JSON.stringify(params)}`;
    if (ttlMs > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.data;
    }

    // ── Circuit breaker ──────────────────────────────────────────────────
    if (FinnhubService.rateLimitedUntilMs > Date.now()) {
      throw new Error('Unavailable via Finnhub: rate limit active — please wait a moment');
    }
    // ────────────────────────────────────────────────────────────────────

    await this.throttle();
    try {
      const response = await axios.get(`${this.baseUrl}${path}`, {
        params: { ...params, token: this.apiKey },
        timeout: 10000,
      });
      const data = response.data;
      if (ttlMs > 0) this.cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, data });
      return data;
    } catch (error: any) {
      const statusCode = error?.response?.status;
      if (statusCode === 401 || statusCode === 403) {
        throw new Error(`Unavailable via Finnhub (plan limitation: ${statusCode})`);
      }
      if (statusCode === 429) {
        FinnhubService.rateLimitedUntilMs = Date.now() + FinnhubService.RATE_LIMIT_LOCKOUT_MS;
        console.warn('Finnhub rate limit (429) hit — circuit breaker open for 65 s');
        throw new Error('Unavailable via Finnhub: rate limit active — please wait a moment');
      }
      throw new Error(`Finnhub request failed: ${error.message}`);
    }
  }

  async getStockPrice(symbol: string): Promise<any> {
    const data = await this.makeRequest('/quote', { symbol: symbol.toUpperCase() }, 30000);
    // Finnhub returns { c:0, t:0 } (all zeros) for unknown/invalid symbols — treat as no data
    if (!data || data.c === undefined || data.c === null || data.t === 0) {
      throw new Error('Unavailable via Finnhub: no stock price data');
    }
    return {
      symbol: symbol.toUpperCase(),
      price: data.c?.toString(),
      change: data.d?.toString(),
      changePercent: data.dp !== null && data.dp !== undefined ? `${Number(data.dp).toFixed(2)}%` : 'N/A',
      high: data.h?.toString(),
      low: data.l?.toString(),
      open: data.o?.toString(),
      previousClose: data.pc?.toString(),
    };
  }

  async getPriceHistory(symbol: string, range = '1y'): Promise<any> {
    const now = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const lower = (range || '').toLowerCase();
    const { from, resolution } = (() => {
      if (lower.includes('max')) return { from: now - 20 * 365 * DAY, resolution: 'M' };
      if (lower.includes('5y')) return { from: now - 5 * 365 * DAY, resolution: 'W' };
      if (lower.includes('3y')) return { from: now - 3 * 365 * DAY, resolution: 'W' };
      if (lower.includes('1y') || lower === 'daily') return { from: now - 365 * DAY, resolution: 'D' };
      if (lower.includes('6m')) return { from: now - 180 * DAY, resolution: 'D' };
      if (lower.includes('3m') || lower === 'quarterly') return { from: now - 90 * DAY, resolution: 'D' };
      if (lower.includes('1m') || lower === 'monthly') return { from: now - 30 * DAY, resolution: 'D' };
      if (lower.includes('1w') || lower === 'weekly') return { from: now - 7 * DAY, resolution: 'D' };
      return { from: now - 90 * DAY, resolution: 'D' };
    })();
    const data = await this.makeRequest('/stock/candle', {
      symbol: symbol.toUpperCase(),
      resolution,
      from: from.toString(),
      to: now.toString(),
    }, 60 * 60 * 1000);
    if (data.s !== 'ok' || !Array.isArray(data.c)) throw new Error('Unavailable via Finnhub: price history not available');
    const prices = (data.t as number[]).map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: data.o?.[i],
      high: data.h?.[i],
      low: data.l?.[i],
      close: data.c[i],
      volume: data.v?.[i],
    }));
    return { symbol: symbol.toUpperCase(), prices };
  }

  async getCompanyOverview(symbol: string): Promise<any> {
    const [profile, metrics] = await Promise.all([
      this.makeRequest('/stock/profile2', { symbol: symbol.toUpperCase() }, 6 * 60 * 60 * 1000),
      this.makeRequest('/stock/metric', { symbol: symbol.toUpperCase(), metric: 'all' }, 60 * 60 * 1000).catch(() => ({ metric: {} })),
    ]);
    if (!profile?.name) throw new Error('Unavailable via Finnhub: company profile not found');
    const m = metrics?.metric || {};
    return {
      symbol: symbol.toUpperCase(),
      name: profile.name,
      description: null,
      sector: profile.finnhubIndustry,
      industry: profile.finnhubIndustry,
      marketCapitalization: profile.marketCapitalization ? String(Math.round(profile.marketCapitalization * 1e6)) : null,
      eps: m.epsTTM ?? null,
      peRatio: m.peBasicExclExtraTTM ?? null,
      forwardPE: m.peNormalizedAnnual ?? null,
      pegRatio: m.pegNormalizedAnnual ?? null,
      bookValue: m.bookValuePerShareQuarterly ?? null,
      dividendPerShare: m.dividendsPerShareAnnual ?? null,
      dividendYield: m.dividendYieldIndicatedAnnual ?? null,
      revenueTTM: m.revenueTTM ?? null,
      grossProfitTTM: m.grossMarginTTM && m.revenueTTM ? String(m.grossMarginTTM * m.revenueTTM) : null,
      '52WeekHigh': m['52WeekHigh'] ?? null,
      '52WeekLow': m['52WeekLow'] ?? null,
      '50DayMovingAverage': m['50DayMovingAverage'] ?? null,
      '200DayMovingAverage': m['200DayMovingAverage'] ?? null,
      beta: m.beta ?? null,
      profitMargin: m.netProfitMarginTTM ?? null,
      operatingMargin: m.operatingMarginTTM ?? null,
      returnOnAssets: m.roaTTM ?? null,
      returnOnEquity: m.roeTTM ?? null,
      revenuePerShare: m.revenuePerShareTTM ?? null,
      quarterlyEarningsGrowth: m.epsGrowthTTMYoy ?? null,
      quarterlyRevenueGrowth: m.revenueGrowthTTMYoy ?? null,
      sharesOutstanding: profile.shareOutstanding ? String(Math.round(profile.shareOutstanding * 1e6)) : null,
      sharesFloat: null,
      percentInsiders: null,
      percentInstitutions: null,
      shortRatio: null,
      shortPercentFloat: null,
      shortPercentOutstanding: null,
      analystTargetPrice: null,
      exDividendDate: null,
      dividendDate: null,
    };
  }

  async getBasicFinancials(symbol: string): Promise<any> {
    const data = await this.makeRequest('/stock/metric', { symbol: symbol.toUpperCase(), metric: 'all' }, 60 * 60 * 1000);
    return { symbol: symbol.toUpperCase(), metric: data.metric || {}, series: data.series || {} };
  }

  // Pivot Finnhub series.quarterly.ic/bs/cf (per-field time-series arrays) into
  // per-period records that match the output shape expected by reportGenerator.
  // series format: { revenue: [{period, v}, ...], grossProfit: [...], ... }
  private pivotSeries(
    seriesData: Record<string, Array<{ period: string; v: number }>>,
    limit: number
  ): Array<Record<string, unknown>> {
    const periodSet = new Set<string>();
    for (const entries of Object.values(seriesData)) {
      if (Array.isArray(entries)) {
        for (const { period } of entries) periodSet.add(period);
      }
    }
    const periods = [...periodSet].sort((a, b) => b.localeCompare(a)).slice(0, limit);
    return periods.map((period) => {
      const rec: Record<string, unknown> = { period };
      for (const [field, entries] of Object.entries(seriesData)) {
        if (Array.isArray(entries)) {
          const hit = entries.find((e) => e.period === period);
          if (hit !== undefined) rec[field] = hit.v;
        }
      }
      return rec;
    });
  }

  async getInsiderTrading(symbol: string): Promise<any> {
    const data = await this.makeRequest('/stock/insider-transactions', { symbol: symbol.toUpperCase() }, 6 * 60 * 60 * 1000);
    const transactions = (data.data || []).slice(0, 15).map((t: any) => ({
      transactionDate: t.transactionDate,
      insider: t.name,
      transactionType: t.transactionCode === 'P' ? 'Purchase' : t.transactionCode === 'S' ? 'Sale' : t.transactionCode,
      shares: t.share?.toString(),
      sharePrice: t.transactionPrice?.toString(),
      totalValue: t.share && t.transactionPrice ? (Number(t.share) * Number(t.transactionPrice)).toFixed(0) : 'N/A',
    }));
    return { symbol: symbol.toUpperCase(), recentTransactions: transactions };
  }

  async getAnalystRatings(symbol: string): Promise<any> {
    const [recs, target] = await Promise.all([
      this.makeRequest('/stock/recommendation', { symbol: symbol.toUpperCase() }, 6 * 60 * 60 * 1000).catch(() => []),
      this.makeRequest('/stock/price-target', { symbol: symbol.toUpperCase() }, 6 * 60 * 60 * 1000).catch(() => ({})),
    ]);
    const latest = Array.isArray(recs) ? (recs[0] || {}) : {};
    return {
      symbol: symbol.toUpperCase(),
      analystTargetPrice: target.targetMean ?? 'N/A',
      strongBuy: latest.strongBuy ?? 'N/A',
      buy: latest.buy ?? 'N/A',
      hold: latest.hold ?? 'N/A',
      sell: latest.sell ?? 'N/A',
      strongSell: latest.strongSell ?? 'N/A',
    };
  }

  async getAnalystRecommendations(symbol: string): Promise<any> {
    const data = await this.makeRequest('/stock/recommendation', { symbol: symbol.toUpperCase() }, 6 * 60 * 60 * 1000);
    return {
      symbol: symbol.toUpperCase(),
      recommendations: (Array.isArray(data) ? data : []).slice(0, 4).map((r: any) => ({
        period: r.period,
        strongBuy: r.strongBuy,
        buy: r.buy,
        hold: r.hold,
        sell: r.sell,
        strongSell: r.strongSell,
      })),
    };
  }

  async getPriceTargets(symbol: string): Promise<any> {
    const data = await this.makeRequest('/stock/price-target', { symbol: symbol.toUpperCase() }, 6 * 60 * 60 * 1000);
    return {
      symbol: symbol.toUpperCase(),
      targetMean: data.targetMean ?? null,
      targetHigh: data.targetHigh ?? null,
      targetLow: data.targetLow ?? null,
      targetMedian: data.targetMedian ?? null,
      lastUpdated: data.lastUpdated ?? null,
    };
  }

  async getPeers(symbol: string): Promise<any> {
    const data = await this.makeRequest('/stock/peers', { symbol: symbol.toUpperCase() }, 6 * 60 * 60 * 1000);
    return {
      symbol: symbol.toUpperCase(),
      peers: Array.isArray(data) ? data.filter((s: any) => s !== symbol.toUpperCase()) : [],
    };
  }

  async searchStock(query: string): Promise<any> {
    const data = await this.makeRequest('/search', { q: query }, 60 * 60 * 1000);
    const results = (data.result || [])
      .map((item: any) => ({
        symbol: item.symbol || item.displaySymbol,
        name: item.description,
        type: item.type,
        region: 'United States',
        currency: 'USD',
        source: 'finnhub',
      }))
      .filter((item: any) => item.symbol);
    return { results };
  }

  async getEarningsHistory(symbol: string): Promise<any> {
    const data = await this.makeRequest('/stock/earnings', { symbol: symbol.toUpperCase() }, 6 * 60 * 60 * 1000);
    const earnings = Array.isArray(data) ? data : [];
    return {
      symbol: symbol.toUpperCase(),
      quarterlyEarnings: earnings.slice(0, 12).map((e: any) => ({
        fiscalQuarter: e.period,
        reportedEPS: e.actual,
        estimatedEPS: e.estimate,
        surprise: e.surprise,
        surprisePercentage: e.surprisePercent,
      })),
    };
  }

  async getIncomeStatement(symbol: string): Promise<any> {
    // /financials-reported is premium (403 on free tier). Use /stock/metric series instead —
    // same request already made by getBasicFinancials so it's a cache hit after the first call.
    const data = await this.makeRequest('/stock/metric', { symbol: symbol.toUpperCase(), metric: 'all' }, 60 * 60 * 1000);
    const ic = (data.series?.quarterly?.ic ?? {}) as Record<string, Array<{ period: string; v: number }>>;
    const rows = this.pivotSeries(ic, 8);
    if (!rows.length) throw new Error('Unavailable via Finnhub: no income statement data');
    return {
      symbol: symbol.toUpperCase(),
      quarterlyReports: rows.map((r) => ({
        fiscalQuarter: r.period ?? null,
        totalRevenue: r.revenue ?? null,
        grossProfit: r.grossProfit ?? null,
        operatingIncome: r.operatingIncome ?? null,
        netIncome: r.netIncome ?? null,
        ebitda: r.ebitda ?? null,
      })),
    };
  }

  async getBalanceSheet(symbol: string): Promise<any> {
    const data = await this.makeRequest('/stock/metric', { symbol: symbol.toUpperCase(), metric: 'all' }, 60 * 60 * 1000);
    const bs = (data.series?.quarterly?.bs ?? {}) as Record<string, Array<{ period: string; v: number }>>;
    const rows = this.pivotSeries(bs, 4);
    if (!rows.length) throw new Error('Unavailable via Finnhub: no balance sheet data');
    return {
      symbol: symbol.toUpperCase(),
      quarterlyReports: rows.map((r) => ({
        fiscalQuarter: r.period ?? null,
        totalAssets: r.totalAssets ?? null,
        totalLiabilities: r.totalLiabilities ?? null,
        totalShareholderEquity: r.totalEquity ?? r.shareholderEquity ?? null,
        cashAndEquivalents: r.cashAndCashEquivalentsAtCarryingValue ?? r.cashAndEquivalents ?? null,
        longTermDebt: r.longTermDebt ?? null,
      })),
    };
  }

  async getCashFlow(symbol: string): Promise<any> {
    const data = await this.makeRequest('/stock/metric', { symbol: symbol.toUpperCase(), metric: 'all' }, 60 * 60 * 1000);
    const cf = (data.series?.quarterly?.cf ?? {}) as Record<string, Array<{ period: string; v: number }>>;
    const rows = this.pivotSeries(cf, 4);
    if (!rows.length) throw new Error('Unavailable via Finnhub: no cash flow data');
    return {
      symbol: symbol.toUpperCase(),
      quarterlyReports: rows.map((r) => {
        const operating = r.netCashProvidedByOperatingActivities ?? r.operatingCashFlow ?? null;
        const capex = r.capitalExpenditures ?? null;
        return {
          fiscalQuarter: r.period ?? null,
          operatingCashflow: operating,
          capitalExpenditures: capex,
          freeCashFlow: r.freeCashFlow ??
            (operating != null && capex != null
              ? (Number(operating) - Math.abs(Number(capex))).toString()
              : null),
          dividendPayout: r.dividendsPaid ?? null,
        };
      }),
    };
  }

  async getSectorPerformance(): Promise<any> {
    throw new Error('Sector performance unavailable via Finnhub');
  }

  async getTopGainersLosers(): Promise<any> {
    throw new Error('Top movers unavailable via Finnhub');
  }

  async getNewsSentiment(symbol: string): Promise<any> {
    const data = await this.makeRequest('/news-sentiment', { symbol: symbol.toUpperCase() }, 15 * 60 * 1000);
    return {
      symbol: symbol.toUpperCase(),
      sentiment: data.sentiment,
      buzz: data.buzz,
      companyNewsScore: data.companyNewsScore,
      sectorAverageBullishPercent: data.sectorAverageBullishPercent,
      sectorAverageNewsScore: data.sectorAverageNewsScore,
    };
  }

  async getCompanyNews(symbol: string, days = 30): Promise<any> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const data = await this.makeRequest('/company-news', {
      symbol: symbol.toUpperCase(),
      from: fmt(from),
      to: fmt(to),
    }, 15 * 60 * 1000);
    const articles = Array.isArray(data) ? data.slice(0, 20) : [];
    return {
      symbol: symbol.toUpperCase(),
      articles: articles.map((a: any) => ({
        datetime: a.datetime ? new Date(a.datetime * 1000).toISOString() : null,
        headline: a.headline,
        source: a.source,
        url: a.url,
        summary: a.summary,
      })),
    };
  }

  async searchNews(_query: string, _days = 30): Promise<any> {
    // Finnhub /news only supports category filtering (general/forex/crypto/merger),
    // not keyword search. Throw a suppressed error rather than returning unrelated results.
    throw new Error('Unavailable via Finnhub: keyword news search not supported');
  }
}

class HybridStockDataService implements StockDataService {
  constructor(
    private primary: StockDataService,
    private fallback: StockDataService
  ) {}

  private async withFallback<T>(primaryCall: () => Promise<T>, fallbackCall: () => Promise<T>): Promise<T> {
    try {
      return await primaryCall();
    } catch {
      const result = await fallbackCall();
      // Tag with source so stockTools correctly attributes Finnhub data in the sources table
      if (result != null && typeof result === 'object' && !Array.isArray(result)) {
        return { ...(result as object), __source: 'Finnhub' } as T;
      }
      return result;
    }
  }

  getStockPrice(symbol: string) {
    return this.withFallback(
      () => this.primary.getStockPrice(symbol),
      () => this.fallback.getStockPrice(symbol)
    );
  }
  getPriceHistory(symbol: string, range?: string) {
    return this.withFallback(
      () => this.primary.getPriceHistory(symbol, range),
      () => this.fallback.getPriceHistory(symbol, range)
    );
  }
  getCompanyOverview(symbol: string) {
    return this.withFallback(
      () => this.primary.getCompanyOverview(symbol),
      () => this.fallback.getCompanyOverview(symbol)
    );
  }
  getBasicFinancials(symbol: string) {
    return this.withFallback(
      () => this.primary.getBasicFinancials(symbol),
      () => this.fallback.getBasicFinancials(symbol)
    );
  }
  getInsiderTrading(symbol: string) {
    return this.withFallback(
      () => this.primary.getInsiderTrading(symbol),
      () => this.fallback.getInsiderTrading(symbol)
    );
  }
  getAnalystRatings(symbol: string) {
    return this.withFallback(
      () => this.primary.getAnalystRatings(symbol),
      () => this.fallback.getAnalystRatings(symbol)
    );
  }
  getAnalystRecommendations(symbol: string) {
    return this.withFallback(
      () => this.primary.getAnalystRecommendations(symbol),
      () => this.fallback.getAnalystRecommendations(symbol)
    );
  }
  getPriceTargets(symbol: string) {
    return this.withFallback(
      () => this.primary.getPriceTargets(symbol),
      () => this.fallback.getPriceTargets(symbol)
    );
  }
  getPeers(symbol: string) {
    return this.withFallback(
      () => this.primary.getPeers(symbol),
      () => this.fallback.getPeers(symbol)
    );
  }
  searchStock(query: string) {
    return this.primary.searchStock(query);
  }
  getEarningsHistory(symbol: string) {
    return this.withFallback(
      () => this.primary.getEarningsHistory(symbol),
      () => this.fallback.getEarningsHistory(symbol)
    );
  }
  getIncomeStatement(symbol: string) {
    return this.withFallback(
      () => this.primary.getIncomeStatement(symbol),
      () => this.fallback.getIncomeStatement(symbol)
    );
  }
  getBalanceSheet(symbol: string) {
    return this.withFallback(
      () => this.primary.getBalanceSheet(symbol),
      () => this.fallback.getBalanceSheet(symbol)
    );
  }
  getCashFlow(symbol: string) {
    return this.withFallback(
      () => this.primary.getCashFlow(symbol),
      () => this.fallback.getCashFlow(symbol)
    );
  }
  getSectorPerformance() {
    return this.primary.getSectorPerformance();
  }
  getTopGainersLosers() {
    return this.primary.getTopGainersLosers();
  }
  getNewsSentiment(symbol: string) {
    return this.primary.getNewsSentiment(symbol);
  }
  getCompanyNews(symbol: string, days?: number) {
    return this.primary.getCompanyNews(symbol, days);
  }
  searchNews(query: string, days?: number) {
    return this.primary.searchNews(query, days);
  }
}

export function createStockService(apiKey?: string): StockDataService {
  const provider = PROVIDER_ENV;
  if (provider === 'finnhub') {
    return new FinnhubService();
  }
  if (provider === 'hybrid') {
    return new HybridStockDataService(new AlphaVantageService(apiKey), new FinnhubService());
  }
  return new AlphaVantageService(apiKey);
}
