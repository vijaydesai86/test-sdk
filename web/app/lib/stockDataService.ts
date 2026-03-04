/**
 * Stock Data Service
 *
 * Multi-provider stock data layer with per-request caching and throttling.
 *
 * Provider selection via STOCK_DATA_PROVIDER environment variable:
 *   'alphavantage' (default) — Alpha Vantage REST API
 *                              Free tier: 25 requests/day
 *                              https://www.alphavantage.co  (set ALPHA_VANTAGE_API_KEY)
 *   'finnhub'                — Finnhub REST API
 *                              Free tier: 60 requests/min, real-time data
 *                              https://finnhub.io           (set FINNHUB_API_KEY)
 *   'hybrid'                 — AlphaVantage primary, Finnhub fallback
 *                              Requires both ALPHA_VANTAGE_API_KEY and FINNHUB_API_KEY
 *
 * Other free providers you can add using the same pattern:
 *   - Polygon.io           free: 5 req/min, delayed data       POLYGON_API_KEY
 *   - Financial Modeling Prep  free: 250 req/day                FMP_API_KEY
 *   - Twelve Data          free: 800 req/day                    TWELVE_DATA_API_KEY
 *   - Marketstack          free: 100 req/month                  MARKETSTACK_API_KEY
 */
import axios from 'axios';

// ─── Shared Utilities ──────────────────────────────────────────────────────

const attachSource = (data: any, source: string): any => {
  if (data && typeof data === 'object') (data as any).__source = source;
  return data;
};

const parseRangeToDays = (range = '1y'): number => {
  const lower = range.toLowerCase();
  if (lower.includes('max')) return 365 * 20;
  if (lower.includes('5y')) return 365 * 5;
  if (lower.includes('3y')) return 365 * 3;
  if (lower.includes('1y')) return 365;
  if (lower.includes('6m')) return 180;
  if (lower.includes('3m')) return 90;
  if (lower.includes('1m')) return 30;
  if (lower.includes('1w')) return 7;
  return 365;
};

// ─── Response Cache ────────────────────────────────────────────────────────

interface CacheEntry {
  data: any;
  expiresAt: number;
}

class ResponseCache {
  private readonly store = new Map<string, CacheEntry>();

  get(key: string): any | null {
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.data;
  }

  set(key: string, data: any, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  async getOrFetch(key: string, ttlMs: number, fetcher: () => Promise<any>): Promise<any> {
    const cached = this.get(key);
    if (cached !== null) return cached;
    const data = await fetcher();
    if (ttlMs > 0) this.set(key, data, ttlMs);
    return data;
  }
}

// ─── Service Interface ─────────────────────────────────────────────────────

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

// ─── Alpha Vantage ─────────────────────────────────────────────────────────

const AV_SOURCE = 'Alpha Vantage';

/**
 * Alpha Vantage stock data provider.
 * Free tier: 25 requests/day — great for demos and low-frequency lookups.
 * Get a key at https://www.alphavantage.co/support/#api-key
 * Required env var: ALPHA_VANTAGE_API_KEY
 */
export class AlphaVantageService implements StockDataService {
  private readonly baseUrl = 'https://www.alphavantage.co/query';
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;
  private static readonly sharedCache = new ResponseCache();

  constructor(private readonly apiKey = process.env.ALPHA_VANTAGE_API_KEY ?? 'demo') {
    this.minIntervalMs = Number(process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS ?? 1200);
  }

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private async request(params: Record<string, string>, ttlMs = 0): Promise<any> {
    const cacheKey = `av:${JSON.stringify(Object.fromEntries(Object.entries(params).sort()))}`;
    return AlphaVantageService.sharedCache.getOrFetch(cacheKey, ttlMs, async () => {
      await this.throttle();
      const { data } = await axios.get(this.baseUrl, {
        params: { ...params, apikey: this.apiKey },
        timeout: 10_000,
      });
      if (data?.Note) throw new Error(data.Note);
      if (data?.Information) throw new Error(data.Information);
      if (data?.['Error Message']) throw new Error(data['Error Message']);
      return data;
    });
  }

  async getStockPrice(symbol: string): Promise<any> {
    const data = await this.request(
      { function: 'GLOBAL_QUOTE', symbol: symbol.toUpperCase() },
      30_000
    );
    const q = data['Global Quote'];
    if (!q) throw new Error('Unable to fetch stock price');
    return attachSource(
      {
        symbol: q['01. symbol'],
        price: q['05. price'],
        change: q['09. change'],
        changePercent: q['10. change percent'],
        volume: q['06. volume'],
        latestTradingDay: q['07. latest trading day'],
      },
      AV_SOURCE
    );
  }

