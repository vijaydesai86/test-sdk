import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { AlphaVantageService } from '../stockDataService';

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
});

