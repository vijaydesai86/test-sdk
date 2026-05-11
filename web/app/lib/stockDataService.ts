/* eslint-disable @typescript-eslint/no-explicit-any */
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
    alphavantage: Number(process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS || 1200),
  };

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ALPHA_VANTAGE_API_KEY || '';
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
    if (!this.apiKey) {
      throw new Error('Unavailable via Alpha Vantage: API key not configured');
    }
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
      analystTargetPrice: data.AnalystTargetPrice || null,
      strongBuy: data.AnalystRatingStrongBuy || null,
      buy: data.AnalystRatingBuy || null,
      hold: data.AnalystRatingHold || null,
      sell: data.AnalystRatingSell || null,
      strongSell: data.AnalystRatingStrongSell || null,
      movingAverage50Day: data['50DayMovingAverage'] || null,
      upside: data.AnalystTargetPrice && data['50DayMovingAverage']
        ? `${(((Number(data.AnalystTargetPrice) / Number(data['50DayMovingAverage'])) - 1) * 100).toFixed(1)}% (vs 50-day MA)`
        : null,
    };
  }

  async getAnalystRecommendations(_symbol: string): Promise<any> {
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
  private lastRequestAt = 0;
  private minIntervalMs = Number(process.env.FINNHUB_MIN_INTERVAL_MS || 500);

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.FINNHUB_API_KEY || '';
  }

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const wait = this.minIntervalMs - (now - this.lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }

  private async makeRequest(path: string, params: Record<string, string> = {}, ttlMs = 0): Promise<any> {
    const cacheKey = `finnhub:${path}:${JSON.stringify(params)}`;
    if (ttlMs > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.data;
    }
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
      // 401/403 means the API key lacks access to this endpoint (free-tier plan limitation).
      // Use the "unavailable via Finnhub" phrasing so safeFetch silently suppresses it
      // rather than surfacing it as a user-visible report data gap.
      if (statusCode === 401 || statusCode === 403) {
        throw new Error(`Unavailable via Finnhub (plan limitation: ${statusCode})`);
      }
      // 429 = Finnhub rate limit hit; use a message that isRateLimit() in stockTools
      // will recognise so rateLimitHit is set and remaining fetches are skipped.
      if (statusCode === 429) {
        throw new Error('Finnhub rate limit exceeded (429)');
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
    // Finnhub sometimes returns a 200 OK with an `error` field instead of HTTP 4xx.
    // Treat this as a plan/access limitation so it gets suppressed rather than shown
    // in the report's Data Gaps section.
    if (profile?.error) {
      throw new Error(`Unavailable via Finnhub: ${profile.error}`);
    }
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
      analystTargetPrice: target.targetMean ?? null,
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

export class TwelveDataService implements StockDataService {
  private apiKey: string;
  private baseUrl = 'https://api.twelvedata.com';
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private lastRequestAt = 0;
  private minIntervalMs = Number(process.env.TWELVE_DATA_MIN_INTERVAL_MS || 800);

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.TWELVE_DATA_API_KEY || '';
  }

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const wait = this.minIntervalMs - (now - this.lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }

  private async makeRequest(path: string, params: Record<string, string> = {}, ttlMs = 0): Promise<any> {
    if (!this.apiKey) {
      throw new Error('Unavailable via Twelve Data: API key not configured');
    }
    const cacheKey = `twelvedata:${path}:${JSON.stringify(params)}`;
    if (ttlMs > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.data;
    }
    await this.throttle();
    try {
      const response = await axios.get(`${this.baseUrl}${path}`, {
        params: { ...params, apikey: this.apiKey },
        timeout: 10000,
      });
      const data = response.data;
      if (data?.status === 'error') {
        throw new Error(data?.message || 'Unknown Twelve Data error');
      }
      if (ttlMs > 0) this.cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, data });
      return data;
    } catch (error: any) {
      const statusCode = error?.response?.status;
      if (statusCode === 401 || statusCode === 403) {
        throw new Error(`Unavailable via Twelve Data (plan limitation: ${statusCode})`);
      }
      if (statusCode === 429) {
        throw new Error('Twelve Data rate limit exceeded (429)');
      }
      throw new Error(`Twelve Data request failed: ${error.message}`);
    }
  }

  async getStockPrice(symbol: string): Promise<any> {
    const data = await this.makeRequest('/quote', { symbol: symbol.toUpperCase() }, 30000);
    if (!data?.price) {
      throw new Error('Unavailable via Twelve Data: no stock price data');
    }
    return {
      symbol: data.symbol || symbol.toUpperCase(),
      price: data.price,
      change: data.change,
      changePercent: data.percent_change ? `${data.percent_change}%` : 'N/A',
      volume: data.volume,
      latestTradingDay: data.datetime,
    };
  }

  async getPriceHistory(symbol: string, range = '1y'): Promise<any> {
    const lower = range.toLowerCase();
    const days = (() => {
      if (lower.includes('1w')) return 7;
      if (lower.includes('1m')) return 30;
      if (lower.includes('3m')) return 90;
      if (lower.includes('6m')) return 180;
      if (lower.includes('1y') || lower === 'daily') return 365;
      if (lower.includes('3y')) return 365 * 3;
      if (lower.includes('5y')) return 365 * 5;
      if (lower.includes('max')) return 5000;
      return 365;
    })();
    const outputsize = Math.min(Math.max(days, 30), 5000);
    const data = await this.makeRequest(
      '/time_series',
      { symbol: symbol.toUpperCase(), interval: '1day', outputsize: outputsize.toString() },
      60 * 60 * 1000
    );
    const values = Array.isArray(data?.values) ? data.values : [];
    if (values.length === 0) {
      throw new Error('Unavailable via Twelve Data: price history not available');
    }
    return {
      symbol: symbol.toUpperCase(),
      prices: values.map((item: any) => ({
        date: item.datetime,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
      })),
    };
  }

  async getCompanyOverview(symbol: string): Promise<any> {
    const data = await this.makeRequest('/profile', { symbol: symbol.toUpperCase() }, 6 * 60 * 60 * 1000);
    if (!data?.name) {
      throw new Error('Unavailable via Twelve Data: company profile not found');
    }
    return {
      symbol: data.symbol || symbol.toUpperCase(),
      name: data.name,
      description: data.description,
      sector: data.sector,
      industry: data.industry,
      marketCapitalization: data.market_cap,
      eps: data.eps,
      peRatio: data.pe,
      beta: data.beta,
      dividendYield: data.dividend_yield,
      sharesOutstanding: data.shares_outstanding,
    };
  }

  async getBasicFinancials(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Twelve Data: basic financials not supported');
  }

  async getInsiderTrading(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Twelve Data: insider trading not supported');
  }

  async getAnalystRatings(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Twelve Data: analyst ratings not supported');
  }

  async getAnalystRecommendations(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Twelve Data: analyst recommendations not supported');
  }

  async getPriceTargets(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Twelve Data: price targets not supported');
  }

  async getPeers(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Twelve Data: peer data not supported');
  }

  async searchStock(query: string): Promise<any> {
    const data = await this.makeRequest('/symbol_search', { symbol: query }, 60 * 60 * 1000);
    const matches = Array.isArray(data?.data) ? data.data : [];
    if (!matches.length) {
      throw new Error('Unavailable via Twelve Data: no matches found');
    }
    const results = matches.map((item: any) => ({
      symbol: item.symbol,
      name: item.instrument_name,
      type: item.instrument_type,
      region: item.country,
      currency: item.currency,
      exchange: item.exchange,
      source: 'twelvedata',
    }));
    return { results };
  }

  async getEarningsHistory(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Twelve Data: earnings history not supported');
  }

  async getIncomeStatement(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Twelve Data: income statement not supported');
  }

  async getBalanceSheet(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Twelve Data: balance sheet not supported');
  }

  async getCashFlow(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Twelve Data: cash flow not supported');
  }

  async getSectorPerformance(): Promise<any> {
    throw new Error('Unavailable via Twelve Data: sector performance not supported');
  }

  async getTopGainersLosers(): Promise<any> {
    throw new Error('Unavailable via Twelve Data: market movers not supported');
  }

  async getNewsSentiment(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Twelve Data: news sentiment not supported');
  }

  async getCompanyNews(_symbol: string, _days = 30): Promise<any> {
    throw new Error('Unavailable via Twelve Data: company news not supported');
  }

  async searchNews(_query: string, _days = 30): Promise<any> {
    throw new Error('Unavailable via Twelve Data: news search not supported');
  }
}

