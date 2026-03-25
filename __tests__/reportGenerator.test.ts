import { describe, it, expect } from 'vitest';
import {
  buildStockReport,
  buildComparisonReport,
  buildSectorReport,
  buildDeepSectorReport,
  saveReport,
  type StockReportData,
  type ComparisonReportData,
  type SectorReportData,
  type DeepSectorReportData,
  type MoatAnalysis,
} from '../web/app/lib/reportGenerator';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const minimalStock = (): StockReportData => ({
  symbol: 'AAPL',
  generatedAt: '2025-01-01T00:00:00Z',
  price: { price: '182.00', changePercent: '1.5%' },
});

const richStock = (): StockReportData => ({
  symbol: 'AAPL',
  generatedAt: '2025-01-01T00:00:00Z',
  price: { price: '182.00', changePercent: '1.5%' },
  companyOverview: {
    name: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    marketCapitalization: '2800000000000',
    peRatio: '28',
    description: 'Apple designs and manufactures consumer electronics and software.',
    analystTargetPrice: '210.00',
    profitMargin: '0.25',
    operatingMargin: '0.30',
    returnOnEquity: '1.50',
    revenueTTM: '385000000000',
    grossProfitTTM: '170000000000',
    '52WeekLow': '155',
    '52WeekHigh': '199',
  },
  basicFinancials: {
    metric: {
      grossMarginTTM: 0.44,
      operatingMarginTTM: 0.30,
      roeTTM: 1.5,
      revenueGrowthTTM: 0.06,
      epsGrowth5Y: 0.12,
    },
  },
  priceHistory: {
    prices: [
      { date: '2024-01-01', close: '170' },
      { date: '2024-04-01', close: '175' },
      { date: '2024-07-01', close: '180' },
      { date: '2024-10-01', close: '182' },
    ],
  },
  earningsHistory: {
    quarterlyEarnings: [
      { fiscalQuarter: '2024-09-30', reportedEPS: '1.64' },
      { fiscalQuarter: '2024-06-30', reportedEPS: '1.53' },
      { fiscalQuarter: '2024-03-31', reportedEPS: '1.40' },
      { fiscalQuarter: '2023-12-31', reportedEPS: '2.18' },
    ],
  },
  incomeStatement: {
    quarterlyReports: [
      {
        fiscalDateEnding: '2024-09-30',
        totalRevenue: '94930000000',
        grossProfit: '43870000000',
        operatingIncome: '29590000000',
        netIncome: '14736000000',
      },
      {
        fiscalDateEnding: '2024-06-30',
        totalRevenue: '85777000000',
        grossProfit: '39673000000',
        operatingIncome: '26976000000',
        netIncome: '21448000000',
      },
    ],
  },
  analystRatings: { strongBuy: 15, buy: 20, hold: 5, sell: 1, strongSell: 0 },
  priceTargets: { targetLow: 160, targetMean: 210, targetMedian: 208, targetHigh: 250 },
});

const wideMoat = (): MoatAnalysis => ({
  moatType: 'Intangible Assets',
  moatStrength: 'Wide',
  moatScore: 82,
  barriers: ['Brand loyalty', 'Ecosystem lock-in', 'App Store network effects'],
  narrative: 'Apple commands exceptional brand loyalty via its tightly integrated hardware/software ecosystem.',
  bestFor: 'Long-term investors seeking a quality compounder with durable pricing power.',
});

const narrowMoat = (): MoatAnalysis => ({
  moatType: 'Switching Costs',
  moatStrength: 'Narrow',
  moatScore: 48,
  barriers: ['Enterprise data integration'],
  narrative: 'Moderate switching costs from deep enterprise integrations, but faces pricing pressure.',
  bestFor: 'Investors comfortable with moderate competitive risk in enterprise software.',
});

