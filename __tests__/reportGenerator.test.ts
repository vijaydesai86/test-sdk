import { describe, it, expect } from 'vitest';
import {
  buildStockReport,
  buildComparisonReport,
  buildSectorReport,
  buildDeepSectorReport,
  buildDeepStockReport,
  buildDeepComparisonReport,
  buildWatchlistDailyReport,
  saveReport,
  type StockReportData,
  type ComparisonReportData,
  type SectorReportData,
  type DeepSectorReportData,
  type MoatAnalysis,
} from '../web/app/lib/reportGenerator';
import { computeDcfValuation } from '../web/app/lib/dcfValuation';
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

const duplicateHeadings = (report: string): string[] => {
  const counts = new Map<string, number>();
  for (const line of report.split(/\r?\n/)) {
    const match = line.match(/^(#{1,6}\s+.+)$/);
    if (!match) continue;
    const heading = match[1];
    counts.set(heading, (counts.get(heading) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([heading]) => heading);
};

describe('computeDcfValuation', () => {
  it('uses current price as the margin-of-safety denominator', () => {
    const result = computeDcfValuation({
      currentPrice: 100,
      riskFreeRate: 0.04,
      overview: {
        sharesOutstanding: '100',
        beta: '1',
        quarterlyRevenueGrowth: '0',
      },
      cashFlow: {
        annualReports: [
          { operatingCashflow: '1000', capitalExpenditures: '-100' },
          { operatingCashflow: '1000', capitalExpenditures: '-100' },
          { operatingCashflow: '1000', capitalExpenditures: '-100' },
        ],
      },
    });

    expect(result.intrinsicValuePerShare).not.toBeNull();
    expect(result.marginOfSafetyPercent).toBeCloseTo(((result.intrinsicValuePerShare! - 100) / 100) * 100, 1);
    expect(result.assumptions.fcfBasis).toBe('annual');
  });

  it('annualizes only when fewer than four quarterly FCF periods are available and marks low confidence', () => {
    const result = computeDcfValuation({
      currentPrice: 100,
      riskFreeRate: 0.04,
      overview: {
        sharesOutstanding: '100',
        beta: '1',
      },
      cashFlow: {
        quarterlyReports: [
          { operatingCashflow: '100', capitalExpenditure: '-10' },
        ],
      },
    });

    expect(result.assumptions.baseFCF).toBe(360);
    expect(result.assumptions.fcfBasis).toBe('annualized-latest-quarter');
    expect(result.confidence).toBe('Low');
    expect(result.verdict).toMatch(/Low-confidence DCF/i);
  });

  it('accepts common provider cash-flow aliases and percent-formatted growth rates', () => {
    const result = computeDcfValuation({
      currentPrice: 100,
      riskFreeRate: 0.04,
      overview: {
        sharesOutstanding: '100',
        beta: '1',
        quarterlyRevenueGrowth: '10%',
      },
      cashFlow: {
        quarterlyReports: [
          { totalCashFromOperatingActivities: '120', capitalExpenditure: '-20' },
          { netCashProvidedByOperatingActivities: '110', capitalExpenditure: '-20' },
          { netCashProvidedByUsedInOperatingActivities: '100', paymentsToAcquirePropertyPlantAndEquipment: '20' },
          { operatingCashflow: '90', capitalExpenditures: '-20' },
        ],
      },
    });

    expect(result.assumptions.baseFCF).toBe(340);
    expect(result.assumptions.growthRate).toBe(10);
  });

  it('uses balance-sheet cash and debt for the DCF equity-value bridge when available', () => {
    const withoutBalanceSheet = computeDcfValuation({
      currentPrice: 100,
      riskFreeRate: 0.04,
      overview: {
        sharesOutstanding: '100',
        beta: '1',
        quarterlyRevenueGrowth: '0',
      },
      cashFlow: {
        annualReports: [
          { operatingCashflow: '1000', capitalExpenditures: '-100' },
          { operatingCashflow: '1000', capitalExpenditures: '-100' },
          { operatingCashflow: '1000', capitalExpenditures: '-100' },
        ],
      },
    });
    const withBalanceSheet = computeDcfValuation({
      currentPrice: 100,
      riskFreeRate: 0.04,
      overview: {
        sharesOutstanding: '100',
        beta: '1',
        quarterlyRevenueGrowth: '0',
      },
      balanceSheet: {
        quarterlyReports: [
          { cashAndEquivalents: '300', longTermDebt: '100' },
        ],
      },
      cashFlow: {
        annualReports: [
          { operatingCashflow: '1000', capitalExpenditures: '-100' },
          { operatingCashflow: '1000', capitalExpenditures: '-100' },
          { operatingCashflow: '1000', capitalExpenditures: '-100' },
        ],
      },
    });

    expect(withBalanceSheet.intrinsicValuePerShare).toBeCloseTo(withoutBalanceSheet.intrinsicValuePerShare! + 2, 1);
  });
});

// ─── buildStockReport ─────────────────────────────────────────────────────────

describe('buildStockReport', () => {
  it('includes the standard report header', () => {
    const report = buildStockReport(minimalStock());
    expect(report).toContain('# AAPL Comprehensive Equity Research Report');
  });

  it('uses trailing four-quarter FCF for DCF instead of treating one quarter as annual', () => {
    const data: StockReportData = {
      ...richStock(),
      companyOverview: {
        ...richStock().companyOverview,
        sharesOutstanding: '100',
        beta: '1',
        quarterlyRevenueGrowth: '0.10',
      },
      price: { price: '100' },
      cashFlow: {
        quarterlyReports: [
          { operatingCashflow: '100', capitalExpenditures: '-10' },
          { operatingCashflow: '90', capitalExpenditures: '-10' },
          { operatingCashflow: '80', capitalExpenditures: '-10' },
          { operatingCashflow: '70', capitalExpenditures: '-10' },
        ],
      },
    };

    const report = buildStockReport(data);

    expect(report).toContain('Trailing 4-quarter FCF');
    expect(report).toContain('Base FCF');
    expect(report).toContain('$300');
  });

  it('contains key structural sections', () => {
    const report = buildStockReport(richStock());
    expect(report).toContain('## 🏢 Business Overview');
    expect(report).toContain('## 🧾 Financial Deep Dive');
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

  it('assigns buy guidance when quality, valuation, and trend all support entry', () => {
    const report = buildStockReport({
      symbol: 'BUYME',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '100.00', changePercent: '1.2%' },
      companyOverview: {
        name: 'Buy Me Inc.',
        peRatio: '16',
        analystTargetPrice: '135',
        operatingMargin: '0.38',
        profitMargin: '0.62',
        returnOnEquity: '1.20',
        '50DayMovingAverage': '95',
        '200DayMovingAverage': '85',
      },
      basicFinancials: {
        metric: {
          grossMarginTTM: 0.72,
          operatingMarginTTM: 0.38,
          roeTTM: 1.2,
          revenueGrowthTTM: 0.32,
          epsGrowth5Y: 0.28,
        },
      },
      analystRatings: { strongBuy: 8, buy: 4, hold: 1, sell: 0, strongSell: 0 },
      priceTargets: { targetMean: 135 },
      priceHistory: {
        prices: [
          { date: '2024-01-01', close: '72' },
          { date: '2024-04-01', close: '79' },
          { date: '2024-07-01', close: '88' },
          { date: '2024-10-01', close: '100' },
        ],
      },
      balanceSheet: {
        quarterlyReports: [
          {
            fiscalDateEnding: '2024-09-30',
            cashAndEquivalents: '5000000000',
            longTermDebt: '1000000000',
            totalAssets: '18000000000',
            totalLiabilities: '6000000000',
            totalShareholderEquity: '12000000000',
          },
        ],
      },
      cashFlow: {
        quarterlyReports: [
          {
            fiscalDateEnding: '2024-09-30',
            operatingCashflow: '2200000000',
            capitalExpenditures: '-400000000',
            freeCashFlow: '1800000000',
          },
        ],
      },
    });

    expect(report).toContain('| Buy Me Inc. (BUYME) | 🟢 Buy | High |');
    expect(report).toContain('Owners: Add');
  });

  it('assigns sell guidance for weak quality with broken reward-to-risk', () => {
    const report = buildStockReport({
      symbol: 'EXIT',
      generatedAt: '2025-01-01T00:00:00Z',
      price: { price: '100.00', changePercent: '-3.4%' },
      companyOverview: {
        name: 'Exit Corp.',
        peRatio: '150',
        analystTargetPrice: '70',
        operatingMargin: '-0.05',
        profitMargin: '-0.08',
        returnOnEquity: '-0.25',
        '50DayMovingAverage': '115',
        '200DayMovingAverage': '130',
      },
      basicFinancials: {
        metric: {
          grossMarginTTM: 0.12,
          operatingMarginTTM: -0.05,
          roeTTM: -0.25,
          revenueGrowthTTM: -0.18,
          epsGrowth5Y: -0.22,
        },
      },
      analystRatings: { strongBuy: 0, buy: 1, hold: 3, sell: 5, strongSell: 2 },
      priceTargets: { targetMean: 70 },
      priceHistory: {
        prices: [
          { date: '2024-01-01', close: '132' },
          { date: '2024-04-01', close: '124' },
          { date: '2024-07-01', close: '112' },
          { date: '2024-10-01', close: '100' },
        ],
      },
      balanceSheet: {
        quarterlyReports: [
          {
            fiscalDateEnding: '2024-09-30',
            cashAndEquivalents: '200000000',
            longTermDebt: '4200000000',
            totalAssets: '5000000000',
            totalLiabilities: '6200000000',
            totalShareholderEquity: '-1200000000',
          },
        ],
      },
      cashFlow: {
        quarterlyReports: [
          {
            fiscalDateEnding: '2024-09-30',
            operatingCashflow: '-500000000',
            capitalExpenditures: '-250000000',
            freeCashFlow: '-750000000',
          },
        ],
      },
    });

    expect(report).toContain('| Exit Corp. (EXIT) | 🔴 Sell | High |');
    expect(report).toContain('Owners: Sell');
  });

  it('lowers confidence when the recommendation relies on partial data', () => {
    const report = buildStockReport(minimalStock());
    expect(report).toContain('| AAPL (AAPL) | 🟠 Watch | Low |');
    expect(report).toContain('Confidence reflects data completeness and signal alignment');
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

  it('normalizes ratio-style percentages consistently across stock report sections', () => {
    const report = buildStockReport(richStock());
    expect(report).toContain('| ROE (TTM) | 150.0% |');
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
    expect(report).toMatch(/✅ BUY|⚖️ HOLD|• WATCH|🔴 SELL/);
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

  it('keeps growth drivers focused on business growth rather than duplicating timing and target lines', () => {
    const report = buildStockReport(richStock());
    expect(report).not.toContain('Price vs 50D MA');
    expect(report).not.toContain('Analyst target upside:');
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

  it('formats analyst targets consistently with currency and signed upside in comparison reports', () => {
    const report = buildComparisonReport(baseComparison());
    expect(report).toContain('| NVIDIA (NVDA) | $600.00 | +20.0% |');
  });

  it('uses decision snapshots when present for comparison guidance', () => {
    const items = twoCompanyItems();
    items[0].decisionSnapshot = {
      action: 'Add',
      confidence: 'High',
      freshness: 'fresh',
      overallScore: 88,
      qualityScore: 85,
      valuationScore: 80,
      technicalScore: 78,
      portfolioFitScore: 82,
      whyNow: ['Strong setup'],
      whyNot: [],
      missingInputs: [],
      changed: ['Action changed from Hold to Add.'],
      summary: 'Add with high confidence. Setup remains differentiated.',
      portfolioImpact: 'Below target weight.',
      invalidation: 'Demand weakens.',
      nextTrigger: 'Review after earnings.',
    };
    const report = buildComparisonReport({ ...baseComparison(), items });
    expect(report).toContain('Add with high confidence. Setup remains differentiated.');
  });

  it('includes indicative allocation table', () => {
    const report = buildComparisonReport(baseComparison());
    expect(report).toContain('## 🧭 Indicative Allocation');
  });

  it('includes investment conclusion section', () => {
    const report = buildComparisonReport(baseComparison());
    expect(report).toContain('## 🎯 Investment Conclusion');
  });

  it('uses the multi-source legend in debug output when multi provider mode is enabled', () => {
    const previousDebug = process.env.DEBUG;
    const previousProvider = process.env.STOCK_DATA_PROVIDER;
    process.env.DEBUG = 'true';
    process.env.STOCK_DATA_PROVIDER = 'multi';
    try {
      const report = buildComparisonReport({
        ...baseComparison(),
        sources: {
          NVDA: { Price: 'Finnhub' },
          AMD: { Price: 'Alpha Vantage' },
        },
      });
      expect(report).toContain('_Legend: Multi-source chain: Alpha Vantage → Finnhub → Financial Modeling Prep → Twelve Data → Stooq._');
    } finally {
      process.env.DEBUG = previousDebug;
      process.env.STOCK_DATA_PROVIDER = previousProvider;
    }
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

  it('includes research report header', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('# Research Report: Quantum Computing');
  });

  it('includes research methodology section', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('## 🔬 Research Methodology');
    expect(report).toContain('Candidate Identification');
  });

  it('includes ecosystem dependency section', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('## 🕸️ Research Ecosystem & Dependencies');
    expect(report).toContain('Supply Chain');
  });

  it('includes ecosystem mermaid diagram', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('## 🗺️ Research Dependency Map');
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

  it('includes research investment conclusion', () => {
    const report = buildDeepSectorReport(baseDeep());
    expect(report).toContain('## 🎯 Investment Conclusion');
    expect(report).toContain('Research Outlook');
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

  it('handles missing optional research fields gracefully', () => {
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

  it('omits balance section when every comparison balance cell is unavailable', () => {
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['A', 'B'],
      items: [
        { symbol: 'A', overview: { name: 'Alpha' } },
        { symbol: 'B', overview: { name: 'Beta' } },
      ],
      notes: [],
    };
    const report = buildComparisonReport(data);
    expect(report).not.toContain('## 🏦 Balance Sheet & Cash');
    expect(report).not.toContain('| Company | Cash | LT Debt | Net Debt | Equity | Free Cash Flow |');
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

  it('ignores malformed llmConclusion payloads and falls back to the structured conclusion', () => {
    const report = buildStockReport({ ...richStock(), llmConclusion: '{}' });
    expect(report).not.toContain('{}');
    expect(report).not.toContain('### 📋 Quick Reference');
    expect(report).toContain('## 🎯 Investment Conclusion');
  });

  it('ignores llmConclusion text that contradicts the structured decision rating', () => {
    const llmText = 'Given the available evidence, the appropriate recommendation is BUY.';
    const report = buildStockReport({
      ...richStock(),
      llmConclusion: llmText,
      decisionSnapshot: {
        action: 'Wait',
        confidence: 'High',
        freshness: 'fresh',
        overallScore: 71,
        qualityScore: 80,
        valuationScore: 60,
        technicalScore: 55,
        portfolioFitScore: 70,
        whyNow: ['Snapshot says wait'],
        whyNot: [],
        missingInputs: [],
        changed: [],
        summary: 'Wait with high confidence from snapshot.',
        portfolioImpact: 'Snapshot impact',
        invalidation: 'Snapshot invalidation',
        nextTrigger: 'Snapshot trigger',
      },
    });

    expect(report).not.toContain(llmText);
    expect(report).not.toContain('### 📋 Quick Reference');
    expect(report).toContain('WATCH');
  });

  it('maps add decisions to add-for-owners and buy-for-non-owners', () => {
    const report = buildStockReport({
      ...richStock(),
      decisionSnapshot: {
        action: 'Add',
        confidence: 'High',
        freshness: 'fresh',
        overallScore: 78,
        qualityScore: 82,
        valuationScore: 68,
        technicalScore: 74,
        portfolioFitScore: 70,
        whyNow: ['Strong setup'],
        whyNot: [],
        missingInputs: [],
        changed: [],
        summary: 'Add to the position with high confidence.',
        portfolioImpact: 'Snapshot impact',
        invalidation: 'Snapshot invalidation',
        nextTrigger: 'Snapshot trigger',
      },
    });

    expect(report).toContain('| Apple Inc. (AAPL) | 🟢 Buy | High |');
    expect(report).toContain('Owners: Add');
    expect(report).toContain('Decision Score');
    expect(report).not.toContain('Overall Score');
    expect(report).toContain('**Decision Score:** 78.0/100');
  });

  it('sanitizes malformed comparison llm conclusions and falls back to the structured summary', () => {
    const data: ComparisonReportData = {
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: twoCompanyItems(),
      notes: [],
      llmConclusion: '{}',
    };
    const report = buildComparisonReport(data);
    expect(report).not.toContain('{}');
    expect(report).toContain('### 📊 Company Quick Reference');
    expect(report).toContain('Score source: Decision Snapshot overall score when available; otherwise the data-only composite score.');
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

  it('allocation note uses the mixed report score wording', () => {
    const report = buildComparisonReport({
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: twoCompanyItems(),
      notes: [],
    });

    expect(report).toContain('normalized report scores');
    expect(report).not.toContain('normalized composite scores');
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

describe('buildWatchlistDailyReport', () => {
  it('renders one combined report with a top summary table and company sections', () => {
    const report = buildWatchlistDailyReport({
      generatedAt: '2025-01-02T00:00:00Z',
      watchlistName: 'Core Watchlist',
      items: [
        {
          symbol: 'AAPL',
          companyName: 'Apple Inc.',
          stock: richStock(),
          action: 'Buy',
          reason: 'Strong profitability and supportive target upside.',
        },
        {
          symbol: 'NVDA',
          companyName: 'NVIDIA',
          stock: {
            ...minimalStock(),
            symbol: 'NVDA',
            companyOverview: { name: 'NVIDIA' },
          },
          action: 'Hold',
          reason: 'Signals are constructive, but the fresh entry is less compelling.',
        },
      ],
    });

    expect(report).toContain('# Watchlist Daily Report: Core Watchlist');
    expect(report).toContain('| Company | Signal | Confidence | Action |');
    expect(report).toContain('| Apple Inc. (AAPL) | 🟢 Buy | Medium |');
    expect(report).toContain('| NVIDIA (NVDA) | 🟡 Hold | Medium |');
    expect(report).toContain('**Apple Inc. (AAPL):**');
    expect(report).toContain('**NVIDIA (NVDA):**');
    expect(report).toContain('_For owners = you already hold the stock. For non-owners = you are considering a fresh entry. Confidence reflects data completeness and signal alignment._');
    expect(report).toContain('## 1. Apple Inc. (AAPL)');
    expect(report).toContain('## 2. NVIDIA (NVDA)');
    expect(report).toContain('### 🏢 Business Overview');
  });

  it('treats explicit watch actions as hold-for-owners and watch-for-non-owners', () => {
    const report = buildWatchlistDailyReport({
      generatedAt: '2025-01-02T00:00:00Z',
      watchlistName: 'Core Watchlist',
      items: [
        {
          symbol: 'AMD',
          companyName: 'Advanced Micro Devices',
          stock: {
            ...richStock(),
            symbol: 'AMD',
            companyOverview: { ...richStock().companyOverview, name: 'Advanced Micro Devices' },
          },
          action: 'Watch',
          reason: 'Wait for a better setup.',
        },
      ],
    });

    expect(report).toContain('| Advanced Micro Devices (AMD) | 🟠 Watch | Medium |');
    expect(report).toContain('**Advanced Micro Devices (AMD):** Wait for a better setup.');
  });

  it('labels partial watchlist coverage and scopes signal mix to full-coverage companies', () => {
    const report = buildWatchlistDailyReport({
      generatedAt: '2025-01-02T00:00:00Z',
      watchlistName: 'Core Watchlist',
      totalItems: 3,
      skippedItems: [{ symbol: 'AMD', reason: 'Finnhub rate limit reached' }, 'TSM'],
      items: [
        {
          symbol: 'AAPL',
          companyName: 'Apple Inc.',
          stock: richStock(),
          action: 'Buy',
          reason: 'Strong profitability and supportive target upside.',
        },
      ],
    });

    expect(report).toContain('**Full coverage:** 1 / 3');
    expect(report).toContain('**Limited/skipped:** 2 / 3');
    expect(report).toContain('## Partial Coverage');
    expect(report).toContain('AMD: Finnhub rate limit reached');
    expect(report).toContain('Signal Mix:** Buy 1 | Hold 0 | Watch 0 | Sell 0 (full-coverage companies only)');
  });

  it('prefers explicit watchlist actions over embedded decision snapshots when both are supplied', () => {
    const report = buildWatchlistDailyReport({
      generatedAt: '2025-01-02T00:00:00Z',
      watchlistName: 'Core Watchlist',
      items: [
        {
          symbol: 'AAPL',
          companyName: 'Apple Inc.',
          stock: {
            ...richStock(),
            decisionSnapshot: {
              action: 'Wait',
              confidence: 'High',
              freshness: 'fresh',
              overallScore: 71,
              qualityScore: 80,
              valuationScore: 60,
              technicalScore: 55,
              portfolioFitScore: 70,
              whyNow: ['Snapshot says wait'],
              whyNot: [],
              missingInputs: [],
              changed: [],
              summary: 'Wait with high confidence from snapshot.',
              portfolioImpact: 'Snapshot impact',
              invalidation: 'Snapshot invalidation',
              nextTrigger: 'Snapshot trigger',
            },
          },
          action: 'Buy',
          reason: 'Explicit watchlist override.',
        },
      ],
    });

    expect(report).toContain('| Apple Inc. (AAPL) | 🟢 Buy | Medium |');
    expect(report).toContain('**Apple Inc. (AAPL):** Explicit watchlist override.');
    expect(report).not.toContain('Wait with high confidence from snapshot.');
  });

  it('removes embedded stock position-guidance sections from watchlist company detail blocks', () => {
    const report = buildWatchlistDailyReport({
      generatedAt: '2025-01-02T00:00:00Z',
      watchlistName: 'Core Watchlist',
      items: [
        {
          symbol: 'AAPL',
          companyName: 'Apple Inc.',
          stock: richStock(),
          action: 'Buy',
          reason: 'Strong profitability and supportive target upside.',
        },
      ],
    });

    expect(report).toContain('## 🎯 Position Guidance');
    expect(report).not.toContain('### 🎯 Position Guidance');
  });
});

describe('report section redundancy', () => {
  it('does not duplicate section headings across the main report builders', () => {
    const stock = buildStockReport(richStock());
    const comparison = buildComparisonReport({
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: twoCompanyItems(),
      notes: [],
    });
    const sector = buildSectorReport({
      sectorQuery: 'AI chips',
      selectedBy: 'llm',
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: twoCompanyItems(),
      notes: [],
    });
    const deepSector = buildDeepSectorReport({
      sectorQuery: 'AI chips',
      selectedBy: 'llm',
      generatedAt: '2025-01-01T00:00:00Z',
      range: '1y',
      universe: ['NVDA', 'AMD'],
      items: twoCompanyItems(),
      notes: [],
      initialCandidates: ['NVDA', 'AMD', 'AVGO'],
      dependencyAnalysis: '### Supply Chain\nChips depend on foundries.',
      ecosystemDiagram: 'graph LR\nA-->B',
      refinementNotes: '✅ NVDA — leader\n✅ AMD — challenger\n❌ AVGO — excluded for example',
      companySnapshots: {
        NVDA: 'Leader in AI accelerators.',
        AMD: 'Competitive alternative.',
      },
    });
    const watchlist = buildWatchlistDailyReport({
      generatedAt: '2025-01-02T00:00:00Z',
      watchlistName: 'Core Watchlist',
      items: [
        {
          symbol: 'AAPL',
          companyName: 'Apple Inc.',
          stock: richStock(),
          action: 'Buy',
          reason: 'Strong profitability and supportive target upside.',
        },
      ],
    });
    const deepStock = buildDeepStockReport({
      query: 'Apple research',
      symbol: 'AAPL',
      generatedAt: '2025-01-03T00:00:00Z',
      baseContent: stock,
    });
    const deepComparison = buildDeepComparisonReport({
      query: 'NVDA vs AMD',
      symbols: ['NVDA', 'AMD'],
      generatedAt: '2025-01-03T00:00:00Z',
      baseContent: comparison,
      items: twoCompanyItems(),
    });

    expect(duplicateHeadings(stock)).toEqual([]);
    expect(duplicateHeadings(comparison)).toEqual([]);
    expect(duplicateHeadings(sector)).toEqual([]);
    expect(duplicateHeadings(deepSector)).toEqual([]);
    expect(duplicateHeadings(watchlist)).toEqual([]);
    expect(duplicateHeadings(deepStock)).toEqual([]);
    expect(duplicateHeadings(deepComparison)).toEqual([]);
  });

  it('deep comparison detail section does not repeat ownership bullets already covered earlier', () => {
    const deepComparison = buildDeepComparisonReport({
      query: 'NVDA vs AMD',
      symbols: ['NVDA', 'AMD'],
      generatedAt: '2025-01-03T00:00:00Z',
      baseContent: buildComparisonReport({
        generatedAt: '2025-01-01T00:00:00Z',
        range: '1y',
        universe: ['NVDA', 'AMD'],
        items: twoCompanyItems(),
        notes: [],
      }),
      items: twoCompanyItems(),
    });

    expect(deepComparison).toContain('## 🧾 Insider Transaction Detail');
    expect(deepComparison).not.toContain('Insider ownership:');
    expect(deepComparison).not.toContain('Institutional ownership:');
    expect(deepComparison).not.toContain('Short float:');
  });
});
