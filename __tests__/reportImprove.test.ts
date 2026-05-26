import { describe, expect, it } from 'vitest';
import {
  buildImproveToolRequest,
  compareImproveCandidate,
  coverageStats,
  decideImproveStatus,
  sameReportUniverse,
  parseImproveConfig,
  type SavedReportForImprove,
} from '../web/app/lib/reportImprove';
import { buildReportRunMetadata } from '../web/app/lib/reportUpdate';

function report(kind: SavedReportForImprove['reportKind'], metadata = buildReportRunMetadata({
  kind: kind || 'stock',
  query: 'ARM',
  symbols: ['ARM'],
  generatedAt: '2026-05-25T10:00:00.000Z',
  coverage: [],
})): SavedReportForImprove {
  return {
    id: 'report-id',
    filename: 'report.md',
    title: 'Report',
    summary: null,
    content: '# Report',
    storagePath: '2026-05-25/report.md',
    reportKind: kind,
    reportDate: '2026-05-25',
    createdAt: '2026-05-25T10:00:00.000Z',
    metadata,
  };
}

describe('reportImprove', () => {
  it('clamps improve pass configuration to safe bounds', () => {
    expect(parseImproveConfig({
      requestedPasses: 99,
      env: { REPORT_IMPROVE_MAX_PASSES: '5' },
    }).maxPasses).toBe(5);
    expect(parseImproveConfig({
      requestedPasses: 0,
      env: { REPORT_IMPROVE_DEFAULT_PASSES: '3', REPORT_IMPROVE_MAX_PASSES: '5' },
    }).maxPasses).toBe(1);
  });

  it('uses backend env defaults when the UI omits improve pass count', () => {
    expect(parseImproveConfig({
      env: { REPORT_IMPROVE_DEFAULT_PASSES: '7', REPORT_IMPROVE_MAX_PASSES: '10' },
    }).maxPasses).toBe(7);
    expect(parseImproveConfig({
      requestedPasses: 10,
      env: { REPORT_IMPROVE_DEFAULT_PASSES: '7', REPORT_IMPROVE_MAX_PASSES: '10' },
    }).maxPasses).toBe(10);
    expect(parseImproveConfig({
      env: { REPORT_IMPROVE_TARGET: 'all' },
    }).target).toBe('all');
  });

  it('computes critical coverage from report metadata', () => {
    const metadata = buildReportRunMetadata({
      kind: 'stock',
      query: 'ARM',
      symbols: ['ARM'],
      generatedAt: '2026-05-25T10:00:00.000Z',
      coverage: [
        { symbol: 'ARM', key: 'price', label: 'Price', data: { price: 100 }, priority: 'critical' },
        { symbol: 'ARM', key: 'cashFlow', label: 'Cash flow', data: undefined, priority: 'high' },
        { symbol: 'ARM', key: 'overview', label: 'Company overview', data: undefined, priority: 'critical' },
      ],
    });

    expect(coverageStats(metadata)).toEqual({
      total: 3,
      available: 1,
      missing: 2,
      criticalMissing: 1,
      coveragePct: 33,
    });
  });

  it('maps saved report metadata to the correct existing report tool', () => {
    const comparisonMetadata = buildReportRunMetadata({
      kind: 'comparison',
      query: 'Nvidia and Arm',
      symbols: ['NVDA', 'ARM'],
      range: '1y',
      generatedAt: '2026-05-25T10:00:00.000Z',
      coverage: [],
    });

    expect(buildImproveToolRequest(report('comparison', comparisonMetadata))).toMatchObject({
      toolName: 'generate_comparison_report',
      args: {
        updateMode: true,
        updateQuery: 'Nvidia and Arm',
        companies: ['NVDA', 'ARM'],
        range: '1y',
        updateSourceReport: {
          id: 'report-id',
          storagePath: '2026-05-25/report.md',
          metadata: comparisonMetadata,
        },
      },
    });
  });

  it('locks research improve passes to the saved report universe', () => {
    const metadata = buildReportRunMetadata({
      kind: 'research',
      query: 'AI infrastructure',
      symbols: ['NVDA', 'AMD', 'MSFT'],
      range: '1y',
      generatedAt: '2026-05-25T10:00:00.000Z',
      coverage: [],
    });

    expect(buildImproveToolRequest(report('research', metadata))).toMatchObject({
      toolName: 'generate_research_report',
      args: {
        updateMode: true,
        updateQuery: 'AI infrastructure',
        sector: 'AI infrastructure',
        count: 3,
        lockedSymbols: ['NVDA', 'AMD', 'MSFT'],
      },
    });
  });

  it('detects report universe changes after improve', () => {
    expect(sameReportUniverse(
      { symbols: ['NVDA', 'AMD', 'MSFT'] },
      { symbols: ['MSFT', 'NVDA', 'AMD'] }
    )).toBe(true);
    expect(sameReportUniverse(
      { symbols: ['NVDA', 'AMD', 'MSFT'] },
      { symbols: ['FIP', 'AIIA'] }
    )).toBe(false);
    expect(sameReportUniverse(
      { symbols: ['NVDA', 'AMD', 'MSFT'] },
      { symbols: [] }
    )).toBe(false);
  });

  it('continues through configured passes while useful gaps remain', () => {
    const config = { maxPasses: 3, target: 'critical' as const, minWaitMs: 60000 };

    expect(decideImproveStatus({
      before: { total: 4, available: 2, missing: 2, criticalMissing: 1, coveragePct: 50 },
      after: { total: 4, available: 3, missing: 1, criticalMissing: 1, coveragePct: 75 },
      passesDone: 1,
      config,
    })).toMatchObject({ status: 'continue', nextRunAfterMs: 60000 });

    expect(decideImproveStatus({
      before: { total: 4, available: 3, missing: 1, criticalMissing: 1, coveragePct: 75 },
      after: { total: 4, available: 3, missing: 1, criticalMissing: 1, coveragePct: 75 },
      passesDone: 2,
      config,
    })).toMatchObject({ status: 'continue', reason: 'coverage_flat_with_remaining_gaps' });

    expect(decideImproveStatus({
      before: { total: 4, available: 3, missing: 1, criticalMissing: 1, coveragePct: 75 },
      after: { total: 4, available: 3, missing: 1, criticalMissing: 1, coveragePct: 75 },
      passesDone: 3,
      config,
    })).toMatchObject({ status: 'stopped', reason: 'max_passes_reached' });
  });

  it('accepts only monotonic improve candidates', () => {
    const before = { total: 12, available: 8, missing: 4, criticalMissing: 2, coveragePct: 67 };

    expect(compareImproveCandidate(before, {
      total: 12,
      available: 9,
      missing: 3,
      criticalMissing: 1,
      coveragePct: 75,
    })).toEqual({ accepted: true, reason: 'candidate_improved_critical' });

    expect(compareImproveCandidate(before, {
      total: 12,
      available: 7,
      missing: 5,
      criticalMissing: 1,
      coveragePct: 58,
    })).toEqual({ accepted: false, reason: 'candidate_regressed_missing' });

    expect(compareImproveCandidate(before, before)).toEqual({
      accepted: false,
      reason: 'candidate_flat',
    });
  });
});
