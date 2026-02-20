import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { AlphaVantageService } from '../stockDataService';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

describe('AlphaVantageService', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    process.env.ALPHA_VANTAGE_API_KEY = 'test';
    process.env.FMP_API_KEY = 'test';
    process.env.FINNHUB_API_KEY = 'test';
    process.env.NEWSAPI_KEY = 'test';
    process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS = '0';
    process.env.FMP_MIN_INTERVAL_MS = '0';
    process.env.FINNHUB_MIN_INTERVAL_MS = '0';
    process.env.NEWSAPI_MIN_INTERVAL_MS = '0';
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

  it('uses FMP for stock screening', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [{ symbol: 'AAPL' }] });
    const service = new AlphaVantageService('test');

    const results = await service.screenStocks({ sector: 'Technology', limit: 1 });

    expect(results.results).toEqual([{ symbol: 'AAPL' }]);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('financialmodelingprep.com/api/v3/stock-screener'),
      expect.any(Object)
    );
  });

  it('uses Finnhub for company news', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: [{ headline: 'News' }] });
    const service = new AlphaVantageService('test');

    const results = await service.getCompanyNews('AAPL', 5);

    expect(results.articles).toEqual([{ headline: 'News' }]);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('finnhub.io/api/v1/company-news'),
      expect.any(Object)
    );
  });
});
