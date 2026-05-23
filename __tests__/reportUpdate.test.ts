import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import {
  appendReportMetadata,
  buildReportRunMetadata,
  extractReportMetadata,
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
      missingData: [{ symbol: 'ARM', key: 'cashFlow', label: 'Cash flow', priority: 'high' }],
    });
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
});