export class FinancialModelingPrepService implements StockDataService {
  private apiKey: string;
  private baseUrl = 'https://financialmodelingprep.com/api/v3';
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private lastRequestAt = 0;
  private minIntervalMs = Number(process.env.FMP_MIN_INTERVAL_MS || 800);

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.FINANCIAL_MODELING_PREP_API_KEY || '';
  }

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const wait = this.minIntervalMs - (now - this.lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }

  private async makeRequest(path: string, params: Record<string, string> = {}, ttlMs = 0): Promise<any> {
    if (!this.apiKey) {
      throw new Error('Unavailable via Financial Modeling Prep: API key not configured');
    }
    const cacheKey = `fmp:${path}:${JSON.stringify(params)}`;
    if (ttlMs > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.data;
    }
    await this.throttle();
    try {
      const response = await axios.get(`${this.baseUrl}${path}`, {
        params: { ...params, apikey: this.apiKey },
        timeout: 10000,
      });
      const data = response.data;
      const errorMessage = data?.['Error Message'] || data?.error || data?.message;
      if (errorMessage) {
        throw new Error(errorMessage);
      }
      if (ttlMs > 0) this.cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, data });
      return data;
    } catch (error: any) {
      const statusCode = error?.response?.status;
      if (statusCode === 401 || statusCode === 403) {
        throw new Error(`Unavailable via Financial Modeling Prep (plan limitation: ${statusCode})`);
      }
      if (statusCode === 429) {
        throw new Error('Financial Modeling Prep rate limit exceeded (429)');
      }
      throw new Error(`Financial Modeling Prep request failed: ${error.message}`);
    }
  }

  async getStockPrice(symbol: string): Promise<any> {
    const data = await this.makeRequest(`/quote/${symbol.toUpperCase()}`, {}, 30000);
    const quote = Array.isArray(data) ? data[0] : null;
    if (!quote?.price) {
      throw new Error('Unavailable via Financial Modeling Prep: no stock price data');
    }
    return {
      symbol: quote.symbol || symbol.toUpperCase(),
      price: quote.price?.toString(),
      change: quote.change?.toString(),
      changePercent: quote.changesPercentage ? `${Number(quote.changesPercentage).toFixed(2)}%` : 'N/A',
      volume: quote.volume?.toString(),
      latestTradingDay: quote.timestamp ? new Date(quote.timestamp * 1000).toISOString() : undefined,
      high: quote.dayHigh?.toString(),
      low: quote.dayLow?.toString(),
      open: quote.open?.toString(),
      previousClose: quote.previousClose?.toString(),
    };
  }

  async getPriceHistory(symbol: string, range = '1y'): Promise<any> {
    const lower = range.toLowerCase();
    const days = (() => {
      if (lower.includes('1w')) return 7;
      if (lower.includes('1m')) return 30;
      if (lower.includes('3m')) return 90;
      if (lower.includes('6m')) return 180;
      if (lower.includes('1y') || lower === 'daily') return 365;
      if (lower.includes('3y')) return 365 * 3;
      if (lower.includes('5y')) return 365 * 5;
      if (lower.includes('max')) return 5000;
      return 365;
    })();
    const timeseries = Math.min(Math.max(days, 30), 5000);
    const data = await this.makeRequest(
      `/historical-price-full/${symbol.toUpperCase()}`,
      { timeseries: timeseries.toString() },
      60 * 60 * 1000
    );
    const historical = Array.isArray(data?.historical) ? data.historical : [];
    if (!historical.length) {
      throw new Error('Unavailable via Financial Modeling Prep: price history not available');
    }
    return {
      symbol: symbol.toUpperCase(),
      prices: historical.map((item: any) => ({
        date: item.date,
        open: item.open?.toString(),
        high: item.high?.toString(),
        low: item.low?.toString(),
        close: item.close?.toString(),
        volume: item.volume?.toString(),
      })),
    };
  }

  async getCompanyOverview(symbol: string): Promise<any> {
    const data = await this.makeRequest(`/profile/${symbol.toUpperCase()}`, {}, 6 * 60 * 60 * 1000);
    const profile = Array.isArray(data) ? data[0] : null;
    if (!profile?.companyName) {
      throw new Error('Unavailable via Financial Modeling Prep: company profile not found');
    }
    return {
      symbol: profile.symbol || symbol.toUpperCase(),
      name: profile.companyName,
      description: profile.description,
      sector: profile.sector,
      industry: profile.industry,
      marketCapitalization: profile.mktCap?.toString(),
      eps: profile.eps?.toString(),
      peRatio: profile.pe?.toString(),
      beta: profile.beta?.toString(),
      dividendYield: profile.lastDiv?.toString(),
      '52WeekHigh': profile.range ? profile.range.split('-')[1]?.trim() : undefined,
      '52WeekLow': profile.range ? profile.range.split('-')[0]?.trim() : undefined,
      sharesOutstanding: profile.sharesOutstanding?.toString(),
      returnOnEquity: profile.roe?.toString(),
    };
  }

  async getBasicFinancials(symbol: string): Promise<any> {
    const data = await this.makeRequest(`/key-metrics-ttm/${symbol.toUpperCase()}`, {}, 6 * 60 * 60 * 1000);
    const metrics = Array.isArray(data) ? data[0] : null;
    if (!metrics) {
      throw new Error('Unavailable via Financial Modeling Prep: key metrics not found');
    }
    return {
      symbol: symbol.toUpperCase(),
      metric: {
        peBasicExclExtraTTM: metrics.peRatioTTM ?? metrics.peRatio,
        epsTTM: metrics.epsTTM ?? metrics.eps,
        revenueGrowthTTM: metrics.revenueGrowthTTM ?? metrics.revenueGrowth,
        epsGrowthTTM: metrics.epsGrowthTTM ?? metrics.epsGrowth,
        grossMarginTTM: metrics.grossMarginTTM ?? metrics.grossProfitMarginTTM,
        operatingMarginTTM: metrics.operatingMarginTTM ?? metrics.operatingProfitMarginTTM,
        roeTTM: metrics.roeTTM ?? metrics.returnOnEquityTTM,
        revenuePerShareTTM: metrics.revenuePerShareTTM,
      },
      series: {},
    };
  }

  async getInsiderTrading(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Financial Modeling Prep: insider trading not supported');
  }

  async getAnalystRatings(symbol: string): Promise<any> {
    const data = await this.makeRequest(`/rating/${symbol.toUpperCase()}`, {}, 6 * 60 * 60 * 1000);
    if (!data?.rating && !data?.ratingScore) {
      throw new Error('Unavailable via Financial Modeling Prep: analyst rating not found');
    }
    return {
      symbol: symbol.toUpperCase(),
      rating: data.rating,
      ratingScore: data.ratingScore,
      ratingRecommendation: data.ratingRecommendation,
    };
  }

  async getAnalystRecommendations(symbol: string): Promise<any> {
    const data = await this.makeRequest(`/analyst-stock-recommendations/${symbol.toUpperCase()}`, {}, 6 * 60 * 60 * 1000);
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Unavailable via Financial Modeling Prep: analyst recommendations not found');
    }
    return {
      symbol: symbol.toUpperCase(),
      recommendations: data.slice(0, 8).map((row: any) => ({
        period: row.period,
        buy: row.analystRatingsbuy ?? row.buy,
        hold: row.analystRatingsHold ?? row.hold,
        sell: row.analystRatingsSell ?? row.sell,
        strongBuy: row.analystRatingsStrongBuy ?? row.strongBuy,
        strongSell: row.analystRatingsStrongSell ?? row.strongSell,
      })),
    };
  }

  async getPriceTargets(symbol: string): Promise<any> {
    const data = await this.makeRequest(`/price-target/${symbol.toUpperCase()}`, {}, 6 * 60 * 60 * 1000);
    const target = Array.isArray(data) ? data[0] : null;
    if (!target?.targetConsensus && !target?.targetMean) {
      throw new Error('Unavailable via Financial Modeling Prep: price target data not found');
    }
    return {
      symbol: symbol.toUpperCase(),
      targetHigh: target.targetHigh,
      targetLow: target.targetLow,
      targetMedian: target.targetMedian,
      targetMean: target.targetConsensus ?? target.targetMean,
      updatedDate: target.updatedDate,
    };
  }

  async getPeers(symbol: string): Promise<any> {
    const data = await this.makeRequest('/stock_peers', { symbol: symbol.toUpperCase() }, 6 * 60 * 60 * 1000);
    const peers = Array.isArray(data?.peersList) ? data.peersList : [];
    if (!peers.length) {
      throw new Error('Unavailable via Financial Modeling Prep: peer list not found');
    }
    return {
      symbol: symbol.toUpperCase(),
      peers,
    };
  }

  async searchStock(query: string): Promise<any> {
    const data = await this.makeRequest('/search', { query, limit: '10' }, 60 * 60 * 1000);
    const results = Array.isArray(data)
      ? data.map((item: any) => ({
        symbol: item.symbol,
        name: item.name,
        exchange: item.exchangeShortName,
        type: item.type,
        source: 'fmp',
      }))
      : [];
    if (!results.length) {
      throw new Error('Unavailable via Financial Modeling Prep: no matches found');
    }
    return { results };
  }

  async getEarningsHistory(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Financial Modeling Prep: earnings history not supported');
  }

  private async fetchStatement(symbol: string, path: string, period: 'annual' | 'quarter'): Promise<any[]> {
    const params: Record<string, string> = { limit: '5' };
    if (period === 'quarter') {
      params.period = 'quarter';
    }
    const data = await this.makeRequest(`${path}/${symbol.toUpperCase()}`, params, 6 * 60 * 60 * 1000);
    return Array.isArray(data) ? data : [];
  }

  async getIncomeStatement(symbol: string): Promise<any> {
    const annual = await this.fetchStatement(symbol, '/income-statement', 'annual');
    const quarterly = await this.fetchStatement(symbol, '/income-statement', 'quarter');
    if (!annual.length && !quarterly.length) {
      throw new Error('Unavailable via Financial Modeling Prep: no income statement data');
    }
    return {
      symbol: symbol.toUpperCase(),
      annualReports: annual.slice(0, 5).map((r: any) => ({
        fiscalYear: r.date,
        totalRevenue: r.revenue?.toString(),
        grossProfit: r.grossProfit?.toString(),
        operatingIncome: r.operatingIncome?.toString(),
        netIncome: r.netIncome?.toString(),
        ebitda: r.ebitda?.toString(),
      })),
      quarterlyReports: quarterly.slice(0, 8).map((r: any) => ({
        fiscalQuarter: r.date,
        totalRevenue: r.revenue?.toString(),
        grossProfit: r.grossProfit?.toString(),
        operatingIncome: r.operatingIncome?.toString(),
        netIncome: r.netIncome?.toString(),
        ebitda: r.ebitda?.toString(),
      })),
    };
  }

  async getBalanceSheet(symbol: string): Promise<any> {
    const annual = await this.fetchStatement(symbol, '/balance-sheet-statement', 'annual');
    const quarterly = await this.fetchStatement(symbol, '/balance-sheet-statement', 'quarter');
    if (!annual.length && !quarterly.length) {
      throw new Error('Unavailable via Financial Modeling Prep: no balance sheet data');
    }
    return {
      symbol: symbol.toUpperCase(),
      annualReports: annual.slice(0, 5).map((r: any) => ({
        fiscalYear: r.date,
        totalAssets: r.totalAssets?.toString(),
        totalLiabilities: r.totalLiabilities?.toString(),
        totalShareholderEquity: r.totalStockholdersEquity?.toString(),
        cashAndEquivalents: r.cashAndCashEquivalents?.toString(),
        longTermDebt: r.longTermDebt?.toString(),
      })),
      quarterlyReports: quarterly.slice(0, 8).map((r: any) => ({
        fiscalQuarter: r.date,
        totalAssets: r.totalAssets?.toString(),
        totalLiabilities: r.totalLiabilities?.toString(),
        totalShareholderEquity: r.totalStockholdersEquity?.toString(),
        cashAndEquivalents: r.cashAndCashEquivalents?.toString(),
        longTermDebt: r.longTermDebt?.toString(),
      })),
    };
  }

  async getCashFlow(symbol: string): Promise<any> {
    const annual = await this.fetchStatement(symbol, '/cash-flow-statement', 'annual');
    const quarterly = await this.fetchStatement(symbol, '/cash-flow-statement', 'quarter');
    if (!annual.length && !quarterly.length) {
      throw new Error('Unavailable via Financial Modeling Prep: no cash flow data');
    }
    return {
      symbol: symbol.toUpperCase(),
      quarterlyReports: quarterly.slice(0, 4).map((r: any) => ({
        fiscalQuarter: r.date,
        operatingCashflow: r.netCashProvidedByOperatingActivities?.toString(),
        capitalExpenditures: r.capitalExpenditure?.toString(),
        freeCashFlow: r.freeCashFlow?.toString(),
        dividendPayout: r.dividendsPaid?.toString(),
      })),
      annualReports: annual.slice(0, 5).map((r: any) => ({
        fiscalYear: r.date,
        operatingCashflow: r.netCashProvidedByOperatingActivities?.toString(),
        capitalExpenditures: r.capitalExpenditure?.toString(),
        freeCashFlow: r.freeCashFlow?.toString(),
        dividendPayout: r.dividendsPaid?.toString(),
      })),
    };
  }

  async getSectorPerformance(): Promise<any> {
    const data = await this.makeRequest('/sector-performance', {}, 15 * 60 * 1000);
    if (!Array.isArray(data)) {
      throw new Error('Unavailable via Financial Modeling Prep: sector performance not found');
    }
    const performance: Record<string, string> = {};
    for (const row of data) {
      if (row.sector && row.changesPercentage) {
        performance[row.sector] = row.changesPercentage;
      }
    }
    return {
      realTimePerformance: performance,
    };
  }

  async getTopGainersLosers(): Promise<any> {
    const [gainers, losers, actives] = await Promise.all([
      this.makeRequest('/stock_market/gainers', {}, 5 * 60 * 1000),
      this.makeRequest('/stock_market/losers', {}, 5 * 60 * 1000),
      this.makeRequest('/stock_market/actives', {}, 5 * 60 * 1000),
    ]);
    if (!Array.isArray(gainers) && !Array.isArray(losers) && !Array.isArray(actives)) {
      throw new Error('Unavailable via Financial Modeling Prep: top movers not found');
    }
    const mapRows = (rows: any[]) => rows.slice(0, 10).map((row: any) => ({
      ticker: row.ticker || row.symbol,
      price: row.price?.toString(),
      changeAmount: row.changes?.toString(),
      changePercentage: row.changesPercentage?.toString(),
      volume: row.volume?.toString(),
    }));
    return {
      topGainers: Array.isArray(gainers) ? mapRows(gainers) : [],
      topLosers: Array.isArray(losers) ? mapRows(losers) : [],
      mostActive: Array.isArray(actives) ? mapRows(actives) : [],
    };
  }

  async getNewsSentiment(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Financial Modeling Prep: news sentiment not supported');
  }

  async getCompanyNews(symbol: string, days = 30): Promise<any> {
    const data = await this.makeRequest('/stock_news', { tickers: symbol.toUpperCase(), limit: '20' }, 15 * 60 * 1000);
    const articles = Array.isArray(data) ? data : [];
    if (!articles.length) {
      throw new Error('Unavailable via Financial Modeling Prep: company news not found');
    }
    return {
      symbol: symbol.toUpperCase(),
      articles: articles.map((item: any) => ({
        datetime: item.publishedDate || item.date,
        headline: item.title,
        source: item.site,
        url: item.url,
        summary: item.text,
      })),
    };
  }

  async searchNews(query: string, _days = 30): Promise<any> {
    const data = await this.makeRequest('/stock_news', { limit: '50' }, 15 * 60 * 1000);
    const articles = Array.isArray(data) ? data : [];
    const filtered = articles.filter((item: any) =>
      String(item.title || '').toLowerCase().includes(query.toLowerCase()) ||
      String(item.text || '').toLowerCase().includes(query.toLowerCase())
    );
    if (!filtered.length) {
      throw new Error('Unavailable via Financial Modeling Prep: news search returned no results');
    }
    return {
      query,
      articles: filtered.slice(0, 20).map((item: any) => ({
        datetime: item.publishedDate || item.date,
        headline: item.title,
        source: item.site,
        url: item.url,
        summary: item.text,
      })),
    };
  }
}

