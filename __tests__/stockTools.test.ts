import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';
import { executeTool } from '../web/app/lib/stockTools';
import type { StockDataService } from '../web/app/lib/stockDataService';

// ─── Shared stub factory ──────────────────────────────────────────────────────

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

// ─── Tool routing ─────────────────────────────────────────────────────────────

describe('executeTool routing', () => {
  it('routes get_basic_financials to getBasicFinancials', async () => {
    const service = stubService();
    const result = await executeTool('get_basic_financials', { symbol: 'AAPL' }, service);
    expect(result.success).toBe(true);
    expect(service.getBasicFinancials).toHaveBeenCalledWith('AAPL');
  });

  it('routes get_stock_price to getStockPrice', async () => {
    const service = stubService();
    const result = await executeTool('get_stock_price', { symbol: 'MSFT' }, service);
    expect(result.success).toBe(true);
    expect(service.getStockPrice).toHaveBeenCalledWith('MSFT');
  });

  it('routes get_price_history to getPriceHistory', async () => {
    const service = stubService();
    const result = await executeTool('get_price_history', { symbol: 'NVDA', range: '1y' }, service);
    expect(result.success).toBe(true);
    expect(service.getPriceHistory).toHaveBeenCalledWith('NVDA', '1y');
  });

  it('routes get_company_overview to getCompanyOverview', async () => {
    const service = stubService();
    const result = await executeTool('get_company_overview', { symbol: 'TSLA' }, service);
    expect(result.success).toBe(true);
    expect(service.getCompanyOverview).toHaveBeenCalledWith('TSLA');
  });

  it('routes get_analyst_ratings to getAnalystRatings', async () => {
    const service = stubService();
    const result = await executeTool('get_analyst_ratings', { symbol: 'AMZN' }, service);
    expect(result.success).toBe(true);
    expect(service.getAnalystRatings).toHaveBeenCalledWith('AMZN');
  });

  it('routes get_price_targets to getPriceTargets', async () => {
    const service = stubService();
    const result = await executeTool('get_price_targets', { symbol: 'GOOG' }, service);
    expect(result.success).toBe(true);
    expect(service.getPriceTargets).toHaveBeenCalledWith('GOOG');
  });

  it('routes get_earnings_history to getEarningsHistory', async () => {
    const service = stubService();
    const result = await executeTool('get_earnings_history', { symbol: 'AAPL' }, service);
    expect(result.success).toBe(true);
    expect(service.getEarningsHistory).toHaveBeenCalledWith('AAPL');
  });

  it('routes get_income_statement to getIncomeStatement', async () => {
    const service = stubService();
    const result = await executeTool('get_income_statement', { symbol: 'AAPL' }, service);
    expect(result.success).toBe(true);
    expect(service.getIncomeStatement).toHaveBeenCalledWith('AAPL');
  });

  it('routes get_balance_sheet to getBalanceSheet', async () => {
    const service = stubService();
    const result = await executeTool('get_balance_sheet', { symbol: 'AAPL' }, service);
    expect(result.success).toBe(true);
    expect(service.getBalanceSheet).toHaveBeenCalledWith('AAPL');
  });

  it('routes search_news to searchNews', async () => {
    const service = stubService();
    const result = await executeTool('search_news', { query: 'semiconductors', days: 14 }, service);
    expect(result.success).toBe(true);
    expect(service.searchNews).toHaveBeenCalledWith('semiconductors', 14);
  });

  it('routes get_cash_flow to getCashFlow', async () => {
    const service = stubService();
    const result = await executeTool('get_cash_flow', { symbol: 'AAPL' }, service);
    expect(result.success).toBe(true);
    expect(service.getCashFlow).toHaveBeenCalledWith('AAPL');
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

  it('routes get_news_sentiment to getNewsSentiment', async () => {
    const service = stubService();
    const result = await executeTool('get_news_sentiment', { symbol: 'NVDA' }, service);
    expect(result.success).toBe(true);
  });

  it('unknown tool returns success: false with descriptive error', async () => {
    const service = stubService();
    const result = await executeTool('unknown_tool_xyz', { query: 'AI', days: 7 }, service);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('unrecognized tool name returns success: false', async () => {
    const service = stubService();
    const result = await executeTool('completely_nonexistent_tool', {}, service);
    expect(result.success).toBe(false);
  });
});

// ─── generate_stock_report ────────────────────────────────────────────────────

describe('generate_stock_report via executeTool', () => {
  let service: StockDataService;
  beforeEach(() => { service = stubService(); });

  it('produces a report with price/EPS chart sections when data is available', async () => {
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
        {
          fiscalDateEnding: '2024-09-30',
          totalRevenue: '90000000000',
          grossProfit: '40000000000',
          operatingIncome: '27000000000',
          netIncome: '22000000000',
        },
      ],
    });

    const llmFill = vi.fn()
      .mockResolvedValueOnce('{"AAPL":"AAPL"}')
      .mockResolvedValueOnce('{}');

    const result = await executeTool('generate_stock_report', { symbol: 'AAPL', range: '1y' }, service, { llmFill });

    expect(result.success).toBe(true);
    const content = result.data?.content as string;
    expect(content).toContain('## 📈 Price & EPS Trends');
    expect(content).toContain('## 📊 Revenue & Margin Trends');
    expect(content).toContain('## 🧾 Financial Deep Dive');
    expect(content).toContain('```chart');
  });

  it('includes investment conclusion in generated stock report', async () => {
    const llmFill = vi.fn()
      .mockResolvedValueOnce('{"AAPL":"AAPL"}')
      .mockResolvedValueOnce('{}');

    const result = await executeTool('generate_stock_report', { symbol: 'AAPL', range: '1y' }, service, { llmFill });

    expect(result.success).toBe(true);
    const content = result.data?.content as string;
    expect(content).toContain('## 🎯 Investment Conclusion');
  });

  it('includes decision and freshness sections in generated stock report', async () => {
    const llmFill = vi.fn()
      .mockResolvedValueOnce('{"AAPL":"AAPL"}')
      .mockResolvedValueOnce('{}');

    const result = await executeTool('generate_stock_report', { symbol: 'AAPL', range: '1y' }, service, { llmFill });

    expect(result.success).toBe(true);
    const content = result.data?.content as string;
    expect(content).toContain('## Decision Snapshot');
    expect(content).toContain('## Data Freshness');
  });

  it('moat section absent when LLM returns invalid moat JSON', async () => {
    const llmFill = vi.fn()
      .mockResolvedValueOnce('{"AAPL":"AAPL"}')
      .mockResolvedValueOnce('{}');

    const result = await executeTool('generate_stock_report', { symbol: 'AAPL', range: '1y' }, service, { llmFill });

    expect(result.success).toBe(true);
    expect(result.data?.content).not.toContain('## 🏰 Competitive Moat');
  });

  it('moat section present when LLM provides valid moat analysis', async () => {
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
      .mockResolvedValueOnce('{"AAPL":"AAPL"}')
      .mockResolvedValueOnce(moatJson);

    const result = await executeTool('generate_stock_report', { symbol: 'AAPL', range: '1y' }, service, { llmFill });

    expect(result.success).toBe(true);
    const content = result.data?.content as string;
    expect(content).toContain('## 🏰 Competitive Moat');
    expect(content).toContain('Intangible Assets');
    expect(content).toContain('Wide');
    expect(content).toContain('82');
  });

  it('conclusion present alongside moat section', async () => {
    (service.getPriceHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      prices: [{ date: '2024-01-01', close: '170' }, { date: '2024-07-01', close: '180' }],
    });
    const moatJson = JSON.stringify({
      moatType: 'Network Effects',
      moatStrength: 'Wide',
      moatScore: 75,
      barriers: ['Network effects'],
      narrative: 'Strong network effects.',
      bestFor: 'Growth investors.',
    });
    const llmFill = vi.fn()
      .mockResolvedValueOnce('{"AAPL":"AAPL"}')
      .mockResolvedValueOnce(moatJson);

    const result = await executeTool('generate_stock_report', { symbol: 'AAPL', range: '1y' }, service, { llmFill });
    expect(result.success).toBe(true);
    const content = result.data?.content as string;
    expect(content).toContain('## 🏰 Competitive Moat');
    expect(content).toContain('## 🎯 Investment Conclusion');
  });
});

