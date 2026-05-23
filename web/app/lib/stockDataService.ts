/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';
import { getConfiguredEnv, isPlaceholderEnvValue } from './env';

const DEFAULT_PROVIDER_MIN_INTERVAL_MS = {
  alphavantage: 12000,
  finnhub: 1100,
  fmp: 12000,
  twelvedata: 8000,
  stooq: 1000,
  eodhd: 12000,
  marketaux: 1500,
  openfigi: 3000,
} as const;

function getProviderMinIntervalMs(envName: string, fallback: number): number {
  const rawEnv = process.env[envName];
  if (!rawEnv || rawEnv.trim() === '') return fallback;
  const parsed = Number(rawEnv);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

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
  private throttleQueues = new Map<string, Promise<void>>();
  private static sharedCache = new Map<string, { expiresAt: number; data: any }>();
  // Alpha Vantage uses multiple endpoint families behind one base URL, so this service
  // keeps its throttle state in a keyed map instead of a single timestamp.
  private minIntervals = {
    alphavantage: getProviderMinIntervalMs('ALPHA_VANTAGE_MIN_INTERVAL_MS', DEFAULT_PROVIDER_MIN_INTERVAL_MS.alphavantage),
  };

  constructor(apiKey?: string) {
    this.apiKey = (isPlaceholderEnvValue(apiKey) ? undefined : apiKey) || getConfiguredEnv('ALPHA_VANTAGE_API_KEY') || '';
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
    const previous = this.throttleQueues.get(provider) || Promise.resolve();
    const next = previous.then(async () => {
      const last = this.lastRequestAt.get(provider) || 0;
      const now = Date.now();
      const wait = minIntervalMs - (now - last);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      this.lastRequestAt.set(provider, Date.now());
    });
    this.throttleQueues.set(provider, next.catch(() => {}));
    await next;
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
      : null;

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
  private throttleQueue: Promise<void> = Promise.resolve();
  private minIntervalMs = getProviderMinIntervalMs('FINNHUB_MIN_INTERVAL_MS', DEFAULT_PROVIDER_MIN_INTERVAL_MS.finnhub);

  constructor(apiKey?: string) {
    this.apiKey = (isPlaceholderEnvValue(apiKey) ? undefined : apiKey) || getConfiguredEnv('FINNHUB_API_KEY') || '';
  }

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const next = this.throttleQueue.then(async () => {
      const now = Date.now();
      const wait = this.minIntervalMs - (now - this.lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
    });
    this.throttleQueue = next.catch(() => {});
    await next;
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
      dividendYield: m.dividendYieldIndicatedAnnual != null ? Number(m.dividendYieldIndicatedAnnual) / 100 : null,
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
  private throttleQueue: Promise<void> = Promise.resolve();
  private minIntervalMs = getProviderMinIntervalMs('TWELVE_DATA_MIN_INTERVAL_MS', DEFAULT_PROVIDER_MIN_INTERVAL_MS.twelvedata);

  constructor(apiKey?: string) {
    this.apiKey = (isPlaceholderEnvValue(apiKey) ? undefined : apiKey) || getConfiguredEnv('TWELVE_DATA_API_KEY') || '';
  }

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const next = this.throttleQueue.then(async () => {
      const now = Date.now();
      const wait = this.minIntervalMs - (now - this.lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
    });
    this.throttleQueue = next.catch(() => {});
    await next;
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
  private throttleQueue: Promise<void> = Promise.resolve();
  private minIntervalMs = getProviderMinIntervalMs('FMP_MIN_INTERVAL_MS', DEFAULT_PROVIDER_MIN_INTERVAL_MS.fmp);

  constructor(apiKey?: string) {
    this.apiKey = (isPlaceholderEnvValue(apiKey) ? undefined : apiKey) || getConfiguredEnv('FINANCIAL_MODELING_PREP_API_KEY') || '';
  }

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const next = this.throttleQueue.then(async () => {
      const now = Date.now();
      const wait = this.minIntervalMs - (now - this.lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
    });
    this.throttleQueue = next.catch(() => {});
    await next;
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
      dividendPerShare: profile.lastDiv?.toString(),
      dividendYield: null,
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
  private throttleQueue: Promise<void> = Promise.resolve();
  private minIntervalMs = getProviderMinIntervalMs('STOOQ_MIN_INTERVAL_MS', DEFAULT_PROVIDER_MIN_INTERVAL_MS.stooq);

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const next = this.throttleQueue.then(async () => {
      const now = Date.now();
      const wait = this.minIntervalMs - (now - this.lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
    });
    this.throttleQueue = next.catch(() => {});
    await next;
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

class OpenFigiService implements StockDataService {
  private apiKey = getConfiguredEnv('OPENFIGI_API_KEY') || '';
  private baseUrl = 'https://api.openfigi.com/v3';
  private lastRequestAt = 0;
  private throttleQueue: Promise<void> = Promise.resolve();
  private minIntervalMs = getProviderMinIntervalMs('OPENFIGI_MIN_INTERVAL_MS', DEFAULT_PROVIDER_MIN_INTERVAL_MS.openfigi);
  private cache = new Map<string, { expiresAt: number; data: any }>();

  private async throttle() {
    if (this.minIntervalMs <= 0) return;
    const next = this.throttleQueue.then(async () => {
      const now = Date.now();
      const wait = this.minIntervalMs - (now - this.lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
    });
    this.throttleQueue = next.catch(() => {});
    await next;
  }

  private async mapTicker(ticker: string): Promise<any[]> {
    const normalized = ticker.trim().toUpperCase();
    if (!/^[A-Z0-9.]{1,6}$/.test(normalized)) {
      throw new Error('Unavailable via OpenFIGI: only ticker mapping is supported');
    }
    const cacheKey = `openfigi:${normalized}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    await this.throttle();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['X-OPENFIGI-APIKEY'] = this.apiKey;
    try {
      const response = await axios.post(
        `${this.baseUrl}/mapping`,
        [{ idType: 'TICKER', idValue: normalized, exchCode: 'US' }],
        { headers, timeout: 10000 }
      );
      const data = response.data?.[0]?.data;
      const mapped = Array.isArray(data) ? data : [];
      if (!mapped.length) throw new Error('OpenFIGI returned no US equity matches');
      this.cache.set(cacheKey, { expiresAt: Date.now() + 24 * 60 * 60 * 1000, data: mapped });
      return mapped;
    } catch (error: any) {
      const statusCode = error?.response?.status;
      if (statusCode === 429) throw new Error('OpenFIGI rate limit exceeded (429)');
      throw new Error(`Unavailable via OpenFIGI: ${error?.message || 'mapping failed'}`);
    }
  }

  async searchStock(query: string): Promise<any> {
    const mapped = await this.mapTicker(query);
    return {
      results: mapped
        .filter((item: any) => String(item.marketSector || '').toLowerCase() === 'equity')
        .slice(0, 8)
        .map((item: any) => ({
          symbol: item.ticker,
          name: item.name,
          type: item.securityType || item.securityType2 || 'Equity',
          region: item.exchCode || 'US',
          currency: item.currency,
          exchange: item.exchCode,
          figi: item.figi,
          compositeFIGI: item.compositeFIGI,
          source: 'openfigi',
        })),
    };
  }

  async getStockPrice(): Promise<any> { throw new Error('Unavailable via OpenFIGI: market data not supported'); }
  async getPriceHistory(): Promise<any> { throw new Error('Unavailable via OpenFIGI: market data not supported'); }
  async getCompanyOverview(): Promise<any> { throw new Error('Unavailable via OpenFIGI: fundamentals not supported'); }
  async getBasicFinancials(): Promise<any> { throw new Error('Unavailable via OpenFIGI: fundamentals not supported'); }
  async getInsiderTrading(): Promise<any> { throw new Error('Unavailable via OpenFIGI: insider data not supported'); }
  async getAnalystRatings(): Promise<any> { throw new Error('Unavailable via OpenFIGI: analyst data not supported'); }
  async getAnalystRecommendations(): Promise<any> { throw new Error('Unavailable via OpenFIGI: analyst data not supported'); }
  async getPriceTargets(): Promise<any> { throw new Error('Unavailable via OpenFIGI: analyst data not supported'); }
  async getPeers(): Promise<any> { throw new Error('Unavailable via OpenFIGI: peer data not supported'); }
  async getEarningsHistory(): Promise<any> { throw new Error('Unavailable via OpenFIGI: earnings not supported'); }
  async getIncomeStatement(): Promise<any> { throw new Error('Unavailable via OpenFIGI: statements not supported'); }
  async getBalanceSheet(): Promise<any> { throw new Error('Unavailable via OpenFIGI: statements not supported'); }
  async getCashFlow(): Promise<any> { throw new Error('Unavailable via OpenFIGI: statements not supported'); }
  async getSectorPerformance(): Promise<any> { throw new Error('Unavailable via OpenFIGI: sector performance not supported'); }
  async getTopGainersLosers(): Promise<any> { throw new Error('Unavailable via OpenFIGI: movers not supported'); }
  async getNewsSentiment(): Promise<any> { throw new Error('Unavailable via OpenFIGI: news not supported'); }
  async getCompanyNews(): Promise<any> { throw new Error('Unavailable via OpenFIGI: news not supported'); }
  async searchNews(): Promise<any> { throw new Error('Unavailable via OpenFIGI: news not supported'); }
}

class EodhdService implements StockDataService {
  private apiKey = getConfiguredEnv('EODHD_API_KEY') || '';
  private baseUrl = 'https://eodhd.com/api';
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private lastRequestAt = 0;
  private throttleQueue: Promise<void> = Promise.resolve();
  private minIntervalMs = getProviderMinIntervalMs('EODHD_MIN_INTERVAL_MS', DEFAULT_PROVIDER_MIN_INTERVAL_MS.eodhd);

  private formatSymbol(symbol: string): string {
    const raw = symbol.trim().toUpperCase();
    if (/\.[A-Z0-9]{2,6}$/.test(raw)) return raw;
    return `${raw.replace(/\./g, '-')}.US`;
  }

  private async throttle() {
    if (this.minIntervalMs <= 0) return;
    const next = this.throttleQueue.then(async () => {
      const now = Date.now();
      const wait = this.minIntervalMs - (now - this.lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
    });
    this.throttleQueue = next.catch(() => {});
    await next;
  }

  private async makeRequest(path: string, params: Record<string, string> = {}, ttlMs = 0): Promise<any> {
    if (!this.apiKey) throw new Error('Unavailable via EODHD: API key not configured');
    const cacheKey = `eodhd:${path}:${JSON.stringify(params)}`;
    const cached = ttlMs > 0 ? this.cache.get(cacheKey) : undefined;
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    await this.throttle();
    try {
      const response = await axios.get(`${this.baseUrl}${path}`, {
        params: { ...params, api_token: this.apiKey, fmt: 'json' },
        timeout: 12000,
      });
      const data = response.data;
      const message = typeof data === 'string' ? data : data?.message || data?.error;
      if (message && /limit|token|forbidden|invalid|error/i.test(String(message))) {
        throw new Error(String(message));
      }
      if (ttlMs > 0) this.cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, data });
      return data;
    } catch (error: any) {
      const statusCode = error?.response?.status;
      if (statusCode === 429) throw new Error('EODHD rate limit exceeded (429)');
      if (statusCode === 401 || statusCode === 403) throw new Error(`Unavailable via EODHD (plan limitation: ${statusCode})`);
      throw new Error(`EODHD request failed: ${error?.message || 'unknown error'}`);
    }
  }

  async getStockPrice(symbol: string): Promise<any> {
    const data = await this.makeRequest(`/real-time/${this.formatSymbol(symbol)}`, {}, 5 * 60 * 1000);
    const price = data?.close ?? data?.previousClose;
    if (price === undefined || price === null) throw new Error('Unavailable via EODHD: no price data');
    return {
      symbol: symbol.toUpperCase(),
      price: String(price),
      change: data.change?.toString(),
      changePercent: data.change_p ? `${data.change_p}%` : undefined,
      volume: data.volume?.toString(),
      latestTradingDay: data.timestamp ? new Date(Number(data.timestamp) * 1000).toISOString() : data.date,
      open: data.open?.toString(),
      high: data.high?.toString(),
      low: data.low?.toString(),
      previousClose: data.previousClose?.toString(),
    };
  }

  async getPriceHistory(symbol: string, range = '1y'): Promise<any> {
    const lower = range.toLowerCase();
    const days =
      lower.includes('1w') ? 7 :
      lower.includes('1m') ? 30 :
      lower.includes('3m') ? 90 :
      lower.includes('6m') ? 180 :
      lower.includes('3y') ? 365 * 3 :
      lower.includes('5y') ? 365 * 5 :
      lower.includes('max') ? 365 * 20 :
      365;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const data = await this.makeRequest(`/eod/${this.formatSymbol(symbol)}`, {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      period: 'd',
    }, 12 * 60 * 60 * 1000);
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) throw new Error('Unavailable via EODHD: no price history');
    return {
      symbol: symbol.toUpperCase(),
      prices: rows.sort((a: any, b: any) => String(b.date).localeCompare(String(a.date))).map((item: any) => ({
        date: item.date,
        open: item.open?.toString(),
        high: item.high?.toString(),
        low: item.low?.toString(),
        close: item.close?.toString(),
        volume: item.volume?.toString(),
      })),
    };
  }

  private async fundamentals(symbol: string): Promise<any> {
    const data = await this.makeRequest(`/fundamentals/${this.formatSymbol(symbol)}`, {}, 24 * 60 * 60 * 1000);
    if (!data || typeof data !== 'object' || data.General === undefined) {
      throw new Error('Unavailable via EODHD: no fundamentals');
    }
    return data;
  }

  async getCompanyOverview(symbol: string): Promise<any> {
    const data = await this.fundamentals(symbol);
    return {
      symbol: symbol.toUpperCase(),
      name: data.General?.Name,
      description: data.General?.Description,
      sector: data.General?.Sector,
      industry: data.General?.Industry,
      marketCapitalization: data.Highlights?.MarketCapitalization?.toString(),
      eps: data.Highlights?.EarningsShare?.toString(),
      peRatio: data.Highlights?.PERatio?.toString(),
      forwardPE: data.Valuation?.ForwardPE?.toString(),
      pegRatio: data.Highlights?.PEGRatio?.toString(),
      beta: data.Technicals?.Beta?.toString(),
      dividendYield: data.Highlights?.DividendYield?.toString(),
      dividendPerShare: data.Highlights?.DividendShare?.toString(),
      sharesOutstanding: data.SharesStats?.SharesOutstanding?.toString(),
      analystTargetPrice: data.Highlights?.WallStreetTargetPrice?.toString(),
      profitMargin: data.Highlights?.ProfitMargin?.toString(),
      operatingMargin: data.Highlights?.OperatingMarginTTM?.toString(),
      returnOnEquity: data.Highlights?.ReturnOnEquityTTM?.toString(),
      returnOnAssets: data.Highlights?.ReturnOnAssetsTTM?.toString(),
      quarterlyRevenueGrowth: data.Highlights?.QuarterlyRevenueGrowthYOY?.toString(),
      quarterlyEarningsGrowth: data.Highlights?.QuarterlyEarningsGrowthYOY?.toString(),
    };
  }

  async getBasicFinancials(symbol: string): Promise<any> {
    const data = await this.fundamentals(symbol);
    return {
      symbol: symbol.toUpperCase(),
      metric: {
        peBasicExclExtraTTM: data.Highlights?.PERatio,
        epsTTM: data.Highlights?.EarningsShare,
        revenueGrowthTTM: data.Highlights?.QuarterlyRevenueGrowthYOY,
        epsGrowthTTM: data.Highlights?.QuarterlyEarningsGrowthYOY,
        operatingMarginTTM: data.Highlights?.OperatingMarginTTM,
        netProfitMarginTTM: data.Highlights?.ProfitMargin,
        roeTTM: data.Highlights?.ReturnOnEquityTTM,
        roaTTM: data.Highlights?.ReturnOnAssetsTTM,
      },
      series: {},
    };
  }

  private statementRows(data: any, statement: string, mode: 'yearly' | 'quarterly') {
    const rows = data.Financials?.[statement]?.[mode] || {};
    return Object.entries(rows)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([, row]: [string, any]) => row);
  }

  async getIncomeStatement(symbol: string): Promise<any> {
    const data = await this.fundamentals(symbol);
    const mapRow = (row: any) => ({
      fiscalDateEnding: row.date,
      totalRevenue: row.totalRevenue?.toString(),
      grossProfit: row.grossProfit?.toString(),
      operatingIncome: row.operatingIncome?.toString(),
      netIncome: row.netIncome?.toString(),
      ebitda: row.ebitda?.toString(),
    });
    return {
      symbol: symbol.toUpperCase(),
      annualReports: this.statementRows(data, 'Income_Statement', 'yearly').map(mapRow),
      quarterlyReports: this.statementRows(data, 'Income_Statement', 'quarterly').map(mapRow),
    };
  }

  async getBalanceSheet(symbol: string): Promise<any> {
    const data = await this.fundamentals(symbol);
    const mapRow = (row: any) => ({
      fiscalDateEnding: row.date,
      totalAssets: row.totalAssets?.toString(),
      totalLiabilities: row.totalLiab?.toString() ?? row.totalLiabilities?.toString(),
      totalShareholderEquity: row.totalStockholderEquity?.toString(),
      cashAndCashEquivalentsAtCarryingValue: row.cash?.toString(),
      longTermDebt: row.longTermDebt?.toString(),
    });
    return {
      symbol: symbol.toUpperCase(),
      annualReports: this.statementRows(data, 'Balance_Sheet', 'yearly').map(mapRow),
      quarterlyReports: this.statementRows(data, 'Balance_Sheet', 'quarterly').map(mapRow),
    };
  }

  async getCashFlow(symbol: string): Promise<any> {
    const data = await this.fundamentals(symbol);
    const mapRow = (row: any) => {
      const ocf = row.totalCashFromOperatingActivities ?? row.netCashProvidedByOperatingActivities;
      const capex = row.capitalExpenditures;
      return {
        fiscalDateEnding: row.date,
        operatingCashflow: ocf?.toString(),
        capitalExpenditures: capex?.toString(),
        freeCashFlow: ocf != null && capex != null ? (Number(ocf) - Math.abs(Number(capex))).toString() : undefined,
        dividendPayout: row.dividendsPaid?.toString(),
      };
    };
    return {
      symbol: symbol.toUpperCase(),
      annualReports: this.statementRows(data, 'Cash_Flow', 'yearly').map(mapRow),
      quarterlyReports: this.statementRows(data, 'Cash_Flow', 'quarterly').map(mapRow),
    };
  }

  async searchStock(query: string): Promise<any> {
    const data = await this.makeRequest(`/search/${encodeURIComponent(query)}`, {}, 24 * 60 * 60 * 1000);
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) throw new Error('Unavailable via EODHD: no search results');
    return {
      results: rows.slice(0, 10).map((item: any) => ({
        symbol: String(item.Code || '').toUpperCase(),
        name: item.Name,
        type: item.Type,
        region: item.Country,
        currency: item.Currency,
        exchange: item.Exchange,
        source: 'eodhd',
      })),
    };
  }

  async getCompanyNews(symbol: string, days = 30): Promise<any> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const data = await this.makeRequest('/news', {
      s: this.formatSymbol(symbol),
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      limit: '20',
    }, 30 * 60 * 1000);
    const rows = Array.isArray(data) ? data : [];
    return {
      symbol: symbol.toUpperCase(),
      articles: rows.map((item: any) => ({
        datetime: item.date || null,
        headline: item.title,
        source: item.source,
        url: item.link,
        summary: item.content,
      })),
    };
  }

  async searchNews(query: string, days = 30): Promise<any> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const data = await this.makeRequest('/news', {
      t: query,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      limit: '20',
    }, 30 * 60 * 1000);
    const rows = Array.isArray(data) ? data : [];
    return {
      query,
      articles: rows.map((item: any) => ({
        datetime: item.date || null,
        headline: item.title,
        source: item.source,
        url: item.link,
        summary: item.content,
      })),
    };
  }

  async getInsiderTrading(): Promise<any> { throw new Error('Unavailable via EODHD: insider trading not supported'); }
  async getAnalystRatings(): Promise<any> { throw new Error('Unavailable via EODHD: analyst ratings not supported'); }
  async getAnalystRecommendations(): Promise<any> { throw new Error('Unavailable via EODHD: analyst recommendations not supported'); }
  async getPriceTargets(): Promise<any> { throw new Error('Unavailable via EODHD: price targets not supported'); }
  async getPeers(): Promise<any> { throw new Error('Unavailable via EODHD: peers not supported'); }
  async getEarningsHistory(): Promise<any> { throw new Error('Unavailable via EODHD: earnings history not supported'); }
  async getSectorPerformance(): Promise<any> { throw new Error('Unavailable via EODHD: sector performance not supported'); }
  async getTopGainersLosers(): Promise<any> { throw new Error('Unavailable via EODHD: market movers not supported'); }
  async getNewsSentiment(): Promise<any> { throw new Error('Unavailable via EODHD: news sentiment not supported'); }
}

class MarketauxService implements StockDataService {
  private apiKey = getConfiguredEnv('MARKETAUX_API_KEY') || '';
  private baseUrl = 'https://api.marketaux.com/v1/news/all';
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private lastRequestAt = 0;
  private throttleQueue: Promise<void> = Promise.resolve();
  private minIntervalMs = getProviderMinIntervalMs('MARKETAUX_MIN_INTERVAL_MS', DEFAULT_PROVIDER_MIN_INTERVAL_MS.marketaux);

  private async throttle() {
    if (this.minIntervalMs <= 0) return;
    const next = this.throttleQueue.then(async () => {
      const now = Date.now();
      const wait = this.minIntervalMs - (now - this.lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
    });
    this.throttleQueue = next.catch(() => {});
    await next;
  }

  private async news(params: Record<string, string>) {
    if (!this.apiKey) throw new Error('Unavailable via Marketaux: API key not configured');
    const cacheKey = `marketaux:${JSON.stringify(params)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    await this.throttle();
    try {
      const response = await axios.get(this.baseUrl, {
        params: { ...params, api_token: this.apiKey, language: 'en', limit: params.limit || '20' },
        timeout: 12000,
      });
      const data = response.data;
      if (data?.error) throw new Error(data.error?.message || data.error);
      this.cache.set(cacheKey, { expiresAt: Date.now() + 30 * 60 * 1000, data });
      return data;
    } catch (error: any) {
      const statusCode = error?.response?.status;
      if (statusCode === 429) throw new Error('Marketaux rate limit exceeded (429)');
      if (statusCode === 401 || statusCode === 403) throw new Error(`Unavailable via Marketaux (plan limitation: ${statusCode})`);
      throw new Error(`Marketaux request failed: ${error?.message || 'unknown error'}`);
    }
  }

  private mapArticles(data: any) {
    const articles = Array.isArray(data?.data) ? data.data : [];
    return articles.map((item: any) => ({
      datetime: item.published_at || null,
      headline: item.title,
      source: item.source,
      url: item.url,
      summary: item.description || item.snippet,
      sentimentScore: item.sentiment_score,
    }));
  }

  async getCompanyNews(symbol: string, days = 30): Promise<any> {
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = await this.news({ symbols: symbol.toUpperCase(), published_after: from });
    return { symbol: symbol.toUpperCase(), articles: this.mapArticles(data) };
  }

  async searchNews(query: string, days = 30): Promise<any> {
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = await this.news({ search: query, published_after: from });
    return { query, articles: this.mapArticles(data) };
  }

  async getNewsSentiment(symbol: string): Promise<any> {
    const news = await this.getCompanyNews(symbol, 14);
    const scores = (news.articles || []).map((a: any) => Number(a.sentimentScore)).filter((v: number) => Number.isFinite(v));
    const average = scores.length ? scores.reduce((sum: number, value: number) => sum + value, 0) / scores.length : null;
    return {
      symbol: symbol.toUpperCase(),
      sentiment: average === null ? 'Neutral' : average > 0.15 ? 'Bullish' : average < -0.15 ? 'Bearish' : 'Neutral',
      sentimentScore: average,
      articleCount: news.articles?.length || 0,
      articles: news.articles,
    };
  }

  async getStockPrice(): Promise<any> { throw new Error('Unavailable via Marketaux: market data not supported'); }
  async getPriceHistory(): Promise<any> { throw new Error('Unavailable via Marketaux: market data not supported'); }
  async getCompanyOverview(): Promise<any> { throw new Error('Unavailable via Marketaux: fundamentals not supported'); }
  async getBasicFinancials(): Promise<any> { throw new Error('Unavailable via Marketaux: fundamentals not supported'); }
  async getInsiderTrading(): Promise<any> { throw new Error('Unavailable via Marketaux: insider data not supported'); }
  async getAnalystRatings(): Promise<any> { throw new Error('Unavailable via Marketaux: analyst data not supported'); }
  async getAnalystRecommendations(): Promise<any> { throw new Error('Unavailable via Marketaux: analyst data not supported'); }
  async getPriceTargets(): Promise<any> { throw new Error('Unavailable via Marketaux: analyst data not supported'); }
  async getPeers(): Promise<any> { throw new Error('Unavailable via Marketaux: peer data not supported'); }
  async searchStock(): Promise<any> { throw new Error('Unavailable via Marketaux: stock search not supported'); }
  async getEarningsHistory(): Promise<any> { throw new Error('Unavailable via Marketaux: earnings not supported'); }
  async getIncomeStatement(): Promise<any> { throw new Error('Unavailable via Marketaux: statements not supported'); }
  async getBalanceSheet(): Promise<any> { throw new Error('Unavailable via Marketaux: statements not supported'); }
  async getCashFlow(): Promise<any> { throw new Error('Unavailable via Marketaux: statements not supported'); }
  async getSectorPerformance(): Promise<any> { throw new Error('Unavailable via Marketaux: sector performance not supported'); }
  async getTopGainersLosers(): Promise<any> { throw new Error('Unavailable via Marketaux: movers not supported'); }
}

type ProviderId = 'alphavantage' | 'finnhub' | 'fmp' | 'twelvedata' | 'stooq' | 'eodhd' | 'marketaux' | 'openfigi';
const PROVIDER_LABELS: Record<ProviderId, string> = {
  alphavantage: 'Alpha Vantage',
  finnhub: 'Finnhub',
  fmp: 'Financial Modeling Prep',
  twelvedata: 'Twelve Data',
  stooq: 'Stooq',
  eodhd: 'EODHD',
  marketaux: 'Marketaux',
  openfigi: 'OpenFIGI',
};

const METHOD_PROVIDER_PRIORITY: Partial<Record<keyof StockDataService, ProviderId[]>> = {
  getStockPrice: ['finnhub', 'fmp', 'twelvedata', 'alphavantage', 'stooq', 'eodhd'],
  getPriceHistory: ['finnhub', 'fmp', 'twelvedata', 'stooq', 'alphavantage', 'eodhd'],
  getCompanyOverview: ['fmp', 'finnhub', 'alphavantage', 'eodhd', 'twelvedata', 'stooq'],
  getBasicFinancials: ['fmp', 'finnhub', 'alphavantage', 'eodhd', 'twelvedata', 'stooq'],
  getAnalystRatings: ['finnhub', 'fmp', 'alphavantage', 'eodhd', 'twelvedata', 'stooq'],
  getAnalystRecommendations: ['finnhub', 'fmp', 'alphavantage', 'eodhd', 'twelvedata', 'stooq'],
  getPriceTargets: ['finnhub', 'fmp', 'alphavantage', 'eodhd', 'twelvedata', 'stooq'],
  getPeers: ['finnhub', 'fmp', 'alphavantage', 'eodhd', 'twelvedata', 'stooq'],
  // Search requests are high-frequency during ticker resolution, so prefer the roomier
  // free-tier providers before spending Alpha Vantage's much tighter daily quota.
  searchStock: ['finnhub', 'fmp', 'openfigi', 'eodhd', 'alphavantage', 'twelvedata', 'stooq'],
  getEarningsHistory: ['finnhub', 'fmp', 'alphavantage', 'eodhd', 'twelvedata', 'stooq'],
  getIncomeStatement: ['fmp', 'finnhub', 'alphavantage', 'eodhd', 'twelvedata', 'stooq'],
  getBalanceSheet: ['fmp', 'finnhub', 'alphavantage', 'eodhd', 'twelvedata', 'stooq'],
  getCashFlow: ['fmp', 'finnhub', 'alphavantage', 'eodhd', 'twelvedata', 'stooq'],
  getNewsSentiment: ['marketaux', 'finnhub', 'fmp', 'alphavantage', 'eodhd', 'twelvedata', 'stooq'],
  getCompanyNews: ['marketaux', 'finnhub', 'fmp', 'alphavantage', 'eodhd', 'twelvedata', 'stooq'],
  searchNews: ['marketaux', 'fmp', 'eodhd', 'finnhub', 'alphavantage', 'twelvedata', 'stooq'],
  getSectorPerformance: ['fmp', 'alphavantage', 'finnhub', 'twelvedata', 'stooq'],
  getTopGainersLosers: ['fmp', 'alphavantage', 'finnhub', 'twelvedata', 'stooq'],
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

function countMeaningfulLeaves(value: any, depth = 0): number {
  if (!hasMeaningfulValue(value)) return 0;
  if (depth >= 4) return 1;
  if (Array.isArray(value)) {
    return value.slice(0, 5).reduce((total, entry) => total + countMeaningfulLeaves(entry, depth + 1), 0);
  }
  if (typeof value === 'object') {
    return Object.keys(value).slice(0, 20).reduce<number>(
      (total, key) => total + countMeaningfulLeaves((value as Record<string, unknown>)[key], depth + 1),
      0
    );
  }
  return 1;
}

function shouldMergeAnotherProvider(method: keyof StockDataService, result: any): boolean {
  if (!MERGEABLE_METHODS.has(method)) return false;
  if (!result || typeof result !== 'object') return true;

  switch (method) {
    case 'getCompanyOverview':
      return countMeaningfulLeaves(result) < 12;
    case 'getBasicFinancials':
      return countMeaningfulLeaves(result) < 8;
    case 'getIncomeStatement':
    case 'getBalanceSheet':
    case 'getCashFlow':
      return (
        !hasMeaningfulValue((result as any)?.annualReports) &&
        !hasMeaningfulValue((result as any)?.quarterlyReports) &&
        !hasMeaningfulValue((result as any)?.annual) &&
        !hasMeaningfulValue((result as any)?.quarterly) &&
        countMeaningfulLeaves(result) < 6
      );
    default:
      return false;
  }
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
    const mergeSources: string[] = [];
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
        if (mergeCount >= 2 || !shouldMergeAnotherProvider(method, mergedResult)) {
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
  const alphaVantageKey = (isPlaceholderEnvValue(apiKey) ? undefined : apiKey) || getConfiguredEnv('ALPHA_VANTAGE_API_KEY');
  const finnhubKey = getConfiguredEnv('FINNHUB_API_KEY');
  const fmpKey = getConfiguredEnv('FINANCIAL_MODELING_PREP_API_KEY');
  const twelveKey = getConfiguredEnv('TWELVE_DATA_API_KEY');
  const openFigiKey = getConfiguredEnv('OPENFIGI_API_KEY');
  const eodhdKey = getConfiguredEnv('EODHD_API_KEY');
  const marketauxKey = getConfiguredEnv('MARKETAUX_API_KEY');
  const providers: Array<{ id: ProviderId; service: StockDataService }> = [];
  if (alphaVantageKey) {
    providers.push({ id: 'alphavantage', service: new AlphaVantageService(alphaVantageKey) });
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
  if (openFigiKey) {
    providers.push({ id: 'openfigi', service: new OpenFigiService() });
  }
  if (eodhdKey) {
    providers.push({ id: 'eodhd', service: new EodhdService() });
  }
  if (marketauxKey) {
    providers.push({ id: 'marketaux', service: new MarketauxService() });
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
    this.apiKey = (isPlaceholderEnvValue(apiKey) ? undefined : apiKey) || getConfiguredEnv('FRED_API_KEY') || '';
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

function parseApiNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * BEA API service — official U.S. macro/industry data, free API key required.
 */
export class BeaService {
  private apiKey = getConfiguredEnv('BEA_API_KEY') || '';
  private baseUrl = 'https://apps.bea.gov/api/data';
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private cacheTtlMs = Number(process.env.BEA_CACHE_TTL_MS || 12 * 60 * 60 * 1000);

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private async getNipaTable(tableName: string, frequency = 'Q', year = 'LAST5'): Promise<any[]> {
    if (!this.isConfigured()) {
      throw new Error('BEA_API_KEY not configured');
    }
    const cacheKey = `bea:${tableName}:${frequency}:${year}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const resp = await axios.get(this.baseUrl, {
      params: {
        UserID: this.apiKey,
        method: 'GetData',
        datasetname: 'NIPA',
        TableName: tableName,
        Frequency: frequency,
        Year: year,
        ResultFormat: 'JSON',
      },
      timeout: 15000,
    });
    const apiError = resp.data?.BEAAPI?.Error?.APIErrorDescription || resp.data?.BEAAPI?.Results?.Error;
    if (apiError) throw new Error(String(apiError));
    const rows = resp.data?.BEAAPI?.Results?.Data;
    const data = Array.isArray(rows) ? rows : [];
    this.cache.set(cacheKey, { expiresAt: Date.now() + this.cacheTtlMs, data });
    return data;
  }

  private latestMatching(rows: any[], pattern: RegExp) {
    const matches = rows
      .filter((row) => pattern.test(String(row.LineDescription || row.LineDescription2 || '')))
      .sort((a, b) => String(b.TimePeriod || '').localeCompare(String(a.TimePeriod || '')));
    const row = matches[0];
    if (!row) return null;
    return {
      lineNumber: row.LineNumber ? String(row.LineNumber) : null,
      description: row.LineDescription || null,
      timePeriod: row.TimePeriod || null,
      value: parseApiNumber(row.DataValue),
      unit: row.CL_UNIT || row.UnitOfMeasure || null,
      tableName: row.TableName || null,
    };
  }

  async getMacroIndicators(): Promise<any> {
    if (!this.isConfigured()) {
      return { error: 'BEA_API_KEY not configured. Get a free key from bea.gov/API/signup.' };
    }
    const [growthRows, levelRows] = await Promise.all([
      this.getNipaTable('T10101', 'Q', 'LAST5'),
      this.getNipaTable('T10105', 'Q', 'LAST5'),
    ]);
    const indicators = {
      realGdpGrowth: this.latestMatching(growthRows, /^Gross domestic product$/i),
      pceGrowth: this.latestMatching(growthRows, /^Personal consumption expenditures$/i),
      privateInvestmentGrowth: this.latestMatching(growthRows, /^Gross private domestic investment$/i),
      exportsGrowth: this.latestMatching(growthRows, /^Exports$/i),
      importsGrowth: this.latestMatching(growthRows, /^Imports$/i),
      governmentSpendingGrowth: this.latestMatching(growthRows, /^Government consumption expenditures/i),
      nominalGdp: this.latestMatching(levelRows, /^Gross domestic product$/i),
      personalConsumption: this.latestMatching(levelRows, /^Personal consumption expenditures$/i),
    };
    return {
      indicators,
      sourceTables: [
        { tableName: 'T10101', description: 'Percent change from preceding period in real GDP and major components' },
        { tableName: 'T10105', description: 'Gross domestic product and major components, current dollars' },
      ],
      fetchedAt: new Date().toISOString(),
      __source: 'BEA NIPA API',
    };
  }
}

/**
 * EIA API service — official U.S. energy data, free API key required.
 */
export class EiaService {
  private apiKey = getConfiguredEnv('EIA_API_KEY') || '';
  private baseUrl = 'https://api.eia.gov/v2/seriesid';
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private cacheTtlMs = Number(process.env.EIA_CACHE_TTL_MS || 12 * 60 * 60 * 1000);

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private async getSeries(seriesId: string): Promise<any> {
    if (!this.isConfigured()) {
      throw new Error('EIA_API_KEY not configured');
    }
    const cacheKey = `eia:${seriesId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const resp = await axios.get(`${this.baseUrl}/${encodeURIComponent(seriesId)}`, {
      params: {
        api_key: this.apiKey,
        length: '24',
      },
      timeout: 15000,
    });
    const rows = resp.data?.response?.data;
    const sorted = Array.isArray(rows)
      ? rows.sort((a: any, b: any) => String(b.period || '').localeCompare(String(a.period || '')))
      : [];
    const latest = sorted[0] || null;
    const data = {
      seriesId,
      name: resp.data?.response?.description || resp.data?.response?.name || seriesId,
      latest: latest ? {
        period: latest.period || null,
        value: parseApiNumber(latest.value),
        units: latest.units || latest.unit || null,
      } : null,
      observations: sorted.map((row: any) => ({
        period: row.period || null,
        value: parseApiNumber(row.value),
        units: row.units || row.unit || null,
      })),
    };
    this.cache.set(cacheKey, { expiresAt: Date.now() + this.cacheTtlMs, data });
    return data;
  }

  async getEnergyIndicators(): Promise<any> {
    if (!this.isConfigured()) {
      return { error: 'EIA_API_KEY not configured. Get a free key from eia.gov/opendata.' };
    }
    const series = [
      { id: 'wtiCrudeSpot', seriesId: 'PET.RWTC.D', label: 'WTI crude oil spot price' },
      { id: 'henryHubGasSpot', seriesId: 'NG.RNGWHHD.D', label: 'Henry Hub natural gas spot price' },
      { id: 'usRetailElectricityPrice', seriesId: 'ELEC.PRICE.US-ALL.M', label: 'U.S. average retail electricity price' },
      { id: 'usElectricityGeneration', seriesId: 'ELEC.GEN.ALL-US-99.M', label: 'U.S. electricity net generation, all fuels' },
    ];
    const indicators = await Promise.all(series.map(async (config) => {
      try {
        const data = await this.getSeries(config.seriesId);
        return { ...config, ...data };
      } catch (error: any) {
        return { ...config, latest: null, observations: [], error: error?.message || 'Unavailable' };
      }
    }));
    return {
      indicators,
      fetchedAt: new Date().toISOString(),
      __source: 'EIA Open Data API',
    };
  }
}

type SecTickerEntry = {
  cik_str: number;
  ticker: string;
  title: string;
};

type NormalizedSecFact = {
  tag: string;
  label: string;
  unit: string;
  value: number;
  start: string | null;
  end: string | null;
  filed: string | null;
  form: string | null;
  fp: string | null;
  frame?: string | null;
  period: 'annual' | 'interim' | 'instant';
};

const SEC_FACT_TAGS: Record<string, { label: string; tags: string[]; units: string[]; kind: 'duration' | 'instant' }> = {
  revenue: {
    label: 'Revenue',
    tags: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'],
    units: ['USD'],
    kind: 'duration',
  },
  grossProfit: {
    label: 'Gross profit',
    tags: ['GrossProfit'],
    units: ['USD'],
    kind: 'duration',
  },
  operatingIncome: {
    label: 'Operating income',
    tags: ['OperatingIncomeLoss', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest'],
    units: ['USD'],
    kind: 'duration',
  },
  netIncome: {
    label: 'Net income',
    tags: ['NetIncomeLoss', 'ProfitLoss'],
    units: ['USD'],
    kind: 'duration',
  },
  assets: {
    label: 'Assets',
    tags: ['Assets'],
    units: ['USD'],
    kind: 'instant',
  },
  liabilities: {
    label: 'Liabilities',
    tags: ['Liabilities'],
    units: ['USD'],
    kind: 'instant',
  },
  equity: {
    label: 'Shareholders equity',
    tags: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    units: ['USD'],
    kind: 'instant',
  },
  cash: {
    label: 'Cash and equivalents',
    tags: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
    units: ['USD'],
    kind: 'instant',
  },
  operatingCashFlow: {
    label: 'Operating cash flow',
    tags: ['NetCashProvidedByUsedInOperatingActivities'],
    units: ['USD'],
    kind: 'duration',
  },
  capex: {
    label: 'Capital expenditures',
    tags: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
    units: ['USD'],
    kind: 'duration',
  },
  dilutedShares: {
    label: 'Diluted shares',
    tags: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
    units: ['shares'],
    kind: 'duration',
  },
  dilutedEps: {
    label: 'Diluted EPS',
    tags: ['EarningsPerShareDiluted'],
    units: ['USD/shares', 'USD/shares'],
    kind: 'duration',
  },
};

/**
 * SEC XBRL companyfacts service — official, no API key required.
 * Returns compact normalized facts only; callers should not dump full companyfacts
 * payloads into LLM context.
 */
export class SecCompanyFactsService {
  private companyTickersUrl = 'https://www.sec.gov/files/company_tickers.json';
  private companyFactsUrl = 'https://data.sec.gov/api/xbrl/companyfacts';
  private userAgent = process.env.SEC_USER_AGENT || 'StockResearchBot/1.0 contact@example.com';
  private static tickerCache: { expiresAt: number; entries: SecTickerEntry[] } | null = null;
  private static factsCache = new Map<string, { expiresAt: number; data: any }>();
  private cacheTtlMs = Number(process.env.SEC_COMPANY_FACTS_CACHE_TTL_MS || 12 * 60 * 60 * 1000);

  private async getTickerEntries(): Promise<SecTickerEntry[]> {
    const cached = SecCompanyFactsService.tickerCache;
    if (cached && cached.expiresAt > Date.now()) return cached.entries;
    const resp = await axios.get(this.companyTickersUrl, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      timeout: 10000,
    });
    const entries = Object.values(resp.data || {}) as SecTickerEntry[];
    SecCompanyFactsService.tickerCache = {
      expiresAt: Date.now() + this.cacheTtlMs,
      entries,
    };
    return entries;
  }

  async resolveTicker(ticker: string): Promise<{ cik: string; ticker: string; name: string } | null> {
    const normalized = String(ticker || '').trim().toUpperCase();
    if (!normalized) return null;
    const entries = await this.getTickerEntries();
    const matched = entries.find((entry) => String(entry.ticker).toUpperCase() === normalized);
    if (!matched) return null;
    return {
      cik: String(matched.cik_str).padStart(10, '0'),
      ticker: String(matched.ticker).toUpperCase(),
      name: matched.title,
    };
  }

  async getCompanyFacts(ticker: string): Promise<any> {
    const resolved = await this.resolveTicker(ticker);
    if (!resolved) {
      return { ticker: String(ticker || '').toUpperCase(), error: 'Ticker not found in SEC company_tickers mapping.' };
    }
    const cached = SecCompanyFactsService.factsCache.get(resolved.cik);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.data, __source: 'SEC companyfacts' };
    }
    const resp = await axios.get(`${this.companyFactsUrl}/CIK${resolved.cik}.json`, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      timeout: 15000,
    });
    const data = {
      cik: resolved.cik,
      ticker: resolved.ticker,
      name: resolved.name,
      entityName: resp.data?.entityName || resolved.name,
      facts: resp.data?.facts || {},
      fetchedAt: new Date().toISOString(),
    };
    SecCompanyFactsService.factsCache.set(resolved.cik, {
      expiresAt: Date.now() + this.cacheTtlMs,
      data,
    });
    return { ...data, __source: 'SEC companyfacts' };
  }

  private factDurationDays(fact: any): number | null {
    const start = fact?.start ? Date.parse(String(fact.start)) : NaN;
    const end = fact?.end ? Date.parse(String(fact.end)) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return Math.round((end - start) / (24 * 60 * 60 * 1000));
  }

  private isAnnualDurationFact(fact: any): boolean {
    const fp = String(fact?.fp || '').toUpperCase();
    const form = String(fact?.form || '').toUpperCase();
    const frame = String(fact?.frame || '').toUpperCase();
    const durationDays = this.factDurationDays(fact);
    return (
      fp === 'FY' ||
      /^(10-K|20-F|40-F)$/.test(form) ||
      (durationDays !== null && durationDays >= 300) ||
      /^CY\d{4}$/.test(frame)
    );
  }

  private sortFactsByPeriod(a: any, b: any): number {
    const endCompare = String(b.end || '').localeCompare(String(a.end || ''));
    if (endCompare !== 0) return endCompare;
    return String(b.filed || '').localeCompare(String(a.filed || ''));
  }

  private latestFact(companyFacts: any, config: { label: string; tags: string[]; units: string[]; kind: 'duration' | 'instant' }): NormalizedSecFact | null {
    const usGaap = companyFacts?.facts?.['us-gaap'] || {};
    const candidates: Array<{ tag: string; unit: string; fact: any; tagRank: number }> = [];
    for (const [tagRank, tag] of config.tags.entries()) {
      const concept = usGaap[tag];
      if (!concept?.units) continue;
      for (const unit of config.units) {
        const facts = Array.isArray(concept.units[unit]) ? concept.units[unit] : [];
        candidates.push(...facts
          .filter((fact: any) => Number.isFinite(Number(fact.val)))
          .filter((fact: any) => !fact.form || /^(10-K|10-Q|20-F|40-F|6-K|8-K)$/i.test(String(fact.form)))
          .filter((fact: any) => config.kind === 'instant' || this.factDurationDays(fact) !== null || this.isAnnualDurationFact(fact))
          .map((fact: any) => ({ tag, unit, fact, tagRank })));
      }
    }
    const preferred = config.kind === 'duration'
      ? candidates.filter((entry) => this.isAnnualDurationFact(entry.fact))
      : candidates;
    const latest = [...(preferred.length ? preferred : candidates)].sort((a, b) => {
      const periodCompare = this.sortFactsByPeriod(a.fact, b.fact);
      if (periodCompare !== 0) return periodCompare;
      return a.tagRank - b.tagRank;
    })[0];
    if (latest) {
      return {
        tag: latest.tag,
        label: config.label,
        unit: latest.unit,
        value: Number(latest.fact.val),
        start: latest.fact.start || null,
        end: latest.fact.end || null,
        filed: latest.fact.filed || null,
        form: latest.fact.form || null,
        fp: latest.fact.fp || null,
        frame: latest.fact.frame || null,
        period: config.kind === 'instant' ? 'instant' : this.isAnnualDurationFact(latest.fact) ? 'annual' : 'interim',
      };
    }
    return null;
  }

  async getNormalizedFinancialFacts(ticker: string): Promise<any> {
    const companyFacts = await this.getCompanyFacts(ticker);
    if (companyFacts.error) return companyFacts;
    const facts = Object.fromEntries(
      Object.entries(SEC_FACT_TAGS).map(([key, config]) => [key, this.latestFact(companyFacts, config)])
    );
    const operatingCashFlow = facts.operatingCashFlow as NormalizedSecFact | null;
    const capex = facts.capex as NormalizedSecFact | null;
    const freeCashFlow =
      operatingCashFlow && capex && operatingCashFlow.end && capex.end && operatingCashFlow.end === capex.end
        ? {
          label: 'Free cash flow',
          unit: 'USD',
          value: operatingCashFlow.value - Math.abs(capex.value),
          formula: 'operatingCashFlow - abs(capex)',
          sourceTags: [operatingCashFlow.tag, capex.tag],
          end: operatingCashFlow.end,
          filed: operatingCashFlow.filed,
        }
        : null;
    return {
      ticker: companyFacts.ticker,
      cik: companyFacts.cik,
      name: companyFacts.name,
      entityName: companyFacts.entityName,
      facts,
      freeCashFlow,
      fetchedAt: companyFacts.fetchedAt,
      __source: 'SEC companyfacts',
    };
  }
}

/**
 * U.S. Treasury daily yield curve feed — official XML, no API key required.
 */
export class TreasuryYieldCurveService {
  private baseUrl = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml';
  private static cache = new Map<string, { expiresAt: number; data: any }>();
  private cacheTtlMs = Number(process.env.TREASURY_RATES_CACHE_TTL_MS || 12 * 60 * 60 * 1000);

  private textBetween(block: string, tagName: string): string | null {
    const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`<d:${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/d:${escaped}>`, 'i');
    const match = block.match(pattern);
    if (!match) return null;
    return match[1].replace(/<[^>]+>/g, '').trim() || null;
  }

  private parseNumber(value: string | null): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseEntries(xml: string) {
    const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
    return entries.map((entry) => {
      const dateRaw = this.textBetween(entry, 'NEW_DATE') || this.textBetween(entry, 'NEW_DATE_1');
      const date = dateRaw ? dateRaw.slice(0, 10) : null;
      return {
        date,
        month1: this.parseNumber(this.textBetween(entry, 'BC_1MONTH')),
        month2: this.parseNumber(this.textBetween(entry, 'BC_2MONTH')),
        month3: this.parseNumber(this.textBetween(entry, 'BC_3MONTH')),
        month4: this.parseNumber(this.textBetween(entry, 'BC_4MONTH')),
        month6: this.parseNumber(this.textBetween(entry, 'BC_6MONTH')),
        year1: this.parseNumber(this.textBetween(entry, 'BC_1YEAR')),
        year2: this.parseNumber(this.textBetween(entry, 'BC_2YEAR')),
        year3: this.parseNumber(this.textBetween(entry, 'BC_3YEAR')),
        year5: this.parseNumber(this.textBetween(entry, 'BC_5YEAR')),
        year7: this.parseNumber(this.textBetween(entry, 'BC_7YEAR')),
        year10: this.parseNumber(this.textBetween(entry, 'BC_10YEAR')),
        year20: this.parseNumber(this.textBetween(entry, 'BC_20YEAR')),
        year30: this.parseNumber(this.textBetween(entry, 'BC_30YEAR')),
      };
    }).filter((entry) => entry.date);
  }

  async getLatestYieldCurve(year = new Date().getUTCFullYear()): Promise<any> {
    const cacheKey = `yield:${year}`;
    const cached = TreasuryYieldCurveService.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const resp = await axios.get(this.baseUrl, {
      params: {
        data: 'daily_treasury_yield_curve',
        field_tdr_date_value: String(year),
      },
      timeout: 15000,
    });
    const observations = this.parseEntries(String(resp.data || '')).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const latest = observations[0] || null;
    const data = {
      year,
      latest,
      observations,
      yieldCurve: latest ? {
        tenYearMinusTwoYear: latest.year10 !== null && latest.year2 !== null ? Number((latest.year10 - latest.year2).toFixed(3)) : null,
        thirtyYearMinusThreeMonth: latest.year30 !== null && latest.month3 !== null ? Number((latest.year30 - latest.month3).toFixed(3)) : null,
      } : null,
      fetchedAt: new Date().toISOString(),
      __source: 'U.S. Treasury daily yield curve',
    };
    TreasuryYieldCurveService.cache.set(cacheKey, { expiresAt: Date.now() + this.cacheTtlMs, data });
    return data;
  }
}

/**
 * BLS Public Data API — no key required for limited use; optional BLS_API_KEY
 * raises the daily query ceiling.
 */
export class BlsPublicDataService {
  private baseUrl = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
  private apiKey = getConfiguredEnv('BLS_API_KEY') || '';
  private static cache: { expiresAt: number; data: any } | null = null;
  private cacheTtlMs = Number(process.env.BLS_MACRO_CACHE_TTL_MS || 12 * 60 * 60 * 1000);
  private series = [
    { id: 'CPI_ALL_URBAN', seriesId: 'CUUR0000SA0', name: 'CPI-U: All items' },
    { id: 'CORE_CPI', seriesId: 'CUSR0000SA0L1E', name: 'Core CPI-U less food and energy' },
    { id: 'UNEMPLOYMENT_RATE', seriesId: 'LNS14000000', name: 'Unemployment rate' },
    { id: 'NONFARM_PAYROLLS', seriesId: 'CES0000000001', name: 'All employees, total nonfarm' },
    { id: 'AVG_HOURLY_EARNINGS', seriesId: 'CES0500000003', name: 'Average hourly earnings, private' },
  ];

  private parseSeries(series: any) {
    const observations = (series?.data || [])
      .filter((point: any) => /^M\d{2}$/.test(String(point.period || '')))
      .map((point: any) => ({
        year: String(point.year),
        period: String(point.period),
        periodName: String(point.periodName || ''),
        date: `${point.year}-${String(point.period).slice(1).padStart(2, '0')}`,
        value: Number.isFinite(Number(point.value)) ? Number(point.value) : null,
        latest: point.latest === 'true',
      }))
      .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
    const latest = observations[observations.length - 1] || null;
    const priorYear = latest
      ? observations.find((point: any) => point.date === `${Number(latest.year) - 1}-${String(latest.period).slice(1).padStart(2, '0')}`)
      : null;
    const yoyPercent = latest?.value !== null && priorYear?.value
      ? Number((((latest.value - priorYear.value) / priorYear.value) * 100).toFixed(2))
      : null;
    return { observations, latest, yoyPercent };
  }

  async getMacroIndicators(): Promise<any> {
    if (BlsPublicDataService.cache && BlsPublicDataService.cache.expiresAt > Date.now()) {
      return BlsPublicDataService.cache.data;
    }
    const now = new Date();
    const payload: Record<string, any> = {
      seriesid: this.series.map((item) => item.seriesId),
      startyear: String(now.getUTCFullYear() - 2),
      endyear: String(now.getUTCFullYear()),
    };
    if (this.apiKey) payload.registrationkey = this.apiKey;
    const resp = await axios.post(this.baseUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    const returnedSeries = resp.data?.Results?.series || [];
    const indicators = this.series.map((config) => {
      const sourceSeries = returnedSeries.find((series: any) => series.seriesID === config.seriesId);
      return {
        ...config,
        ...this.parseSeries(sourceSeries),
      };
    });
    const data = {
      status: resp.data?.status || 'UNKNOWN',
      messages: resp.data?.message || [],
      indicators,
      fetchedAt: new Date().toISOString(),
      quotaMode: this.apiKey ? 'registered' : 'unregistered',
      __source: 'BLS Public Data API',
    };
    BlsPublicDataService.cache = { expiresAt: Date.now() + this.cacheTtlMs, data };
    return data;
  }
}