export class StooqService implements StockDataService {
  private baseUrl = 'https://stooq.com';
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private lastRequestAt = 0;
  private minIntervalMs = Number(process.env.STOOQ_MIN_INTERVAL_MS || 800);

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const wait = this.minIntervalMs - (now - this.lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }

  private async makeRequest(path: string, ttlMs = 0): Promise<string> {
    const cacheKey = `stooq:${path}`;
    if (ttlMs > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.data;
    }
    await this.throttle();
    try {
      const response = await axios.get(`${this.baseUrl}${path}`, {
        timeout: 10000,
        responseType: 'text',
      });
      const data = response.data as string;
      if (ttlMs > 0) this.cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, data });
      return data;
    } catch (error: any) {
      const statusCode = error?.response?.status;
      if (statusCode === 429) {
        throw new Error('Stooq rate limit exceeded (429)');
      }
      throw new Error(`Stooq request failed: ${error.message}`);
    }
  }

  private parseCsvRows(csv: string): string[][] {
    return csv
      .trim()
      .split('\n')
      .map((line) => line.split(',').map((value) => value.trim()))
      .filter((row) => row.length > 1);
  }

  async getStockPrice(symbol: string): Promise<any> {
    const tick = symbol.toLowerCase();
    const csv = await this.makeRequest(`/q/l/?s=${tick}.us&f=sd2t2ohlcv&h&e=csv`, 30000);
    const rows = this.parseCsvRows(csv);
    if (rows.length < 2) {
      throw new Error('Unavailable via Stooq: stock price not found');
    }
    const [
      rowSymbol,
      date,
      time,
      open,
      high,
      low,
      close,
      volume,
    ] = rows[1];
    if (!rowSymbol || rowSymbol === 'N/A') {
      throw new Error('Unavailable via Stooq: stock price not found');
    }
    const openVal = Number(open);
    const closeVal = Number(close);
    const change = Number.isFinite(openVal) && Number.isFinite(closeVal)
      ? (closeVal - openVal).toFixed(2)
      : undefined;
    const changePercent = Number.isFinite(openVal) && openVal !== 0 && Number.isFinite(closeVal)
      ? `${(((closeVal - openVal) / openVal) * 100).toFixed(2)}%`
      : undefined;
    return {
      symbol: symbol.toUpperCase(),
      price: close,
      change,
      changePercent,
      volume,
      latestTradingDay: date ? `${date} ${time || ''}`.trim() : undefined,
      high,
      low,
      open,
    };
  }

  async getPriceHistory(symbol: string, range = '1y'): Promise<any> {
    const tick = symbol.toLowerCase();
    const csv = await this.makeRequest(`/q/d/l/?s=${tick}.us&i=d`, 60 * 60 * 1000);
    const rows = this.parseCsvRows(csv);
    if (rows.length < 2) {
      throw new Error('Unavailable via Stooq: price history not available');
    }
    const headers = rows[0];
    const dataRows = rows.slice(1);
    const lower = range.toLowerCase();
    const days = (() => {
      if (lower.includes('1w')) return 7;
      if (lower.includes('1m')) return 30;
      if (lower.includes('3m')) return 90;
      if (lower.includes('6m')) return 180;
      if (lower.includes('1y') || lower === 'daily') return 365;
      if (lower.includes('3y')) return 365 * 3;
      if (lower.includes('5y')) return 365 * 5;
      if (lower.includes('max')) return null;
      return 365;
    })();
    const cutoff = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
    const prices = dataRows
      .filter((row) => row.length >= headers.length)
      .map((row) => ({
        date: row[0],
        open: row[1],
        high: row[2],
        low: row[3],
        close: row[4],
        volume: row[5],
      }))
      .filter((row) => {
        if (!cutoff) return true;
        const parsed = new Date(row.date);
        return !Number.isNaN(parsed.getTime()) && parsed >= cutoff;
      });
    if (!prices.length) {
      throw new Error('Unavailable via Stooq: price history not available');
    }
    return { symbol: symbol.toUpperCase(), prices };
  }

  async getCompanyOverview(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Stooq: company overview not supported');
  }

  async getBasicFinancials(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Stooq: basic financials not supported');
  }

  async getInsiderTrading(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Stooq: insider trading not supported');
  }

  async getAnalystRatings(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Stooq: analyst ratings not supported');
  }

  async getAnalystRecommendations(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Stooq: analyst recommendations not supported');
  }

  async getPriceTargets(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Stooq: price targets not supported');
  }

  async getPeers(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Stooq: peers not supported');
  }

  async searchStock(_query: string): Promise<any> {
    throw new Error('Unavailable via Stooq: symbol search not supported');
  }

  async getEarningsHistory(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Stooq: earnings history not supported');
  }

  async getIncomeStatement(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Stooq: income statement not supported');
  }

  async getBalanceSheet(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Stooq: balance sheet not supported');
  }

  async getCashFlow(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Stooq: cash flow not supported');
  }

  async getSectorPerformance(): Promise<any> {
    throw new Error('Unavailable via Stooq: sector performance not supported');
  }

  async getTopGainersLosers(): Promise<any> {
    throw new Error('Unavailable via Stooq: market movers not supported');
  }

  async getNewsSentiment(_symbol: string): Promise<any> {
    throw new Error('Unavailable via Stooq: news sentiment not supported');
  }

  async getCompanyNews(_symbol: string, _days = 30): Promise<any> {
    throw new Error('Unavailable via Stooq: company news not supported');
  }

  async searchNews(_query: string, _days = 30): Promise<any> {
    throw new Error('Unavailable via Stooq: news search not supported');
  }
}

