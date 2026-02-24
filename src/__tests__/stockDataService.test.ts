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
    process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS = '0';
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
});
