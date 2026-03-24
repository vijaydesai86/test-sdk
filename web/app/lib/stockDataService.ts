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
  getDividendHistory(symbol: string, years?: number): Promise<any>;
  getStockSplits(symbol: string, years?: number): Promise<any>;
  getEarningsCalendar(symbol?: string, weeks?: number): Promise<any>;
  getIpoCalendar(weeks?: number): Promise<any>;
  getEconomicIndicators(): Promise<any>;
  getTechnicalIndicators(symbol: string): Promise<any>;
  getCommodityPrices(commodities?: string[]): Promise<any>;
  getForexRate(fromCurrency: string, toCurrency: string): Promise<any>;
  getMarketStatus(): Promise<any>;
}

type Provider = 'alphavantage' | 'finnhub' | 'hybrid';
const PROVIDER_ENV = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase() as Provider;

/**
 * Compute RSI-14 (Wilder), MACD(12,26,9), SMA-20, SMA-50, and Bollinger Bands(20,2)
 * from a closing-price series. `closes` must be in ascending date order (oldest first).
 * Returns the most recent computed values along with a plain-English interpretation.
 */
function computeTechnicalIndicators(
  symbol: string,
  closes: number[],
  prices: Array<{ date: string }>
): any {
  const len = closes.length;
  const lastDate = len > 0 ? (prices[len - 1]?.date ?? null) : null;

  // --- SMA ---
  const smaOf = (n: number): number | null => {
    if (len < n) return null;
    return parseFloat((closes.slice(len - n).reduce((a, b) => a + b, 0) / n).toFixed(4));
  };

  // --- EMA (returns full series from seed) ---
  const emaOf = (n: number, data: number[]): number[] => {
    if (data.length < n) return [];
    const k = 2 / (n + 1);
    let val = data.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const out = [val];
    for (let i = n; i < data.length; i++) {
      val = data[i] * k + val * (1 - k);
      out.push(val);
    }
    return out;
  };

  // --- Wilder's RSI-14 ---
  const computeRsi14 = (): number | null => {
    if (len < 15) return null;
    const changes = closes.slice(1).map((v, i) => v - closes[i]);
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < 14; i++) {
      if (changes[i] > 0) avgGain += changes[i];
      else avgLoss -= changes[i];
    }
    avgGain /= 14;
    avgLoss /= 14;
    for (let i = 14; i < changes.length; i++) {
      const gain = changes[i] > 0 ? changes[i] : 0;
      const loss = changes[i] < 0 ? -changes[i] : 0;
      avgGain = (avgGain * 13 + gain) / 14;
      avgLoss = (avgLoss * 13 + loss) / 14;
    }
    if (avgLoss === 0) return 100;
    return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
  };

  // --- MACD(12,26,9) ---
  const computeMACD = (): { macd: number; signal: number; histogram: number } | null => {
    const ema12 = emaOf(12, closes);
    const ema26 = emaOf(26, closes);
    if (ema12.length < 9 || ema26.length < 9) return null;
    const n = Math.min(ema12.length, ema26.length);
    const macdLine = ema26.slice(ema26.length - n).map((v, i) => ema12[ema12.length - n + i] - v);
    const signal9 = emaOf(9, macdLine);
    if (!signal9.length) return null;
    const lastMacd = macdLine[macdLine.length - 1];
    const lastSignal = signal9[signal9.length - 1];
    return {
      macd: parseFloat(lastMacd.toFixed(4)),
      signal: parseFloat(lastSignal.toFixed(4)),
      histogram: parseFloat((lastMacd - lastSignal).toFixed(4)),
    };
  };

  // --- Bollinger Bands(20, 2σ) ---
  const computeBBands = (): { upper: number; middle: number; lower: number } | null => {
    if (len < 20) return null;
    const slice = closes.slice(-20);
    const mid = slice.reduce((a, b) => a + b, 0) / 20;
    const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / 20;
    const sd = Math.sqrt(variance);
    return {
      upper: parseFloat((mid + 2 * sd).toFixed(4)),
      middle: parseFloat(mid.toFixed(4)),
      lower: parseFloat((mid - 2 * sd).toFixed(4)),
    };
  };

  const rsi14 = computeRsi14();
  const macd = computeMACD();
  const bbands = computeBBands();

  return {
    symbol,
    asOf: lastDate,
    rsi14,
    macd,
    sma20: smaOf(20),
    sma50: smaOf(50),
    bbands,
    interpretation: {
      rsi: rsi14 === null
        ? null
        : rsi14 > 70 ? 'Overbought (>70)'
        : rsi14 < 30 ? 'Oversold (<30)'
        : 'Neutral (30–70)',
      macd: !macd
        ? null
        : macd.histogram > 0
          ? 'Bullish (MACD above signal line)'
          : 'Bearish (MACD below signal line)',
    },
  };
}

/**
 * Stock data service using Alpha Vantage API (free tier)
 * Note: Alpha Vantage free tier has a limit of 5 API calls per minute and 25 per day.
 *
 * Circuit breaker: once a rate-limit response is detected the class-level
 * `rateLimitedUntilMs` flag is set.  All subsequent `makeRequest` calls skip
 * the throttle and throw immediately (matching the "Unavailable via Alpha Vantage"
 * suppression pattern) so HybridStockDataService falls back to Finnhub instantly
 * instead of wasting 1200 ms per call.
 */
export class AlphaVantageService implements StockDataService {
  private apiKey: string;
  private baseUrl = 'https://www.alphavantage.co/query';
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private static sharedCache = new Map<string, { expiresAt: number; data: any }>();
  private minIntervals = {
    alphavantage: Number(process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS || 1200),
  };