type ProviderId = 'alphavantage' | 'finnhub' | 'fmp' | 'twelvedata' | 'stooq';
const PROVIDER_LABELS: Record<ProviderId, string> = {
  alphavantage: 'Alpha Vantage',
  finnhub: 'Finnhub',
  fmp: 'Financial Modeling Prep',
  twelvedata: 'Twelve Data',
  stooq: 'Stooq',
};

const METHOD_PROVIDER_PRIORITY: Partial<Record<keyof StockDataService, ProviderId[]>> = {
  getStockPrice: ['finnhub', 'fmp', 'twelvedata', 'alphavantage', 'stooq'],
  getPriceHistory: ['finnhub', 'fmp', 'twelvedata', 'alphavantage', 'stooq'],
  getCompanyOverview: ['fmp', 'alphavantage', 'finnhub', 'twelvedata', 'stooq'],
  getBasicFinancials: ['fmp', 'finnhub', 'alphavantage', 'twelvedata', 'stooq'],
  getAnalystRatings: ['finnhub', 'alphavantage', 'fmp', 'twelvedata', 'stooq'],
  getAnalystRecommendations: ['finnhub', 'fmp', 'alphavantage', 'twelvedata', 'stooq'],
  getPriceTargets: ['finnhub', 'fmp', 'alphavantage', 'twelvedata', 'stooq'],
  getPeers: ['finnhub', 'fmp', 'alphavantage', 'twelvedata', 'stooq'],
  searchStock: ['alphavantage', 'finnhub', 'fmp', 'twelvedata', 'stooq'],
  getEarningsHistory: ['finnhub', 'alphavantage', 'fmp', 'twelvedata', 'stooq'],
  getIncomeStatement: ['fmp', 'finnhub', 'alphavantage', 'twelvedata', 'stooq'],
  getBalanceSheet: ['fmp', 'finnhub', 'alphavantage', 'twelvedata', 'stooq'],
  getCashFlow: ['fmp', 'finnhub', 'alphavantage', 'twelvedata', 'stooq'],
  getNewsSentiment: ['finnhub', 'alphavantage', 'fmp', 'twelvedata', 'stooq'],
  getCompanyNews: ['finnhub', 'fmp', 'alphavantage', 'twelvedata', 'stooq'],
  searchNews: ['fmp', 'finnhub', 'alphavantage', 'twelvedata', 'stooq'],
};

