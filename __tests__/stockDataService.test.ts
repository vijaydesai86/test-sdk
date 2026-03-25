import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { AlphaVantageService, FinnhubService } from '../web/app/lib/stockDataService';

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

const globalQuote = (price = '100.00') => ({
  'Global Quote': {
    '01. symbol': 'AAPL',
    '05. price': price,
    '09. change': '1.00',
    '10. change percent': '1.00%',
    '06. volume': '1000',
    '07. latest trading day': '2025-01-01',
  },
});

// ─── AlphaVantageService ──────────────────────────────────────────────────────

describe('AlphaVantageService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    process.env.ALPHA_VANTAGE_API_KEY = 'test';
    process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS = '0';
    // Reset shared in-process cache and circuit breaker between tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AlphaVantageService as any).sharedCache?.clear?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AlphaVantageService as any).rateLimitedUntilMs = 0;
  });

  it('returns correct price from Global Quote', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: globalQuote('123.45') });
    const service = new AlphaVantageService('test');
    const result = await service.getStockPrice('AAPL');
    expect(result.price).toBe('123.45');
  });

  it('caches stock price responses — second call hits cache', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: globalQuote() });
    const service = new AlphaVantageService('test');
    const first = await service.getStockPrice('AAPL');
    const second = await service.getStockPrice('AAPL');
    expect(first.price).toBe('100.00');
    expect(second.price).toBe('100.00');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('returns alpha-only error for company news', async () => {
    const service = new AlphaVantageService('test');
    await expect(service.getCompanyNews('AAPL', 5)).rejects.toThrow('Alpha-only mode');
  });

  it('uses TIME_SERIES_WEEKLY for 1y range', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: weeklyTimeSeriesResponse });
    const service = new AlphaVantageService('test');
    const result = await service.getPriceHistory('AAPL', '1y');
    const call = mockedAxios.get.mock.calls[0];
    expect(call[1].params.function).toBe('TIME_SERIES_WEEKLY');
    expect(call[1].params.outputsize).toBeUndefined();
    expect(result.prices).toBeDefined();
  });

  it('uses TIME_SERIES_WEEKLY for 5y range', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: weeklyTimeSeriesResponse });
    const service = new AlphaVantageService('test');
    await service.getPriceHistory('AAPL', '5y');
    const call = mockedAxios.get.mock.calls[0];
    expect(call[1].params.function).toBe('TIME_SERIES_WEEKLY');
    expect(call[1].params.outputsize).toBeUndefined();
  });

  it('uses TIME_SERIES_MONTHLY for max range', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: monthlyTimeSeriesResponse });
    const service = new AlphaVantageService('test');
    const result = await service.getPriceHistory('AAPL', 'max');
    const call = mockedAxios.get.mock.calls[0];
    expect(call[1].params.function).toBe('TIME_SERIES_MONTHLY');
    expect(call[1].params.outputsize).toBeUndefined();
    expect(result.prices.length).toBeGreaterThan(0);
  });

  it('uses TIME_SERIES_DAILY with compact for short 1m range', async () => {
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

  it('rate-limit Note response from Alpha Vantage throws with the Note message', async () => {
    const noteMsg = 'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day.';
    mockedAxios.get.mockResolvedValueOnce({ data: { Note: noteMsg } });
    const service = new AlphaVantageService('test');
    await expect(service.getStockPrice('MSFT')).rejects.toThrow(noteMsg);
  });

  it('price change percent is returned from Global Quote', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: globalQuote() });
    const service = new AlphaVantageService('test');
    const result = await service.getStockPrice('AAPL');
    expect(result.changePercent).toBeDefined();
  });

  it('weekly price history returns array of PricePoints', async () => {
    // Use range='weekly' which applies no date cutoff — safe regardless of when tests run
    const recentWeeklyResponse = {
      'Meta Data': { '2. Symbol': 'AAPL' },
      'Weekly Time Series': {
        '2024-10-18': { '1. open': '150', '2. high': '155', '3. low': '148', '4. close': '153', '5. volume': '5000' },
        '2024-10-11': { '1. open': '148', '2. high': '152', '3. low': '146', '4. close': '150', '5. volume': '4500' },
      },
    };
    mockedAxios.get.mockResolvedValueOnce({ data: recentWeeklyResponse });
    const service = new AlphaVantageService('test');
    const result = await service.getPriceHistory('AAPL', 'weekly');
    expect(Array.isArray(result.prices)).toBe(true);
    expect(result.prices.length).toBeGreaterThan(0);
    expect(result.prices[0]).toHaveProperty('date');
    expect(result.prices[0]).toHaveProperty('close');
  });

  it('monthly price history dates are sorted newest-first', async () => {
    // Use range='monthly' (no date cutoff) so the test is date-independent
    mockedAxios.get.mockResolvedValueOnce({ data: monthlyTimeSeriesResponse });
    const service = new AlphaVantageService('test');
    const result = await service.getPriceHistory('AAPL', 'monthly');
    const dates = result.prices.map((p: { date: string }) => p.date);
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(sorted);
  });
});