  async getPriceHistory(symbol: string, range = 'daily'): Promise<any> {
    const now = new Date();
    const norm = range.toLowerCase();
    const cfg = (() => {
      if (['1w', '1week', 'week'].includes(norm))
        return { fn: 'TIME_SERIES_DAILY', size: 'compact', days: 7 };
      if (['1m', '1month', 'month'].includes(norm))
        return { fn: 'TIME_SERIES_DAILY', size: 'compact', days: 30 };
      if (['3m', '3month', 'quarter'].includes(norm))
        return { fn: 'TIME_SERIES_DAILY', size: 'compact', days: 90 };
      if (['6m', '6month'].includes(norm))
        return { fn: 'TIME_SERIES_DAILY', size: 'compact', days: 180 };
      if (['1y', '1year', 'year'].includes(norm))
        return { fn: 'TIME_SERIES_WEEKLY', size: 'full', days: 365 };
      if (['3y', '3year'].includes(norm))
        return { fn: 'TIME_SERIES_WEEKLY', size: 'full', days: 365 * 3 };
      if (['5y', '5year'].includes(norm))
        return { fn: 'TIME_SERIES_WEEKLY', size: 'full', days: 365 * 5 };
      if (['max', 'all'].includes(norm))
        return { fn: 'TIME_SERIES_MONTHLY', size: 'full', days: null as null };
      if (norm === 'weekly') return { fn: 'TIME_SERIES_WEEKLY', size: 'full', days: null as null };
      if (norm === 'monthly') return { fn: 'TIME_SERIES_MONTHLY', size: 'full', days: null as null };
      return { fn: 'TIME_SERIES_DAILY', size: 'compact', days: null as null };
    })();

    const data = await this.request(
      { function: cfg.fn, symbol: symbol.toUpperCase(), outputsize: cfg.size },
      60 * 60 * 1000
    );
    const tsKey = Object.keys(data).find((k) => k.includes('Time Series'));
    if (!tsKey) throw new Error('Unable to fetch price history');

    const cutoff = cfg.days ? new Date(now.getTime() - cfg.days * 86_400_000) : null;
    const prices = Object.entries(data[tsKey])
      .filter(([date]) => {
        if (!cutoff) return true;
        const d = new Date(date);
        return !Number.isNaN(d.getTime()) && d >= cutoff;
      })
      .map(([date, v]: [string, any]) => ({
        date,
        open: v['1. open'],
        high: v['2. high'],
        low: v['3. low'],
        close: v['4. close'],
        volume: v['5. volume'],
      }));
    return attachSource({ symbol: symbol.toUpperCase(), prices }, AV_SOURCE);
  }

  async getCompanyOverview(symbol: string): Promise<any> {
    const data = await this.request(
      { function: 'OVERVIEW', symbol: symbol.toUpperCase() },
      6 * 60 * 60 * 1000
    );
    if (!data.Symbol) throw new Error('Unable to fetch company overview');
    return attachSource(
      {
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
      },
      AV_SOURCE
    );
  }

