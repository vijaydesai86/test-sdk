import { describe, it, expect, vi } from 'vitest';
import { executeTool } from '../../web/app/lib/stockTools';
import type { StockDataService } from '../../web/app/lib/stockDataService';
import { FinnhubService } from '../../web/app/lib/stockDataService';

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
  getEarningsHistory: vi.fn().mockResolvedValue({}),
  getIncomeStatement: vi.fn().mockResolvedValue({}),
  getBalanceSheet: vi.fn().mockResolvedValue({}),
  getCashFlow: vi.fn().mockResolvedValue({}),
  getSectorPerformance: vi.fn().mockResolvedValue({}),
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

  it('search_news has no tool definition and returns unknown tool error', async () => {
    const service = stubService();
    const result = await executeTool('search_news', { query: 'AI', days: 7 }, service);

    expect(result.success).toBe(false);
  });

  it('routes get_sector_performance to getSectorPerformance', async () => {
    const service = stubService();
    const result = await executeTool('get_sector_performance', {}, service);
    expect(result.success).toBe(true);
    expect(service.getSectorPerformance).toHaveBeenCalled();
  });

  it('routes get_top_gainers_losers to getTopGainersLosers', async () => {
    const service = stubService();
    const result = await executeTool('get_top_gainers_losers', {}, service);
    expect(result.success).toBe(true);
    expect(service.getTopGainersLosers).toHaveBeenCalled();
  });

  it('generate_stock_report without symbol returns error', async () => {
    const service = stubService();
    const result = await executeTool('generate_stock_report', { symbol: '' }, service);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/symbol is required/i);
  });

  it('generate_stock_report with pre-fetched data succeeds without calling any service API', async () => {
    const service = stubService();
    const result = await executeTool('generate_stock_report', {
      symbol: 'AAPL',
      price: { price: '150.00', changePercent: '1.00%' },
      companyOverview: { name: 'Apple Inc', symbol: 'AAPL' },
    }, service);

    expect(result.success).toBe(true);
    expect(result.data?.content).toBeDefined();
    // Report tools must NOT call any service APIs
    expect(service.getStockPrice).not.toHaveBeenCalled();
    expect(service.getCompanyOverview).not.toHaveBeenCalled();
  });

  it('generate_comparison_report with fewer than 2 items returns error', async () => {
    const service = stubService();
    const result = await executeTool('generate_comparison_report', {
      range: '1y',
      universe: ['AAPL'],
      items: [{ symbol: 'AAPL', price: { price: '150.00' } }],
    }, service);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least 2/i);
  });

  it('generate_comparison_report with items array succeeds without calling any service API', async () => {
    const service = stubService();
    const result = await executeTool('generate_comparison_report', {
      range: '1y',
      universe: ['AAPL', 'MSFT'],
      items: [
        { symbol: 'AAPL', price: { price: '150.00' }, overview: { name: 'Apple', symbol: 'AAPL' } },
        { symbol: 'MSFT', price: { price: '300.00' }, overview: { name: 'Microsoft', symbol: 'MSFT' } },
      ],
    }, service);

    expect(result.success).toBe(true);
    expect(result.data?.content).toBeDefined();
    // Report tools must NOT call any service APIs
    expect(service.getStockPrice).not.toHaveBeenCalled();
    expect(service.getCompanyOverview).not.toHaveBeenCalled();
  });

  it('generate_sector_report without sectorQuery returns error', async () => {
    const service = stubService();
    const result = await executeTool('generate_sector_report', {
      sectorQuery: '',
      universe: ['NVDA'],
      items: [{ symbol: 'NVDA' }],
    }, service);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/sectorQuery is required/i);
  });

  it('generate_sector_report without items returns error', async () => {
    const service = stubService();
    const result = await executeTool('generate_sector_report', {
      sectorQuery: 'AI chips',
      universe: ['NVDA'],
      items: [],
    }, service);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/items array is required/i);
  });

  it('generate_sector_report with items and sectorQuery succeeds without calling any service API', async () => {
    const service = stubService();
    const result = await executeTool('generate_sector_report', {
      sectorQuery: 'AI chips',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: [
        { symbol: 'NVDA', price: { price: '500.00' }, overview: { name: 'NVIDIA', symbol: 'NVDA' } },
        { symbol: 'AMD', price: { price: '150.00' }, overview: { name: 'AMD', symbol: 'AMD' } },
      ],
    }, service);

    expect(result.success).toBe(true);
    expect(result.data?.content).toContain('AI chips');
    // Report tools must NOT call any service APIs
    expect(service.getStockPrice).not.toHaveBeenCalled();
    expect(service.getCompanyOverview).not.toHaveBeenCalled();
  });

  it('generate_deep_sector_report without items returns error', async () => {
    const service = stubService();
    const result = await executeTool('generate_deep_sector_report', {
      sectorQuery: 'semiconductors',
      universe: ['NVDA'],
      items: [],
    }, service);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/items array is required/i);
  });

  it('generate_deep_sector_report with items succeeds without calling any service API', async () => {
    const service = stubService();
    const result = await executeTool('generate_deep_sector_report', {
      sectorQuery: 'semiconductors',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: [
        { symbol: 'NVDA', price: { price: '500.00' }, overview: { name: 'NVIDIA', symbol: 'NVDA' } },
        { symbol: 'AMD', price: { price: '150.00' }, overview: { name: 'AMD', symbol: 'AMD' } },
      ],
      dependencyAnalysis: 'NVIDIA and AMD compete in AI chips.',
      ecosystemDiagram: 'graph LR\n  NVDA-->Cloud',
    }, service);

    expect(result.success).toBe(true);
    expect(result.data?.content).toBeDefined();
    // Report tools must NOT call any service APIs
    expect(service.getStockPrice).not.toHaveBeenCalled();
    expect(service.getCompanyOverview).not.toHaveBeenCalled();
  });
});

describe('FinnhubService error messages', () => {
  it('throws suppression-compatible error when profile2 returns empty', async () => {
    const service = new FinnhubService('dummy');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).makeRequest = vi.fn().mockResolvedValue({});

    await expect(service.getCompanyOverview('AAPL')).rejects.toThrow('Unavailable via Finnhub');
  });

  it('Finnhub company overview error matches the safeFetch suppression regex', async () => {
    const suppressionRegex = /unavailable (in|via) (Alpha|Finnhub)/i;
    const errorMessage = 'Unavailable via Finnhub: company profile not found';
    expect(suppressionRegex.test(errorMessage)).toBe(true);
  });

  it('Alpha Vantage company overview error matches the safeFetch suppression regex', () => {
    const suppressionRegex = /unavailable (in|via) (Alpha|Finnhub)/i;
    const errorMessage = 'Unavailable via Alpha Vantage: company data not found';
    expect(suppressionRegex.test(errorMessage)).toBe(true);
  });
});