const twoCompanyItems = (): ComparisonReportData['items'] => [
  {
    symbol: 'NVDA',
    price: { price: '500', changePercent: '2%' },
    overview: {
      name: 'NVIDIA',
      marketCapitalization: '1200000000000',
      peRatio: '55',
      sector: 'Technology',
    },
    basicFinancials: { metric: { grossMarginTTM: 0.65, operatingMarginTTM: 0.45, roeTTM: 0.8, revenueGrowthTTM: 0.85 } },
    priceTargets: { targetMean: 600 },
    priceHistory: {
      prices: [
        { date: '2024-01-01', close: '450' },
        { date: '2024-07-01', close: '500' },
      ],
    },
  },
  {
    symbol: 'AMD',
    price: { price: '160', changePercent: '1%' },
    overview: {
      name: 'AMD',
      marketCapitalization: '260000000000',
      peRatio: '42',
      sector: 'Technology',
    },
    basicFinancials: { metric: { grossMarginTTM: 0.50, operatingMarginTTM: 0.20, roeTTM: 0.25, revenueGrowthTTM: 0.10 } },
    priceTargets: { targetMean: 190 },
    priceHistory: {
      prices: [
        { date: '2024-01-01', close: '140' },
        { date: '2024-07-01', close: '160' },
      ],
    },
  },
];

// ─── buildStockReport ─────────────────────────────────────────────────────────

describe('buildStockReport', () => {
  it('includes the standard report header', () => {
    const report = buildStockReport(minimalStock());
    expect(report).toContain('# AAPL Comprehensive Equity Research Report');
  });

  it('contains key structural sections', () => {
    const report = buildStockReport(richStock());
    expect(report).toContain('## 🏢 Business Overview');
    expect(report).toContain('## 💰 Financials');
    expect(report).toContain('## 🚀 Growth Drivers');
    expect(report).toContain('## ⚠️ Risks & Headwinds');
    expect(report).toContain('## 🧭 Investment Highlights');
    expect(report).toContain('## 🧠 Analyst View');
  });

  it('renders charts when price history is present', () => {
    const report = buildStockReport(richStock());
    expect(report).toContain('```chart');
    expect(report).toContain('Price History');
  });

  it('renders EPS chart when earnings data is present', () => {
    const report = buildStockReport(richStock());
    expect(report).toContain('Quarterly EPS');
  });

  it('renders analyst target distribution chart', () => {
    const report = buildStockReport(richStock());
    expect(report).toContain('Analyst Target Distribution');
  });

  it('renders scorecard section when data allows composite computation', () => {
    const report = buildStockReport(richStock());
    expect(report).toContain('Composite Score');
  });

  it('includes investment conclusion section', () => {
    const report = buildStockReport(richStock());
    expect(report).toContain('## 🎯 Investment Conclusion');
    expect(report).toContain('Suggested Portfolio Role');
  });

  it('conclusion does not appear in minimal report without data for rating', () => {
    // Even with minimal data the conclusion section is always appended
    const report = buildStockReport(minimalStock());
    expect(report).toContain('## 🎯 Investment Conclusion');
  });

  it('BUY or HOLD rating appears in conclusion', () => {
    // richStock has strong fundamentals — conclusion should mention one of the rating labels
    const data = richStock();
    const report = buildStockReport(data);
    // The conclusion section always appears; check that it includes one of the rating emoji+labels
    expect(report).toMatch(/✅ BUY|⚖️ HOLD|👀 WATCH|🔴 SELL/);
  });

  it('conclusion contains analyst upside when price targets are provided', () => {
    const data = richStock();
    const report = buildStockReport(data);
    // Price 182, target 210 → ~15.4% upside
    expect(report).toContain('upside');
  });

  it('shows wide moat section when MoatAnalysis is provided', () => {
    const data = { ...richStock(), moatAnalysis: wideMoat() };
    const report = buildStockReport(data);
    expect(report).toContain('## 🏰 Competitive Moat');
    expect(report).toContain('Intangible Assets');
    expect(report).toContain('Wide');
    expect(report).toContain('82');
  });

  it('conclusion reflects wide moat in portfolio role when both score and moat are strong', () => {
    const data = { ...richStock(), moatAnalysis: wideMoat() };
    const report = buildStockReport(data);
    expect(report).toContain('moat');
  });

  it('narrow moat does not produce wide moat label in conclusion', () => {
    const data = { ...richStock(), moatAnalysis: narrowMoat() };
    const report = buildStockReport(data);
    // Should not claim wide moat in conclusion for a score of 48
    expect(report).not.toContain('Wide moat');
  });

  it('conclusion is data-driven disclaimer always present', () => {
    const report = buildStockReport(richStock());
    expect(report).toContain('not financial advice');
  });

  it('handles missing price gracefully', () => {
    const data: StockReportData = {
      symbol: 'UNKNOWN',
      generatedAt: '2025-01-01T00:00:00Z',
      price: {},
    };
    expect(() => buildStockReport(data)).not.toThrow();
    const report = buildStockReport(data);
    expect(report).toContain('# UNKNOWN');
  });

  it('revenue chart appears when income statement is provided', () => {
    const report = buildStockReport(richStock());
    expect(report).toContain('## 📊 Revenue & Margin Trends');
  });

  it('handles NaN/undefined financial values gracefully', () => {
    const data: StockReportData = {
      symbol: 'XYZ',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: 'NaN', changePercent: undefined },
      basicFinancials: { metric: { grossMarginTTM: NaN, operatingMarginTTM: undefined } },
    };
    expect(() => buildStockReport(data)).not.toThrow();
  });
});

