import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { AlphaVantageService, FinnhubService, createStockService } from '../stockDataService';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

// ─── AlphaVantageService ─────────────────────────────────────────────────────

describe('AlphaVantageService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    process.env.ALPHA_VANTAGE_API_KEY = 'test-av-key';
    process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS = '0';
  });

  it('returns stock price with correct shape', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        'Global Quote': {
          '01. symbol': 'TEST',
          '05. price': '100.00',
          '09. change': '1.00',
          '10. change percent': '1.00%',
          '06. volume': '1000',
          '07. latest trading day': '2025-01-01',
        },
      },
    });
    const svc = new AlphaVantageService('test-av-key');
    const result = await svc.getStockPrice('TEST');
    expect(result.price).toBe('100.00');
    expect(result.symbol).toBe('TEST');
    expect(result.__source).toBe('Alpha Vantage');
  });

  it('deduplicates identical requests via cache (only 1 HTTP call)', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        'Global Quote': {
          '01. symbol': 'AAPL',
          '05. price': '200.00',
          '09. change': '2.00',
          '10. change percent': '1.00%',
          '06. volume': '5000',
          '07. latest trading day': '2025-01-01',
        },
      },
    });
    const svc = new AlphaVantageService('test-av-key');
    await svc.getStockPrice('AAPL');
    await svc.getStockPrice('AAPL');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('throws on Alpha Vantage rate-limit Note response', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { Note: 'API call frequency is 5 calls per minute.' },
    });
    const svc = new AlphaVantageService('test-av-key');
    await expect(svc.getStockPrice('RATE')).rejects.toThrow('API call frequency');
  });

  it('throws unavailable error for getCompanyNews', async () => {
    const svc = new AlphaVantageService('test-av-key');
    await expect(svc.getCompanyNews('TEST', 5)).rejects.toThrow('unavailable in Alpha Vantage');
  });

  it('throws unavailable error for getNewsSentiment', async () => {
    const svc = new AlphaVantageService('test-av-key');
    await expect(svc.getNewsSentiment('TEST')).rejects.toThrow('unavailable in Alpha Vantage');
  });

  it('returns sector performance with ranked keys', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        'Rank A: Real-Time Performance': { Technology: '1.2%' },
        'Rank B: 1 Day Performance': { Technology: '1.0%' },
        'Rank C: 5 Day Performance': {},
        'Rank D: 1 Month Performance': {},
        'Rank E: 3 Month Performance': {},
        'Rank F: Year-to-Date (YTD) Performance': {},
        'Rank G: 1 Year Performance': {},
      },
    });
    const svc = new AlphaVantageService('test-av-key');
    const result = await svc.getSectorPerformance();
    expect(result.realTimePerformance.Technology).toBe('1.2%');
    expect(result.__source).toBe('Alpha Vantage');
  });
});

// ─── FinnhubService ──────────────────────────────────────────────────────────