  // ── Circuit breaker ──────────────────────────────────────────────────────────
  // Shared across every AlphaVantageService instance in the same Node.js process.
  // When > Date.now() all makeRequest calls throw immediately without throttling.
  private static rateLimitedUntilMs = 0;
  // Conservative lockout for the 25 req/day limit — 1 hour gives the daily counter
  // time to partially reset without hammering AV until midnight.
  private static readonly DAILY_LIMIT_LOCKOUT_MS = 60 * 60 * 1000;
  // 65-second lockout for per-second/per-minute limit messages (5 s buffer).
  private static readonly PER_MINUTE_LOCKOUT_MS = 65 * 1000;
  // ────────────────────────────────────────────────────────────────────────────

  // ── Queue-based throttle ─────────────────────────────────────────────────────
  // Each new call chains a fixed-interval slot onto the previous one.
  // This correctly serialises both sequential AND concurrent callers without the
  // race condition in the timestamp-comparison approach (where all concurrent calls
  // read the same lastRequestAt and all fire simultaneously).
  private throttleQueue = Promise.resolve();
  // ────────────────────────────────────────────────────────────────────────────

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

  /** Queue a slot in the throttle chain.  Safe for concurrent callers. */
  private throttle(minIntervalMs: number): Promise<void> {
    if (minIntervalMs <= 0) return Promise.resolve();
    // Append a new slot that fires `minIntervalMs` after the previous slot resolves.
    // Because Promise.all calls this synchronously for each entry, the chain is built
    // atomically within a single event-loop tick — no race condition.
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
      // ── Circuit breaker: skip throttle + HTTP when rate-limited ─────────────
      if (AlphaVantageService.rateLimitedUntilMs > Date.now()) {
        throw new Error(
          'Unavailable via Alpha Vantage: rate limit active — falling back to alternative source'
        );
      }
      // ─────────────────────────────────────────────────────────────────────────

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

        // Detect rate-limit messages in the response body (AV returns HTTP 200 even when limited).
        const limitMsg: string = (data?.Note || data?.Information || '') as string;
        if (limitMsg) {
          // Determine lockout duration: per-day limit is much longer than per-second/minute.
          const isDaily = /per day|\d+ requests per day/i.test(limitMsg);
          AlphaVantageService.rateLimitedUntilMs =
            Date.now() +
            (isDaily
              ? AlphaVantageService.DAILY_LIMIT_LOCKOUT_MS
              : AlphaVantageService.PER_MINUTE_LOCKOUT_MS);
          // Use the suppression-compatible prefix so HybridStockDataService's
          // withFallback can catch it silently and route straight to Finnhub.
          throw new Error(
            'Unavailable via Alpha Vantage: rate limit active — falling back to alternative source'
          );
        }

        if (data?.['Error Message']) {
          throw new Error(data['Error Message']);
        }
        return data;
      } catch (error: any) {
        // Re-throw AV rate-limit errors as-is (already in "Unavailable via" format).
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
      queries.map((query) => this.searchStock(query).catch((err: any) => {
        // Rate-limit errors must propagate so withFallback can try Finnhub's /stock/peers.
        if (String(err?.message || '').startsWith('Unavailable via Alpha Vantage')) throw err;
        return { results: [] };
      }))
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

  async getDividendHistory(_symbol: string, _years = 5): Promise<any> {
    throw new Error('Dividend history unavailable in Alpha-only mode');
  }

  async getStockSplits(_symbol: string, _years = 10): Promise<any> {
    throw new Error('Stock splits unavailable in Alpha-only mode');
  }

  async getEarningsCalendar(_symbol?: string, _weeks = 4): Promise<any> {
    throw new Error('Earnings calendar unavailable in Alpha-only mode');
  }

  async getIpoCalendar(_weeks = 4): Promise<any> {
    throw new Error('IPO calendar unavailable in Alpha-only mode');
  }

  async getEconomicIndicators(): Promise<any> {
    // Sequential fetches — respects the per-provider throttle (1200 ms between calls).
    // 24-hour cache means these 5 calls are only made once per day in practice.
    const getLatest = (data: any) => {
      if (!data?.data?.length) return null;
      const latest = data.data[0];
      return { date: latest.date, value: latest.value, unit: data.unit ?? null };
    };

    const result: Record<string, any> = {};
    const fetches: Array<[string, Record<string, string>]> = [
      ['realGdp', { function: 'REAL_GDP', interval: 'quarterly' }],
      ['fedFundsRate', { function: 'FEDERAL_FUNDS_RATE', interval: 'monthly' }],
      ['cpi', { function: 'CPI', interval: 'monthly' }],
      ['inflation', { function: 'INFLATION' }],
      ['treasury10y', { function: 'TREASURY_YIELD', interval: 'monthly', maturity: '10year' }],
    ];

    for (const [key, params] of fetches) {
      try {
        const data = await this.makeRequest(params, { ttlMs: 24 * 60 * 60 * 1000 });
        result[key] = getLatest(data);
      } catch {
        result[key] = null;
      }
    }

    if (Object.values(result).every((v) => v === null)) {
      throw new Error('Unavailable via Alpha Vantage: economic indicators not available');
    }
    return result;
  }

  async getTechnicalIndicators(symbol: string): Promise<any> {
    // Reuse 6-month daily price history (already cached by getStockPrice / generate_stock_report).
    // No extra API calls if the cache is warm; 1 API call if cold.
    let history: any;
    try {
      history = await this.getPriceHistory(symbol, '6m');
    } catch {
      throw new Error('Unavailable via Alpha Vantage: price history required for technical indicators');
    }
    const rawPrices: Array<{ date: string; close: string }> = (history?.prices ?? [])
      .filter((p: any) => p.close != null)
      .slice()
      .reverse(); // oldest first
    if (rawPrices.length < 30) {
      throw new Error('Unavailable via Alpha Vantage: insufficient price history for technical indicators');
    }
    const closes = rawPrices.map((p) => parseFloat(String(p.close)));
    return computeTechnicalIndicators(symbol.toUpperCase(), closes, rawPrices);
  }

  async getCommodityPrices(commodities?: string[]): Promise<any> {
    // Supported AV commodity functions on the free tier.
    const ALL_COMMODITIES: Array<[string, string]> = [
      ['wti', 'WTI'],
      ['brent', 'BRENT'],
      ['naturalGas', 'NATURAL_GAS'],
      ['copper', 'COPPER'],
      ['aluminum', 'ALUMINUM'],
      ['wheat', 'WHEAT'],
      ['corn', 'CORN'],
    ];
    // Filter to requested commodities, or default to the four most common.
    const requested = commodities?.map((c) => c.toLowerCase()) ?? ['wti', 'brent', 'naturalgas', 'copper'];
    const selected = ALL_COMMODITIES.filter(([key]) =>
      requested.some((r) => r.replace(/[^a-z]/g, '') === key.replace(/[^a-z]/g, ''))
    );
    if (!selected.length) {
      return { error: `No recognised commodity names. Available: ${ALL_COMMODITIES.map(([k]) => k).join(', ')}` };
    }

    const getLatest = (data: any) => {
      if (!data?.data?.length) return null;
      return {
        date: data.data[0].date,
        value: data.data[0].value,
        unit: data.unit ?? null,
        name: data.name ?? null,
      };
    };

    const result: Record<string, any> = {};
    for (const [key, fn] of selected) {
      try {
        const data = await this.makeRequest({ function: fn, interval: 'monthly' }, { ttlMs: 6 * 60 * 60 * 1000 });
        result[key] = getLatest(data);
      } catch {
        result[key] = null;
      }
    }

    if (Object.values(result).every((v) => v === null)) {
      throw new Error('Unavailable via Alpha Vantage: commodity prices not available');
    }
    return result;
  }

  async getForexRate(fromCurrency: string, toCurrency: string): Promise<any> {
    const data = await this.makeRequest(
      {
        function: 'CURRENCY_EXCHANGE_RATE',
        from_currency: fromCurrency.toUpperCase(),
        to_currency: toCurrency.toUpperCase(),
      },
      { ttlMs: 5 * 60 * 1000 } // 5-minute cache — rates change frequently
    );
    const rate = data?.['Realtime Currency Exchange Rate'];
    if (!rate) {
      throw new Error('Unavailable via Alpha Vantage: forex rate not found');
    }
    return {
      fromCurrency: rate['1. From_Currency Code'],
      fromCurrencyName: rate['2. From_Currency Name'],
      toCurrency: rate['3. To_Currency Code'],
      toCurrencyName: rate['4. To_Currency Name'],
      exchangeRate: rate['5. Exchange Rate'],
      lastRefreshed: rate['6. Last Refreshed'],
      timeZone: rate['7. Time Zone'],
      bidPrice: rate['8. Bid Price'],
      askPrice: rate['9. Ask Price'],
    };
  }

  async getMarketStatus(): Promise<any> {
    throw new Error('Market status unavailable in Alpha-only mode');
  }
}

export class FinnhubService implements StockDataService {
  private apiKey: string;
  private baseUrl = 'https://finnhub.io/api/v1';
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private minIntervalMs = Number(process.env.FINNHUB_MIN_INTERVAL_MS || 500);