  async getBasicFinancials(symbol: string): Promise<any> {
    const overview = await this.getCompanyOverview(symbol).catch(() => null);
    if (!overview) return { symbol: symbol.toUpperCase(), metric: {}, series: {} };
    const revenue = Number(overview.revenueTTM);
    const grossProfit = Number(overview.grossProfitTTM);
    const grossMarginTTM =
      Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(grossProfit)
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

  async getInsiderTrading(symbol: string): Promise<any> {
    const overview = await this.request(
      { function: 'OVERVIEW', symbol: symbol.toUpperCase() },
      6 * 60 * 60 * 1000
    );
    const result: any = {
      symbol: symbol.toUpperCase(),
      insiderOwnership: overview.PercentInsiders ? `${overview.PercentInsiders}%` : 'N/A',
      institutionalOwnership: overview.PercentInstitutions ? `${overview.PercentInstitutions}%` : 'N/A',
      sharesOutstanding: overview.SharesOutstanding || 'N/A',
      sharesFloat: overview.SharesFloat || 'N/A',
      shortRatio: overview.ShortRatio || 'N/A',
      shortPercentFloat: overview.ShortPercentFloat ? `${overview.ShortPercentFloat}%` : 'N/A',
    };
    try {
      const txn = await this.request(
        { function: 'INSIDER_TRANSACTIONS', symbol: symbol.toUpperCase() },
        6 * 60 * 60 * 1000
      );
      if (Array.isArray(txn?.data) && txn.data.length > 0) {
        result.recentTransactions = txn.data.slice(0, 15).map((t: any) => ({
          transactionDate: t.transaction_date,
          insider: t.executive,
          title: t.executive_title,
          transactionType: t.acquisition_or_disposal === 'A' ? 'Purchase' : 'Sale',
          shares: t.shares,
          sharePrice: t.share_price,
          totalValue:
            t.shares && t.share_price
              ? (Number(t.shares) * Number(t.share_price)).toFixed(0)
              : 'N/A',
        }));
      }
    } catch {
      // Premium endpoint — ownership data above is still returned
    }
    return attachSource(result, AV_SOURCE);
  }

  async getAnalystRatings(symbol: string): Promise<any> {
    const data = await this.request(
      { function: 'OVERVIEW', symbol: symbol.toUpperCase() },
      6 * 60 * 60 * 1000
    );
    return attachSource(
      {
        symbol: symbol.toUpperCase(),
        analystTargetPrice: data.AnalystTargetPrice || 'N/A',
        strongBuy: data.AnalystRatingStrongBuy || 'N/A',
        buy: data.AnalystRatingBuy || 'N/A',
        hold: data.AnalystRatingHold || 'N/A',
        sell: data.AnalystRatingSell || 'N/A',
        strongSell: data.AnalystRatingStrongSell || 'N/A',
        movingAverage50Day: data['50DayMovingAverage'] || 'N/A',
        upside:
          data.AnalystTargetPrice && data['50DayMovingAverage']
            ? `${(((Number(data.AnalystTargetPrice) / Number(data['50DayMovingAverage'])) - 1) * 100).toFixed(1)}% (vs 50-day MA)`
            : 'N/A',
      },
      AV_SOURCE
    );
  }

  async getAnalystRecommendations(_symbol: string): Promise<any> {
    throw new Error('Analyst recommendations unavailable in Alpha Vantage');
  }

  async getPriceTargets(symbol: string): Promise<any> {
    const overview = await this.getCompanyOverview(symbol).catch(() => null);
    return attachSource(
      { symbol: symbol.toUpperCase(), targetMean: overview?.analystTargetPrice ?? null },
      AV_SOURCE
    );
  }

  async getPeers(symbol: string): Promise<any> {
    const overview = await this.getCompanyOverview(symbol).catch(() => null);
    const queries = Array.from(
      new Set(
        [overview?.industry, overview?.sector, overview?.name, symbol]
          .filter(Boolean)
          .map((v) => String(v).trim())
      )
    ).slice(0, 2);
    const results = await Promise.all(
      queries.map((q) => this.searchStock(q).catch(() => ({ results: [] })))
    );
    const peers = Array.from(
      new Set(
        results.flatMap((r) => r.results || []).map((item: any) => item.symbol).filter(Boolean)
      )
    );
    return attachSource({ symbol: symbol.toUpperCase(), peers }, AV_SOURCE);
  }

  async searchStock(query: string): Promise<any> {
    const data = await this.request({ function: 'SYMBOL_SEARCH', keywords: query }, 60 * 60 * 1000);
    const matches = (data?.bestMatches || []).map((m: any) => ({
      symbol: m['1. symbol'],
      name: m['2. name'],
      type: m['3. type'],
      region: m['4. region'],
      currency: m['8. currency'],
      source: 'alphavantage',
    }));
    const seen = new Set<string>();
    const unique = matches.filter((item: any) => {
      if (!item.symbol) return false;
      const k = item.symbol.toUpperCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const usResults = unique.filter((item: any) => {
      const region = String(item.region || '').toLowerCase();
      const currency = String(item.currency || '').toUpperCase();
      const type = String(item.type || '').toLowerCase();
      if (type && !type.includes('equity')) return false;
      return (
        region.includes('united states') ||
        currency === 'USD' ||
        ['NYSE', 'NASDAQ', 'AMEX'].some((x) => (item.exchange || '').includes(x))
      );
    });
    const filtered = usResults.length
      ? usResults
      : unique.filter((item: any) => { const t = String(item.type || '').toLowerCase(); return !t || t.includes('equity'); });
    return { results: filtered };
  }

  async searchCompanies(query: string): Promise<any> {
    return this.searchStock(query);
  }

  async getEarningsHistory(symbol: string): Promise<any> {
    const data = await this.request(
      { function: 'EARNINGS', symbol: symbol.toUpperCase() },
      6 * 60 * 60 * 1000
    );
    if (!data.quarterlyEarnings) throw new Error('Unable to fetch earnings history');
    return attachSource(
      {
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
      },
      AV_SOURCE
    );
  }

  async getIncomeStatement(symbol: string): Promise<any> {
    const data = await this.request(
      { function: 'INCOME_STATEMENT', symbol: symbol.toUpperCase() },
      6 * 60 * 60 * 1000
    );
    if (!data.quarterlyReports) throw new Error('Unable to fetch income statement');
    return attachSource(
      {
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
      },
      AV_SOURCE
    );
  }

  async getBalanceSheet(symbol: string): Promise<any> {
    const data = await this.request(
      { function: 'BALANCE_SHEET', symbol: symbol.toUpperCase() },
      6 * 60 * 60 * 1000
    );
    if (!data.quarterlyReports) throw new Error('Unable to fetch balance sheet');
    return attachSource(
      {
        symbol: symbol.toUpperCase(),
        quarterlyReports: data.quarterlyReports.slice(0, 4).map((r: any) => ({
          fiscalQuarter: r.fiscalDateEnding,
          totalAssets: r.totalAssets,
          totalLiabilities: r.totalLiabilities,
          totalShareholderEquity: r.totalShareholderEquity,
          cashAndEquivalents: r.cashAndCashEquivalentsAtCarryingValue,
          longTermDebt: r.longTermDebt,
        })),
      },
      AV_SOURCE
    );
  }

  async getCashFlow(symbol: string): Promise<any> {
    const data = await this.request(
      { function: 'CASH_FLOW', symbol: symbol.toUpperCase() },
      6 * 60 * 60 * 1000
    );
    if (!data.quarterlyReports) throw new Error('Unable to fetch cash flow');
    return attachSource(
      {
        symbol: symbol.toUpperCase(),
        quarterlyReports: data.quarterlyReports.slice(0, 4).map((r: any) => ({
          fiscalQuarter: r.fiscalDateEnding,
          operatingCashflow: r.operatingCashflow,
          capitalExpenditures: r.capitalExpenditures,
          freeCashFlow:
            r.operatingCashflow && r.capitalExpenditures
              ? (Number(r.operatingCashflow) - Math.abs(Number(r.capitalExpenditures))).toString()
              : 'N/A',
          dividendPayout: r.dividendPayout,
        })),
      },
      AV_SOURCE
    );
  }

  async getSectorPerformance(): Promise<any> {
    const data = await this.request({ function: 'SECTOR' }, 15 * 60 * 1000);
    return attachSource(
      {
        realTimePerformance: data['Rank A: Real-Time Performance'] || {},
        oneDayPerformance: data['Rank B: 1 Day Performance'] || {},
        fiveDayPerformance: data['Rank C: 5 Day Performance'] || {},
        oneMonthPerformance: data['Rank D: 1 Month Performance'] || {},
        threeMonthPerformance: data['Rank E: 3 Month Performance'] || {},
        yearToDatePerformance: data['Rank F: Year-to-Date (YTD) Performance'] || {},
        oneYearPerformance: data['Rank G: 1 Year Performance'] || {},
      },
      AV_SOURCE
    );
  }

  async getStocksBySector(_sector: string): Promise<any> {
    throw new Error('Sector stock list unavailable in Alpha Vantage free tier');
  }

  async screenStocks(_filters: Record<string, string | number | undefined>): Promise<any> {
    throw new Error('Stock screening unavailable in Alpha Vantage free tier');
  }

  async getTopGainersLosers(): Promise<any> {
    const data = await this.request({ function: 'TOP_GAINERS_LOSERS' }, 5 * 60 * 1000);
    return attachSource(
      {
        topGainers: (data.top_gainers || []).slice(0, 10).map((s: any) => ({
          ticker: s.ticker, price: s.price, changeAmount: s.change_amount,
          changePercentage: s.change_percentage, volume: s.volume,
        })),
        topLosers: (data.top_losers || []).slice(0, 10).map((s: any) => ({
          ticker: s.ticker, price: s.price, changeAmount: s.change_amount,
          changePercentage: s.change_percentage, volume: s.volume,
        })),
        mostActive: (data.most_actively_traded || []).slice(0, 10).map((s: any) => ({
          ticker: s.ticker, price: s.price, changeAmount: s.change_amount,
          changePercentage: s.change_percentage, volume: s.volume,
        })),
      },
      AV_SOURCE
    );
  }

  async getNewsSentiment(_symbol: string): Promise<any> {
    throw new Error('News sentiment unavailable in Alpha Vantage free tier');
  }
  async getCompanyNews(_symbol: string, _days?: number): Promise<any> {
    throw new Error('Company news unavailable in Alpha Vantage free tier');
  }
  async searchNews(_query: string, _days?: number): Promise<any> {
    throw new Error('News search unavailable in Alpha Vantage free tier');
  }
}

// ─── Finnhub Provider ──────────────────────────────────────────────────────

const FH_SOURCE = 'Finnhub';

/**
 * Finnhub stock data provider.
 * Free tier: 60 requests/minute — real-time data, financials, news, and more.
 * Get a key at https://finnhub.io/register
 * Required env var: FINNHUB_API_KEY
 *
 * What the free plan covers:
 *   Real-time quotes, OHLCV candles, company profiles, financials,
 *   earnings, insider transactions, analyst ratings, price targets,
 *   peer lists, company news, and market news with sentiment.
 */
export class FinnhubService implements StockDataService {
  private readonly baseUrl = 'https://finnhub.io/api/v1';
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;
  private static readonly sharedCache = new ResponseCache();

  constructor(private readonly apiKey = process.env.FINNHUB_API_KEY ?? '') {
    this.minIntervalMs = Number(process.env.FINNHUB_MIN_INTERVAL_MS ?? 1000);
  }

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private async get(path: string, params: Record<string, string> = {}): Promise<any> {
    if (!this.apiKey) throw new Error('FINNHUB_API_KEY is not configured');
    await this.throttle();
    try {
      const { data } = await axios.get(`${this.baseUrl}${path}`, {
        params: { ...params, token: this.apiKey },
        timeout: 10_000,
      });
      return data;
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err.message;
      throw new Error(`Finnhub error on ${path}: ${msg}`);
    }
  }

  private cache<T>(key: string, ttlMs: number, path: string, params: Record<string, string> = {}): Promise<T> {
    return FinnhubService.sharedCache.getOrFetch(key, ttlMs, () => this.get(path, params)) as Promise<T>;
  }

  async getStockPrice(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase();
    const d = await this.cache<any>(`fh:quote:${sym}`, 30_000, '/quote', { symbol: sym });
    if (d?.c == null) throw new Error(`Unable to fetch stock price for ${sym}`);
    return attachSource(
      {
        symbol: sym,
        price: d.c?.toFixed(2),
        change: d.d?.toFixed(2) ?? null,
        changePercent: d.dp != null ? `${d.dp.toFixed(2)}%` : 'N/A',
        high: d.h, low: d.l, open: d.o, previousClose: d.pc, volume: d.v,
        timestamp: d.t ? new Date(d.t * 1000).toISOString() : null,
      },
      FH_SOURCE
    );
  }

  async getPriceHistory(symbol: string, range = '1y'): Promise<any> {
    const sym = symbol.toUpperCase();
    const now = Math.floor(Date.now() / 1000);
    const days = parseRangeToDays(range);
    const resolution = days > 365 ? 'W' : 'D';
    const d = await this.cache<any>(
      `fh:candles:${sym}:${range}`, 60 * 60 * 1000, '/stock/candles',
      { symbol: sym, resolution, from: String(now - days * 86_400), to: String(now) }
    );
    if (!d || d.s !== 'ok') throw new Error('Unable to fetch price history');
    const prices = (d.t as number[]).map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i], volume: d.v[i],
    }));
    return attachSource({ symbol: sym, prices }, FH_SOURCE);
  }