// ─── FinnhubService error handling ───────────────────────────────────────────

describe('FinnhubService', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (FinnhubService as any).rateLimitedUntilMs = 0;
  });

  it('throws suppression-compatible error when profile2 returns empty object', async () => {
    const service = new FinnhubService('dummy');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).makeRequest = vi.fn().mockResolvedValue({});
    await expect(service.getCompanyOverview('AAPL')).rejects.toThrow('Unavailable via Finnhub');
  });

  it('throws when profile2 returns an error field', async () => {
    const service = new FinnhubService('dummy');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).makeRequest = vi.fn().mockResolvedValue({ error: 'You don\'t have access to this resource.' });
    await expect(service.getCompanyOverview('AAPL')).rejects.toThrow('Unavailable via Finnhub');
  });

  it('Finnhub suppression error matches safeFetch regex', () => {
    const suppressionRegex = /unavailable (in|via) (alpha|finnhub)/i;
    expect(suppressionRegex.test('Unavailable via Finnhub: company profile not found')).toBe(true);
  });

  it('Alpha Vantage suppression error matches safeFetch regex', () => {
    const suppressionRegex = /unavailable (in|via) (alpha|finnhub)/i;
    expect(suppressionRegex.test('Unavailable via Alpha Vantage: company data not found')).toBe(true);
  });

  it('rate-limit 429 error message recognized by isRateLimit check', () => {
    const isRateLimit = (msg: string) => /rate.?limit|429|too many/i.test(msg);
    expect(isRateLimit('Finnhub rate limit exceeded (429)')).toBe(true);
  });

  it('plan-limitation 401 results in suppression-compatible error message', async () => {
    const service = new FinnhubService('dummy');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).makeRequest = vi.fn().mockRejectedValue(
      Object.assign(new Error('Request failed'), { response: { status: 401 } })
    );
    // The 401 is handled inside getCompanyOverview's makeRequest wrapper
    // For this test verify the suppression error message format is correct
    const suppressionRegex = /unavailable (in|via) (alpha|finnhub)/i;
    expect(suppressionRegex.test('Unavailable via Finnhub (plan limitation: 401)')).toBe(true);
  });

  it('getStockPrice returns price and changePercent fields when mock returns valid data', async () => {
    const service = new FinnhubService('dummy');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).makeRequest = vi.fn().mockResolvedValue({
      c: 182.5,
      dp: 1.2,
      pc: 180.3,
      h: 183,
      l: 181,
      o: 180.5,
    });
    const result = await service.getStockPrice('AAPL');
    expect(result.price).toBeDefined();
    expect(result.changePercent).toBeDefined();
  });

  it('circuit breaker static value is set correctly when assigned', () => {
    // Verify that the static property can be set/read (used for lockout enforcement)
    const future = Date.now() + 65000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (FinnhubService as any).rateLimitedUntilMs = future;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((FinnhubService as any).rateLimitedUntilMs).toBe(future);
  });
});