// ─── generate_sector_report ───────────────────────────────────────────────────

describe('generate_sector_report via executeTool', () => {
  let service: StockDataService;
  beforeEach(() => { service = stubService(); });

  it('returns error when sector is empty', async () => {
    const result = await executeTool('generate_sector_report', { sector: '' }, service);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/sector or theme query is required/i);
  });

  it('returns error when LLM is unavailable and cannot identify companies', async () => {
    const result = await executeTool('generate_sector_report', { sector: 'AI data center' }, service);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Could not identify companies/i);
  });

  it('fetches data for companies identified by LLM', async () => {
    const llmFill = vi.fn().mockResolvedValue('["NVDA","AMD"]');
    const result = await executeTool('generate_sector_report', { sector: 'AI chips', count: 2 }, service, { llmFill });

    expect(result.success).toBe(true);
    expect(service.getStockPrice).toHaveBeenCalledWith('NVDA');
    expect(service.getStockPrice).toHaveBeenCalledWith('AMD');
  });

  it('report content includes sector query', async () => {
    const llmFill = vi.fn().mockResolvedValue('["NVDA","AMD"]');
    const result = await executeTool('generate_sector_report', { sector: 'AI chips', count: 2 }, service, { llmFill });

    expect(result.success).toBe(true);
    expect(result.data?.content).toContain('AI chips');
  });

  it('report includes investment conclusion section', async () => {
    const llmFill = vi.fn().mockResolvedValue('["NVDA","AMD"]');
    const result = await executeTool('generate_sector_report', { sector: 'Semiconductors', count: 2 }, service, { llmFill });

    expect(result.success).toBe(true);
    expect(result.data?.content).toContain('## 🎯 Investment Conclusion');
  });

  it('sector report conclusion contains sector-specific outlook (not generic "Peer Group Outlook")', async () => {
    const llmFill = vi.fn().mockResolvedValue('["NVDA","AMD"]');
    const result = await executeTool('generate_sector_report', { sector: 'Cloud', count: 2 }, service, { llmFill });

    expect(result.success).toBe(true);
    // Sector conclusion label is "<sectorName> Outlook:" e.g. "Cloud Outlook:"
    expect(result.data?.content).toContain('Outlook:');
    expect(result.data?.content).not.toContain('Peer Group Outlook');
  });

  it('llmFill called four times: tickers, batch moat analysis, position rationale, and conclusion', async () => {
    const llmFill = vi.fn().mockResolvedValue('["NVDA","AMD"]');
    await executeTool('generate_sector_report', { sector: 'AI chips', count: 2 }, service, { llmFill });
    // Calls: (1) sector company tickers, (2) batch moat analysis, (3) position rationale, (4) investment conclusion
    expect(llmFill).toHaveBeenCalledTimes(4);
  });

  it('conclusion appears exactly once in sector report', async () => {
    const llmFill = vi.fn().mockResolvedValue('["NVDA","AMD"]');
    const result = await executeTool('generate_sector_report', { sector: 'EV', count: 2 }, service, { llmFill });

    expect(result.success).toBe(true);
    const content = result.data?.content as string;
    const count = (content.match(/## 🎯 Investment Conclusion/g) || []).length;
    expect(count).toBe(1);
  });
});

