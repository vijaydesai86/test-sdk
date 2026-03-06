import { describe, it, expect } from 'vitest';
import { buildStockReport, buildSectorReport, buildPeerReport, buildComparisonReport, saveReport } from '../reportGenerator';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('reportGenerator', () => {
  it('builds a stock report with charts', () => {
    const report = buildStockReport({
      symbol: 'AAPL',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '100.00', changePercent: '1.0%' },
      priceHistory: { prices: [{ date: '2025-01-01', close: '100' }] },
      earningsHistory: { quarterlyEarnings: [{ fiscalQuarter: '2024-12-31', reportedEPS: '1.2' }] },
      incomeStatement: { quarterlyReports: [{ fiscalQuarter: '2024-12-31', totalRevenue: '1000', grossProfit: '600', operatingIncome: '300' }] },
      priceTargets: { targetLow: 80, targetMean: 110, targetMedian: 105, targetHigh: 130 },
    });

    expect(report).toContain('# AAPL Comprehensive Equity Research Report');
    expect(report).toContain('```chart');
    expect(report).toContain('Analyst Target Distribution');
    expect(report).toContain('Composite Score');
    expect(report).toContain('Moat');
  });

  it('renders insider trading activity section when data provided', () => {
    const report = buildStockReport({
      symbol: 'TSLA',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '200.00' },
      insiderTransactions: {
        data: [
          { name: 'Elon Musk', transactionCode: 'S', share: 5000, value: 1000000, transactionDate: '2025-01-15' },
          { name: 'Robyn Denholm', transactionCode: 'P', share: 200, value: 40000, transactionDate: '2025-01-10' },
        ],
      },
    });

    expect(report).toContain('## 🏠 Insider Trading Activity');
    expect(report).toContain('Elon Musk');
    expect(report).toContain('Sell');
    expect(report).toContain('Buy');
  });

  it('shows no-data placeholder for insider section when empty transactions provided', () => {
    const report = buildStockReport({
      symbol: 'MSFT',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '300.00' },
      insiderTransactions: { data: [] },
    });

    expect(report).toContain('## 🏠 Insider Trading Activity');
    expect(report).toContain('No recent insider transactions');
  });

  it('omits insider section when insiderTransactions is undefined', () => {
    const report = buildStockReport({
      symbol: 'GOOG',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '150.00' },
    });

    expect(report).not.toContain('## 🏠 Insider Trading Activity');
  });

  it('renders News Highlights section from companyNews articles', () => {
    const report = buildStockReport({
      symbol: 'NVDA',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '800.00' },
      companyNews: {
        articles: [
          { headline: 'NVDA beats Q4 expectations', source: 'Reuters', datetime: '2025-01-05' },
          { headline: 'New GPU architecture announced', source: 'Bloomberg', datetime: '2025-01-04' },
        ],
      },
    });

    expect(report).toContain('## 📰 News Highlights');
    expect(report).toContain('NVDA beats Q4 expectations');
    expect(report).toContain('New GPU architecture announced');
  });

  it('renders ESG & Sustainability section when esgScore provided', () => {
    const report = buildStockReport({
      symbol: 'AAPL',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '100.00' },
      esgScore: { total: 72.5, environmental: 80, social: 70, governance: 65, rating: 'AA' },
    });

    expect(report).toContain('## 🌱 ESG & Sustainability');
    expect(report).toContain('72.5');
    expect(report).toContain('AA');
  });

  it('omits ESG section when esgScore is undefined', () => {
    const report = buildStockReport({
      symbol: 'AAPL',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '100.00' },
    });

    expect(report).not.toContain('## 🌱 ESG & Sustainability');
  });

  it('renders Legal & Regulatory section when legalEvents provided', () => {
    const report = buildStockReport({
      symbol: 'META',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '400.00' },
      legalEvents: [
        { type: 'SEC Investigation', date: '2025-01-01', description: 'Data privacy investigation ongoing' },
      ],
    });

    expect(report).toContain('## ⚖️ Legal & Regulatory');
    expect(report).toContain('SEC Investigation');
    expect(report).toContain('Data privacy investigation ongoing');
  });

  it('renders Management Quality section when managementTeam provided', () => {
    const report = buildStockReport({
      symbol: 'AMZN',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '180.00' },
      managementTeam: { ceo: 'Andy Jassy', cfo: 'Brian Olsavsky' },
    });

    expect(report).toContain('## 👔 Management Quality');
    expect(report).toContain('Andy Jassy');
    expect(report).toContain('Brian Olsavsky');
  });

  it('renders Suppliers & Customers section when supplierCustomers provided', () => {
    const report = buildStockReport({
      symbol: 'AAPL',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '100.00' },
      supplierCustomers: {
        suppliers: ['TSMC', 'Foxconn', 'Corning'],
        customers: ['AT&T', 'Verizon'],
      },
    });

    expect(report).toContain('## 🔗 Suppliers & Customers');
    expect(report).toContain('TSMC');
    expect(report).toContain('AT&T');
  });

  it('renders Peer Comparison table from peers data', () => {
    const report = buildStockReport({
      symbol: 'AMD',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '120.00' },
      peers: { peers: ['NVDA', 'INTC', 'QCOM'] },
    });

    expect(report).toContain('## 👥 Peer Comparison');
    expect(report).toContain('NVDA');
    expect(report).toContain('INTC');
  });

  it('renders Visual Appendix listing chart types when charts are present', () => {
    const report = buildStockReport({
      symbol: 'MSFT',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '300.00', changePercent: '0.5%' },
      priceHistory: { prices: [{ date: '2024-01-01', close: '250' }, { date: '2025-01-01', close: '300' }] },
      priceTargets: { targetLow: 290, targetMean: 340, targetHigh: 380 },
    });

    expect(report).toContain('## 📎 Visual Appendix');
    expect(report).toContain('Price History');
    expect(report).toContain('Analyst Price Target Distribution');
  });

  it('builds a sector report with narrative sections', () => {
    const report = buildSectorReport({
      query: 'AI data center',
      generatedAt: '2025-01-01T00:00:00Z',
      universe: ['AAPL', 'MSFT'],
      items: [
        { symbol: 'AAPL', price: { price: '100' }, overview: { marketCapitalization: '1000', peRatio: '20' }, priceTargets: { targetMean: 120 } },
        { symbol: 'MSFT', price: { price: '200' }, overview: { marketCapitalization: '2000', peRatio: '30' }, priceTargets: { targetMean: 220 } },
      ],
      notes: ['Universe built from search'],
    });

    expect(report).toContain('## 🧭 Sector Summary');
    expect(report).toContain('## 🧾 Company Overview');
    expect(report).toContain('## ✅ Recommendations');
    expect(report).toContain('Companies Included');
    // New moat scores section is always included
    expect(report).toContain('## 🏰 Composite Moat Scores');
  });

  it('renders sector News Highlights when items have companyNews', () => {
    const report = buildSectorReport({
      query: 'Cloud computing',
      generatedAt: '2025-01-01T00:00:00Z',
      universe: ['AMZN', 'MSFT'],
      items: [
        {
          symbol: 'AMZN',
          price: { price: '180' },
          overview: { name: 'Amazon', marketCapitalization: '1800000000000' },
          companyNews: { articles: [{ headline: 'AWS revenue grows 40%', source: 'CNBC' }] },
        },
        { symbol: 'MSFT', price: { price: '300' }, overview: { name: 'Microsoft' } },
      ],
      notes: [],
    });

    expect(report).toContain('## 📰 News Highlights');
    expect(report).toContain('AWS revenue grows 40%');
  });

  it('renders sector Market Sentiment when items have newsSentiment', () => {
    const report = buildSectorReport({
      query: 'Semiconductor',
      generatedAt: '2025-01-01T00:00:00Z',
      universe: ['NVDA', 'AMD'],
      items: [
        {
          symbol: 'NVDA',
          price: { price: '800' },
          overview: { name: 'NVIDIA' },
          newsSentiment: { sentiment: { sentiment: 'Bullish', sentimentScore: 0.85 } },
        },
        { symbol: 'AMD', price: { price: '120' }, overview: { name: 'AMD' } },
      ],
      notes: [],
    });

    expect(report).toContain('## 📡 Market Sentiment');
    expect(report).toContain('Bullish');
  });

  it('renders comparison report Moat Scores section', () => {
    const report = buildComparisonReport({
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: [
        { symbol: 'NVDA', price: { price: '800' }, overview: { marketCapitalization: '2000000000000' } },
        { symbol: 'AMD', price: { price: '120' }, overview: { marketCapitalization: '200000000000' } },
      ],
    });

    expect(report).toContain('## 🏰 Moat Scores');
    expect(report).toContain('Moat Level');
  });

  it('renders comparison News Highlights when companyNews provided', () => {
    const report = buildComparisonReport({
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['AAPL', 'MSFT'],
      items: [
        {
          symbol: 'AAPL',
          price: { price: '180' },
          overview: { name: 'Apple' },
          companyNews: { articles: [{ headline: 'iPhone sales surge in Q1' }] },
        },
        { symbol: 'MSFT', price: { price: '300' }, overview: { name: 'Microsoft' } },
      ],
    });

    expect(report).toContain('## 📰 News Highlights');
    expect(report).toContain('iPhone sales surge in Q1');
  });

  it('renders comparison Market Sentiment when newsSentiment provided', () => {
    const report = buildComparisonReport({
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['AMZN', 'GOOG'],
      items: [
        {
          symbol: 'AMZN',
          price: { price: '180' },
          overview: { name: 'Amazon' },
          newsSentiment: { overallSentimentLabel: 'Positive', overallSentimentScore: 0.72 },
        },
        { symbol: 'GOOG', price: { price: '160' }, overview: { name: 'Alphabet' } },
      ],
    });

    expect(report).toContain('## 📡 Market Sentiment');
    expect(report).toContain('Positive');
  });

  it('saves report to disk', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reports-'));
    const saved = await saveReport('hello', 'test-report', tempDir);
    const content = await fs.readFile(saved.filePath, 'utf8');

    expect(content).toBe('hello');
  });

  it('builds a peer report with detailed comparison table', () => {
    const report = buildPeerReport({
      symbol: 'AMD',
      generatedAt: '2025-01-01T00:00:00Z',
      range: '5y',
      universe: ['AMD', 'NVDA'],
      items: [
        {
          symbol: 'AMD',
          price: { price: '100' },
          overview: { marketCapitalization: '1000', peRatio: '20' },
          priceTargets: { targetMean: 120 },
          priceHistory: { prices: [{ date: '2024-12-31', close: '100' }, { date: '2025-01-01', close: '102' }] },
        },
        {
          symbol: 'NVDA',
          price: { price: '200' },
          overview: { marketCapitalization: '2000', peRatio: '30' },
          priceTargets: { targetMean: 240 },
          priceHistory: { prices: [{ date: '2024-12-31', close: '200' }, { date: '2025-01-01', close: '205' }] },
        },
      ],
      notes: ['Peer data from Finnhub'],
    });

    expect(report).toContain('Peer Comparison Report');
    expect(report).toContain('Company Snapshot');
    expect(report).toContain('Role in Peer Set');
    expect(report).toContain('Analyst View');
  });
});

