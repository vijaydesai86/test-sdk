import { describe, it, expect, vi } from 'vitest';
import { executeTool } from '../../web/app/lib/stockTools';
import type { StockDataService } from '../../web/app/lib/stockDataService';

const stubService = (): StockDataService => ({
  getStockPrice: vi.fn().mockResolvedValue({ price: '100.00', changePercent: '1.00%' }),
  getPriceHistory: vi.fn().mockResolvedValue({ prices: [] }),
  getCompanyOverview: vi.fn().mockResolvedValue({ name: 'Apple' }),
  getBasicFinancials: vi.fn().mockResolvedValue({ metric: {} }),
  getInsiderTrading: vi.fn().mockResolvedValue({}),
  getAnalystRatings: vi.fn().mockResolvedValue({}),
  getAnalystRecommendations: vi.fn().mockResolvedValue({}),
  getPriceTargets: vi.fn().mockResolvedValue({}),
  getPeers: vi.fn().mockResolvedValue({}),
  searchStock: vi.fn().mockResolvedValue({ results: [] }),
  searchCompanies: vi.fn().mockResolvedValue({ results: [] }),
  getEarningsHistory: vi.fn().mockResolvedValue({}),
  getIncomeStatement: vi.fn().mockResolvedValue({}),
  getBalanceSheet: vi.fn().mockResolvedValue({}),
  getCashFlow: vi.fn().mockResolvedValue({}),
  getSectorPerformance: vi.fn().mockResolvedValue({}),
  getStocksBySector: vi.fn().mockResolvedValue({}),
  screenStocks: vi.fn().mockResolvedValue({}),
  getTopGainersLosers: vi.fn().mockResolvedValue({}),
  getNewsSentiment: vi.fn().mockResolvedValue({}),
  getCompanyNews: vi.fn().mockResolvedValue({}),
  searchNews: vi.fn().mockResolvedValue({}),
});

describe('web executeTool', () => {
  it('routes to basic financials', async () => {
    const service = stubService();
    const result = await executeTool('get_basic_financials', { symbol: 'AAPL' }, service);

    expect(result.success).toBe(true);
    expect(service.getBasicFinancials).toHaveBeenCalledWith('AAPL');
  });

  it('routes to news search', async () => {
    const service = stubService();
    const result = await executeTool('search_news', { query: 'AI', days: 7 }, service);

    expect(result.success).toBe(true);
    expect(service.searchNews).toHaveBeenCalledWith('AI', 7);
  });
});