  // ── Circuit breaker ──────────────────────────────────────────────────────────
  // When Finnhub returns HTTP 429, set this flag to prevent the retry loop from
  // hammering the API.  Shared across all FinnhubService instances in the process.
  // 65-second lockout matches the Finnhub sliding-window (60 req/min + 5 s buffer).
  private static rateLimitedUntilMs = 0;
  private static readonly RATE_LIMIT_LOCKOUT_MS = 65 * 1000;
  // ────────────────────────────────────────────────────────────────────────────

  // ── Queue-based throttle ─────────────────────────────────────────────────────
  // Serialises concurrent callers correctly — the timestamp-comparison approach
  // has a race condition where all calls fired via Promise.all() read the same
  // lastRequestAt value and fire simultaneously.
  private throttleQueue = Promise.resolve();
  // ────────────────────────────────────────────────────────────────────────────

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.FINNHUB_API_KEY || '';
  }

  /** Queue a throttle slot.  Each caller fires minIntervalMs after the previous. */
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

    // ── Circuit breaker: skip throttle + HTTP when rate-limited ───────────────
    if (FinnhubService.rateLimitedUntilMs > Date.now()) {
      throw new Error('Unavailable via Finnhub: rate limit active — please wait a moment');
    }
    // ─────────────────────────────────────────────────────────────────────────

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
      if (statusCode === 401 || statusCode === 403) {
        throw new Error(`Unavailable via Finnhub (plan limitation: ${statusCode})`);
      }
      if (statusCode === 429) {
        // Open the circuit breaker so all subsequent calls in this invocation skip
        // the 500ms throttle wait and fail immediately.
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

    // Parse a Finnhub /stock/candle response into a prices array, or return null if the
    // response indicates no data (free-tier restriction, symbol not found, etc.).
    const parseCandles = (d: any) => {
      if (d?.s !== 'ok' || !Array.isArray(d?.c) || d.c.length === 0) return null;
      return (d.t as number[]).map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        open: d.o?.[i],
        high: d.h?.[i],
        low: d.l?.[i],
        close: d.c[i],
        volume: d.v?.[i],
      }));
    };

    const data = await this.makeRequest('/stock/candle', {
      symbol: symbol.toUpperCase(),
      resolution,
      from: from.toString(),
      to: now.toString(),
    }, 60 * 60 * 1000);

    const prices = parseCandles(data);
    if (prices) return { symbol: symbol.toUpperCase(), prices };

    // Free-tier fallback: weekly/monthly resolutions are often unavailable on Finnhub's
    // free plan.  Retry with 1-year daily data which is reliably available at no cost.
    if (resolution !== 'D') {
      const fallback = await this.makeRequest('/stock/candle', {
        symbol: symbol.toUpperCase(),
        resolution: 'D',
        from: (now - 365 * DAY).toString(),
        to: now.toString(),
      }, 60 * 60 * 1000);
      const fallbackPrices = parseCandles(fallback);
      if (fallbackPrices) return { symbol: symbol.toUpperCase(), prices: fallbackPrices };
    }

    throw new Error('Unavailable via Finnhub: price history not available');
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
    // Derive total TTM revenue from per-share × shares when the aggregate is unavailable.
    // revenuePerShareTTM is in $/share; sharesM is millions of shares.
    // $/share × sharesM × 1e6 = $/share × 1e6 shares = raw dollar total revenue.
    // Both values come from real Finnhub API responses — no estimation involved.
    const sharesM = profile?.shareOutstanding ?? 0; // millions
    const rawRevenue = m.revenueTTM != null
      ? Number(m.revenueTTM) * 1e6
      : m.revenuePerShareTTM != null && sharesM > 0
        ? Number(m.revenuePerShareTTM) * sharesM * 1e6
        : null;
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
      revenueTTM: rawRevenue != null ? String(Math.round(rawRevenue)) : null,
      grossProfitTTM: m.grossMarginTTM != null && rawRevenue != null
        ? String(Math.round(m.grossMarginTTM * rawRevenue))
        : null,
      // grossMarginTTM as a ratio (0–1) so buildBasicFinancialsFallback can use it
      // directly when revenueTTM/grossProfitTTM are unavailable for this stock.
      grossMarginTTM: m.grossMarginTTM ?? null,
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
    if (!rows.length) {
      // Free-tier fallback: quarterly series may be absent; derive a single TTM entry from the
      // metric snapshot (which is always present on the free plan).
      const m = data.metric || {};
      const rev = m.revenueTTM != null ? Number(m.revenueTTM) * 1e6 : null;
      if (rev != null && rev > 0) {
        const gross = m.grossMarginTTM != null ? Math.round(rev * Number(m.grossMarginTTM)) : null;
        const opInc = m.operatingMarginTTM != null ? Math.round(rev * Number(m.operatingMarginTTM)) : null;
        const netInc = m.netProfitMarginTTM != null ? Math.round(rev * Number(m.netProfitMarginTTM)) : null;
        return {
          symbol: symbol.toUpperCase(),
          quarterlyReports: [{
            fiscalQuarter: 'TTM',
            totalRevenue: String(Math.round(rev)),
            grossProfit: gross != null ? String(gross) : null,
            operatingIncome: opInc != null ? String(opInc) : null,
            netIncome: netInc != null ? String(netInc) : null,
            ebitda: null,
          }],
        };
      }
      throw new Error('Unavailable via Finnhub: no income statement data');
    }
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
    if (!rows.length) {
      // Free-tier fallback: quarterly series absent. Derive approximate balance sheet entries
      // from per-share metric values × shares outstanding (profile2 is cached after getCompanyOverview).
      const m = data.metric || {};
      const profile = await this.makeRequest('/stock/profile2', { symbol: symbol.toUpperCase() }, 6 * 60 * 60 * 1000).catch(() => null);
      const shares = profile?.shareOutstanding ?? 0; // Finnhub: millions of shares
      // Per-share values are in raw dollars; multiply by shares(millions) × 1e6 for total raw dollars.
      const bvps = m.bookValuePerShareQuarterly ?? m.bookValuePerShareAnnual ?? null;
      const cpsa = m.cashPerShareAnnual ?? m.cashPerShareQuarterly ?? null;
      const equity = bvps != null && shares > 0 ? Math.round(Number(bvps) * shares * 1e6) : null;
      const cash = cpsa != null && shares > 0 ? Math.round(Number(cpsa) * shares * 1e6) : null;
      if (equity !== null || cash !== null) {
        return {
          symbol: symbol.toUpperCase(),
          quarterlyReports: [{
            fiscalQuarter: 'Latest',
            totalAssets: null,
            totalLiabilities: null,
            totalShareholderEquity: equity != null ? String(equity) : null,
            cashAndEquivalents: cash != null ? String(cash) : null,
            longTermDebt: null,
          }],
        };
      }
      throw new Error('Unavailable via Finnhub: no balance sheet data');
    }
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
    if (!rows.length) {
      // Free-tier fallback: quarterly series may be absent; derive TTM entry from metric snapshot.
      const m = data.metric || {};
      if (m.freeCashFlowTTM != null || m.cashFlowPerShareTTM != null) {
        return {
          symbol: symbol.toUpperCase(),
          quarterlyReports: [{
            fiscalQuarter: 'TTM',
            operatingCashflow: null,
            capitalExpenditures: null,
            freeCashFlow: m.freeCashFlowTTM != null ? String(Math.round(Number(m.freeCashFlowTTM) * 1e6)) : null,
            dividendPayout: null,
          }],
        };
      }
      throw new Error('Unavailable via Finnhub: no cash flow data');
    }
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

  async getDividendHistory(symbol: string, years = 5): Promise<any> {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = await this.makeRequest('/stock/dividend', {
      symbol: symbol.toUpperCase(),
      from,
      to,
    }, 24 * 60 * 60 * 1000);
    const dividends = Array.isArray(data) ? data : [];
    return {
      symbol: symbol.toUpperCase(),
      dividends: dividends.slice(0, 20).map((d: any) => ({
        exDate: d.date,
        payDate: d.payDate,
        recordDate: d.recordDate,
        declarationDate: d.declarationDate,
        amount: d.amount,
        adjustedAmount: d.adjustedAmount,
        currency: d.currency,
      })),
    };
  }

  async getStockSplits(symbol: string, years = 10): Promise<any> {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = await this.makeRequest('/stock/split', {
      symbol: symbol.toUpperCase(),
      from,
      to,
    }, 7 * 24 * 60 * 60 * 1000);
    const splits = Array.isArray(data) ? data : [];
    return {
      symbol: symbol.toUpperCase(),
      splits: splits.map((s: any) => ({
        date: s.date,
        fromFactor: s.fromFactor,
        toFactor: s.toFactor,
      })),
    };
  }

  async getEarningsCalendar(symbol?: string, weeks = 4): Promise<any> {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const params: Record<string, string> = { from, to };
    if (symbol) params.symbol = symbol.toUpperCase();
    const data = await this.makeRequest('/calendar/earnings', params, 60 * 60 * 1000);
    const earnings = Array.isArray(data?.earningsCalendar) ? data.earningsCalendar : [];
    return {
      from,
      to,
      earnings: earnings.slice(0, 50).map((e: any) => ({
        symbol: e.symbol,
        date: e.date,
        hour: e.hour,
        epsEstimate: e.epsEstimate,
        epsActual: e.epsActual,
        revenueEstimate: e.revenueEstimate,
        revenueActual: e.revenueActual,
      })),
    };
  }

  async getIpoCalendar(weeks = 4): Promise<any> {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = await this.makeRequest('/calendar/ipo', { from, to }, 60 * 60 * 1000);
    const ipos = Array.isArray(data?.ipoCalendar) ? data.ipoCalendar : [];
    return {
      from,
      to,
      ipos: ipos.slice(0, 30).map((ipo: any) => ({
        symbol: ipo.symbol,
        date: ipo.date,
        name: ipo.name,
        numberOfShares: ipo.numberOfShares,
        price: ipo.price,
        status: ipo.status,
        exchange: ipo.exchange,
      })),
    };
  }

  async getEconomicIndicators(): Promise<any> {
    throw new Error('Unavailable via Finnhub: economic indicators not supported');
  }

  async getTechnicalIndicators(symbol: string): Promise<any> {
    // Compute from 6-month price history — same as AlphaVantageService; no extra Finnhub calls.
    let history: any;
    try {
      history = await this.getPriceHistory(symbol, '6m');
    } catch {
      throw new Error('Unavailable via Finnhub: price history required for technical indicators');
    }
    const rawPrices: Array<{ date: string; close: string }> = (history?.prices ?? [])
      .filter((p: any) => p.close != null)
      .slice()
      .reverse(); // oldest first
    if (rawPrices.length < 30) {
      throw new Error('Unavailable via Finnhub: insufficient price history for technical indicators');
    }
    const closes = rawPrices.map((p) => parseFloat(String(p.close)));
    return computeTechnicalIndicators(symbol.toUpperCase(), closes, rawPrices);
  }

  async getCommodityPrices(_commodities?: string[]): Promise<any> {
    throw new Error('Unavailable via Finnhub: commodity prices not supported');
  }

  async getForexRate(fromCurrency: string, toCurrency: string): Promise<any> {
    // Finnhub /forex/rates?base={currency} returns exchange rates relative to a base currency.
    const data = await this.makeRequest('/forex/rates', { base: fromCurrency.toUpperCase() }, 5 * 60 * 1000);
    const rates = data?.quote ?? {};
    const rate = rates[toCurrency.toUpperCase()];
    if (rate === undefined || rate === null) {
      throw new Error(`Unavailable via Finnhub: no rate found for ${fromCurrency}/${toCurrency}`);
    }
    return {
      fromCurrency: fromCurrency.toUpperCase(),
      toCurrency: toCurrency.toUpperCase(),
      exchangeRate: String(rate),
      source: 'Finnhub',
    };
  }

  async getMarketStatus(): Promise<any> {
    const data = await this.makeRequest('/market-status', { exchange: 'US' }, 60 * 1000);
    return {
      exchange: data.exchange,
      isOpen: data.isOpen,
      session: data.session,
      holiday: data.holiday ?? null,
      timezone: data.timezone,
      timestamp: data.t,
    };
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
      // Tag with source so stockTools.ts correctly attributes Finnhub data in the sources table
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
  // Bug fix: both methods must use withFallback so that in hybrid mode
  // AV's "Alpha-only mode" throw is caught and Finnhub's implementation is used.
  getNewsSentiment(symbol: string) {
    return this.withFallback(
      () => this.primary.getNewsSentiment(symbol),
      () => this.fallback.getNewsSentiment(symbol)
    );
  }
  getCompanyNews(symbol: string, days?: number) {
    return this.withFallback(
      () => this.primary.getCompanyNews(symbol, days),
      () => this.fallback.getCompanyNews(symbol, days)
    );
  }
  searchNews(query: string, days?: number) {
    return this.primary.searchNews(query, days);
  }
  getDividendHistory(symbol: string, years?: number) {
    return this.withFallback(
      () => this.primary.getDividendHistory(symbol, years),
      () => this.fallback.getDividendHistory(symbol, years)
    );
  }
  getStockSplits(symbol: string, years?: number) {
    return this.withFallback(
      () => this.primary.getStockSplits(symbol, years),
      () => this.fallback.getStockSplits(symbol, years)
    );
  }
  getEarningsCalendar(symbol?: string, weeks?: number) {
    return this.withFallback(
      () => this.primary.getEarningsCalendar(symbol, weeks),
      () => this.fallback.getEarningsCalendar(symbol, weeks)
    );
  }
  getIpoCalendar(weeks?: number) {
    return this.withFallback(
      () => this.primary.getIpoCalendar(weeks),
      () => this.fallback.getIpoCalendar(weeks)
    );
  }
  getEconomicIndicators() {
    // Economic indicators only from AV (Finnhub does not provide macro data)
    return this.primary.getEconomicIndicators();
  }
  getTechnicalIndicators(symbol: string) {
    return this.withFallback(
      () => this.primary.getTechnicalIndicators(symbol),
      () => this.fallback.getTechnicalIndicators(symbol)
    );
  }
  getCommodityPrices(commodities?: string[]) {
    // Only AV has commodity prices; Finnhub throws. No meaningful fallback.
    return this.primary.getCommodityPrices(commodities);
  }
  getForexRate(fromCurrency: string, toCurrency: string) {
    return this.withFallback(
      () => this.primary.getForexRate(fromCurrency, toCurrency),
      () => this.fallback.getForexRate(fromCurrency, toCurrency)
    );
  }
  getMarketStatus() {
    return this.withFallback(
      () => this.primary.getMarketStatus(),
      () => this.fallback.getMarketStatus()
    );
  }
}