const MERGEABLE_METHODS = new Set<keyof StockDataService>([
  'getCompanyOverview',
  'getBasicFinancials',
  'getIncomeStatement',
  'getBalanceSheet',
  'getCashFlow',
]);

function hasMeaningfulValue(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '' && value !== 'N/A';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some((entry) => hasMeaningfulValue(entry));
  return true;
}

function mergeProviderPayload(base: any, incoming: any): any {
  if (base === null || base === undefined) return incoming;
  if (incoming === null || incoming === undefined) return base;
  if (Array.isArray(base) || Array.isArray(incoming)) {
    return hasMeaningfulValue(base) ? base : incoming;
  }
  if (typeof base !== 'object' || typeof incoming !== 'object') {
    return hasMeaningfulValue(base) ? base : incoming;
  }

  const merged: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === '__source') continue;
    if (!(key in merged) || !hasMeaningfulValue(merged[key])) {
      merged[key] = value;
      continue;
    }
    if (typeof merged[key] === 'object' && typeof value === 'object' && !Array.isArray(merged[key]) && !Array.isArray(value)) {
      merged[key] = mergeProviderPayload(merged[key], value);
    }
  }
  return merged;
}

class MultiSourceStockDataService implements StockDataService {
  private disabledProviders = new Map<ProviderId, { until: number; reason: string }>();
  private cooldownMs = Number(process.env.STOCK_PROVIDER_COOLDOWN_MS || 5 * 60 * 1000);

