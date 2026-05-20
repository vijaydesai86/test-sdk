/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs/promises');
const { createJiti } = require('jiti');

const testRoot = path.join('/tmp', `test-sdk-report-tests-${process.pid}`);
process.env.VERCEL = '1';
process.env.REPORTS_DIR = path.join(testRoot, 'reports');
process.env.WATCHLISTS_FILE = path.join(testRoot, 'watchlists.json');
process.env.RESEARCH_MEMORY_FILE = path.join(testRoot, 'research-memory.json');
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const jiti = createJiti(__filename);
const { executeTool } = jiti(path.join(process.cwd(), 'app/lib/stockTools.ts'));

const COMPANIES = {
  NVDA: { name: 'NVIDIA Corp', sector: 'Technology', industry: 'Semiconductors' },
  AMD: { name: 'Advanced Micro Devices Inc', sector: 'Technology', industry: 'Semiconductors' },
  AVGO: { name: 'Broadcom Inc', sector: 'Technology', industry: 'Semiconductors' },
  MSFT: { name: 'Microsoft Corp', sector: 'Technology', industry: 'Software' },
  AMZN: { name: 'Amazon.com Inc', sector: 'Consumer Cyclical', industry: 'Internet Retail' },
  GOOGL: { name: 'Alphabet Inc', sector: 'Communication Services', industry: 'Internet Content' },
  TSM: { name: 'TSMC Taiwan Semiconductor Manufacturing Company', sector: 'Technology', industry: 'Semiconductors' },
};