export function createStockService(apiKey?: string): StockDataService {
  const provider = PROVIDER_ENV;
  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (provider === 'finnhub') {
    return new FinnhubService(finnhubKey);
  }
  if (provider === 'hybrid') {
    if (finnhubKey) {
      return new HybridStockDataService(new AlphaVantageService(apiKey), new FinnhubService(finnhubKey));
    }
    // No Finnhub key configured; fall back to Alpha Vantage only to avoid 403 errors
    return new AlphaVantageService(apiKey);
  }
  return new AlphaVantageService(apiKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// Supplementary services — independent of the StockDataService interface.
// These are created on demand inside executeTool.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SEC EDGAR API — completely free, no API key required.
 * Rate limit: ≤ 10 requests/second. User-Agent with contact info is required.
 *
 * Provides:
 *  - Ticker → CIK mapping (company_tickers.json, cached 24h)
 *  - Recent filings list (8-K, 10-K, 10-Q, DEF14A …) per company
 */
export class SecEdgarService {
  /** Class-level cache shared across instances (module singleton within a request). */
  private static sharedCache = new Map<string, { expiresAt: number; data: any }>();
  private lastRequestAt = 0;
  private minIntervalMs = 200; // conservative: 5 req/s

  private get headers() {
    return {
      // SEC EDGAR policy: User-Agent must contain a contact email
      'User-Agent': 'stock-research-assistant/1.0 (institutional-research@github.com)',
      'Accept': 'application/json',
    };
  }

  private async throttle(): Promise<void> {
    const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    this.lastRequestAt = Date.now();
  }

  private async fetchJson(url: string, ttlMs: number): Promise<any> {
    const cached = SecEdgarService.sharedCache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    await this.throttle();
    const response = await axios.get(url, { headers: this.headers, timeout: 15000 });
    SecEdgarService.sharedCache.set(url, { expiresAt: Date.now() + ttlMs, data: response.data });
    return response.data;
  }

  /** Returns the 10-digit padded CIK for the given ticker, or null if not found. */
  async getCikForTicker(ticker: string): Promise<string | null> {
    const url = 'https://www.sec.gov/files/company_tickers.json';
    const data = await this.fetchJson(url, 24 * 60 * 60 * 1000); // 24h cache
    const entry = (Object.values(data) as any[]).find(
      (e) => String(e.ticker ?? '').toUpperCase() === ticker.toUpperCase()
    );
    return entry ? String(entry.cik_str).padStart(10, '0') : null;
  }

  /**
   * Get the most recent SEC filings for a company.
   * @param symbol  US stock ticker
   * @param formTypes  Optional filter (e.g. ['8-K', '10-K']). Defaults to all types.
   * @param count  Max number of filings to return (default 15)
   */
  async getRecentFilings(symbol: string, formTypes?: string[], count = 15): Promise<any> {
    const cik = await this.getCikForTicker(symbol);
    if (!cik) {
      throw new Error(`SEC EDGAR: no company found for ticker "${symbol.toUpperCase()}"`);
    }
    const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const data = await this.fetchJson(url, 6 * 60 * 60 * 1000); // 6h cache

    const recent = data.filings?.recent ?? {};
    const forms: string[] = recent.form ?? [];
    const dates: string[] = recent.filingDate ?? [];
    const accessions: string[] = recent.accessionNumber ?? [];
    const descriptions: string[] = recent.primaryDocDescription ?? [];
    const primaryDocs: string[] = recent.primaryDocument ?? [];

    let filings = forms.map((form, i) => ({
      formType: form,
      filingDate: dates[i] ?? null,
      description: descriptions[i] || null,
      primaryDocument: primaryDocs[i] || null,
      // Direct URL to the filing index page on EDGAR — use the original padded CIK string
      filingUrl: accessions[i]
        ? `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/` +
          `${accessions[i].replace(/-/g, '')}/`
        : null,
    }));

    if (formTypes?.length) {
      const upper = formTypes.map((t) => t.toUpperCase());
      filings = filings.filter((f) => upper.includes(f.formType.toUpperCase()));
    }

    return {
      symbol: symbol.toUpperCase(),
      cik,
      companyName: data.name ?? null,
      filings: filings.slice(0, count),
    };
  }
}

/**
 * FRED (Federal Reserve Economic Data) — free with API key.
 * Register at https://fred.stlouisfed.org/docs/api/api_key.html (instant, free).
 *
 * Provides ~800,000 US and international economic time series including:
 *  - VIX, S&P 500, yield curve, Fed funds rate, CPI, unemployment, GDP,
 *    mortgage rates, corporate bond spreads, housing starts, and more.
 */
export class FredService {
  private apiKey: string;
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private lastRequestAt = 0;
  private minIntervalMs = 300;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.FRED_API_KEY || '';
  }

  get isConfigured(): boolean { return !!this.apiKey; }

  private async throttle(): Promise<void> {
    const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    this.lastRequestAt = Date.now();
  }

  private async fetchSeries(seriesId: string, limit = 5): Promise<any> {
    if (!this.apiKey) {
      throw new Error(
        'FRED API key not configured. ' +
        'Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html and set FRED_API_KEY.'
      );
    }
    const cacheKey = `fred:${seriesId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    await this.throttle();
    const response = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
      params: {
        series_id: seriesId,
        api_key: this.apiKey,
        file_type: 'json',
        limit,
        sort_order: 'desc',
        // No observation_start — sort_order + limit already returns the N most recent observations
      },
      timeout: 10000,
    });
    const data = response.data;
    this.cache.set(cacheKey, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, data });
    return data;
  }

  /** Returns the latest non-missing observation for a series, plus the previous one. */
  private getLatest(data: any): { value: string; date: string; previousValue: string | null; previousDate: string | null } | null {
    const obs: any[] = data?.observations ?? [];
    const valid = obs.filter((o) => o.value !== '.');
    if (!valid.length) return null;
    return {
      value: valid[0].value,
      date: valid[0].date,
      previousValue: valid[1]?.value ?? null,
      previousDate: valid[1]?.date ?? null,
    };
  }

  /**
   * Fetch a comprehensive set of US market & macro indicators.
   * Includes VIX, yield curve, treasury rates, employment, inflation, GDP, mortgage rates,
   * credit spreads, and S&P 500 level — all from the Federal Reserve's public database.
   */
  async getMarketIndicators(): Promise<any> {
    // Each [key, seriesId, friendlyName] triple
    const series: Array<[string, string, string]> = [
      ['vix', 'VIXCLS', 'CBOE Volatility Index (VIX)'],
      ['sp500', 'SP500', 'S&P 500 Index'],
      ['yieldCurve10y2y', 'T10Y2Y', '10-Year minus 2-Year Treasury Spread'],
      ['treasury10y', 'DGS10', '10-Year Treasury Yield (daily)'],
      ['treasury2y', 'DGS2', '2-Year Treasury Yield (daily)'],
      ['treasury3m', 'DTB3', '3-Month Treasury Bill Rate'],
      ['fedFundsRate', 'FEDFUNDS', 'Effective Federal Funds Rate'],
      ['realGdpGrowth', 'A191RL1Q225SBEA', 'Real GDP Growth Rate (QoQ, annualized)'],
      ['unemployment', 'UNRATE', 'US Unemployment Rate'],
      ['cpiYoy', 'CPIAUCSL', 'Consumer Price Index (All Urban Consumers)'],
      ['pce', 'PCEPI', 'PCE Price Index (Fed preferred inflation gauge)'],
      ['corePce', 'PCEPILFE', 'Core PCE Price Index (ex food & energy)'],
      ['mortgageRate30y', 'MORTGAGE30US', '30-Year Fixed Mortgage Rate'],
      ['creditSpreadBaa', 'BAA10Y', 'Baa Corporate Bond Spread over 10-Year Treasury'],
      ['housingStarts', 'HOUST', 'Housing Starts (thousands of units)'],
      ['retailSales', 'RSAFS', 'Advance Retail Sales (millions $)'],
      ['industrialProduction', 'INDPRO', 'Industrial Production Index'],
      ['consumerSentiment', 'UMCSENT', 'University of Michigan Consumer Sentiment'],
    ];

    const result: Record<string, any> = {};
    for (const [key, seriesId, name] of series) {
      try {
        const data = await this.fetchSeries(seriesId, 5);
        const latest = this.getLatest(data);
        result[key] = latest ? { ...latest, seriesId, name } : null;
      } catch {
        result[key] = null;
      }
    }

    // Derived: yield curve interpretation
    const ycValue = result.yieldCurve10y2y?.value;
    if (ycValue !== undefined && ycValue !== null) {
      const spread = parseFloat(ycValue);
      result.yieldCurveSignal = Number.isFinite(spread)
        ? spread < 0
          ? `⚠️ Inverted (${spread.toFixed(2)} ppts) — historically precedes recessions by 6–18 months`
          : spread < 0.5
          ? `⚡ Near-flat (${spread.toFixed(2)} ppts) — caution; watch for further flattening`
          : `✅ Normal (${spread.toFixed(2)} ppts) — no near-term recession signal from curve`
        : null;
    }

    return result;
  }
}

/**
 * CoinGecko API — free with optional demo key.
 * Without key: ~5–15 req/min (public).
 * With free demo key: 30 req/min, 10,000/month.
 * Get a free key at https://www.coingecko.com/en/api — click "Get API Key".
 *
 * Provides crypto prices, market caps, historical data, and top-market rankings.
 */
export class CoinGeckoService {
  private cache = new Map<string, { expiresAt: number; data: any }>();
  private lastRequestAt = 0;
  private apiKey: string | null;
  // Free public: ~10/min; free demo key: 30/min
  private minIntervalMs: number;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.COINGECKO_API_KEY || null;
    // Free public: ~5–15 req/min; 4s interval stays well within that.
    // Free demo key: 30 req/min; tighten to 2s interval.
    this.minIntervalMs = this.apiKey ? 2000 : 4000;
  }

  private async throttle(): Promise<void> {
    const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    this.lastRequestAt = Date.now();
  }

  private getParams(extra: Record<string, any> = {}): Record<string, any> {
    const p: Record<string, any> = { ...extra };
    if (this.apiKey) p['x_cg_demo_api_key'] = this.apiKey;
    return p;
  }

  /**
   * Resolve a common crypto symbol (BTC, ETH, SOL …) or CoinGecko coin-ID
   * to a CoinGecko coin-ID (e.g. 'bitcoin', 'ethereum').
   * Falls back to lower-casing the input if not in the built-in map.
   */
  private resolveId(symbolOrId: string): string {
    const symbolMap: Record<string, string> = {
      BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin',
      SOL: 'solana', XRP: 'ripple', ADA: 'cardano',
      AVAX: 'avalanche-2', DOGE: 'dogecoin', DOT: 'polkadot',
      MATIC: 'matic-network', LINK: 'chainlink', UNI: 'uniswap',
      LTC: 'litecoin', ATOM: 'cosmos', NEAR: 'near',
      ALGO: 'algorand', SHIB: 'shiba-inu', USDT: 'tether',
      USDC: 'usd-coin', TON: 'the-open-network', SUI: 'sui',
      APT: 'aptos', ARB: 'arbitrum', OP: 'optimism',
      PEPE: 'pepe', WIF: 'dogwifcoin', BONK: 'bonk',
    };
    const upper = symbolOrId.toUpperCase();
    return symbolMap[upper] ?? symbolOrId.toLowerCase();
  }

  /** Get detailed price, market cap, and change data for a single cryptocurrency. */
  async getCryptoPrice(symbolOrId: string): Promise<any> {
    const coinId = this.resolveId(symbolOrId);
    const cacheKey = `cg:coin:${coinId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    await this.throttle();
    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}`, {
      params: this.getParams({
        localization: false, tickers: false,
        market_data: true, community_data: false, developer_data: false,
      }),
      timeout: 10000,
    });
    const d = response.data;
    const md = d.market_data ?? {};
    const result = {
      id: d.id,
      symbol: String(d.symbol ?? '').toUpperCase(),
      name: d.name,
      currentPrice: md.current_price?.usd ?? null,
      marketCap: md.market_cap?.usd ?? null,
      marketCapRank: d.market_cap_rank ?? null,
      fullyDilutedValuation: md.fully_diluted_valuation?.usd ?? null,
      tradingVolume24h: md.total_volume?.usd ?? null,
      high24h: md.high_24h?.usd ?? null,
      low24h: md.low_24h?.usd ?? null,
      priceChange24h: md.price_change_24h ?? null,
      priceChangePercent24h: md.price_change_percentage_24h ?? null,
      priceChangePercent7d: md.price_change_percentage_7d ?? null,
      priceChangePercent30d: md.price_change_percentage_30d ?? null,
      priceChangePercent1y: md.price_change_percentage_1y ?? null,
      ath: md.ath?.usd ?? null,
      athDate: md.ath_date?.usd ?? null,
      athChangePercent: md.ath_change_percentage?.usd ?? null,
      atl: md.atl?.usd ?? null,
      atlDate: md.atl_date?.usd ?? null,
      circulatingSupply: md.circulating_supply ?? null,
      totalSupply: md.total_supply ?? null,
      maxSupply: md.max_supply ?? null,
      description: d.description?.en
        ? String(d.description.en)
            // Remove all HTML tags and every remaining angle bracket in two passes.
            // After both passes the string is guaranteed to contain no '<' or '>'
            // characters, producing clean plain text safe for UI display.
            .replace(/<[^>]*>/g, ' ')
            .replace(/[<>]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 400)
        : null,
      categories: Array.isArray(d.categories) ? d.categories.slice(0, 5) : [],
      lastUpdated: md.last_updated ?? null,
    };
    this.cache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, data: result });
    return result;
  }

  /** Get top N cryptocurrencies by market cap with 24h/7d/30d price changes. */
  async getTopCryptos(limit = 10): Promise<any> {
    const n = Math.min(Math.max(1, limit), 50);
    const cacheKey = `cg:top:${n}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    await this.throttle();
    const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: this.getParams({
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: n,
        page: 1,
        sparkline: false,
        price_change_percentage: '24h,7d,30d',
      }),
      timeout: 10000,
    });
    const result = (Array.isArray(response.data) ? response.data : []).map((c: any) => ({
      rank: c.market_cap_rank,
      id: c.id,
      symbol: String(c.symbol ?? '').toUpperCase(),
      name: c.name,
      currentPrice: c.current_price ?? null,
      marketCap: c.market_cap ?? null,
      priceChangePercent24h: c.price_change_percentage_24h ?? null,
      priceChangePercent7d: c.price_change_percentage_7d_in_currency ?? null,
      priceChangePercent30d: c.price_change_percentage_30d_in_currency ?? null,
      volume24h: c.total_volume ?? null,
      circulatingSupply: c.circulating_supply ?? null,
      ath: c.ath ?? null,
      athChangePercent: c.ath_change_percentage ?? null,
    }));
    this.cache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, data: result });
    return result;
  }
}