// ─── generate_comparison_report ──────────────────────────────────────────────

describe('generate_comparison_report via executeTool', () => {
  let service: StockDataService;
  beforeEach(() => { service = stubService(); });

  it('returns error when symbols list is empty', async () => {
    const result = await executeTool('generate_comparison_report', { symbols: [] }, service);
    expect(result.success).toBe(false);
  });

  it('fetches data for each provided company', async () => {
    const llmFill = vi.fn().mockResolvedValue('{"AAPL":"AAPL","MSFT":"MSFT"}');
    const result = await executeTool(
      'generate_comparison_report',
      { companies: ['AAPL', 'MSFT'], range: '1y' },
      service,
      { llmFill }
    );
    expect(result.success).toBe(true);
    expect(service.getStockPrice).toHaveBeenCalledWith('AAPL');
    expect(service.getStockPrice).toHaveBeenCalledWith('MSFT');
  });

  it('comparison report fetches the same financial and news context used by single-stock reports', async () => {
    const llmFill = vi.fn().mockResolvedValue('{"AAPL":"AAPL","MSFT":"MSFT"}');
    const result = await executeTool(
      'generate_comparison_report',
      { companies: ['AAPL', 'MSFT'], range: '1y' },
      service,
      { llmFill }
    );
    expect(result.success).toBe(true);
    expect(service.getBasicFinancials).toHaveBeenCalledWith('AAPL');
    expect(service.getBasicFinancials).toHaveBeenCalledWith('MSFT');
    expect(service.getPeers).toHaveBeenCalledWith('AAPL');
    expect(service.getPeers).toHaveBeenCalledWith('MSFT');
    expect(service.getNewsSentiment).toHaveBeenCalledWith('AAPL');
    expect(service.getNewsSentiment).toHaveBeenCalledWith('MSFT');
    expect(service.getCompanyNews).toHaveBeenCalledWith('AAPL', 14);
    expect(service.getCompanyNews).toHaveBeenCalledWith('MSFT', 14);
  });

  it('comparison report includes investment conclusion', async () => {
    const llmFill = vi.fn().mockResolvedValue('{"AAPL":"AAPL","MSFT":"MSFT"}');
    const result = await executeTool(
      'generate_comparison_report',
      { companies: ['AAPL', 'MSFT'], range: '1y' },
      service,
      { llmFill }
    );
    expect(result.success).toBe(true);
    expect(result.data?.content).toContain('## 🎯 Investment Conclusion');
  });

  it('comparison summary uses report-facing Watch wording in signal mix', async () => {
    const llmFill = vi.fn().mockResolvedValue('{"AAPL":"AAPL","MSFT":"MSFT"}');
    const result = await executeTool(
      'generate_comparison_report',
      { companies: ['AAPL', 'MSFT'], range: '1y' },
      service,
      { llmFill }
    );
    expect(result.success).toBe(true);
    expect(result.data?.summary).toContain('Watch');
  });
});