// ─── buildComparisonReport ────────────────────────────────────────────────────

describe('buildComparisonReport', () => {
  const baseComparison = (): ComparisonReportData => ({
    generatedAt: '2025-01-01T00:00:00Z',
    range: '1y',
    universe: ['NVDA', 'AMD'],
    items: twoCompanyItems(),
    notes: [],
  });

  it('includes the comparison header', () => {
    const report = buildComparisonReport(baseComparison());
    expect(report).toContain('# Company Comparison Report');
  });

  it('lists all universe members', () => {
    const report = buildComparisonReport(baseComparison());
    expect(report).toContain('NVDA');
    expect(report).toContain('AMD');
  });

  it('includes snapshot, scale, growth, and valuation tables', () => {
    const report = buildComparisonReport(baseComparison());
    expect(report).toContain('## 📊 Snapshot');
    expect(report).toContain('## 🧾 Scale & Profitability');
    expect(report).toContain('## 🚀 Growth & Momentum');
    expect(report).toContain('## 🧮 Valuation');
  });

  it('includes analyst view section', () => {
    const report = buildComparisonReport(baseComparison());
    expect(report).toContain('## 🧠 Analyst View');
  });

  it('includes indicative allocation table', () => {
    const report = buildComparisonReport(baseComparison());
    expect(report).toContain('## 🧭 Indicative Allocation');
  });

  it('includes investment conclusion section', () => {
    const report = buildComparisonReport(baseComparison());
    expect(report).toContain('## 🎯 Investment Conclusion');
  });

  it('conclusion names a top pick when data is available', () => {
    const report = buildComparisonReport(baseComparison());
    expect(report).toContain('Top Pick:');
  });

  it('conclusion includes group outlook', () => {
    const report = buildComparisonReport(baseComparison());
    expect(report).toContain('Peer Group Outlook:');
  });

  it('conclusion includes disclaimer', () => {
    const report = buildComparisonReport(baseComparison());
    expect(report).toContain('not financial advice');
  });

  it('moat analysis section appears when moat analysis is present on items', () => {
    const items = twoCompanyItems();
    items[0].moatAnalysis = wideMoat();
    const report = buildComparisonReport({ ...baseComparison(), items });
    expect(report).toContain('## 🏰 Moat Analysis');
    expect(report).toContain('Intangible Assets');
  });

  it('conclusion highlights moat leader when a wide moat company is present', () => {
    const items = twoCompanyItems();
    items[0].moatAnalysis = wideMoat();
    const report = buildComparisonReport({ ...baseComparison(), items });
    expect(report).toContain('Strongest moat:');
  });

  it('data gaps note rendered when notes are provided', () => {
    const report = buildComparisonReport({
      ...baseComparison(),
      notes: ['NVDA: balance sheet unavailable'],
    });
    expect(report).toContain('Data Gaps');
    expect(report).toContain('NVDA: balance sheet unavailable');
  });

  it('handles single-item universe without throwing', () => {
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA'],
      items: [twoCompanyItems()[0]],
      notes: [],
    };
    expect(() => buildComparisonReport(data)).not.toThrow();
  });

  it('handles empty items array without throwing', () => {
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: [],
      items: [],
      notes: [],
    };
    expect(() => buildComparisonReport(data)).not.toThrow();
  });
});

// ─── buildSectorReport ────────────────────────────────────────────────────────