describe('FinnhubService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    process.env.FINNHUB_API_KEY = 'test-fh-key';
    process.env.FINNHUB_MIN_INTERVAL_MS = '0';
  });

  it('returns stock price with correct shape', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { c: 150.25, d: 2.5, dp: 1.69, h: 151.0, l: 148.5, o: 149.0, pc: 147.75, v: 50000000, t: 1700000000 },
    });
    const svc = new FinnhubService('test-fh-key');
    const result = await svc.getStockPrice('AAPL');
    expect(result.symbol).toBe('AAPL');
    expect(result.price).toBe('150.25');
    expect(result.changePercent).toBe('1.69%');
    expect(result.__source).toBe('Finnhub');
  });

  it('throws when stock price response has null current price', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { c: null, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0 } });
    const svc = new FinnhubService('test-fh-key');
    await expect(svc.getStockPrice('BAD')).rejects.toThrow('Unable to fetch stock price');
  });

  it('throws when FINNHUB_API_KEY is missing', async () => {
    const svc = new FinnhubService('');
    // Use a symbol that has never been cached so the empty-key check is reached
    await expect(svc.getStockPrice('NOKEY')).rejects.toThrow('FINNHUB_API_KEY is not configured');
  });

  it('returns price history from candles', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        s: 'ok',
        t: [1700000000, 1700086400],
        o: [100, 101],
        h: [105, 106],
        l: [99, 100],
        c: [103, 104],
        v: [1000, 2000],
      },
    });
    const svc = new FinnhubService('test-fh-key');
    const result = await svc.getPriceHistory('MSFT', '1m');
    expect(result.symbol).toBe('MSFT');
    expect(result.prices).toHaveLength(2);
    expect(result.prices[0]).toHaveProperty('close', 103);
    expect(result.__source).toBe('Finnhub');
  });

  it('throws when candles status is not ok', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { s: 'no_data' } });
    const svc = new FinnhubService('test-fh-key');
    await expect(svc.getPriceHistory('EMPTY', '1y')).rejects.toThrow('Unable to fetch price history');
  });

  it('returns earnings history with beat/miss fields', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { period: '2024-09-30', actual: 1.64, estimate: 1.60, surprise: 0.04, surprisePercent: 2.5 },
        { period: '2024-06-30', actual: 1.53, estimate: 1.55, surprise: -0.02, surprisePercent: -1.3 },
      ],
    });
    const svc = new FinnhubService('test-fh-key');
    const result = await svc.getEarningsHistory('AAPL');
    expect(result.quarterlyEarnings).toHaveLength(2);
    expect(result.quarterlyEarnings[0].reportedEPS).toBe(1.64);
    expect(result.quarterlyEarnings[0].surprise).toBe(0.04);
  });

  it('returns analyst recommendations', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { period: '2024-11-01', strongBuy: 15, buy: 20, hold: 8, sell: 2, strongSell: 0 },
      ],
    });
    const svc = new FinnhubService('test-fh-key');
    const recs = await svc.getAnalystRecommendations('NVDA');
    expect(recs.recommendations[0].strongBuy).toBe(15);
    expect(recs.__source).toBe('Finnhub');
  });

  it('returns price targets with high/low/mean', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { targetHigh: 250, targetLow: 180, targetMean: 215, targetMedian: 210, lastUpdated: '2024-11-01' },
    });
    const svc = new FinnhubService('test-fh-key');
    const result = await svc.getPriceTargets('GOOGL');
    expect(result.targetMean).toBe(215);
    expect(result.targetHigh).toBe(250);
    expect(result.__source).toBe('Finnhub');
  });

  it('throws unavailable for sector performance', async () => {
    const svc = new FinnhubService('test-fh-key');
    await expect(svc.getSectorPerformance()).rejects.toThrow('not available via Finnhub');
  });

  it('throws unavailable for top gainers/losers', async () => {
    const svc = new FinnhubService('test-fh-key');
    await expect(svc.getTopGainersLosers()).rejects.toThrow('not available via Finnhub');
  });

  it('returns company news articles', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { headline: 'Apple Q4 beats', summary: 'Revenue up 6%', source: 'Reuters', url: 'https://example.com', datetime: 1700000000 },
      ],
    });
    const svc = new FinnhubService('test-fh-key');
    const result = await svc.getCompanyNews('AAPL', 7);
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].headline).toBe('Apple Q4 beats');
    expect(result.__source).toBe('Finnhub');
  });

  it('deduplicates requests via cache (1 HTTP call for same symbol)', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { c: 300, d: 1, dp: 0.33, h: 305, l: 298, o: 299, pc: 299, v: 10000000, t: 1700000000 },
    });
    const svc = new FinnhubService('test-fh-key');
    await svc.getStockPrice('TSLA');
    await svc.getStockPrice('TSLA');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('returns insider trading transactions', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          { transactionDate: '2024-11-10', name: 'Tim Cook', title: 'CEO', change: -10000, transactionPrice: 225 },
        ],
      },
    });
    const svc = new FinnhubService('test-fh-key');
    const result = await svc.getInsiderTrading('AAPL');
    expect(result.recentTransactions[0].transactionType).toBe('Sale');
    expect(result.recentTransactions[0].insider).toBe('Tim Cook');
  });
});

// ─── createStockService factory ───────────────────────────────────────────────

describe('createStockService factory', () => {
  beforeEach(() => {
    delete process.env.STOCK_DATA_PROVIDER;
  });

  it('returns AlphaVantageService by default', () => {
    process.env.STOCK_DATA_PROVIDER = 'alphavantage';
    const svc = createStockService('av-key');
    expect(svc).toBeInstanceOf(AlphaVantageService);
  });

  it('returns FinnhubService when provider=finnhub', () => {
    process.env.STOCK_DATA_PROVIDER = 'finnhub';
    const svc = createStockService(undefined, 'fh-key');
    expect(svc).toBeInstanceOf(FinnhubService);
  });

  it('falls back to AlphaVantageService for unknown provider', () => {
    process.env.STOCK_DATA_PROVIDER = 'unknown_provider';
    const svc = createStockService('av-key');
    expect(svc).toBeInstanceOf(AlphaVantageService);
  });
});