// ─── LLM conclusion prompt generation ────────────────────────────────────────

describe('LLM conclusion integration in executeTool', () => {
  let service: StockDataService;
  beforeEach(() => { service = stubService(); });
  it('stock report: llmFill called three times — ticker resolution, moat, then conclusion', async () => {
    const moatResponse = JSON.stringify({
      moatType: 'Network Effect',
      moatStrength: 'Wide',
      moatScore: 75,
      barriers: ['Network effects'],
      narrative: 'Strong network moat.',
      bestFor: 'Growth investors',
    });
    const conclusionResponse = 'Apple demonstrates strong financials with 30% operating margin from API data. BUY recommendation based on real data.';
    const llmFill = vi.fn()
      .mockResolvedValueOnce('{"AAPL":"AAPL"}')  // Call 1: ticker resolution
      .mockResolvedValueOnce(moatResponse)        // Call 2: moat analysis
      .mockResolvedValueOnce(conclusionResponse); // Call 3: conclusion
    const result = await executeTool('generate_stock_report', { symbol: 'AAPL', range: '1y' }, service, { llmFill });
    expect(result.success).toBe(true);
    expect(llmFill).toHaveBeenCalledTimes(3);
    // Conclusion narrative injected into report
    expect(result.data?.content).toContain(conclusionResponse);
  });

  it('stock report: conclusion uses structured fallback when LLM is unavailable', async () => {
    const result = await executeTool('generate_stock_report', { symbol: 'AAPL', range: '1y' }, service);
    expect(result.success).toBe(true);
    // No LLM — structured fallback used
    expect(result.data?.content).toContain('## 🎯 Investment Conclusion');
  });

  it('comparison report: llmFill called four times — tickers, moat, rationale, conclusion', async () => {
    const llmFill = vi.fn()
      .mockResolvedValueOnce('{"AAPL":"AAPL","MSFT":"MSFT"}')  // Call 1: ticker resolution
      .mockResolvedValueOnce('{}')                              // Call 2: batch moat
      .mockResolvedValueOnce('{}')                              // Call 3: position rationale
      .mockResolvedValueOnce('AAPL leads with 25% margins from real API data. BUY AAPL. MSFT is a solid HOLD.'); // Call 4: conclusion
    const result = await executeTool(
      'generate_comparison_report',
      { companies: ['AAPL', 'MSFT'], range: '1y' },
      service,
      { llmFill }
    );
    expect(result.success).toBe(true);
    expect(llmFill).toHaveBeenCalledTimes(4);
    expect(result.data?.content).toContain('AAPL leads');
  });

  it('sector report: llmFill conclusion prompt contains sector theme', async () => {
    let conclusionPromptReceived = '';
    const llmFill = vi.fn().mockImplementation((prompt: string) => {
      if (prompt.includes('Deep Sector') || prompt.includes('Sector:')) {
        conclusionPromptReceived = prompt;
        return Promise.resolve('Semiconductors are experiencing strong AI-driven demand from real API data. BUY NVDA.');
      }
      return Promise.resolve('["NVDA","AMD"]');
    });
    const result = await executeTool('generate_sector_report', { sector: 'Semiconductors', count: 2 }, service, { llmFill });
    expect(result.success).toBe(true);
    // The conclusion prompt sent to the LLM should reference the sector
    expect(conclusionPromptReceived).toContain('Semiconductors');
    expect(result.data?.content).toContain('## 🎯 Investment Conclusion');
  });

  it('sector report fetches financial and news context for each selected company', async () => {
    const llmFill = vi.fn().mockResolvedValue('["NVDA","AMD"]');
    const result = await executeTool('generate_sector_report', { sector: 'Semiconductors', count: 2 }, service, { llmFill });
    expect(result.success).toBe(true);
    expect(service.getBasicFinancials).toHaveBeenCalledWith('NVDA');
    expect(service.getBasicFinancials).toHaveBeenCalledWith('AMD');
    expect(service.getPeers).toHaveBeenCalledWith('NVDA');
    expect(service.getPeers).toHaveBeenCalledWith('AMD');
    expect(service.getNewsSentiment).toHaveBeenCalledWith('NVDA');
    expect(service.getNewsSentiment).toHaveBeenCalledWith('AMD');
    expect(service.getCompanyNews).toHaveBeenCalledWith('NVDA', 14);
    expect(service.getCompanyNews).toHaveBeenCalledWith('AMD', 14);
  });

  it('deep sector report: LLM conclusion narrative appears in report', async () => {
    const conclusionText = 'Deep sector AI analysis based on real API data shows NVDA dominates with 85% market share. Strong BUY.';
    let callCount = 0;
    const llmFill = vi.fn().mockImplementation((prompt: string) => {
      callCount++;
      // Call 1: initial candidates, Call 2: dependency/refinement, Call 3: batch moat, Call 4: conclusion
      if (prompt.includes('Deep Sector') || (callCount >= 4 && !prompt.includes('moatType'))) {
        return Promise.resolve(conclusionText);
      }
      if (prompt.includes('moatType')) {
        return Promise.resolve('{}');
      }
      if (prompt.includes('dependencyAnalysis') || prompt.includes('refinedList')) {
        return Promise.resolve(JSON.stringify({
          refinedList: ['NVDA', 'AMD'],
          dependencyAnalysis: 'NVDA dominates',
          ecosystemDiagram: 'graph LR\n  NVDA --> AMD',
          refinementNotes: '✅ NVDA (NVIDIA) — market leader',
        }));
      }
      return Promise.resolve('["NVDA","AMD"]');
    });
    const result = await executeTool('generate_deep_sector_report', { sector: 'AI chips', count: 2 }, service, { llmFill });
    expect(result.success).toBe(true);
    expect(result.data?.content).toContain('## 🎯 Investment Conclusion');
  });

  it('deep sector report fetches the refined universe with financial and news context', async () => {
    let callCount = 0;
    const llmFill = vi.fn().mockImplementation((prompt: string) => {
      callCount++;
      if (prompt.includes('moatType')) {
        return Promise.resolve('{}');
      }
      if (prompt.includes('dependencyAnalysis') || prompt.includes('refinedList')) {
        return Promise.resolve(JSON.stringify({
          refinedList: ['NVDA', 'AMD'],
          dependencyAnalysis: 'NVDA dominates',
          ecosystemDiagram: 'graph LR\n  NVDA --> AMD',
          refinementNotes: '✅ NVDA (NVIDIA) — market leader',
        }));
      }
      if (callCount === 1) {
        return Promise.resolve('["NVDA","AMD"]');
      }
      return Promise.resolve('Deep sector conclusion.');
    });
    const result = await executeTool('generate_deep_sector_report', { sector: 'AI chips', count: 2 }, service, { llmFill });
    expect(result.success).toBe(true);
    expect(service.getBasicFinancials).toHaveBeenCalledWith('NVDA');
    expect(service.getBasicFinancials).toHaveBeenCalledWith('AMD');
    expect(service.getPeers).toHaveBeenCalledWith('NVDA');
    expect(service.getPeers).toHaveBeenCalledWith('AMD');
    expect(service.getNewsSentiment).toHaveBeenCalledWith('NVDA');
    expect(service.getNewsSentiment).toHaveBeenCalledWith('AMD');
    expect(service.getCompanyNews).toHaveBeenCalledWith('NVDA', 14);
    expect(service.getCompanyNews).toHaveBeenCalledWith('AMD', 14);
  });
});