  async getCompanyOverview(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase();
    const [profile, metrics] = await Promise.all([
      this.cache<any>(`fh:profile:${sym}`, 6 * 60 * 60 * 1000, '/stock/profile2', { symbol: sym }),
      this.getBasicFinancials(sym).catch(() => ({ metric: {} })),
    ]);
    if (!profile?.ticker) throw new Error(`Unable to fetch company overview for ${sym}`);
    const m = metrics.metric ?? {};
    return attachSource(
      {
        symbol: sym,
        name: profile.name,
        description: `${profile.name} is a ${profile.finnhubIndustry ?? 'public'} company listed on ${profile.exchange ?? 'an exchange'}.`,
        sector: profile.finnhubIndustry ?? null,
        industry: profile.finnhubIndustry ?? null,
        marketCapitalization: profile.marketCapitalization ? String(Math.round(profile.marketCapitalization * 1e6)) : null,
        eps: m.epsNormalizedAnnual ?? null,
        peRatio: m.peNormalizedAnnual ?? null,
        forwardPE: m.peTTM ?? null,
        beta: m.beta ?? null,
        '52WeekHigh': m['52WeekHigh'] ?? null,
        '52WeekLow': m['52WeekLow'] ?? null,
        dividendYield: m.dividendYieldIndicatedAnnual ?? null,
        profitMargin: m.netProfitMarginTTM != null ? m.netProfitMarginTTM / 100 : null,
        returnOnEquity: m.roeTTM != null ? m.roeTTM / 100 : null,
        sharesOutstanding: profile.shareOutstanding ? String(Math.round(profile.shareOutstanding * 1e6)) : null,
        exchange: profile.exchange ?? null,
        ipoDate: profile.ipo ?? null,
        webUrl: profile.weburl ?? null,
        logo: profile.logo ?? null,
        currency: profile.currency ?? 'USD',
      },
      FH_SOURCE
    );
  }

