import axios from 'axios';
import YahooFinance from 'yahoo-finance2';

// Singleton Yahoo Finance instance (suppresses the one-time survey notice)
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] } as any);

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
    alphavantage: Number(process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS || 1200),
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

// ---------------------------------------------------------------------------
// Yahoo Finance service — no API key required; uses yahoo-finance2 npm package
// ---------------------------------------------------------------------------

export class YahooFinanceService implements StockDataService {
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private lastRequestAt = 0;
  // sharedCache is process-level; survives across invocations within the same Vercel instance
  private static sharedCache = new Map<string, { expiresAt: number; data: any }>();
  // Yahoo Finance rate-limits aggressive scrapers; stay well under 1 req/sec.
  private minIntervalMs = Number(process.env.YAHOO_MIN_INTERVAL_MS || 500);

  // Cache TTL constants
  private static TTL_PRICE = 30_000;           // 30 s — live quote
  private static TTL_HISTORY = 60 * 60_000;    // 1 h  — historical prices
  private static TTL_FUNDAMENTALS = 6 * 60 * 60_000; // 6 h  — overview/financials

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const wait = this.minIntervalMs - (now - this.lastRequestAt);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestAt = Date.now();
  }

  private async fetchWithCache<T>(
    cacheKey: string,
    ttlMs: number,
    fetcher: () => Promise<T>
  ): Promise<T> {
    if (ttlMs > 0) {
      const hit = this.cache.get(cacheKey) ?? YahooFinanceService.sharedCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        this.cache.set(cacheKey, hit);
        return hit.data as T;
      }
    }
    const data = await fetcher();
    if (ttlMs > 0) {
      const entry = { expiresAt: Date.now() + ttlMs, data };
      this.cache.set(cacheKey, entry);
      YahooFinanceService.sharedCache.set(cacheKey, entry);
    }
    return data;
  }

  /** Fetch a quoteSummary with caching, throttling and retry on 429. */
  private async quoteSummary(symbol: string, modules: string[], ttlMs: number): Promise<any> {
    const key = `yf:quoteSummary:${symbol}:${[...modules].sort().join(',')}`;
    return this.fetchWithCache(key, ttlMs, async () => {
      await this.throttle();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await (yf as any).quoteSummary(symbol.toUpperCase(), {
            modules,
            validateResult: false,
          });
          return result;
        } catch (err: any) {
          const msg = String(err?.message || '');
          if ((msg.includes('Too Many') || msg.includes('429') || msg.includes('rate')) && attempt < 2) {
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
            continue;
          }
          throw err;
        }
      }
    });
  }

  async getStockPrice(symbol: string): Promise<any> {
    const key = `yf:quote:${symbol.toUpperCase()}`;
    return this.fetchWithCache(key, YahooFinanceService.TTL_PRICE, async () => {
      await this.throttle();
      const q = await (yf as any).quote(symbol.toUpperCase(), /* queryOptions */ {}, { validateResult: false });
      if (!q) throw new Error('Unable to fetch stock price');
      return {
        symbol: q.symbol,
        price: q.regularMarketPrice?.toString() ?? null,
        change: q.regularMarketChange?.toString() ?? null,
        changePercent: q.regularMarketChangePercent != null
          ? `${q.regularMarketChangePercent.toFixed(2)}%`
          : null,
        volume: q.regularMarketVolume?.toString() ?? null,
        latestTradingDay: q.regularMarketTime
          ? new Date(q.regularMarketTime).toISOString().slice(0, 10)
          : null,
        open: q.regularMarketOpen?.toString() ?? null,
        high: q.regularMarketDayHigh?.toString() ?? null,
        low: q.regularMarketDayLow?.toString() ?? null,
        previousClose: q.regularMarketPreviousClose?.toString() ?? null,
        marketCap: q.marketCap?.toString() ?? null,
      };
    });
  }

  async getPriceHistory(symbol: string, range: string = '1y'): Promise<any> {
    const upper = symbol.toUpperCase();
    const normalizedRange = range.toLowerCase();
    const periodMap: Record<string, { period1: string; interval: '1d' | '1wk' | '1mo' }> = {
      '1d': { period1: daysAgo(1), interval: '1d' },
      '1w': { period1: daysAgo(7), interval: '1d' },
      '1week': { period1: daysAgo(7), interval: '1d' },
      week: { period1: daysAgo(7), interval: '1d' },
      '1m': { period1: daysAgo(30), interval: '1d' },
      '1month': { period1: daysAgo(30), interval: '1d' },
      month: { period1: daysAgo(30), interval: '1d' },
      '3m': { period1: daysAgo(90), interval: '1d' },
      '3month': { period1: daysAgo(90), interval: '1d' },
      quarter: { period1: daysAgo(90), interval: '1d' },
      '6m': { period1: daysAgo(180), interval: '1d' },
      '6month': { period1: daysAgo(180), interval: '1d' },
      '1y': { period1: daysAgo(365), interval: '1wk' },
      '1year': { period1: daysAgo(365), interval: '1wk' },
      year: { period1: daysAgo(365), interval: '1wk' },
      '3y': { period1: daysAgo(365 * 3), interval: '1wk' },
      '3year': { period1: daysAgo(365 * 3), interval: '1wk' },
      '5y': { period1: daysAgo(365 * 5), interval: '1wk' },
      '5year': { period1: daysAgo(365 * 5), interval: '1wk' },
      max: { period1: daysAgo(365 * 20), interval: '1mo' },
      all: { period1: daysAgo(365 * 20), interval: '1mo' },
    };
    const cfg = periodMap[normalizedRange] ?? { period1: daysAgo(365), interval: '1wk' as const };
    const key = `yf:hist:${upper}:${normalizedRange}`;
    return this.fetchWithCache(key, YahooFinanceService.TTL_HISTORY, async () => {
      await this.throttle();
      const rows: any[] = await (yf as any).historical(
        upper,
        { period1: cfg.period1, interval: cfg.interval },
        { validateResult: false }
      );
      const prices = (rows || []).map((r: any) => ({
        date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
        open: r.open?.toString() ?? null,
        high: r.high?.toString() ?? null,
        low: r.low?.toString() ?? null,
        close: r.close?.toString() ?? null,
        volume: r.volume?.toString() ?? null,
      }));
      return { symbol: upper, prices };
    });
  }

  async getCompanyOverview(symbol: string): Promise<any> {
    const data = await this.quoteSummary(symbol, [
      'assetProfile', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'price',
    ], YahooFinanceService.TTL_FUNDAMENTALS);

    const p = data?.price ?? {};
    const ap = data?.assetProfile ?? {};
    const sd = data?.summaryDetail ?? {};
    const ks = data?.defaultKeyStatistics ?? {};
    const fd = data?.financialData ?? {};

    return {
      symbol: symbol.toUpperCase(),
      name: p.longName ?? p.shortName ?? null,
      description: ap.longBusinessSummary ?? null,
      sector: ap.sector ?? null,
      industry: ap.industry ?? null,
      marketCapitalization: p.marketCap?.raw?.toString() ?? null,
      eps: ks.trailingEps?.raw?.toString() ?? null,
      peRatio: sd.trailingPE?.raw?.toString() ?? null,
      forwardPE: sd.forwardPE?.raw?.toString() ?? null,
      pegRatio: ks.pegRatio?.raw?.toString() ?? null,
      bookValue: ks.bookValue?.raw?.toString() ?? null,
      dividendPerShare: sd.dividendRate?.raw?.toString() ?? null,
      dividendYield: sd.dividendYield?.raw != null
        ? (sd.dividendYield.raw * 100).toFixed(2)
        : null,
      revenueTTM: fd.totalRevenue?.raw?.toString() ?? null,
      grossProfitTTM: null,
      '52WeekHigh': sd.fiftyTwoWeekHigh?.raw?.toString() ?? null,
      '52WeekLow': sd.fiftyTwoWeekLow?.raw?.toString() ?? null,
      '50DayMovingAverage': sd.fiftyDayAverage?.raw?.toString() ?? null,
      '200DayMovingAverage': sd.twoHundredDayAverage?.raw?.toString() ?? null,
      beta: sd.beta?.raw?.toString() ?? null,
      profitMargin: fd.profitMargins?.raw?.toString() ?? null,
      operatingMargin: fd.operatingMargins?.raw?.toString() ?? null,
      returnOnAssets: fd.returnOnAssets?.raw?.toString() ?? null,
      returnOnEquity: fd.returnOnEquity?.raw?.toString() ?? null,
      revenuePerShare: fd.revenuePerShare?.raw?.toString() ?? null,
      quarterlyEarningsGrowth: fd.earningsGrowth?.raw?.toString() ?? null,
      quarterlyRevenueGrowth: fd.revenueGrowth?.raw?.toString() ?? null,
      sharesOutstanding: ks.sharesOutstanding?.raw?.toString() ?? null,
      sharesFloat: ks.floatShares?.raw?.toString() ?? null,
      percentInsiders: ks.heldPercentInsiders?.raw != null
        ? (ks.heldPercentInsiders.raw * 100).toFixed(2)
        : null,
      percentInstitutions: ks.heldPercentInstitutions?.raw != null
        ? (ks.heldPercentInstitutions.raw * 100).toFixed(2)
        : null,
      shortRatio: ks.shortRatio?.raw?.toString() ?? null,
      shortPercentFloat: ks.shortPercentOfFloat?.raw != null
        ? (ks.shortPercentOfFloat.raw * 100).toFixed(2)
        : null,
      shortPercentOutstanding: null,
      analystTargetPrice: fd.targetMeanPrice?.raw?.toString() ?? null,
      analystRatingStrongBuy: null,
      analystRatingBuy: null,
      analystRatingHold: null,
      analystRatingSell: null,
      analystRatingStrongSell: null,
      exDividendDate: sd.exDividendDate?.raw
        ? new Date(sd.exDividendDate.raw * 1000).toISOString().slice(0, 10)
        : null,
      dividendDate: sd.dividendDate?.raw
        ? new Date(sd.dividendDate.raw * 1000).toISOString().slice(0, 10)
        : null,
      website: ap.website ?? null,
      employees: ap.fullTimeEmployees?.toString() ?? null,
    };
  }

  async getBasicFinancials(symbol: string): Promise<any> {
    const data = await this.quoteSummary(symbol, [
      'defaultKeyStatistics', 'financialData', 'summaryDetail',
    ], YahooFinanceService.TTL_FUNDAMENTALS);

    const ks = data?.defaultKeyStatistics ?? {};
    const fd = data?.financialData ?? {};
    const sd = data?.summaryDetail ?? {};

    return {
      symbol: symbol.toUpperCase(),
      metric: {
        peBasicExclExtraTTM: sd.trailingPE?.raw ?? ks.trailingPE?.raw ?? null,
        epsTTM: ks.trailingEps?.raw ?? null,
        revenueGrowthTTM: fd.revenueGrowth?.raw ?? null,
        epsGrowthTTM: fd.earningsGrowth?.raw ?? null,
        grossMarginTTM: fd.grossMargins?.raw ?? null,
        operatingMarginTTM: fd.operatingMargins?.raw ?? null,
        roeTTM: fd.returnOnEquity?.raw ?? null,
        roaTTM: fd.returnOnAssets?.raw ?? null,
        revenuePerShareTTM: fd.revenuePerShare?.raw ?? null,
        currentRatioQuarterly: fd.currentRatio?.raw ?? null,
        debtToEquity: fd.debtToEquity?.raw ?? null,
        totalDebt: fd.totalDebt?.raw ?? null,
        freeCashflowTTM: fd.freeCashflow?.raw ?? null,
        '52WeekHigh': sd.fiftyTwoWeekHigh?.raw ?? null,
        '52WeekLow': sd.fiftyTwoWeekLow?.raw ?? null,
        beta: sd.beta?.raw ?? null,
        bookValuePerShareQuarterly: ks.bookValue?.raw ?? null,
        forwardPE: sd.forwardPE?.raw ?? null,
        pegRatio: ks.pegRatio?.raw ?? null,
        priceToSalesRatioTTM: ks.priceToSalesTrailing12Months?.raw ?? null,
        priceToBookMRQ: ks.priceToBook?.raw ?? null,
      },
      series: {},
    };
  }

  async getInsiderTrading(symbol: string): Promise<any> {
    const data = await this.quoteSummary(symbol, [
      'insiderHolders', 'majorHoldersBreakdown', 'defaultKeyStatistics',
    ], YahooFinanceService.TTL_FUNDAMENTALS);

    const mhb = data?.majorHoldersBreakdown ?? {};
    const ks = data?.defaultKeyStatistics ?? {};
    const ih = data?.insiderHolders ?? {};

    const result: any = {
      symbol: symbol.toUpperCase(),
      insiderOwnership: mhb.insidersPercentHeld?.raw != null
        ? `${(mhb.insidersPercentHeld.raw * 100).toFixed(2)}%`
        : 'N/A',
      institutionalOwnership: mhb.institutionsPercentHeld?.raw != null
        ? `${(mhb.institutionsPercentHeld.raw * 100).toFixed(2)}%`
        : 'N/A',
      sharesOutstanding: ks.sharesOutstanding?.raw?.toString() ?? 'N/A',
      sharesFloat: ks.floatShares?.raw?.toString() ?? 'N/A',
      shortRatio: ks.shortRatio?.raw?.toString() ?? 'N/A',
      shortPercentFloat: ks.shortPercentOfFloat?.raw != null
        ? `${(ks.shortPercentOfFloat.raw * 100).toFixed(2)}%`
        : 'N/A',
      shortPercentOutstanding: 'N/A',
    };

    const holders: any[] = ih.holders ?? [];
    if (holders.length > 0) {
      result.recentTransactions = holders.slice(0, 15).map((h: any) => ({
        transactionDate: h.latestTransDate?.fmt ?? null,
        insider: h.name ?? null,
        title: h.relation ?? null,
        transactionType: h.transactionDescription ?? null,
        shares: h.positionDirect?.raw?.toString() ?? null,
        sharePrice: null,
        totalValue: 'N/A',
      }));
    }

    return result;
  }

  async getAnalystRatings(symbol: string): Promise<any> {
    const data = await this.quoteSummary(symbol, [
      'financialData', 'summaryDetail',
    ], YahooFinanceService.TTL_FUNDAMENTALS);

    const fd = data?.financialData ?? {};
    const sd = data?.summaryDetail ?? {};

    return {
      symbol: symbol.toUpperCase(),
      analystTargetPrice: fd.targetMeanPrice?.raw?.toString() ?? 'N/A',
      targetHigh: fd.targetHighPrice?.raw?.toString() ?? 'N/A',
      targetLow: fd.targetLowPrice?.raw?.toString() ?? 'N/A',
      recommendation: fd.recommendationKey ?? 'N/A',
      numberOfAnalysts: fd.numberOfAnalystOpinions?.raw?.toString() ?? 'N/A',
      movingAverage50Day: sd.fiftyDayAverage?.raw?.toString() ?? 'N/A',
      upside: fd.targetMeanPrice?.raw != null && sd.fiftyDayAverage?.raw != null
        ? `${(((fd.targetMeanPrice.raw / sd.fiftyDayAverage.raw) - 1) * 100).toFixed(1)}% (vs 50-day MA)`
        : 'N/A',
    };
  }

  async getAnalystRecommendations(symbol: string): Promise<any> {
    throw new Error('Analyst recommendations unavailable via Yahoo Finance');
  }

  async getPriceTargets(symbol: string): Promise<any> {
    const data = await this.quoteSummary(symbol, ['financialData'], YahooFinanceService.TTL_FUNDAMENTALS);
    const fd = data?.financialData ?? {};
    return {
      symbol: symbol.toUpperCase(),
      targetMean: fd.targetMeanPrice?.raw?.toString() ?? null,
      targetHigh: fd.targetHighPrice?.raw?.toString() ?? null,
      targetLow: fd.targetLowPrice?.raw?.toString() ?? null,
      numberOfAnalysts: fd.numberOfAnalystOpinions?.raw?.toString() ?? null,
    };
  }

  async getPeers(symbol: string): Promise<any> {
    throw new Error('Peers unavailable via Yahoo Finance');
  }

  async searchStock(query: string): Promise<any> {
    const key = `yf:search:${query.toLowerCase()}`;
    return this.fetchWithCache(key, YahooFinanceService.TTL_HISTORY, async () => {
      await this.throttle();
      const result = await (yf as any).search(
        query,
        { newsCount: 0, quotesCount: 10 },
        { validateResult: false }
      );
      const quotes: any[] = result?.quotes ?? [];
      const filtered = quotes
        .filter((q: any) => q.quoteType === 'EQUITY' || q.quoteType === 'ETF')
        .map((q: any) => ({
          symbol: q.symbol,
          name: q.shortname ?? q.longname ?? null,
          type: q.quoteType,
          exchange: q.exchDisp ?? q.exchange ?? null,
          region: null,
          currency: null,
          source: 'yahoo',
        }));
      return { results: filtered };
    });
  }

  async searchCompanies(query: string): Promise<any> {
    return this.searchStock(query);
  }

  async getEarningsHistory(symbol: string): Promise<any> {
    const data = await this.quoteSummary(symbol, ['earnings', 'earningsTrend'], YahooFinanceService.TTL_FUNDAMENTALS);
    const earningsData = data?.earnings ?? {};
    const quarterly: any[] = earningsData.earningsChart?.quarterly ?? [];
    const yearly: any[] = earningsData.financialsChart?.yearly ?? [];

    if (quarterly.length === 0 && yearly.length === 0) {
      throw new Error('Unable to fetch earnings history');
    }

    return {
      symbol: symbol.toUpperCase(),
      annualEarnings: yearly.slice(0, 10).map((e: any) => ({
        fiscalYear: e.date?.toString() ?? null,
        reportedEPS: e.earnings?.raw?.toString() ?? null,
      })),
      quarterlyEarnings: quarterly.slice(0, 12).map((e: any) => ({
        fiscalQuarter: e.date?.toString() ?? null,
        reportedEPS: e.actual?.raw?.toString() ?? null,
        estimatedEPS: e.estimate?.raw?.toString() ?? null,
        surprise: e.actual?.raw != null && e.estimate?.raw != null
          ? (e.actual.raw - e.estimate.raw).toFixed(4)
          : null,
        surprisePercentage: e.actual?.raw != null && e.estimate?.raw != null && e.estimate.raw !== 0
          ? (((e.actual.raw - e.estimate.raw) / Math.abs(e.estimate.raw)) * 100).toFixed(2)
          : null,
      })),
    };
  }

  async getIncomeStatement(symbol: string): Promise<any> {
    const data = await this.quoteSummary(symbol, ['incomeStatementHistory'], YahooFinanceService.TTL_FUNDAMENTALS);
    const ish = data?.incomeStatementHistory ?? {};
    const reports: any[] = ish.incomeStatementHistory ?? [];

    if (reports.length === 0) throw new Error('Unable to fetch income statement');

    const mapReport = (r: any) => ({
      fiscalYear: r.endDate?.fmt ?? null,
      totalRevenue: r.totalRevenue?.raw?.toString() ?? null,
      grossProfit: r.grossProfit?.raw?.toString() ?? null,
      operatingIncome: r.operatingIncome?.raw?.toString() ?? null,
      netIncome: r.netIncome?.raw?.toString() ?? null,
      ebitda: r.ebitda?.raw?.toString() ?? null,
    });

    return {
      symbol: symbol.toUpperCase(),
      annualReports: reports.slice(0, 5).map(mapReport),
      quarterlyReports: reports.slice(0, 8).map((r: any) => ({
        fiscalQuarter: r.endDate?.fmt ?? null,
        totalRevenue: r.totalRevenue?.raw?.toString() ?? null,
        grossProfit: r.grossProfit?.raw?.toString() ?? null,
        operatingIncome: r.operatingIncome?.raw?.toString() ?? null,
        netIncome: r.netIncome?.raw?.toString() ?? null,
        ebitda: r.ebitda?.raw?.toString() ?? null,
      })),
    };
  }

  async getBalanceSheet(symbol: string): Promise<any> {
    const data = await this.quoteSummary(symbol, ['balanceSheetHistory'], YahooFinanceService.TTL_FUNDAMENTALS);
    const bsh = data?.balanceSheetHistory ?? {};
    const reports: any[] = bsh.balanceSheetStatements ?? [];

    if (reports.length === 0) throw new Error('Unable to fetch balance sheet');

    return {
      symbol: symbol.toUpperCase(),
      quarterlyReports: reports.slice(0, 4).map((r: any) => ({
        fiscalQuarter: r.endDate?.fmt ?? null,
        totalAssets: r.totalAssets?.raw?.toString() ?? null,
        totalLiabilities: r.totalLiab?.raw?.toString() ?? null,
        totalShareholderEquity: r.totalStockholderEquity?.raw?.toString() ?? null,
        cashAndEquivalents: r.cash?.raw?.toString() ?? null,
        longTermDebt: r.longTermDebt?.raw?.toString() ?? null,
      })),
    };
  }

  async getCashFlow(symbol: string): Promise<any> {
    const data = await this.quoteSummary(symbol, ['cashflowStatementHistory'], YahooFinanceService.TTL_FUNDAMENTALS);
    const cfh = data?.cashflowStatementHistory ?? {};
    const reports: any[] = cfh.cashflowStatements ?? [];

    if (reports.length === 0) throw new Error('Unable to fetch cash flow data');

    return {
      symbol: symbol.toUpperCase(),
      quarterlyReports: reports.slice(0, 4).map((r: any) => {
        const opCF = r.totalCashFromOperatingActivities?.raw ?? null;
        const capEx = r.capitalExpenditures?.raw ?? null;
        return {
          fiscalQuarter: r.endDate?.fmt ?? null,
          operatingCashflow: opCF?.toString() ?? null,
          capitalExpenditures: capEx?.toString() ?? null,
          freeCashFlow: opCF != null && capEx != null
            ? (opCF - Math.abs(capEx)).toString()
            : 'N/A',
          dividendPayout: r.dividendsPaid?.raw?.toString() ?? null,
        };
      }),
    };
  }

  async getSectorPerformance(): Promise<any> {
    throw new Error('Sector performance unavailable via Yahoo Finance');
  }

  async getStocksBySector(sector: string): Promise<any> {
    throw new Error('Sector screening unavailable via Yahoo Finance');
  }

  async screenStocks(filters: Record<string, string | number | undefined>): Promise<any> {
    throw new Error('Stock screening unavailable via Yahoo Finance');
  }

  async getTopGainersLosers(): Promise<any> {
    const key = 'yf:topMovers';
    return this.fetchWithCache(key, 5 * 60_000, async () => {
      await this.throttle();
      const [gainers, losers] = await Promise.all([
        (yf as any).dailyGainers({ count: 10 }, { validateResult: false }).catch(() => ({ quotes: [] })),
        (yf as any).dailyLosers({ count: 10 }, { validateResult: false }).catch(() => ({ quotes: [] })),
      ]);
      const mapMover = (q: any) => ({
        ticker: q.symbol,
        price: q.regularMarketPrice?.toString() ?? null,
        changeAmount: q.regularMarketChange?.toString() ?? null,
        changePercentage: q.regularMarketChangePercent != null
          ? `${q.regularMarketChangePercent.toFixed(2)}%`
          : null,
        volume: q.regularMarketVolume?.toString() ?? null,
      });
      return {
        topGainers: (gainers?.quotes ?? []).slice(0, 10).map(mapMover),
        topLosers: (losers?.quotes ?? []).slice(0, 10).map(mapMover),
        mostActive: [],
      };
    });
  }

  async getNewsSentiment(symbol: string): Promise<any> {
    throw new Error('News sentiment unavailable via Yahoo Finance');
  }

  async getCompanyNews(symbol: string, days: number = 30): Promise<any> {
    throw new Error('Company news unavailable via Yahoo Finance');
  }

  async searchNews(query: string, days: number = 30): Promise<any> {
    throw new Error('News search unavailable via Yahoo Finance');
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Factory — reads STOCK_DATA_PROVIDER to choose which service to use
// ---------------------------------------------------------------------------

/**
 * Create the active stock data service based on environment configuration.
 *
 * STOCK_DATA_PROVIDER=yfinance  → YahooFinanceService (no API key needed)
 * STOCK_DATA_PROVIDER=alphavantage (default) → AlphaVantageService
 */
export function createStockService(): { service: StockDataService; provider: string; missingKey?: string } {
  const provider = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase();

  if (provider === 'yfinance' || provider === 'yahoo' || provider === 'yahoo_finance') {
    return { service: new YahooFinanceService(), provider: 'yfinance' };
  }

  // Default: Alpha Vantage
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) {
    return {
      service: new AlphaVantageService(),
      provider: 'alphavantage',
      missingKey: 'ALPHA_VANTAGE_API_KEY',
    };
  }
  return { service: new AlphaVantageService(key), provider: 'alphavantage' };
}