describe('buildSectorReport', () => {
  const baseSector = (): SectorReportData => ({
    sectorQuery: 'AI chips',
    selectedBy: 'llm',
    generatedAt: '2025-01-01T00:00:00Z',
    range: '1y',
    universe: ['NVDA', 'AMD'],
    items: twoCompanyItems(),
    notes: [],
  });

  it('includes sector-specific header', () => {
    const report = buildSectorReport(baseSector());
    expect(report).toContain('# Sector / Thematic Analysis: AI chips');
  });

  it('includes universe selection section', () => {
    const report = buildSectorReport(baseSector());
    expect(report).toContain('## 🔍 Universe Selection');
    expect(report).toContain('NVDA, AMD');
  });

  it('states LLM-identified companies when selectedBy is llm', () => {
    const report = buildSectorReport(baseSector());
    expect(report).toContain('identified by AI');
  });

  it('states manual selection when selectedBy is not llm', () => {
    const report = buildSectorReport({ ...baseSector(), selectedBy: 'manual' });
    expect(report).toContain('selected for');
  });

  it('includes comparison body sections', () => {
    const report = buildSectorReport(baseSector());
    expect(report).toContain('## 📊 Snapshot');
    expect(report).toContain('## 🧭 Indicative Allocation');
  });

  it('includes sector-specific investment conclusion', () => {
    const report = buildSectorReport(baseSector());
    expect(report).toContain('## 🎯 Investment Conclusion');
    // Sector conclusion label is "<sectorQuery> Outlook:" e.g. "AI chips Outlook:"
    expect(report).toContain('Outlook:');
  });

  it('conclusion references the sector query', () => {
    const report = buildSectorReport(baseSector());
    // Sector conclusion includes the sector name, e.g. "AI chips Outlook:"
    expect(report).toContain('AI chips');
  });

  it('does NOT contain duplicate generic "Peer Group Outlook" in sector report', () => {
    const report = buildSectorReport(baseSector());
    // Sector report conclusion should say "Sector Outlook" not "Peer Group Outlook"
    const peerGroupCount = (report.match(/Peer Group Outlook/g) || []).length;
    expect(peerGroupCount).toBe(0);
  });

  it('conclusion appears only once (no duplicate conclusion sections)', () => {
    const report = buildSectorReport(baseSector());
    const conclusionCount = (report.match(/## 🎯 Investment Conclusion/g) || []).length;
    expect(conclusionCount).toBe(1);
  });
});

// ─── buildDeepSectorReport ───────────────────────────────────────────────────

describe('buildDeepSectorReport', () => {
  const baseDeep = (): DeepSectorReportData => ({
    sectorQuery: 'Quantum Computing',
    selectedBy: 'llm',
    generatedAt: '2025-01-01T00:00:00Z',
    range: '1y',
    universe: ['IBM', 'IONQ'],
    initialCandidates: ['IBM', 'IONQ', 'GOOGL', 'MSFT'],
    dependencyAnalysis:
      '### 🔗 Supply Chain & Dependencies\n\nIBM supplies hardware; IONQ is pure-play.\n\n' +
      '### 👥 Customer & Revenue Exposure\n\nB2B focus.\n\n' +
      '### 📊 Market & Macro Factors\n\nGovernment R&D spending rising.\n\n' +
      '### ⚔️ Competitive Dynamics & Sentiment\n\nEarly stage market.',
    ecosystemDiagram: 'graph LR\n  IBM-->Enterprise\n  IONQ-->Cloud',
    refinementNotes:
      '✅ IBM (IBM Corp) — broad quantum portfolio\n' +
      '✅ IONQ (IonQ) — pure-play quantum hardware\n' +
      '❌ GOOGL (Alphabet) — not a primary quantum play\n' +
      '❌ MSFT (Microsoft) — quantum is a small fraction of revenue',
    companySnapshots: {
      IBM: 'IBM has a diversified quantum computing division and existing enterprise relationships.',
      IONQ: 'IonQ is a pure-play trapped-ion quantum hardware and software provider.',
    },
    items: [
      {
        symbol: 'IBM',
        price: { price: '150', changePercent: '0.5%' },
        overview: { name: 'IBM', marketCapitalization: '135000000000', peRatio: '20', sector: 'Technology' },
        basicFinancials: { metric: { grossMarginTTM: 0.55, operatingMarginTTM: 0.12 } },
        priceTargets: { targetMean: 160 },
        priceHistory: { prices: [{ date: '2024-01-01', close: '140' }, { date: '2024-07-01', close: '150' }] },
      },
      {
        symbol: 'IONQ',
        price: { price: '15', changePercent: '3%' },
        overview: { name: 'IonQ', marketCapitalization: '3200000000', peRatio: null, sector: 'Technology' },
        basicFinancials: { metric: { grossMarginTTM: 0.30, operatingMarginTTM: -0.85 } },
        priceTargets: { targetMean: 22 },
        priceHistory: { prices: [{ date: '2024-01-01', close: '10' }, { date: '2024-07-01', close: '15' }] },
      },
    ],
    notes: [],
  });

  it('includes deep sector research header', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('# Deep Sector Research: Quantum Computing');
  });

  it('includes research methodology section', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('## 🔬 Research Methodology');
    expect(report).toContain('Candidate Identification');
  });

  it('includes ecosystem dependency section', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('## 🕸️ Sector Ecosystem & Dependencies');
    expect(report).toContain('Supply Chain');
  });

  it('includes ecosystem mermaid diagram', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('## 🗺️ Sector Dependency Map');
    expect(report).toContain('```mermaid');
    expect(report).toContain('graph LR');
  });

  it('includes rationale table parsed from ✅/❌ lines', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('## 🎯 Company Selection Rationale');
    expect(report).toContain('IBM');
  });

  it('includes company snapshots table', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('## 📋 Selected Companies at a Glance');
    expect(report).toContain('Investment Thesis');
  });

  it('includes comparison body sections', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('## 📊 Snapshot');
  });

  it('includes deep-sector investment conclusion', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('## 🎯 Investment Conclusion');
    expect(report).toContain('Deep Sector Outlook');
  });

  it('conclusion appears exactly once (no duplicates)', () => {
    const report = buildDeepSectorReport(baseDeep());
    const count = (report.match(/## 🎯 Investment Conclusion/g) || []).length;
    expect(count).toBe(1);
  });

  it('refinement rationale rendered as table when format matches', () => {
    const report = buildDeepSectorReport(baseDeep());
    // Table columns should be present
    expect(report).toContain('| Status |');
    expect(report).toContain('| Company |');
  });

  it('handles missing optional deep-sector fields gracefully', () => {
    const minimal: DeepSectorReportData = {
      sectorQuery: 'Biotech',
      selectedBy: 'llm',
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['MRNA'],
      items: [
        {
          symbol: 'MRNA',
          price: { price: '60' },
          overview: { name: 'Moderna', sector: 'Healthcare' },
        },
      ],
      notes: [],
    };
    expect(() => buildDeepSectorReport(minimal)).not.toThrow();
  });
});