  async getBasicFinancials(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase();
    const d = await this.cache<any>(`fh:metrics:${sym}`, 6 * 60 * 60 * 1000, '/stock/metric', { symbol: sym, metric: 'all' });
    const m = d?.metric ?? {};
    return attachSource(
      {
        symbol: sym,
        metric: {
          peBasicExclExtraTTM: m.peTTM ?? null,
          epsTTM: m.epsNormalizedAnnual ?? null,
          revenueGrowthTTM: m.revenueGrowthTTMAnnual ?? null,
          epsGrowthTTM: m.epsGrowth3Y ?? null,
          grossMarginTTM: m.grossMarginTTM != null ? m.grossMarginTTM / 100 : null,
          operatingMarginTTM: m.operatingMarginTTM != null ? m.operatingMarginTTM / 100 : null,
          roeTTM: m.roeTTM != null ? m.roeTTM / 100 : null,
          revenuePerShareTTM: m.revenuePerShareAnnual ?? null,
          beta: m.beta ?? null,
          '52WeekHigh': m['52WeekHigh'] ?? null,
          '52WeekLow': m['52WeekLow'] ?? null,
          debtToEquity: m.totalDebt_totalEquityAnnual ?? null,
          priceToBook: m.pbAnnual ?? null,
          currentRatio: m.currentRatioAnnual ?? null,
          dividendYield: m.dividendYieldIndicatedAnnual ?? null,
        },
        series: {},
      },
      FH_SOURCE
    );
  }

  async getInsiderTrading(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase();
    const d = await this.cache<any>(`fh:insider:${sym}`, 6 * 60 * 60 * 1000, '/stock/insider-transactions', { symbol: sym });
    const transactions = (d?.data ?? []).slice(0, 15).map((t: any) => ({
      transactionDate: t.transactionDate,
      insider: t.name,
      title: t.title ?? 'N/A',
      transactionType: t.change > 0 ? 'Purchase' : 'Sale',
      shares: Math.abs(t.change ?? 0),
      sharePrice: t.transactionPrice ?? null,
      totalValue: t.change && t.transactionPrice ? Math.abs(t.change * t.transactionPrice).toFixed(0) : 'N/A',
    }));
    return attachSource({ symbol: sym, recentTransactions: transactions }, FH_SOURCE);
  }

  async getAnalystRatings(symbol: string): Promise<any> {
    const recs = await this.getAnalystRecommendations(symbol);
    const latest = recs?.recommendations?.[0] ?? {};
    return attachSource(
      {
        symbol: symbol.toUpperCase(),
        strongBuy: latest.strongBuy ?? 'N/A',
        buy: latest.buy ?? 'N/A',
        hold: latest.hold ?? 'N/A',
        sell: latest.sell ?? 'N/A',
        strongSell: latest.strongSell ?? 'N/A',
        period: latest.period ?? 'N/A',
      },
      FH_SOURCE
    );
  }

  async getAnalystRecommendations(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase();
    const d = await this.cache<any[]>(`fh:recommendations:${sym}`, 6 * 60 * 60 * 1000, '/stock/recommendation', { symbol: sym });
    return attachSource(
      {
        symbol: sym,
        recommendations: (d ?? []).slice(0, 6).map((r: any) => ({
          period: r.period,
          strongBuy: r.strongBuy, buy: r.buy, hold: r.hold, sell: r.sell, strongSell: r.strongSell,
        })),
      },
      FH_SOURCE
    );
  }

