import { describe, it, expect, vi } from 'vitest';
import { executeTool } from '../../web/app/lib/stockTools';
import type { StockDataService } from '../../web/app/lib/stockDataService';
import { FinnhubService, SecEdgarService, FredService, CoinGeckoService } from '../../web/app/lib/stockDataService';

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
  getDividendHistory: vi.fn().mockResolvedValue({ dividends: [] }),
  getStockSplits: vi.fn().mockResolvedValue({ splits: [] }),
  getEarningsCalendar: vi.fn().mockResolvedValue({ earnings: [] }),
  getIpoCalendar: vi.fn().mockResolvedValue({ ipos: [] }),
  getEconomicIndicators: vi.fn().mockResolvedValue({ realGdp: null }),
  getTechnicalIndicators: vi.fn().mockResolvedValue({ rsi14: 55, macd: null, sma20: 150, sma50: 145 }),
  getCommodityPrices: vi.fn().mockResolvedValue({ wti: { value: '75.00', date: '2024-01-01' } }),
  getForexRate: vi.fn().mockResolvedValue({ fromCurrency: 'USD', toCurrency: 'EUR', exchangeRate: '0.9200' }),
  getMarketStatus: vi.fn().mockResolvedValue({ isOpen: true, session: 'regular' }),
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

  it('generate_sector_report returns error when sector is empty', async () => {
    const service = stubService();
    const result = await executeTool('generate_sector_report', { sector: '' }, service);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/sector or theme query is required/i);
  });

  it('generate_sector_report returns error when LLM is unavailable and cannot identify companies', async () => {
    const service = stubService();
    // No llmFill provided → universe stays empty
    const result = await executeTool('generate_sector_report', { sector: 'AI data center' }, service);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Could not identify companies/i);
  });

  it('generate_stock_report produces chart sections when data is available', async () => {
    const service = stubService();
    // Provide rich data so chart sections appear in the output
    (service.getPriceHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      prices: [
        { date: '2024-01-01', close: '170' },
        { date: '2024-04-01', close: '175' },
        { date: '2024-07-01', close: '180' },
      ],
    });
    (service.getEarningsHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      quarterlyEarnings: [
        { fiscalQuarter: '2024-09-30', reportedEPS: '1.6' },
        { fiscalQuarter: '2024-06-30', reportedEPS: '1.5' },
        { fiscalQuarter: '2024-03-31', reportedEPS: '1.4' },
      ],
    });
    (service.getIncomeStatement as ReturnType<typeof vi.fn>).mockResolvedValue({
      quarterlyReports: [
        { fiscalDateEnding: '2024-09-30', totalRevenue: '90000000000', grossProfit: '40000000000', operatingIncome: '27000000000', netIncome: '22000000000' },
        { fiscalDateEnding: '2024-06-30', totalRevenue: '88000000000', grossProfit: '39000000000', operatingIncome: '26000000000', netIncome: '21000000000' },
      ],
    });

    // LLM resolves ticker (first call) and moat analysis (second call, returns non-JSON to gracefully skip)
    const llmFill = vi.fn()
      .mockResolvedValueOnce('{"AAPL":"AAPL"}')   // ticker resolution
      .mockResolvedValueOnce('{}');                 // moat analysis (no valid moat → skipped)

    const result = await executeTool(
      'generate_stock_report',
      { symbol: 'AAPL', range: '1y' },
      service,
      { llmFill }
    );

    expect(result.success).toBe(true);
    const content = result.data?.content as string;

    // Charts must be present when data is available
    expect(content).toContain('## 📈 Price & EPS Trends');
    expect(content).toContain('## 📊 Revenue & Margin Trends');
    expect(content).toContain('## 💰 Financials');
    expect(content).toContain('```chart');

    // Moat section absent when LLM returns invalid moat JSON
    expect(content).not.toContain('## 🏰 Competitive Moat');
  });

  it('generate_stock_report shows moat section when LLM provides valid analysis', async () => {
    const service = stubService();
    (service.getPriceHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      prices: [{ date: '2024-01-01', close: '170' }, { date: '2024-07-01', close: '180' }],
    });

    const moatJson = JSON.stringify({
      moatType: 'Intangible Assets',
      moatStrength: 'Wide',
      moatScore: 82,
      barriers: ['Brand loyalty', 'Ecosystem lock-in'],
      narrative: 'Apple has a strong moat through its ecosystem.',
      bestFor: 'Long-term investors seeking stable returns.',
    });

    const llmFill = vi.fn()
      .mockResolvedValueOnce('{"AAPL":"AAPL"}')  // ticker resolution
      .mockResolvedValueOnce(moatJson);            // moat analysis

    const result = await executeTool(
      'generate_stock_report',
      { symbol: 'AAPL', range: '1y' },
      service,
      { llmFill }
    );

    expect(result.success).toBe(true);
    const content = result.data?.content as string;
    expect(content).toContain('## 🏰 Competitive Moat');
    expect(content).toContain('Intangible Assets');
    expect(content).toContain('Wide');
    expect(content).toContain('82');
    expect(content).toContain('Best For');

    // Chart sections must still be present alongside moat section
    expect(content).toContain('## 📈 Price & EPS Trends');
    expect(content).toContain('## 💰 Financials');
  });

  it('generate_sector_report uses llmFill to identify companies and fetches data', async () => {
    const service = stubService();
    // LLM returns two tickers
    const llmFill = vi.fn().mockResolvedValue('["NVDA","AMD"]');
    const result = await executeTool(
      'generate_sector_report',
      { sector: 'AI chips', count: 2 },
      service,
      { llmFill }
    );

    expect(result.success).toBe(true);
    // llmFill is called: once for sector company identification, once for batch moat, once for conclusion
    expect(llmFill).toHaveBeenCalledTimes(3);
    // Should have fetched data for both tickers
    expect(service.getStockPrice).toHaveBeenCalledWith('NVDA');
    expect(service.getStockPrice).toHaveBeenCalledWith('AMD');
    expect(result.data?.content).toContain('AI chips');
  });
});

