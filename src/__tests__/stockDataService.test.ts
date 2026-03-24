import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { AlphaVantageService, FinnhubService } from '../stockDataService';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

const weeklyTimeSeriesResponse = {
  'Meta Data': { '2. Symbol': 'AAPL' },
  'Weekly Time Series': {
    '2025-01-10': { '1. open': '150', '2. high': '155', '3. low': '148', '4. close': '153', '5. volume': '5000' },
    '2025-01-03': { '1. open': '148', '2. high': '152', '3. low': '146', '4. close': '150', '5. volume': '4500' },
  },
};

const monthlyTimeSeriesResponse = {
  'Meta Data': { '2. Symbol': 'AAPL' },
  'Monthly Time Series': {
    '2025-01-31': { '1. open': '148', '2. high': '158', '3. low': '145', '4. close': '155', '5. volume': '40000' },
    '2024-12-31': { '1. open': '142', '2. high': '150', '3. low': '140', '4. close': '148', '5. volume': '38000' },
  },
};

describe('AlphaVantageService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    process.env.ALPHA_VANTAGE_API_KEY = 'test';
    process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS = '0';
    // Clear the shared in-process cache so each test makes real requests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AlphaVantageService as any).sharedCache.clear();
    // Reset circuit breaker between tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AlphaVantageService as any).rateLimitedUntilMs = 0;
  });

  it('caches stock price responses', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        'Global Quote': {
          '01. symbol': 'AAPL',
          '05. price': '100.00',
          '09. change': '1.00',
          '10. change percent': '1.00%',
          '06. volume': '1000',
          '07. latest trading day': '2025-01-01',
        },
      },
    });

    const service = new AlphaVantageService('test');
    const first = await service.getStockPrice('AAPL');
    const second = await service.getStockPrice('AAPL');

    expect(first.price).toBe('100.00');
    expect(second.price).toBe('100.00');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('returns alpha-only error for news', async () => {
    const service = new AlphaVantageService('test');

    await expect(service.getCompanyNews('AAPL', 5)).rejects.toThrow('Alpha-only mode');
  });

  it('uses TIME_SERIES_WEEKLY for 1y range (no outputsize param)', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: weeklyTimeSeriesResponse });

    const service = new AlphaVantageService('test');
    const result = await service.getPriceHistory('AAPL', '1y');

    const call = mockedAxios.get.mock.calls[0];
    expect(call[1].params.function).toBe('TIME_SERIES_WEEKLY');
    expect(call[1].params.outputsize).toBeUndefined();
    expect(result.prices).toBeDefined();
  });

  it('uses TIME_SERIES_WEEKLY for 5y range (no outputsize param)', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: weeklyTimeSeriesResponse });

    const service = new AlphaVantageService('test');
    await service.getPriceHistory('AAPL', '5y');

    const call = mockedAxios.get.mock.calls[0];
    expect(call[1].params.function).toBe('TIME_SERIES_WEEKLY');
    expect(call[1].params.outputsize).toBeUndefined();
  });

  it('uses TIME_SERIES_MONTHLY for max range (no outputsize param)', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: monthlyTimeSeriesResponse });

    const service = new AlphaVantageService('test');
    const result = await service.getPriceHistory('AAPL', 'max');

    const call = mockedAxios.get.mock.calls[0];
    expect(call[1].params.function).toBe('TIME_SERIES_MONTHLY');
    expect(call[1].params.outputsize).toBeUndefined();
    expect(result.prices.length).toBeGreaterThan(0);
  });

  it('uses TIME_SERIES_DAILY with compact for short ranges', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        'Time Series (Daily)': {
          '2025-01-10': { '1. open': '150', '2. high': '155', '3. low': '148', '4. close': '153', '5. volume': '5000' },
        },
      },
    });

    const service = new AlphaVantageService('test');
    await service.getPriceHistory('AAPL', '1m');

    const call = mockedAxios.get.mock.calls[0];
    expect(call[1].params.function).toBe('TIME_SERIES_DAILY');
    expect(call[1].params.outputsize).toBe('compact');
  });

  it('throws suppression-compatible error when company overview is empty', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: {} });

    const service = new AlphaVantageService('test');
    await expect(service.getCompanyOverview('AAPL')).rejects.toThrow('Unavailable via Alpha Vantage');
  });

  // ── Circuit breaker tests ──────────────────────────────────────────────────

  it('opens daily circuit breaker on per-day rate limit response and skips subsequent HTTP calls', async () => {
    // First call returns the 25 req/day limit message in Information
    mockedAxios.get.mockResolvedValueOnce({
      data: { Information: 'We have detected your API key as TEST and our standard API rate limit is 25 requests per day.' },
    });

    const service = new AlphaVantageService('test');

    // First call should trigger the circuit breaker
    await expect(service.getStockPrice('AAPL')).rejects.toThrow('Unavailable via Alpha Vantage: rate limit active');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    // Second call should NOT make an HTTP request — circuit is open
    await expect(service.getStockPrice('MSFT')).rejects.toThrow('Unavailable via Alpha Vantage: rate limit active');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1); // still 1 — no extra HTTP call
  });

  it('opens short-lockout circuit breaker on per-second rate limit (Note field)', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { Note: 'Thank you for using Alpha Vantage! Please consider spreading out your free API requests more sparingly (1 request per second).' },
    });

    const service = new AlphaVantageService('test');
    await expect(service.getStockPrice('AAPL')).rejects.toThrow('Unavailable via Alpha Vantage: rate limit active');

    // Circuit breaker is open — no second HTTP call
    await expect(service.getStockPrice('MSFT')).rejects.toThrow('Unavailable via Alpha Vantage: rate limit active');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('daily lockout is longer than per-minute lockout', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const daily = (AlphaVantageService as any).DAILY_LIMIT_LOCKOUT_MS as number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perMin = (AlphaVantageService as any).PER_MINUTE_LOCKOUT_MS as number;
    expect(daily).toBeGreaterThan(perMin);
    expect(daily).toBe(60 * 60 * 1000);   // 1 hour
    expect(perMin).toBe(65 * 1000);         // 65 seconds
  });

  it('getPeers propagates circuit-breaker error so withFallback can try Finnhub', async () => {
    // getCompanyOverview call (OVERVIEW) returns rate-limit message → circuit opens
    mockedAxios.get.mockResolvedValueOnce({
      data: { Information: 'We have detected your API key as TEST and our standard API rate limit is 25 requests per day.' },
    });

    const service = new AlphaVantageService('test');
    // The circuit fires on the OVERVIEW call inside getCompanyOverview, so getPeers must throw
    // rather than silently returning an empty peer list.
    await expect(service.getPeers('NVDA')).rejects.toThrow('Unavailable via Alpha Vantage');
  });
});