  constructor(private providers: Array<{ id: ProviderId; service: StockDataService }>) {}

  private isDisabled(providerId: ProviderId): boolean {
    const entry = this.disabledProviders.get(providerId);
    if (!entry) return false;
    if (entry.until <= Date.now()) {
      this.disabledProviders.delete(providerId);
      return false;
    }
    return true;
  }

  private markDisabled(providerId: ProviderId, reason: string) {
    this.disabledProviders.set(providerId, { until: Date.now() + this.cooldownMs, reason });
  }

  private shouldDisable(message: string): boolean {
    return /rate limit|429|too many requests|quota|forbidden|unauthorized|api key|plan limitation/i.test(message);
  }

  private getOrderedProviders(method: keyof StockDataService) {
    const priority = METHOD_PROVIDER_PRIORITY[method] || [];
    const rank = new Map(priority.map((id, index) => [id, index]));
    return [...this.providers].sort((a, b) => {
      const aRank = rank.has(a.id) ? (rank.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
      const bRank = rank.has(b.id) ? (rank.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    });
  }

  private async callProviders<T>(method: keyof StockDataService, args: any[]): Promise<T> {
    let lastError: any;
    let mergedResult: any = null;
    let mergeSources: string[] = [];
    let mergeCount = 0;
    for (const provider of this.getOrderedProviders(method)) {
      if (this.isDisabled(provider.id)) continue;
      try {
        const result = await (provider.service[method] as (...params: any[]) => Promise<T>)(...args);
        const labeledResult = result && typeof result === 'object' && !Array.isArray(result)
          ? { ...(result as object), __source: PROVIDER_LABELS[provider.id] } as T
          : result;
        if (!MERGEABLE_METHODS.has(method)) {
          return labeledResult;
        }
        mergedResult = mergeProviderPayload(mergedResult, labeledResult);
        mergeSources.push(PROVIDER_LABELS[provider.id]);
        mergeCount += 1;
        if (mergeCount >= 2) {
          break;
        }
      } catch (error: any) {
        lastError = error;
        const message = error?.message || 'Unavailable';
        if (this.shouldDisable(message)) {
          this.markDisabled(provider.id, message);
        }
      }
    }
    if (mergedResult && typeof mergedResult === 'object' && !Array.isArray(mergedResult)) {
      return {
        ...mergedResult,
        __source: mergeSources.length > 1 ? `Composite (${mergeSources.join(' + ')})` : mergeSources[0] || 'Multi-source',
      } as T;
    }
    throw lastError || new Error('All providers unavailable');
  }

  getStockPrice(symbol: string) {
    return this.callProviders('getStockPrice', [symbol]);
  }
  getPriceHistory(symbol: string, range?: string) {
    return this.callProviders('getPriceHistory', [symbol, range]);
  }
  getCompanyOverview(symbol: string) {
    return this.callProviders('getCompanyOverview', [symbol]);
  }
  getBasicFinancials(symbol: string) {
    return this.callProviders('getBasicFinancials', [symbol]);
  }
  getInsiderTrading(symbol: string) {
    return this.callProviders('getInsiderTrading', [symbol]);
  }
  getAnalystRatings(symbol: string) {
    return this.callProviders('getAnalystRatings', [symbol]);
  }
  getAnalystRecommendations(symbol: string) {
    return this.callProviders('getAnalystRecommendations', [symbol]);
  }
  getPriceTargets(symbol: string) {
    return this.callProviders('getPriceTargets', [symbol]);
  }
  getPeers(symbol: string) {
    return this.callProviders('getPeers', [symbol]);
  }
  searchStock(query: string) {
    return this.callProviders('searchStock', [query]);
  }
  getEarningsHistory(symbol: string) {
    return this.callProviders('getEarningsHistory', [symbol]);
  }
  getIncomeStatement(symbol: string) {
    return this.callProviders('getIncomeStatement', [symbol]);
  }
  getBalanceSheet(symbol: string) {
    return this.callProviders('getBalanceSheet', [symbol]);
  }
  getCashFlow(symbol: string) {
    return this.callProviders('getCashFlow', [symbol]);
  }
  getSectorPerformance() {
    return this.callProviders('getSectorPerformance', []);
  }
  getTopGainersLosers() {
    return this.callProviders('getTopGainersLosers', []);
  }
  getNewsSentiment(symbol: string) {
    return this.callProviders('getNewsSentiment', [symbol]);
  }
  getCompanyNews(symbol: string, days?: number) {
    return this.callProviders('getCompanyNews', [symbol, days]);
  }
  searchNews(query: string, days?: number) {
    return this.callProviders('searchNews', [query, days]);
  }
}




export function createStockService(apiKey?: string): StockDataService {
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const fmpKey = process.env.FINANCIAL_MODELING_PREP_API_KEY;
  const twelveKey = process.env.TWELVE_DATA_API_KEY;
  const providers: Array<{ id: ProviderId; service: StockDataService }> = [];
  if (apiKey || process.env.ALPHA_VANTAGE_API_KEY) {
    providers.push({ id: 'alphavantage', service: new AlphaVantageService(apiKey) });
  }
  if (finnhubKey) {
    providers.push({ id: 'finnhub', service: new FinnhubService(finnhubKey) });
  }
  if (fmpKey) {
    providers.push({ id: 'fmp', service: new FinancialModelingPrepService(fmpKey) });
  }
  if (twelveKey) {
    providers.push({ id: 'twelvedata', service: new TwelveDataService(twelveKey) });
  }
  providers.push({ id: 'stooq', service: new StooqService() });
  return new MultiSourceStockDataService(providers);
}

// ────────────────────────────────────────────────────────────────────────────
// Standalone services — NOT part of the StockDataService interface.
// Instantiated on-demand in executeTool (stockTools.ts).
// ────────────────────────────────────────────────────────────────────────────

/**
 * SEC EDGAR service — free, no API key required.
 * Rate limit: 10 requests/second (use User-Agent header as required by SEC).
 * Docs: https://www.sec.gov/search-filings/efts/efts-documentation
 */
export class SecEdgarService {
  private baseUrl = 'https://efts.sec.gov/LATEST';
  private edgarBaseUrl = 'https://data.sec.gov';
  private userAgent = 'StockResearchBot/1.0 (stock-research-tool)';

  /**
   * Search for a company's CIK (Central Index Key) by ticker symbol.
   * Uses the SEC company tickers JSON endpoint which maps tickers to CIKs.
   */
  async getCIK(ticker: string): Promise<{ cik: string; name: string } | null> {
    try {
      // Use SEC's full-text search to find CIK by ticker
      const searchResp = await axios.get(`${this.baseUrl}/search-index?q="${ticker.toUpperCase()}"&dateRange=custom&startdt=2020-01-01&forms=10-K,10-Q`, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        timeout: 10000,
      });
      const hit = searchResp.data?.hits?.hits?.[0]?._source;
      if (hit?.entity_id) {
        return { cik: String(hit.entity_id).padStart(10, '0'), name: hit.display_names?.[0] || ticker };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get recent SEC filings for a company.
   * Returns 10-K, 10-Q, 8-K, and other significant filings.
   */
  async getRecentFilings(ticker: string, count = 10): Promise<any> {
    try {
      // Use EDGAR full-text search to find filings by ticker
      const resp = await axios.get(
        `${this.baseUrl}/search-index?q="${ticker.toUpperCase()}"&forms=10-K,10-Q,8-K,DEF+14A,S-1&dateRange=custom&startdt=2023-01-01&from=0&size=${count}`,
        {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
          timeout: 15000,
        }
      );
      const hits = resp.data?.hits?.hits || [];
      const filings = hits.map((hit: any) => {
        const src = hit._source || {};
        return {
          form: src.form_type || src.file_type || 'Unknown',
          filedDate: src.file_date || src.period_of_report || null,
          description: src.display_names?.[0] || src.entity_name || ticker,
          accessionNumber: src.accession_no || null,
          url: src.accession_no
            ? `https://www.sec.gov/Archives/edgar/data/${(src.entity_id || '').replace(/^0+/, '')}/${src.accession_no.replace(/-/g, '')}/${src.accession_no}-index.htm`
            : null,
        };
      });
      return {
        ticker: ticker.toUpperCase(),
        totalFilings: resp.data?.hits?.total?.value || filings.length,
        filings,
      };
    } catch (error: any) {
      // Fallback: try submissions endpoint directly
      try {
        const tickerResp = await axios.get(
          `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=10-K&dateb=&owner=include&count=${count}&search_text=&action=getcompany&output=atom`,
          {
            headers: { 'User-Agent': this.userAgent },
            timeout: 10000,
          }
        );
        // Parse basic info from response
        return {
          ticker: ticker.toUpperCase(),
          totalFilings: 0,
          filings: [],
          note: 'EDGAR search returned limited results. Try using the company name for better results.',
        };
      } catch {
        return {
          ticker: ticker.toUpperCase(),
          totalFilings: 0,
          filings: [],
          error: error?.message || 'SEC EDGAR unavailable',
        };
      }
    }
  }

  /**
   * Get insider transactions from SEC EDGAR (Form 4 filings).
   */
  async getInsiderFilings(ticker: string, count = 20): Promise<any> {
    try {
      const resp = await axios.get(
        `${this.baseUrl}/search-index?q="${ticker.toUpperCase()}"&forms=4&dateRange=custom&startdt=2024-01-01&from=0&size=${count}`,
        {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
          timeout: 15000,
        }
      );
      const hits = resp.data?.hits?.hits || [];
      const filings = hits.map((hit: any) => {
        const src = hit._source || {};
        return {
          form: 'Form 4',
          filedDate: src.file_date || null,
          filerName: src.display_names?.[0] || 'Unknown',
          accessionNumber: src.accession_no || null,
          url: src.accession_no
            ? `https://www.sec.gov/Archives/edgar/data/${(src.entity_id || '').replace(/^0+/, '')}/${src.accession_no.replace(/-/g, '')}/${src.accession_no}-index.htm`
            : null,
        };
      });
      return { ticker: ticker.toUpperCase(), filings };
    } catch {
      return { ticker: ticker.toUpperCase(), filings: [] };
    }
  }
}

/**
 * FRED (Federal Reserve Economic Data) service — free API key required.
 * Get a key at: https://fred.stlouisfed.org/docs/api/api_key.html
 * Rate limit: 120 requests/minute.
 */
export class FredService {
  private apiKey: string;
  private baseUrl = 'https://api.stlouisfed.org/fred';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.FRED_API_KEY || '';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Get a FRED series observation (latest value).
   */
  private async getSeriesLatest(seriesId: string): Promise<{ date: string; value: number | null }> {
    try {
      const resp = await axios.get(`${this.baseUrl}/series/observations`, {
        params: {
          series_id: seriesId,
          api_key: this.apiKey,
          file_type: 'json',
          sort_order: 'desc',
          limit: 1,
        },
        timeout: 10000,
      });
      const obs = resp.data?.observations?.[0];
      if (!obs) return { date: 'N/A', value: null };
      const val = obs.value === '.' ? null : Number(obs.value);
      return { date: obs.date || 'N/A', value: Number.isFinite(val) ? val : null };
    } catch {
      return { date: 'N/A', value: null };
    }
  }

  /**
   * Get a FRED series with recent observations for trend analysis.
   */
  private async getSeriesHistory(seriesId: string, limit = 12): Promise<Array<{ date: string; value: number | null }>> {
    try {
      const resp = await axios.get(`${this.baseUrl}/series/observations`, {
        params: {
          series_id: seriesId,
          api_key: this.apiKey,
          file_type: 'json',
          sort_order: 'desc',
          limit,
        },
        timeout: 10000,
      });
      return (resp.data?.observations || []).map((obs: any) => ({
        date: obs.date || 'N/A',
        value: obs.value === '.' ? null : (Number.isFinite(Number(obs.value)) ? Number(obs.value) : null),
      })).reverse();
    } catch {
      return [];
    }
  }

  /**
   * Get key macroeconomic indicators.
   * Returns: GDP growth, CPI/inflation, Fed Funds Rate, unemployment, 10Y Treasury yield,
   * consumer sentiment, and initial jobless claims.
   */
  async getEconomicIndicators(): Promise<any> {
    if (!this.isConfigured()) {
      return { error: 'FRED_API_KEY not configured. Get a free key at fred.stlouisfed.org' };
    }

    const indicators = [
      { id: 'GDP', name: 'GDP (Quarterly, Billions $)', series: 'GDP' },
      { id: 'GDPC1', name: 'Real GDP Growth Rate (%)', series: 'A191RL1Q225SBEA' },
      { id: 'CPI', name: 'CPI (Consumer Price Index)', series: 'CPIAUCSL' },
      { id: 'INFLATION', name: 'Inflation Rate (CPI YoY %)', series: 'CPIAUCSL' },
      { id: 'FED_FUNDS', name: 'Federal Funds Rate (%)', series: 'DFF' },
      { id: 'UNEMPLOYMENT', name: 'Unemployment Rate (%)', series: 'UNRATE' },
      { id: 'TREASURY_10Y', name: '10-Year Treasury Yield (%)', series: 'DGS10' },
      { id: 'TREASURY_2Y', name: '2-Year Treasury Yield (%)', series: 'DGS2' },
      { id: 'CONSUMER_SENTIMENT', name: 'Consumer Sentiment Index', series: 'UMCSENT' },
      { id: 'INITIAL_CLAIMS', name: 'Initial Jobless Claims', series: 'ICSA' },
    ];

    const results = await Promise.all(
      indicators.map(async (ind) => {
        const latest = await this.getSeriesLatest(ind.series);
        return {
          id: ind.id,
          name: ind.name,
          value: latest.value,
          date: latest.date,
        };
      })
    );

    // Calculate yield curve spread (10Y - 2Y)
    const t10y = results.find((r) => r.id === 'TREASURY_10Y')?.value;
    const t2y = results.find((r) => r.id === 'TREASURY_2Y')?.value;
    const yieldSpread = t10y !== null && t10y !== undefined && t2y !== null && t2y !== undefined
      ? t10y - t2y
      : null;
    const yieldCurveStatus = yieldSpread === null
      ? 'Unavailable'
      : yieldSpread < 0
        ? 'Inverted (recession signal)'
        : yieldSpread < 0.5
          ? 'Flat (caution)'
          : 'Normal (healthy)';

    return {
      indicators: results,
      yieldCurve: {
        spread: yieldSpread,
        status: yieldCurveStatus,
      },
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Get historical series data for charting.
   */
  async getSeriesData(seriesId: string, limit = 60): Promise<any> {
    if (!this.isConfigured()) {
      return { error: 'FRED_API_KEY not configured' };
    }
    const history = await this.getSeriesHistory(seriesId, limit);
    return { seriesId, observations: history };
  }
}