describe('web reportGenerator', () => {
  it('buildSectorReport wraps comparison report with sector header', async () => {
    const { buildSectorReport: buildSectorReportWeb } = await import('../../web/app/lib/reportGenerator');
    const report = buildSectorReportWeb({
      sectorQuery: 'AI data center',
      selectedBy: 'llm',
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'MSFT'],
      items: [
        { symbol: 'NVDA', price: { price: '500' }, overview: { marketCapitalization: '1000', peRatio: '40' } },
        { symbol: 'MSFT', price: { price: '300' }, overview: { marketCapitalization: '2000', peRatio: '30' } },
      ],
      notes: [],
    });

    expect(report).toContain('# Sector / Thematic Analysis: AI data center');
    expect(report).toContain('## 🔍 Universe Selection');
    expect(report).toContain('NVDA, MSFT');
    // Comparison body sections should be present
    expect(report).toContain('## 📊 Snapshot');
    // New moat scores section always present
    expect(report).toContain('## 🏰 Moat Scores');
  });

  it('web buildDeepSectorReport includes scenario simulations when provided', async () => {
    const { buildDeepSectorReport } = await import('../../web/app/lib/reportGenerator');
    const report = buildDeepSectorReport({
      sectorQuery: 'AI Chips',
      selectedBy: 'llm',
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: [
        { symbol: 'NVDA', price: { price: '800' }, overview: { marketCapitalization: '2000000000000' } },
        { symbol: 'AMD', price: { price: '120' }, overview: { marketCapitalization: '200000000000' } },
      ],
      notes: [],
      dependencyAnalysis: 'NVDA dominates AI compute; AMD gaining share.',
      ecosystemDiagram: 'graph LR\n  NVDA --> DataCenter\n  AMD --> DataCenter',
      refinementNotes: 'Selected NVDA and AMD as top AI chip players.',
      scenarioSimulations: '**Bull:** AI spend doubles, NVDA P/E expands to 60x.\n**Bear:** Macro slowdown cuts capex 20%.\n**Base:** Steady 25% growth.',
      supplierCustomerMap: 'TSMC supplies both NVDA and AMD wafers. Microsoft and AWS are top customers.',
      innovationHighlights: '| Company | Innovation | Impact |\n|---|---|---|\n| NVDA | Blackwell GPU | Next-gen AI training |',
    });

    expect(report).toContain('## 🔭 Scenario Simulations');
    expect(report).toContain('Bull');
    expect(report).toContain('## 🔗 Critical Supplier/Customer Mapping');
    expect(report).toContain('TSMC');
    expect(report).toContain('## 💡 Innovation Highlights');
    expect(report).toContain('Blackwell GPU');
  });

  it('web buildDeepSectorReport omits optional sections when data absent', async () => {
    const { buildDeepSectorReport } = await import('../../web/app/lib/reportGenerator');
    const report = buildDeepSectorReport({
      sectorQuery: 'Cloud',
      selectedBy: 'llm',
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['AMZN'],
      items: [{ symbol: 'AMZN', price: { price: '180' }, overview: { marketCapitalization: '1800000000000' } }],
      notes: [],
    });

    expect(report).not.toContain('## 🔭 Scenario Simulations');
    expect(report).not.toContain('## 🔗 Critical Supplier/Customer Mapping');
    expect(report).not.toContain('## 💡 Innovation Highlights');
    // Core report sections still present
    expect(report).toContain('# Deep Sector Research: Cloud');
  });

  it('web buildStockReport includes insider trading activity section', async () => {
    const { buildStockReport: buildStockReportWeb } = await import('../../web/app/lib/reportGenerator');
    const report = buildStockReportWeb({
      symbol: 'NVDA',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '800.00' },
      insiderTransactions: {
        data: [
          { name: 'Jensen Huang', transactionCode: 'S', share: 10000, value: 8000000, transactionDate: '2025-01-10' },
        ],
      },
    });

    expect(report).toContain('## 🏠 Insider Trading Activity');
    expect(report).toContain('Jensen Huang');
    expect(report).toContain('Sell');
  });

  it('web buildStockReport Visual Appendix lists charts when present', async () => {
    const { buildStockReport: buildStockReportWeb } = await import('../../web/app/lib/reportGenerator');
    const report = buildStockReportWeb({
      symbol: 'AAPL',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '180.00', changePercent: '1.2%' },
      priceHistory: { prices: [{ date: '2024-01-01', close: '150' }, { date: '2025-01-01', close: '180' }] },
      priceTargets: { targetLow: 170, targetMean: 210, targetHigh: 240 },
    });

    expect(report).toContain('## 📎 Visual Appendix');
    expect(report).toContain('Price History');
  });
});