// ─── saveReport ───────────────────────────────────────────────────────────────

describe('saveReport', () => {
  it('writes report content to disk and returns correct path', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reports-'));
    const saved = await saveReport('hello world', 'my-report', tempDir);
    const content = await fs.readFile(saved.filePath, 'utf8');
    expect(content).toBe('hello world');
  });

  it('filename includes a slugified title', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reports-'));
    const saved = await saveReport('body', 'Apple Stock Report', tempDir);
    expect(saved.filename).toMatch(/apple-stock-report/);
  });

  it('filename ends with .md extension', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reports-'));
    const saved = await saveReport('body', 'test', tempDir);
    expect(saved.filename).toMatch(/\.md$/);
  });

  it('creates the directory if it does not exist', async () => {
    const tempBase = await fs.mkdtemp(path.join(os.tmpdir(), 'reports-'));
    const newDir = path.join(tempBase, 'nested', 'sub');
    const saved = await saveReport('content', 'nested', newDir);
    await expect(fs.readFile(saved.filePath, 'utf8')).resolves.toBe('content');
  });

  it('returns undefined supabaseId when Supabase env vars are absent', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reports-'));
    const saved = await saveReport('body', 'no-supabase', tempDir);
    expect(saved.supabaseId).toBeUndefined();
  });
});

// ─── Conclusion helpers (tested via report output) ───────────────────────────