function numericSeed(symbol) {
  return Array.from(symbol).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function searchRecord(symbol) {
  const meta = COMPANIES[symbol] || { name: `${symbol} Corp`, sector: 'Technology', industry: 'Software' };
  return {
    symbol,
    name: meta.name,
    region: 'United States',
    currency: 'USD',
    type: 'Equity',
  };
}

function overviewFor(symbol) {
  if (symbol === 'TSM') {
    return {
      symbol: 'TSM',
      name: COMPANIES.TSM.name,
      sector: 'Technology',
      industry: 'Semiconductors',
      marketCapitalization: '58088850000000',
      sharesOutstanding: '25930000000',
      dividendYield: '1.088',
      '52WeekHigh': '2345',
      '52WeekLow': '946',
      '50DayMovingAverage': '400',
      '200DayMovingAverage': '392',
      bookValue: '227.2',
      revenuePerShare: '100',
      dividendPerShare: '5',
      analystTargetPrice: '2500',
      peRatio: 30,
      forwardPE: 28,
      priceToSalesRatioTTM: 14,
      priceToBookRatio: 7,
      revenueTTM: 90000000000,
      grossProfitTTM: 55000000000,
      profitMargin: 0.42,
      operatingMargin: 0.48,
      returnOnEquity: 0.31,
      returnOnAssets: 0.21,
      quarterlyRevenueGrowth: 0.22,
      quarterlyEarningsGrowth: 0.18,
      currentRatio: 2.5,
      __source: 'Mock',
    };
  }
  const seed = numericSeed(symbol);
  const price = 75 + (seed % 90);
  const shares = 1000000000 + seed * 1000000;
  const meta = COMPANIES[symbol] || { name: `${symbol} Corp`, sector: 'Technology', industry: 'Software' };
  return {
    symbol,
    name: meta.name,
    sector: meta.sector,
    industry: meta.industry,
    marketCapitalization: Math.round(price * shares),
    sharesOutstanding: shares,
    '52WeekHigh': price * 1.25,
    '52WeekLow': price * 0.7,
    '50DayMovingAverage': price * 0.96,
    '200DayMovingAverage': price * 0.9,
    peRatio: 30 + (seed % 20),
    forwardPE: 26 + (seed % 16),
    priceToSalesRatioTTM: 8,
    priceToBookRatio: 10,
    revenueTTM: 50000000000 + seed * 10000000,
    grossProfitTTM: 30000000000 + seed * 5000000,
    profitMargin: 0.25,
    operatingMargin: 0.3,
    returnOnEquity: 0.24,
    returnOnAssets: 0.16,
    quarterlyRevenueGrowth: 0.18,
    quarterlyEarningsGrowth: 0.16,
    currentRatio: 2.2,
    __source: 'Mock',
  };
}

function priceFor(symbol) {
  if (symbol === 'TSM') {
    return { symbol: 'TSM', price: 392.61, change: -3.31, changePercent: '-0.84%', __source: 'Mock' };
  }
  const price = 75 + (numericSeed(symbol) % 90);
  return { symbol, price, change: 1.1, changePercent: '1.10%', __source: 'Mock' };
}

function historyFor(symbol) {
  if (symbol === 'TSM') {
    return {
      symbol: 'TSM',
      prices: [
        { date: '2025-06-01', close: 150, low: 141.37, high: 160 },
        { date: '2026-05-20', close: 392.61, low: 380, high: 400 },
      ],
      __source: 'Mock',
    };
  }
  const price = Number(priceFor(symbol).price);
  return {
    symbol,
    prices: [
      { date: '2025-06-01', close: price * 0.72, low: price * 0.68, high: price * 0.75 },
      { date: '2025-12-01', close: price * 0.88, low: price * 0.84, high: price * 0.91 },
      { date: '2026-05-20', close: price, low: price * 0.98, high: price * 1.04 },
    ],
    __source: 'Mock',
  };
}

function basicFinancialsFor(symbol) {
  return {
    symbol,
    metric: {
      peBasicExclExtraTTM: symbol === 'TSM' ? 30 : 36,
      epsTTM: 4,
      revenueGrowthTTM: 0.2,
      epsGrowthTTM: 0.18,
      grossMarginTTM: 0.6,
      operatingMarginTTM: 0.35,
      roeTTM: 0.28,
      roaTTM: 0.18,
      currentRatio: 2.1,
      debtEquityRatio: 0.25,
    },
    series: {},
    __source: 'Mock',
  };
}

function createMockStockService() {
  return {
    async searchStock(query) {
      const normalized = String(query || '').toUpperCase().replace(/[^A-Z0-9.]/g, '');
      if (/AI|INFRASTRUCTURE|SEMICONDUCTOR|DATA/.test(normalized)) {
        return { results: ['NVDA', 'AMD', 'AVGO', 'MSFT', 'AMZN', 'GOOGL'].map(searchRecord), __source: 'Mock' };
      }
      if (normalized === 'TSMC') {
        return { results: [searchRecord('TSM')], __source: 'Mock' };
      }
      if (COMPANIES[normalized]) {
        return { results: [searchRecord(normalized)], __source: 'Mock' };
      }
      return { results: [], __source: 'Mock' };
    },
    async getStockPrice(symbol) {
      return priceFor(String(symbol).toUpperCase());
    },
    async getCompanyOverview(symbol) {
      return overviewFor(String(symbol).toUpperCase());
    },
    async getBasicFinancials(symbol) {
      return basicFinancialsFor(String(symbol).toUpperCase());
    },
    async getPriceHistory(symbol) {
      return historyFor(String(symbol).toUpperCase());
    },
    async getEarningsHistory(symbol) {
      return { symbol, quarterlyEarnings: [], __source: 'Mock' };
    },
    async getIncomeStatement(symbol) {
      return { symbol, quarterlyReports: [], annualReports: [], __source: 'Mock' };
    },
    async getBalanceSheet(symbol) {
      return { symbol, quarterlyReports: [], annualReports: [], __source: 'Mock' };
    },
    async getCashFlow(symbol) {
      return { symbol, quarterlyReports: [], annualReports: [], __source: 'Mock' };
    },
    async getAnalystRatings(symbol) {
      return { symbol, strongBuy: 1, buy: 8, hold: 3, sell: 0, strongSell: 0, __source: 'Mock' };
    },
    async getAnalystRecommendations(symbol) {
      return { symbol, trend: [], __source: 'Mock' };
    },
    async getInsiderTrading(symbol) {
      return { symbol, transactions: [], __source: 'Mock' };
    },
    async getPriceTargets(symbol) {
      return { symbol, targetMean: Number(priceFor(String(symbol).toUpperCase()).price) * 1.12, __source: 'Mock' };
    },
    async getPeers(symbol) {
      return { symbol, peers: ['NVDA', 'AMD', 'AVGO'], __source: 'Mock' };
    },
    async getNewsSentiment(symbol) {
      return { symbol, feed: [], __source: 'Mock' };
    },
    async getCompanyNews(symbol) {
      return { symbol, articles: [], __source: 'Mock' };
    },
    async getSectorPerformance() {
      return {};
    },
    async getTopGainersLosers() {
      return {};
    },
    async searchNews() {
      return { articles: [], __source: 'Mock' };
    },
  };
}

async function assertSavedReport(result, expectedKind) {
  assert.equal(result.success, true, result.error || 'tool failed');
  assert.ok(result.data && result.data.filename, 'expected saved filename');
  assert.ok(String(result.data.content || '').length > 500, 'expected non-empty report content');
  assert.equal(result.data.reportKind, expectedKind);
  const savedContent = await fs.readFile(result.data.filePath, 'utf8');
  assert.equal(savedContent, result.data.content);
}

async function testDeepSectorDeadlineStillSaves() {
  let llmCalls = 0;
  const result = await executeTool(
    'generate_research_report',
    { sector: 'AI infrastructure stocks', range: '1y', count: 10 },
    createMockStockService(),
    {
      deadlineAt: Date.now() + 90000,
      async llmFill() {
        llmCalls += 1;
        throw new Error('LLM should not be called when the Vercel budget is tight');
      },
    }
  );
  await assertSavedReport(result, 'deep-sector');
  assert.equal(llmCalls, 0, 'tight budget should skip thematic LLM refinement');
  assert.match(result.data.content, /Vercel budget prioritized|Time budget reached|runtime budget/i);
  assert.match(result.data.content, /NVDA|AMD/);
}

async function testDeepSectorImmediateDeadlineStillSaves() {
  let llmCalls = 0;
  const result = await executeTool(
    'generate_research_report',
    { sector: 'Deep research on AI infrastructure stocks', range: '1y', count: 10 },
    createMockStockService(),
    {
      deadlineAt: Date.now() + 1000,
      async llmFill() {
        llmCalls += 1;
        throw new Error('LLM should not be called when the Vercel deadline is already tight');
      },
    }
  );
  await assertSavedReport(result, 'deep-sector');
  assert.equal(llmCalls, 0, 'immediate deadline should not spend time on LLM refinement');
  assert.match(result.data.content, /Vercel budget|Time budget reached|runtime budget/i);
  assert.match(result.data.content, /NVDA|AMD/);
}

async function testComparisonDeadlineStillSaves() {
  const result = await executeTool(
    'generate_comparison_report',
    { companies: ['NVDA', 'AMD'], range: '1y' },
    createMockStockService(),
    { deadlineAt: Date.now() + 90000 }
  );
  await assertSavedReport(result, 'comparison');
  assert.match(result.data.content, /NVDA/);
  assert.match(result.data.content, /AMD/);
}

async function testComparisonImmediateDeadlineStillSaves() {
  const result = await executeTool(
    'generate_comparison_report',
    { companies: ['NVDA', 'AMD'], range: '1y' },
    createMockStockService(),
    { deadlineAt: Date.now() + 1000 }
  );
  await assertSavedReport(result, 'comparison');
  assert.match(result.data.content, /NVDA/);
}

async function testWatchlistImmediateDeadlineStillSaves() {
  const result = await executeTool(
    'generate_watchlist_daily_report',
    { range: '1y' },
    createMockStockService(),
    { deadlineAt: Date.now() + 1000 }
  );
  await assertSavedReport(result, 'watchlist-daily');
  assert.match(result.data.content, /Partial Coverage|Position Guidance/i);
}

async function testTsmMixedScaleFieldsAreSuppressed() {
  const result = await executeTool(
    'generate_stock_report',
    { symbol: 'TSMC', range: '1y', skipSave: true, includeRawData: true, coreOnly: true },
    createMockStockService(),
    {}
  );
  assert.equal(result.success, true, result.error || 'stock report failed');
  assert.equal(result.data.symbol, 'TSM');
  const overview = result.data.rawData.companyOverview;
  assert.equal(overview.marketCapitalization, null, 'bad market cap must be suppressed');
  assert.equal(overview.dividendYield, null, 'bad dividend yield must be suppressed');
  assert.equal(overview['52WeekLow'], 141.37, '52-week low should come from real price history');
  assert.equal(overview['52WeekHigh'], 400, '52-week high should come from real price history');
  assert.match(result.data.content, /Provider market capitalization was inconsistent/);
}

async function main() {
  await fs.rm(testRoot, { recursive: true, force: true });
  await testDeepSectorDeadlineStillSaves();
  await testDeepSectorImmediateDeadlineStillSaves();
  await testComparisonDeadlineStillSaves();
  await testComparisonImmediateDeadlineStillSaves();
  await testWatchlistImmediateDeadlineStillSaves();
  await testTsmMixedScaleFieldsAreSuppressed();
  await fs.rm(testRoot, { recursive: true, force: true });
  console.log('report deadline smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