// ─── Tool definitions ─────────────────────────────────────────────────────────

describe('getToolDefinitions', () => {
  it('exports a non-empty tool definitions array', async () => {
    const { getToolDefinitions } = await import('../web/app/lib/stockTools');
    const defs = getToolDefinitions();
    expect(Array.isArray(defs)).toBe(true);
    expect(defs.length).toBeGreaterThan(0);
  });

  it('each tool definition has a function.name and function.description', async () => {
    const { getToolDefinitions } = await import('../web/app/lib/stockTools');
    const defs = getToolDefinitions();
    for (const def of defs) {
      expect(def.function.name).toBeTruthy();
      expect(def.function.description).toBeTruthy();
    }
  });

  it('getToolDefinitionsByName filters to requested tools only', async () => {
    const { getToolDefinitionsByName } = await import('../web/app/lib/stockTools');
    const defs = getToolDefinitionsByName(['get_stock_price', 'get_company_overview']);
    expect(defs.length).toBe(2);
    const names = defs.map((d) => d.function.name);
    expect(names).toContain('get_stock_price');
    expect(names).toContain('get_company_overview');
  });

  it('getToolDefinitionsByName returns all tools when called with no args', async () => {
    const { getToolDefinitionsByName, getToolDefinitions } = await import('../web/app/lib/stockTools');
    const all = getToolDefinitions();
    const filtered = getToolDefinitionsByName();
    expect(filtered.length).toBe(all.length);
  });

  it('generate_stock_report tool definition exists', async () => {
    const { getToolDefinitions } = await import('../web/app/lib/stockTools');
    const defs = getToolDefinitions();
    const found = defs.find((d) => d.function.name === 'generate_stock_report');
    expect(found).toBeDefined();
  });

  it('generate_sector_report tool definition exists', async () => {
    const { getToolDefinitions } = await import('../web/app/lib/stockTools');
    const defs = getToolDefinitions();
    const found = defs.find((d) => d.function.name === 'generate_sector_report');
    expect(found).toBeDefined();
  });

  it('generate_comparison_report tool definition exists', async () => {
    const { getToolDefinitions } = await import('../web/app/lib/stockTools');
    const defs = getToolDefinitions();
    const found = defs.find((d) => d.function.name === 'generate_comparison_report');
    expect(found).toBeDefined();
  });
});