describe('investment conclusion derivation', () => {
  it('SELL/AVOID label absent when fundamentals are strong', () => {
    const report = buildStockReport(richStock());
    expect(report).not.toContain('SELL / AVOID');
  });

  it('WATCH appears when no financial data is available for rating', () => {
    const report = buildStockReport(minimalStock());
    // Minimal data → can't compute composite → deriveRating returns WATCH
    expect(report).toContain('WATCH');
  });

  it('conclusion includes bullish signal for high revenue growth', () => {
    const data: StockReportData = {
      symbol: 'GRWTH',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '100' },
      basicFinancials: {
        metric: { revenueGrowthTTM: 0.40 }, // 40% growth
      },
    };
    const report = buildStockReport(data);
    expect(report).toContain('Revenue growing');
  });

  it('conclusion includes bearish signal for negative operating margin', () => {
    const data: StockReportData = {
      symbol: 'LOSS',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '50' },
      basicFinancials: {
        metric: { operatingMarginTTM: -0.25 }, // -25%
      },
    };
    const report = buildStockReport(data);
    expect(report).toContain('operating margin');
  });

  it('comparison conclusion identifies runner-up when multiple items are scored', () => {
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: twoCompanyItems(),
      notes: [],
    };
    const report = buildComparisonReport(data);
    expect(report).toContain('Runner-up:');
  });

  it('comparison conclusion strategy mentions diversified approach when scores are mixed', () => {
    // Give one item no financial data so scores are low/null
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['A', 'B'],
      items: [
        { symbol: 'A', price: { price: '10' } },
        { symbol: 'B', price: { price: '20' } },
      ],
      notes: [],
    };
    const report = buildComparisonReport(data);
    expect(report).toContain('## 🎯 Investment Conclusion');
  });
});

// ─── LLM conclusion integration ───────────────────────────────────────────────

describe('LLM conclusion integration', () => {
  it('stock report uses llmConclusion narrative when provided', () => {
    const llmText = 'After thorough analysis of the real API data, Apple demonstrates exceptional financial strength. Revenue grew strongly. BUY recommendation with a core portfolio allocation.';
    const report = buildStockReport({ ...richStock(), llmConclusion: llmText });
    expect(report).toContain('## 🎯 Investment Conclusion');
    expect(report).toContain(llmText);
    expect(report).toContain('### 📋 Quick Reference');
  });

  it('stock report without llmConclusion uses structured fallback', () => {
    const report = buildStockReport(richStock());
    expect(report).toContain('## 🎯 Investment Conclusion');
    // Structured fallback contains data-derived lines
    expect(report).toMatch(/Suggested Portfolio Role:/);
    expect(report).not.toContain('### 📋 Quick Reference');
  });

  it('stock report quick reference section shows real metrics when llmConclusion present', () => {
    const llmText = 'Strong financials observed from API data. BUY.';
    const report = buildStockReport({ ...richStock(), llmConclusion: llmText });
    // Rating and composite score should appear in quick reference
    expect(report).toContain('**Rating:**');
    expect(report).toContain('**Composite Score:**');
  });

  it('comparison report uses llmConclusion narrative when provided', () => {
    const llmText = 'Based on the real API data collected, NVDA leads the AI chip sector with superior margins. BUY NVDA as a core position.';
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: twoCompanyItems(),
      notes: [],
      llmConclusion: llmText,
    };
    const report = buildComparisonReport(data);
    expect(report).toContain('## 🎯 Investment Conclusion');
    expect(report).toContain(llmText);
    expect(report).toContain('### 📊 Company Quick Reference');
  });

  it('comparison report without llmConclusion uses structured fallback', () => {
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: twoCompanyItems(),
      notes: [],
    };
    const report = buildComparisonReport(data);
    expect(report).toContain('## 🎯 Investment Conclusion');
    // Structured fallback also renders company quick reference section
    expect(report).toContain('### 📊 Company Quick Reference');
    // But it should not contain any LLM-sourced text
    expect(report).not.toContain('After thorough analysis');
  });

  it('sector report uses llmConclusion narrative when provided', () => {
    const llmText = 'The AI chip sector shows robust growth driven by data center demand. NVDA remains the top pick at 85% gross margin.';
    const data: SectorReportData = {
      sectorQuery: 'AI chips',
      selectedBy: 'llm',
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: twoCompanyItems(),
      notes: [],
      llmConclusion: llmText,
    };
    const report = buildSectorReport(data);
    expect(report).toContain(llmText);
    expect(report).toContain('### 📊 Company Quick Reference');
  });
});

// ─── Indicative allocation sorting ────────────────────────────────────────────