describe('FinnhubService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    process.env.FINNHUB_API_KEY = 'test-fh';
    process.env.FINNHUB_MIN_INTERVAL_MS = '0';
    // Reset circuit breaker between tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (FinnhubService as any).rateLimitedUntilMs = 0;
  });

  it('opens circuit breaker on HTTP 429 and skips subsequent HTTP calls', async () => {
    const err = Object.assign(new Error('429'), { response: { status: 429 } });
    mockedAxios.get.mockRejectedValueOnce(err);

    const service = new FinnhubService('test-fh');

    // First call hits 429 → circuit opens
    await expect(service.getStockPrice('AAPL')).rejects.toThrow('Unavailable via Finnhub: rate limit active');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    // Second call: circuit is open — no HTTP call made
    await expect(service.getStockPrice('MSFT')).rejects.toThrow('Unavailable via Finnhub: rate limit active');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1); // still 1
  });

  it('falls back to 1y daily candles when the requested weekly resolution returns no_data', async () => {
    // First call: weekly 5y → Finnhub returns no_data
    mockedAxios.get.mockResolvedValueOnce({ data: { s: 'no_data' } });
    // Second call: daily 1y fallback → returns valid candles
    const t = [1700000000, 1700086400];
    mockedAxios.get.mockResolvedValueOnce({
      data: { s: 'ok', t, o: [100, 101], h: [102, 103], l: [99, 100], c: [101, 102], v: [1000, 2000] },
    });

    const service = new FinnhubService('test-fh');
    const result = await service.getPriceHistory('NVDA', '5y');

    expect(result.prices).toHaveLength(2);
    expect(result.prices[0].close).toBe(101);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    // Second call must use resolution=D
    const secondCall = mockedAxios.get.mock.calls[1];
    expect(secondCall[1]?.params?.resolution).toBe('D');
  });

  it('returns price history directly when the first request succeeds', async () => {
    const t = [1700000000];
    mockedAxios.get.mockResolvedValueOnce({
      data: { s: 'ok', t, o: [150], h: [155], l: [148], c: [152], v: [500] },
    });

    const service = new FinnhubService('test-fh');
    const result = await service.getPriceHistory('AAPL', '1y');

    expect(result.prices).toHaveLength(1);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('scales Finnhub revenueTTM from millions to raw dollars in getCompanyOverview', async () => {
    // profile2: marketCapitalization in millions (will be scaled ×1e6)
    mockedAxios.get.mockResolvedValueOnce({
      data: { name: 'Test Corp', finnhubIndustry: 'TECHNOLOGY', marketCapitalization: 1000, shareOutstanding: 100 },
    });
    // metric: revenueTTM in millions, grossMarginTTM as ratio
    mockedAxios.get.mockResolvedValueOnce({
      data: { metric: { revenueTTM: 500, grossMarginTTM: 0.6, operatingMarginTTM: 0.3 } },
    });

    const service = new FinnhubService('test-fh');
    const overview = await service.getCompanyOverview('TEST');

    // revenueTTM must be raw dollars: 500M × 1e6 = 500,000,000
    expect(overview.revenueTTM).toBe('500000000');
    // grossProfitTTM: 0.6 × 500M × 1e6 = 300,000,000
    expect(overview.grossProfitTTM).toBe('300000000');
    // grossMarginTTM exposed as ratio
    expect(overview.grossMarginTTM).toBe(0.6);
    // marketCapitalization: 1000M × 1e6 = 1,000,000,000
    expect(overview.marketCapitalization).toBe('1000000000');
  });

  it('getBalanceSheet falls back to per-share × sharesOutstanding when quarterly series empty', async () => {
    // metric call: empty series, but has per-share fields
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        metric: { bookValuePerShareQuarterly: 20, cashPerShareAnnual: 5 },
        series: { quarterly: { bs: {} } },
      },
    });
    // profile2 call: 200 million shares outstanding
    mockedAxios.get.mockResolvedValueOnce({
      data: { shareOutstanding: 200 },
    });

    const service = new FinnhubService('test-fh');
    const result = await service.getBalanceSheet('TEST');

    expect(result.quarterlyReports).toHaveLength(1);
    // equity = 20 $/share × 200M shares × 1e6 = 20 × 200 × 1e6 = 4,000,000,000
    expect(result.quarterlyReports[0].totalShareholderEquity).toBe('4000000000');
    // cash = 5 $/share × 200M shares × 1e6 = 1,000,000,000
    expect(result.quarterlyReports[0].cashAndEquivalents).toBe('1000000000');
  });

  it('getIncomeStatement TTM fallback uses raw dollars (revenueTTM × 1e6)', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        metric: { revenueTTM: 100, grossMarginTTM: 0.5, operatingMarginTTM: 0.3, netProfitMarginTTM: 0.2 },
        series: { quarterly: { ic: {} } },
      },
    });

    const service = new FinnhubService('test-fh');
    const result = await service.getIncomeStatement('TEST');

    // totalRevenue: 100M × 1e6 = 100,000,000
    expect(result.quarterlyReports[0].totalRevenue).toBe('100000000');
    // grossProfit: 0.5 × 100,000,000 = 50,000,000
    expect(result.quarterlyReports[0].grossProfit).toBe('50000000');
  });

  it('getCashFlow TTM fallback scales freeCashFlowTTM from millions to raw dollars', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        metric: { freeCashFlowTTM: 34.9 },
        series: { quarterly: { cf: {} } },
      },
    });

    const service = new FinnhubService('test-fh');
    const result = await service.getCashFlow('TEST');

    // freeCashFlow: 34.9M × 1e6 = 34,900,000
    expect(result.quarterlyReports[0].freeCashFlow).toBe('34900000');
  });
});