  async getPriceTargets(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase();
    const d = await this.cache<any>(`fh:priceTarget:${sym}`, 6 * 60 * 60 * 1000, '/stock/price-target', { symbol: sym });
    return attachSource(
      {
        symbol: sym,
        targetHigh: d?.targetHigh ?? null,
        targetLow: d?.targetLow ?? null,
        targetMean: d?.targetMean ?? null,
        targetMedian: d?.targetMedian ?? null,
        lastUpdated: d?.lastUpdated ?? null,
      },
      FH_SOURCE
    );
  }

  async getPeers(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase();
    const d = await this.cache<string[]>(`fh:peers:${sym}`, 6 * 60 * 60 * 1000, '/stock/peers', { symbol: sym });
    return attachSource({ symbol: sym, peers: (d ?? []).filter((s) => s !== sym) }, FH_SOURCE);
  }

  async searchStock(query: string): Promise<any> {
    const d = await this.cache<any>(`fh:search:${query.toLowerCase()}`, 60 * 60 * 1000, '/search', { q: query });
    const results = (d?.result ?? [])
      .filter((item: any) => item?.type === 'Common Stock' && item?.symbol)
      .map((item: any) => ({
        symbol: item.displaySymbol ?? item.symbol,
        name: item.description,
        type: 'Equity', region: 'United States', currency: 'USD', source: 'finnhub',
      }))
      .slice(0, 10);
    return { results };
  }

  async searchCompanies(query: string): Promise<any> { return this.searchStock(query); }

  async getEarningsHistory(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase();
    const d = await this.cache<any[]>(`fh:earnings:${sym}`, 6 * 60 * 60 * 1000, '/stock/earnings', { symbol: sym, limit: '20' });
    return attachSource(
      {
        symbol: sym,
        quarterlyEarnings: (d ?? []).map((e: any) => ({
          fiscalQuarter: e.period,
          reportedEPS: e.actual ?? null,
          estimatedEPS: e.estimate ?? null,
          surprise: e.surprise ?? null,
          surprisePercentage: e.surprisePercent ?? null,
        })),
      },
      FH_SOURCE
    );
  }

  async getIncomeStatement(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase();
    const d = await this.cache<any>(`fh:income:${sym}`, 6 * 60 * 60 * 1000, '/financials', { symbol: sym, statement: 'ic', freq: 'quarterly' });
    return attachSource(
      {
        symbol: sym,
        quarterlyReports: (d?.financials ?? []).slice(0, 8).map((r: any) => ({
          fiscalQuarter: r.period,
          totalRevenue: r.revenue ?? null,
          grossProfit: r.grossProfit ?? null,
          operatingIncome: r.ebit ?? null,
          netIncome: r.netIncome ?? null,
          ebitda: r.ebitda ?? null,
        })),
      },
      FH_SOURCE
    );
  }

  async getBalanceSheet(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase();
    const d = await this.cache<any>(`fh:balance:${sym}`, 6 * 60 * 60 * 1000, '/financials', { symbol: sym, statement: 'bs', freq: 'quarterly' });
    return attachSource(
      {
        symbol: sym,
        quarterlyReports: (d?.financials ?? []).slice(0, 4).map((r: any) => ({
          fiscalQuarter: r.period,
          totalAssets: r.totalAssets ?? null,
          totalLiabilities: r.totalLiabilities ?? null,
          totalShareholderEquity: r.stockholdersEquity ?? null,
          cashAndEquivalents: r.cashAndEquivalents ?? null,
          longTermDebt: r.longTermDebt ?? null,
        })),
      },
      FH_SOURCE
    );
  }

  async getCashFlow(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase();
    const d = await this.cache<any>(`fh:cashflow:${sym}`, 6 * 60 * 60 * 1000, '/financials', { symbol: sym, statement: 'cf', freq: 'quarterly' });
    return attachSource(
      {
        symbol: sym,
        quarterlyReports: (d?.financials ?? []).slice(0, 4).map((r: any) => ({
          fiscalQuarter: r.period,
          operatingCashflow: r.operatingCashFlow ?? null,
          capitalExpenditures: r.capitalExpenditures ?? null,
          freeCashFlow:
            r.operatingCashFlow != null && r.capitalExpenditures != null
              ? (r.operatingCashFlow - Math.abs(r.capitalExpenditures)).toString()
              : 'N/A',
        })),
      },
      FH_SOURCE
    );
  }

  async getSectorPerformance(): Promise<any> {
    throw new Error('Sector performance is not available via Finnhub');
  }
  async getStocksBySector(_sector: string): Promise<any> {
    throw new Error('Sector stock list is not available via Finnhub free tier');
  }
  async screenStocks(_filters: Record<string, string | number | undefined>): Promise<any> {
    throw new Error('Stock screening is not available via Finnhub free tier');
  }
  async getTopGainersLosers(): Promise<any> {
    throw new Error('Top gainers/losers is not available via Finnhub free tier');
  }

