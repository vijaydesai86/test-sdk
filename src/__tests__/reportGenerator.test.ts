import { describe, it, expect } from 'vitest';
import { buildStockReport, buildSectorReport, saveReport } from '../reportGenerator';
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
  });

  it('saves report to disk', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reports-'));
    const saved = await saveReport('hello', 'test-report', tempDir);
    const content = await fs.readFile(saved.filePath, 'utf8');

    expect(content).toBe('hello');
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
  });
});