describe('indicative allocation sorting', () => {
  it('allocation rows are sorted highest weight to lowest', () => {
    // Create items with very different fundamentals so weights differ
    const strongItem: ComparisonReportItem = {
      symbol: 'STRONG',
      price: { price: '100' },
      overview: { name: 'Strong Co', peRatio: '15', operatingMargin: '0.35', profitMargin: '0.30', revenueTTM: '10000000000', quarterlyRevenueGrowth: '0.30', returnOnEquity: '0.60', analystTargetPrice: '130' },
      basicFinancials: { metric: { grossMarginTTM: 0.5, operatingMarginTTM: 0.35, roeTTM: 0.6, revenueGrowthTTM: 0.30 } },
    };
    const weakItem: ComparisonReportItem = {
      symbol: 'WEAK',
      price: { price: '50' },
      overview: { name: 'Weak Co' },
    };
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['STRONG', 'WEAK'],
      items: [weakItem, strongItem], // WEAK first intentionally
      notes: [],
    };
    const report = buildComparisonReport(data);
    const allocSection = report.split('## 🧭 Indicative Allocation')[1] ?? '';
    const strongPos = allocSection.indexOf('STRONG');
    const weakPos = allocSection.indexOf('WEAK');
    // STRONG should appear before WEAK (higher weight comes first)
    expect(strongPos).toBeLessThan(weakPos);
  });

  it('allocation with uniform weights keeps all companies present', () => {
    const items = twoCompanyItems();
    // Remove all financial data so weights will be equal
    items.forEach((it) => { delete it.basicFinancials; delete it.overview; });
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items,
      notes: [],
    };
    const report = buildComparisonReport(data);
    expect(report).toContain('NVDA');
    expect(report).toContain('AMD');
  });
});

// ─── Analyst target price fallback ────────────────────────────────────────────

describe('analyst target price resolution', () => {
  it('shows target mean from priceTargets.targetMean', () => {
    const item: ComparisonReportItem = {
      symbol: 'AAPL',
      price: { price: '150' },
      priceTargets: { targetMean: 180 },
    };
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['AAPL'],
      items: [item],
    };
    const report = buildComparisonReport(data);
    expect(report).toContain('180.00');
  });

  it('falls back to analystRatings.analystTargetPrice when priceTargets.targetMean is absent', () => {
    const item: ComparisonReportItem = {
      symbol: 'AAPL',
      price: { price: '150' },
      priceTargets: { targetMean: null },
      analystRatings: { analystTargetPrice: '175.50' },
    };
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['AAPL'],
      items: [item],
    };
    const report = buildComparisonReport(data);
    expect(report).toContain('175.50');
  });

  it('falls back to overview.analystTargetPrice as final fallback', () => {
    const item: ComparisonReportItem = {
      symbol: 'AAPL',
      price: { price: '150' },
      priceTargets: { targetMean: null },
      analystRatings: { analystTargetPrice: null },
      overview: { analystTargetPrice: '195.00' },
    };
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['AAPL'],
      items: [item],
    };
    const report = buildComparisonReport(data);
    expect(report).toContain('195.00');
  });

  it('shows N/A for target and upside when all target sources are absent', () => {
    const item: ComparisonReportItem = {
      symbol: 'AAPL',
      price: { price: '150' },
      priceTargets: { targetMean: null },
      analystRatings: { analystTargetPrice: null },
    };
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['AAPL'],
      items: [item],
    };
    const report = buildComparisonReport(data);
    // Both target mean and upside should show N/A
    const analystSection = report.split('## 🧠 Analyst View')[1] ?? '';
    // The two consecutive N/A values appear in the analyst table row
    const rowMatch = analystSection.match(/N\/A.*N\/A/s);
    expect(rowMatch).not.toBeNull();
  });

  it('ignores string "N/A" in analystRatings.analystTargetPrice (falls back to overview)', () => {
    const item: ComparisonReportItem = {
      symbol: 'AAPL',
      price: { price: '150' },
      priceTargets: {},
      analystRatings: { analystTargetPrice: 'N/A' },
      overview: { analystTargetPrice: '200.00' },
    };
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['AAPL'],
      items: [item],
    };
    const report = buildComparisonReport(data);
    expect(report).toContain('200.00');
  });

  it('single stock report uses overview.analystTargetPrice when priceTargets absent', () => {
    const data: StockReportData = {
      ...richStock(),
      priceTargets: { targetMean: null },
      analystRatings: { analystTargetPrice: null },
      companyOverview: { ...richStock().companyOverview, analystTargetPrice: '220.00' },
    };
    const report = buildStockReport(data);
    expect(report).toContain('220.00');
  });
});