describe('FinnhubService error messages', () => {
  it('throws suppression-compatible error when profile2 returns empty', async () => {
    // FinnhubService with empty key will fail at request level; we mock the internals
    const service = new FinnhubService('dummy');
    // Patch makeRequest to return empty profile
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).makeRequest = vi.fn().mockResolvedValue({});

    await expect(service.getCompanyOverview('AAPL')).rejects.toThrow('Unavailable via Finnhub');
  });

  it('Finnhub company overview error matches the safeFetch suppression regex', async () => {
    const suppressionRegex = /unavailable (in|via) (Alpha|Finnhub)/i;
    // The error message thrown when profile2 returns empty must match so it doesn't appear in Data Gaps
    const errorMessage = 'Unavailable via Finnhub: company profile not found';
    expect(suppressionRegex.test(errorMessage)).toBe(true);
  });

  it('Alpha Vantage company overview error matches the safeFetch suppression regex', () => {
    const suppressionRegex = /unavailable (in|via) (Alpha|Finnhub)/i;
    const errorMessage = 'Unavailable via Alpha Vantage: company data not found';
    expect(suppressionRegex.test(errorMessage)).toBe(true);
  });
});

describe('new data tools (wave 1 — AV + Finnhub)', () => {
  it('routes get_dividend_history to getDividendHistory', async () => {
    const service = stubService();
    const result = await executeTool('get_dividend_history', { symbol: 'AAPL', years: 5 }, service);
    expect(result.success).toBe(true);
    expect(service.getDividendHistory).toHaveBeenCalledWith('AAPL', 5);
  });

  it('routes get_stock_splits to getStockSplits', async () => {
    const service = stubService();
    const result = await executeTool('get_stock_splits', { symbol: 'TSLA' }, service);
    expect(result.success).toBe(true);
    expect(service.getStockSplits).toHaveBeenCalledWith('TSLA', undefined);
  });

  it('routes get_earnings_calendar to getEarningsCalendar', async () => {
    const service = stubService();
    const result = await executeTool('get_earnings_calendar', { weeks: 2 }, service);
    expect(result.success).toBe(true);
    expect(service.getEarningsCalendar).toHaveBeenCalledWith(undefined, 2);
  });

  it('routes get_ipo_calendar to getIpoCalendar', async () => {
    const service = stubService();
    const result = await executeTool('get_ipo_calendar', {}, service);
    expect(result.success).toBe(true);
    expect(service.getIpoCalendar).toHaveBeenCalledWith(undefined);
  });

  it('routes get_economic_indicators to getEconomicIndicators', async () => {
    const service = stubService();
    const result = await executeTool('get_economic_indicators', {}, service);
    expect(result.success).toBe(true);
    expect(service.getEconomicIndicators).toHaveBeenCalled();
  });

  it('routes get_technical_indicators to getTechnicalIndicators', async () => {
    const service = stubService();
    const result = await executeTool('get_technical_indicators', { symbol: 'NVDA' }, service);
    expect(result.success).toBe(true);
    expect(service.getTechnicalIndicators).toHaveBeenCalledWith('NVDA');
  });

  it('routes get_commodity_prices to getCommodityPrices', async () => {
    const service = stubService();
    const result = await executeTool('get_commodity_prices', { commodities: ['wti', 'brent'] }, service);
    expect(result.success).toBe(true);
    expect(service.getCommodityPrices).toHaveBeenCalledWith(['wti', 'brent']);
  });

  it('routes get_forex_rate to getForexRate', async () => {
    const service = stubService();
    const result = await executeTool('get_forex_rate', { fromCurrency: 'USD', toCurrency: 'EUR' }, service);
    expect(result.success).toBe(true);
    expect(service.getForexRate).toHaveBeenCalledWith('USD', 'EUR');
  });

  it('routes get_market_status to getMarketStatus', async () => {
    const service = stubService();
    const result = await executeTool('get_market_status', {}, service);
    expect(result.success).toBe(true);
    expect(service.getMarketStatus).toHaveBeenCalled();
    expect(result.message).toMatch(/OPEN|CLOSED/);
  });
});