  async getNewsSentiment(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase();
    try {
      const d = await this.cache<any>(`fh:sentiment:${sym}`, 30 * 60 * 1000, '/news-sentiment', { symbol: sym });
      return attachSource(
        {
          symbol: sym,
          buzz: d?.buzz ?? {},
          sentiment: d?.sentiment ?? {},
          companyNewsScore: d?.companyNewsScore ?? null,
          sectorAverageBullishPercent: d?.sectorAverageBullishPercent ?? null,
        },
        FH_SOURCE
      );
    } catch (err: any) {
      // /news-sentiment requires a Finnhub paid plan. The Finnhub API returns a specific
      // error message "You don't have access to this resource." for plan-gated endpoints.
      // Return a graceful empty response so the LLM can continue without treating it as
      // a hard error. Any other error (network, auth key missing, etc.) is re-thrown.
      const msg: string = err?.message ?? '';
      if (msg.includes("don't have access") || msg.includes("do not have access") || msg.includes("You don't have access")) {
        return attachSource(
          { symbol: sym, available: false, note: 'News sentiment requires a Finnhub paid plan.' },
          FH_SOURCE
        );
      }
      throw err;
    }
  }

  async getCompanyNews(symbol: string, days = 30): Promise<any> {
    const sym = symbol.toUpperCase();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const from = fmt(new Date(Date.now() - days * 86_400_000));
    const to = fmt(new Date());
    const d = await this.cache<any[]>(`fh:news:${sym}:${from}`, 30 * 60 * 1000, '/company-news', { symbol: sym, from, to });
    return attachSource(
      {
        symbol: sym,
        articles: (d ?? []).slice(0, 20).map((n: any) => ({
          headline: n.headline, summary: n.summary, source: n.source,
          url: n.url, datetime: new Date(n.datetime * 1000).toISOString(),
        })),
      },
      FH_SOURCE
    );
  }

  async searchNews(query: string, _days = 7): Promise<any> {
    const d = await this.cache<any[]>(`fh:marketnews:general`, 15 * 60 * 1000, '/news', { category: 'general' });
    const q = query.toLowerCase();
    const articles = (d ?? [])
      .filter((n: any) => n.headline?.toLowerCase().includes(q) || n.summary?.toLowerCase().includes(q))
      .slice(0, 10)
      .map((n: any) => ({
        headline: n.headline, summary: n.summary, source: n.source,
        url: n.url, datetime: new Date(n.datetime * 1000).toISOString(),
      }));
    return attachSource({ query, articles }, FH_SOURCE);
  }
}

// ─── Hybrid Provider ───────────────────────────────────────────────────────

/**
 * Hybrid: AlphaVantage primary, Finnhub fallback.
 * Needs both ALPHA_VANTAGE_API_KEY and FINNHUB_API_KEY.
 */
class HybridStockDataService implements StockDataService {
  constructor(
    private readonly primary: StockDataService,
    private readonly fallback: StockDataService
  ) {}

  /** Simple try-primary-then-fallback for methods where merging is unnecessary. */
  private async try2<T>(a: () => Promise<T>, b: () => Promise<T>): Promise<T> {
    try { return await a(); } catch { return b(); }
  }

  /**
   * For every key in `patch` where `base` has null / undefined / 'N/A',
   * fill it with the patch value (if the patch value is real).
   * Base always wins on fields it already has a real value for.
   */
  private static patchNulls<T extends Record<string, any>>(base: T, patch: T): T {
    const out: Record<string, any> = { ...base };
    for (const [k, v] of Object.entries(patch)) {
      if ((out[k] === null || out[k] === undefined || out[k] === 'N/A') &&
          v !== null && v !== undefined && v !== 'N/A') {
        out[k] = v;
      }
    }
    return out as T;
  }

  /**
   * Fetch from primary first.  If primary fails OR the optional `isIncomplete`
   * predicate says the result has critical gaps, also call the fallback provider
   * and patch-merge the results so neither source's null gaps survive.
   */
  private async tryMerge<T extends Record<string, any>>(
    a: () => Promise<T>,
    b: () => Promise<T>,
    isIncomplete?: (result: T) => boolean
  ): Promise<T> {
    let primary: T | null = null;
    try { primary = await a(); } catch { /* fall through */ }

    if (primary && (!isIncomplete || !isIncomplete(primary))) return primary;

    let secondary: T | null = null;
    try { secondary = await b(); } catch { /* fall through */ }

    if (!primary && !secondary) throw new Error('Both providers unavailable');
    if (!primary) return secondary!;
    if (!secondary) return primary;
    return HybridStockDataService.patchNulls(primary, secondary);
  }

  getStockPrice(s: string) { return this.try2(() => this.primary.getStockPrice(s), () => this.fallback.getStockPrice(s)); }
  getPriceHistory(s: string, r?: string) { return this.try2(() => this.primary.getPriceHistory(s, r), () => this.fallback.getPriceHistory(s, r)); }

  /** Merge company overview from both providers: primary wins, secondary fills null/N/A gaps.
   * Both AV and FH normalize this field to `marketCapitalization`. */
  getCompanyOverview(s: string) {
    return this.tryMerge(
      () => this.primary.getCompanyOverview(s),
      () => this.fallback.getCompanyOverview(s),
      (r) => !r?.sector || !r?.marketCapitalization
    );
  }