// ─── Financial fallback paths ─────────────────────────────────────────────────

describe('generate_stock_report financial-data fallback', () => {
  let service: StockDataService;

  // Use a synthetic symbol that will never have a real on-disk cache file so
  // the vi.fn() mocks are always consulted (not skipped by the cache layer).
  const SYM = 'ZTEST';
  const LLM_TICKER = `{"${SYM}":"${SYM}"}`;

  beforeEach(async () => {
    // Delete any cache file written by a previous test so that mocks are always consulted
    try { await fsp.unlink(path.resolve('reports', 'cache', `${SYM}.json`)); } catch {}
    service = stubService();
  });

  const richOverview = {
    name: 'Test Corp',
    symbol: SYM,
    eps: '6.43',
    revenueTTM: '400000000000',
    grossProfitTTM: '180000000000',
    operatingMargin: '0.30',
    profitMargin: '0.25',
    bookValue: '4.50',
    sharesOutstanding: '15400000000',
    peRatio: '28',
    returnOnEquity: '1.50',
    quarterlyRevenueGrowth: '0.06',
    quarterlyEarningsGrowth: '0.10',
  };

  it('income statement table shows TTM estimated row when provider returns no data', async () => {
    (service.getCompanyOverview as ReturnType<typeof vi.fn>).mockResolvedValue(richOverview);
    (service.getIncomeStatement as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (service.getBalanceSheet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (service.getCashFlow as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const llmFill = vi.fn()
      .mockResolvedValueOnce(LLM_TICKER)
      .mockResolvedValueOnce('{}')
      .mockResolvedValueOnce('Strong financials. BUY.');

    const result = await executeTool('generate_stock_report', { symbol: SYM, range: '1y' }, service, { llmFill });
    expect(result.success).toBe(true);
    const content = result.data?.content as string;

    expect(content).not.toContain('Income statement data unavailable');
    expect(content).toContain('TTM (est.)');
    expect(content).toContain('$');
  });

  it('income statement shows "unavailable" when even overview has no revenue data', async () => {
    (service.getCompanyOverview as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Unknown Co' });
    (service.getIncomeStatement as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const llmFill = vi.fn()
      .mockResolvedValueOnce(LLM_TICKER)
      .mockResolvedValueOnce('{}')
      .mockResolvedValueOnce('Minimal data. WATCH.');

    const result = await executeTool('generate_stock_report', { symbol: SYM, range: '1y' }, service, { llmFill });
    expect(result.success).toBe(true);
    expect(result.data?.content).toContain('Income statement data unavailable');
  });

  it('balance sheet table shows equity row when provider returns no data', async () => {
    (service.getCompanyOverview as ReturnType<typeof vi.fn>).mockResolvedValue(richOverview);
    (service.getBalanceSheet as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const llmFill = vi.fn()
      .mockResolvedValueOnce(LLM_TICKER)
      .mockResolvedValueOnce('{}')
      .mockResolvedValueOnce('Strong balance sheet. BUY.');

    const result = await executeTool('generate_stock_report', { symbol: SYM, range: '1y' }, service, { llmFill });
    expect(result.success).toBe(true);
    const content = result.data?.content as string;

    expect(content).not.toContain('Balance sheet data unavailable');
    expect(content).toContain('Latest (est.)');
  });

  it('cash flow section shows unavailable when no data and no reliable fallback', async () => {
    (service.getCompanyOverview as ReturnType<typeof vi.fn>).mockResolvedValue(richOverview);
    (service.getCashFlow as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const llmFill = vi.fn()
      .mockResolvedValueOnce(LLM_TICKER)
      .mockResolvedValueOnce('{}')
      .mockResolvedValueOnce('Cash flow data limited. HOLD.');

    const result = await executeTool('generate_stock_report', { symbol: SYM, range: '1y' }, service, { llmFill });
    expect(result.success).toBe(true);
    expect(result.data?.content).toContain('Cash flow data unavailable');
  });

  it('EPS chart appears when provider returns no earnings but overview has eps', async () => {
    (service.getCompanyOverview as ReturnType<typeof vi.fn>).mockResolvedValue(richOverview);
    (service.getEarningsHistory as ReturnType<typeof vi.fn>).mockResolvedValue({ quarterlyEarnings: [] });

    const llmFill = vi.fn()
      .mockResolvedValueOnce(LLM_TICKER)
      .mockResolvedValueOnce('{}')
      .mockResolvedValueOnce('Earnings data from overview. BUY.');

    const result = await executeTool('generate_stock_report', { symbol: SYM, range: '1y' }, service, { llmFill });
    expect(result.success).toBe(true);
    const content = result.data?.content as string;

    expect(content).toContain('## 📈 Price & EPS Trends');
    expect(content).toContain('Quarterly EPS');
  });

  it('EPS chart absent when both earnings and overview eps are missing', async () => {
    (service.getCompanyOverview as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'No EPS Co' });
    (service.getEarningsHistory as ReturnType<typeof vi.fn>).mockResolvedValue({ quarterlyEarnings: [] });

    const llmFill = vi.fn()
      .mockResolvedValueOnce(LLM_TICKER)
      .mockResolvedValueOnce('{}')
      .mockResolvedValueOnce('No EPS data. WATCH.');

    const result = await executeTool('generate_stock_report', { symbol: SYM, range: '1y' }, service, { llmFill });
    expect(result.success).toBe(true);
    // No Price & EPS Trends section when both earnings API and overview eps are empty
    expect(result.data?.content).not.toContain('## 📈 Price & EPS Trends');
  });

  it('real income statement data takes priority over fallback when both are available', async () => {
    (service.getCompanyOverview as ReturnType<typeof vi.fn>).mockResolvedValue(richOverview);
    (service.getIncomeStatement as ReturnType<typeof vi.fn>).mockResolvedValue({
      quarterlyReports: [{
        fiscalQuarter: '2024-09-30',
        totalRevenue: '94930000000',
        grossProfit: '42270000000',
        operatingIncome: '29600000000',
        netIncome: '21400000000',
        ebitda: null,
      }],
    });

    const llmFill = vi.fn()
      .mockResolvedValueOnce(LLM_TICKER)
      .mockResolvedValueOnce('{}')
      .mockResolvedValueOnce('Real data available. BUY.');

    const result = await executeTool('generate_stock_report', { symbol: SYM, range: '1y' }, service, { llmFill });
    expect(result.success).toBe(true);
    const content = result.data?.content as string;

    expect(content).not.toContain('TTM (est.)');
    expect(content).toContain('2024-09-30');
  });

  it('real earnings history takes priority over fallback when available', async () => {
    (service.getCompanyOverview as ReturnType<typeof vi.fn>).mockResolvedValue(richOverview);
    (service.getEarningsHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      quarterlyEarnings: [
        { fiscalQuarter: '2024-09-30', reportedEPS: '1.64', estimatedEPS: '1.60' },
        { fiscalQuarter: '2024-06-30', reportedEPS: '1.40', estimatedEPS: '1.35' },
        { fiscalQuarter: '2024-03-31', reportedEPS: '1.53', estimatedEPS: '1.50' },
        { fiscalQuarter: '2023-12-31', reportedEPS: '2.18', estimatedEPS: '2.10' },
      ],
    });

    const llmFill = vi.fn()
      .mockResolvedValueOnce(LLM_TICKER)
      .mockResolvedValueOnce('{}')
      .mockResolvedValueOnce('Quarterly EPS data available. BUY.');

    const result = await executeTool('generate_stock_report', { symbol: SYM, range: '1y' }, service, { llmFill });
    expect(result.success).toBe(true);
    expect(result.data?.content).toContain('Quarterly EPS');
  });
});

describe('generate_watchlist_daily_report via executeTool', () => {
  let service: StockDataService;
  const watchlistsFile = path.resolve('reports', 'watchlists.json');

  beforeEach(async () => {
    service = stubService();
    await fsp.mkdir(path.dirname(watchlistsFile), { recursive: true });
    await fsp.writeFile(
      watchlistsFile,
      JSON.stringify({
        watchlists: [
          {
            id: 'watch-1',
            name: 'Core Watchlist',
            slug: 'default',
            isDefault: true,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            items: [
              {
                id: 'item-1',
                symbol: 'NVDA',
                companyName: 'NVIDIA',
                displayOrder: 0,
                createdAt: '2025-01-01T00:00:00Z',
              },
              {
                id: 'item-2',
                symbol: 'AMD',
                companyName: 'AMD',
                displayOrder: 1,
                createdAt: '2025-01-01T00:00:00Z',
              },
            ],
          },
        ],
      }),
      'utf8'
    );
  });

  afterEach(async () => {
    try { await fsp.unlink(watchlistsFile); } catch {}
  });

  it('builds one combined report for all watchlist companies', async () => {
    const result = await executeTool('generate_watchlist_daily_report', { range: '1y', skipSave: true }, service);

    expect(result.success).toBe(true);
    expect(result.data?.content).toContain('# Watchlist Daily Report: Core Watchlist');
    // Position guidance uses compact 4-column table
    expect(result.data?.content).toContain('| Company | Signal | Confidence | Action |');
    expect(result.data?.content).toContain('## 1. NVIDIA (NVDA)');
    expect(result.data?.content).toContain('## 2. AMD (AMD)');
    expect(service.getStockPrice).toHaveBeenCalledWith('NVDA');
    expect(service.getStockPrice).toHaveBeenCalledWith('AMD');
  });
});