describe('new data tools (wave 2 — SEC EDGAR, FRED, CoinGecko)', () => {
  it('get_recent_filings calls SecEdgarService.getRecentFilings', async () => {
    const service = stubService();
    // Mock SecEdgarService to avoid real network calls in tests
    const mockFilings = { symbol: 'AAPL', cik: '0000320193', companyName: 'Apple Inc.', filings: [] };
    vi.spyOn(SecEdgarService.prototype, 'getRecentFilings').mockResolvedValueOnce(mockFilings);

    const result = await executeTool('get_recent_filings', { symbol: 'AAPL', formTypes: ['8-K'], count: 5 }, service);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockFilings);
  });

  it('get_recent_filings returns error message on failure', async () => {
    const service = stubService();
    vi.spyOn(SecEdgarService.prototype, 'getRecentFilings').mockRejectedValueOnce(
      new Error('SEC EDGAR: no company found for ticker "FAKE"')
    );

    const result = await executeTool('get_recent_filings', { symbol: 'FAKE' }, service);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SEC EDGAR/i);
  });

  it('get_market_indicators calls FredService.getMarketIndicators', async () => {
    const service = stubService();
    const mockIndicators = { vix: { value: '18.5', date: '2024-01-15' } };
    vi.spyOn(FredService.prototype, 'getMarketIndicators').mockResolvedValueOnce(mockIndicators);

    const result = await executeTool('get_market_indicators', {}, service);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockIndicators);
  });

  it('get_market_indicators returns error when FRED key is not configured', async () => {
    const service = stubService();
    vi.spyOn(FredService.prototype, 'getMarketIndicators').mockRejectedValueOnce(
      new Error('FRED API key not configured. Set FRED_API_KEY.')
    );

    const result = await executeTool('get_market_indicators', {}, service);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/FRED/i);
  });

  it('get_crypto_price calls CoinGeckoService.getCryptoPrice', async () => {
    const service = stubService();
    const mockCrypto = { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', currentPrice: 45000 };
    vi.spyOn(CoinGeckoService.prototype, 'getCryptoPrice').mockResolvedValueOnce(mockCrypto);

    const result = await executeTool('get_crypto_price', { coinId: 'BTC' }, service);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockCrypto);
  });

  it('get_top_cryptos calls CoinGeckoService.getTopCryptos', async () => {
    const service = stubService();
    const mockTop = [{ rank: 1, symbol: 'BTC', name: 'Bitcoin', currentPrice: 45000 }];
    vi.spyOn(CoinGeckoService.prototype, 'getTopCryptos').mockResolvedValueOnce(mockTop);

    const result = await executeTool('get_top_cryptos', { limit: 5 }, service);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockTop);
    expect(result.message).toContain('1');
  });
});