  /**
   * Merge basic financials including the nested `metric` sub-object.
   * AV derives metrics from OVERVIEW (may be absent on free tier);
   * Finnhub pulls from /stock/metric (always populated on free tier).
   * The three metrics checked are the ones AV most commonly fails to derive.
   * Merging ensures grossMarginTTM, roeTTM, and operatingMarginTTM are always filled.
   */
  async getBasicFinancials(s: string): Promise<any> {
    let primary: any = null;
    try { primary = await this.primary.getBasicFinancials(s); } catch { /* fall through */ }

    const hasKeyMetrics = primary?.metric?.grossMarginTTM != null
      && primary?.metric?.roeTTM != null
      && primary?.metric?.operatingMarginTTM != null;
    if (hasKeyMetrics) return primary;

    let secondary: any = null;
    try { secondary = await this.fallback.getBasicFinancials(s); } catch { /* fall through */ }

    if (!primary && !secondary) throw new Error('Both providers unavailable for basic financials');
    if (!primary) return secondary;
    if (!secondary) return primary;

    const merged = HybridStockDataService.patchNulls(primary, secondary);
    merged.metric = HybridStockDataService.patchNulls(
      primary.metric ?? {},
      secondary.metric ?? {}
    );
    return merged;
  }

  getInsiderTrading(s: string) { return this.try2(() => this.primary.getInsiderTrading(s), () => this.fallback.getInsiderTrading(s)); }
  getAnalystRatings(s: string) { return this.try2(() => this.primary.getAnalystRatings(s), () => this.fallback.getAnalystRatings(s)); }
  getAnalystRecommendations(s: string) { return this.try2(() => this.primary.getAnalystRecommendations(s), () => this.fallback.getAnalystRecommendations(s)); }
  getPriceTargets(s: string) { return this.try2(() => this.primary.getPriceTargets(s), () => this.fallback.getPriceTargets(s)); }
  getPeers(s: string) { return this.try2(() => this.primary.getPeers(s), () => this.fallback.getPeers(s)); }
  searchStock(q: string) { return this.try2(() => this.primary.searchStock(q), () => this.fallback.searchStock(q)); }
  searchCompanies(q: string) { return this.try2(() => this.primary.searchCompanies(q), () => this.fallback.searchCompanies(q)); }
  getEarningsHistory(s: string) { return this.try2(() => this.primary.getEarningsHistory(s), () => this.fallback.getEarningsHistory(s)); }
  getIncomeStatement(s: string) { return this.try2(() => this.primary.getIncomeStatement(s), () => this.fallback.getIncomeStatement(s)); }
  getBalanceSheet(s: string) { return this.try2(() => this.primary.getBalanceSheet(s), () => this.fallback.getBalanceSheet(s)); }
  getCashFlow(s: string) { return this.try2(() => this.primary.getCashFlow(s), () => this.fallback.getCashFlow(s)); }
  getSectorPerformance() { return this.try2(() => this.primary.getSectorPerformance(), () => this.fallback.getSectorPerformance()); }
  getStocksBySector(sector: string) { return this.try2(() => this.primary.getStocksBySector(sector), () => this.fallback.getStocksBySector(sector)); }
  screenStocks(f: Record<string, string | number | undefined>) { return this.try2(() => this.primary.screenStocks(f), () => this.fallback.screenStocks(f)); }
  getTopGainersLosers() { return this.try2(() => this.primary.getTopGainersLosers(), () => this.fallback.getTopGainersLosers()); }
  getNewsSentiment(s: string) { return this.try2(() => this.primary.getNewsSentiment(s), () => this.fallback.getNewsSentiment(s)); }
  getCompanyNews(s: string, d?: number) { return this.try2(() => this.primary.getCompanyNews(s, d), () => this.fallback.getCompanyNews(s, d)); }
  searchNews(q: string, d?: number) { return this.try2(() => this.primary.searchNews(q, d), () => this.fallback.searchNews(q, d)); }
}

// ─── Factory ───────────────────────────────────────────────────────────────

type Provider = 'alphavantage' | 'finnhub' | 'hybrid';

/**
 * Normalises the STOCK_DATA_PROVIDER value so that common
 * mis-spellings (e.g. "finhub") map to the canonical form.
 */
export function normalizeProvider(raw?: string): string {
  const p = (raw ?? process.env.STOCK_DATA_PROVIDER ?? 'alphavantage').toLowerCase().trim();
  // Accept "finhub" as an alias for "finnhub" (common typo)
  if (p === 'finhub') return 'finnhub';
  return p;
}

/**
 * Creates the appropriate StockDataService based on STOCK_DATA_PROVIDER.
 *
 * @param avApiKey  Alpha Vantage key (falls back to ALPHA_VANTAGE_API_KEY)
 * @param fhApiKey  Finnhub key (falls back to FINNHUB_API_KEY)
 */
export function createStockService(avApiKey?: string, fhApiKey?: string): StockDataService {
  const provider = normalizeProvider() as Provider;
  const avKey = avApiKey ?? process.env.ALPHA_VANTAGE_API_KEY;
  const fhKey = fhApiKey ?? process.env.FINNHUB_API_KEY;
  switch (provider) {
    case 'finnhub':
      return new FinnhubService(fhKey);
    case 'hybrid':
      return new HybridStockDataService(new AlphaVantageService(avKey), new FinnhubService(fhKey));
    default:
      // Auto-upgrade to hybrid when a Finnhub key is also configured — use every source available
      if (fhKey) {
        return new HybridStockDataService(new AlphaVantageService(avKey), new FinnhubService(fhKey));
      }
      return new AlphaVantageService(avKey);
  }
}
