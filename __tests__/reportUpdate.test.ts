import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import {
  appendReportMetadata,
  buildReportRunMetadata,
  extractReportMetadata,
  mergeWithPreviousReportField,
  stripReportMetadata,
} from '../web/app/lib/reportUpdate';

describe('reportUpdate metadata', () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.REPORTS_DIR;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('embeds and extracts hidden report run metadata without changing visible markdown', () => {
    const metadata = buildReportRunMetadata({
      kind: 'stock',
      query: 'ARM',
      symbols: ['ARM'],
      range: '5y',
      generatedAt: '2026-05-23T12:00:00.000Z',
      coverage: [
        { symbol: 'ARM', key: 'price', label: 'Price', data: { price: 100 }, priority: 'critical' },
        { symbol: 'ARM', key: 'cashFlow', label: 'Cash flow', data: undefined, priority: 'high' },
      ],
    });

    const content = '# ARM Comprehensive Equity Research Report\n\nVisible body.';
    const withMetadata = appendReportMetadata(content, metadata);

    expect(stripReportMetadata(withMetadata)).toBe(content);
    expect(extractReportMetadata(withMetadata)).toMatchObject({
      kind: 'stock',
      symbols: ['ARM'],
      checkpoint: {
        ARM: {
          price: {
            status: 'available',
            data: { price: 100 },
          },
          cashFlow: {
            status: 'missing',
          },
        },
      },
      missingData: [{ symbol: 'ARM', key: 'cashFlow', label: 'Cash flow', priority: 'high' }],
    });
  });

  it('carries forward a prior verified field when an update cannot replace it', () => {
    const metadata = buildReportRunMetadata({
      kind: 'stock',
      query: 'ARM',
      symbols: ['ARM'],
      range: '5y',
      generatedAt: '2026-05-23T12:00:00.000Z',
      coverage: [
        {
          symbol: 'ARM',
          key: 'cashFlow',
          label: 'Cash flow',
          data: { annualReports: [{ fiscalDateEnding: '2025-03-31', operatingCashflow: '1000' }] },
          priority: 'high',
        },
      ],
    });
    const notes: string[] = [];

    const result = mergeWithPreviousReportField({
      previous: { content: '', metadata, score: 100 },
      symbol: 'ARM',
      key: 'cashFlow',
      label: 'Cash flow',
      data: undefined,
      notes,
    });

    expect(result.carriedForward).toBe(true);
    expect(result.data).toEqual({ annualReports: [{ fiscalDateEnding: '2025-03-31', operatingCashflow: '1000' }] });
    expect(notes[0]).toContain('ARM: Cash flow was unavailable in this update; carried forward');
  });

  it('fills only missing nested fields from the prior checkpoint', () => {
    const metadata = buildReportRunMetadata({
      kind: 'stock',
      query: 'ARM',
      symbols: ['ARM'],
      generatedAt: '2026-05-23T12:00:00.000Z',
      coverage: [
        {
          symbol: 'ARM',
          key: 'basicFinancials',
          label: 'Basic financials',
          data: { metric: { peBasicExclExtraTTM: 44, grossMarginTTM: 0.95 } },
          priority: 'critical',
        },
      ],
    });
    const notes: string[] = [];

    const result = mergeWithPreviousReportField({
      previous: { content: '', metadata, score: 100 },
      symbol: 'ARM',
      key: 'basicFinancials',
      label: 'Basic financials',
      data: { metric: { peBasicExclExtraTTM: 40 } },
      notes,
    });

    expect(result.carriedForward).toBe(true);
    expect(result.data).toEqual({ metric: { peBasicExclExtraTTM: 40, grossMarginTTM: 0.95 } });
    expect(notes[0]).toContain('had missing fields in this update');
  });

  it('keeps fresh update data when providers return a meaningful replacement', () => {
    const metadata = buildReportRunMetadata({
      kind: 'stock',
      query: 'ARM',
      symbols: ['ARM'],
      generatedAt: '2026-05-23T12:00:00.000Z',
      coverage: [
        { symbol: 'ARM', key: 'price', label: 'Price', data: { price: 100 }, priority: 'critical' },
      ],
    });
    const notes: string[] = [];

    const result = mergeWithPreviousReportField({
      previous: { content: '', metadata, score: 100 },
      symbol: 'ARM',
      key: 'price',
      label: 'Price',
      data: { price: 101 },
      notes,
    });

    expect(result.carriedForward).toBe(false);
    expect(result.data).toEqual({ price: 101 });
    expect(notes).toEqual([]);
  });

  it('finds the best prior filesystem report for an update request', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'report-update-'));
    process.env.REPORTS_DIR = tmpDir;
    vi.resetModules();
    const { saveReport } = await import('../web/app/lib/reportGenerator');
    const { buildReportRunMetadata, findPreviousReportForUpdate } = await import('../web/app/lib/reportUpdate');

    const metadata = buildReportRunMetadata({
      kind: 'comparison',
      query: 'Nvidia and Arm',
      symbols: ['NVDA', 'ARM'],
      range: '1y',
      generatedAt: '2026-05-23T12:00:00.000Z',
      coverage: [
        { symbol: 'NVDA', key: 'price', label: 'Price', data: { price: 100 }, priority: 'critical' },
        { symbol: 'ARM', key: 'incomeStatement', label: 'Income statement', data: null, priority: 'high' },
      ],
    });
    await saveReport('# Company Comparison Report\n\nUniverse: NVDA, ARM', 'nvda-arm-comparison-report', undefined, {
      reportKind: 'comparison',
      summary: 'Nvidia and Arm comparison',
      runMetadata: metadata,
    });

    const match = await findPreviousReportForUpdate({
      kind: 'comparison',
      query: 'update comparison report of Nvidia and Arm',
      symbols: ['NVDA', 'ARM'],
    });

    expect(match?.metadata?.kind).toBe('comparison');
    expect(match?.metadata?.missingData).toEqual([
      { symbol: 'ARM', key: 'incomeStatement', label: 'Income statement', priority: 'high' },
    ]);
  });

  it('matches a prior watchlist report from visible report text when metadata is sparse', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'report-update-watchlist-'));
    process.env.REPORTS_DIR = tmpDir;
    vi.resetModules();
    const { saveReport } = await import('../web/app/lib/reportGenerator');
    const { findPreviousReportForUpdate } = await import('../web/app/lib/reportUpdate');

    await saveReport(
      '# Watchlist Daily Report: Core Watchlist\n\nGenerated: 2026-05-23T12:00:00.000Z\n\n**Companies covered:** 15',
      'core-watchlist-daily-report'
    );

    const match = await findPreviousReportForUpdate({
      kind: 'watchlist-daily',
      query: 'Update daily watchlist report',
      symbols: ['NVDA', 'ARM', 'TSM'],
    });

    expect(match?.filename).toContain('core-watchlist-daily-report');
  });
});
