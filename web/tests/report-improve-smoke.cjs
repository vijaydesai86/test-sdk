/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('assert/strict');
const path = require('path');
const { createJiti } = require('jiti');

const jiti = createJiti(__filename);
const {
  buildImproveToolRequest,
  compareImproveCandidateForReport,
  coverageStats,
  decideImproveStatus,
  shouldEnforceSameReportUniverse,
} = jiti(path.join(process.cwd(), 'app/lib/reportImprove.ts'));
const { buildReportRunMetadata } = jiti(path.join(process.cwd(), 'app/lib/reportUpdate.ts'));

function savedResearchReport(metadata) {
  return {
    id: 'report-id',
    filename: 'research.md',
    title: 'Research Report: AI infrastructure',
    summary: null,
    content: '# Research Report',
    storagePath: '2026-05-27/research.md',
    reportKind: 'research',
    reportDate: '2026-05-27',
    createdAt: '2026-05-27T10:00:00.000Z',
    metadata,
  };
}

function readiness(overrides = {}) {
  return {
    status: 'discovering',
    selectedCount: 2,
    targetCount: 15,
    targetLockCount: 12,
    targetPartialCount: 7,
    roleCount: 1,
    minRoleCount: 4,
    directEnablerShare: 1,
    broadShare: 0,
    coveredDimensions: ['compute'],
    missingDimensions: ['cloud', 'networking', 'power'],
    repairActions: ['Continue candidate discovery.'],
    canBuildFullReport: false,
    ...overrides,
  };
}

function researchMetadata(symbols, universeStatus, readinessOverride) {
  return buildReportRunMetadata({
    kind: 'research',
    query: 'AI infrastructure',
    symbols,
    range: '1y',
    generatedAt: '2026-05-27T10:00:00.000Z',
    coverage: [],
    researchUniverse: {
      status: universeStatus,
      selectedSymbols: symbols,
      qualifiedSymbols: symbols,
      candidates: [],
      readiness: readiness(readinessOverride),
    },
  });
}

function testPartialUnreadyResearchKeepsTargetCount() {
  const metadata = researchMetadata(['NVDA', 'TSM'], 'discovering', { targetCount: 15 });
  const request = buildImproveToolRequest(savedResearchReport(metadata));
  assert.equal(request.toolName, 'generate_research_report');
  assert.equal(request.args.count, 15);
  assert.deepEqual(request.args.lockedSymbols, ['NVDA', 'TSM']);
  assert.equal(shouldEnforceSameReportUniverse(metadata), false);
}

function testFlatUnreadyCheckpointIsAcceptedButWorseOneIsRejected() {
  const before = researchMetadata(['NVDA'], 'discovering', {});
  const flat = researchMetadata(['NVDA'], 'discovering', {});
  assert.deepEqual(compareImproveCandidateForReport({
    beforeMetadata: before,
    afterMetadata: flat,
    beforeCoverage: coverageStats(before),
    afterCoverage: coverageStats(flat),
  }), { accepted: false, reason: 'research_universe_still_unready' });

  const better = researchMetadata(['NVDA', 'TSM', 'MSFT'], 'refining', readiness({
    status: 'refining',
    selectedCount: 6,
    roleCount: 3,
    coveredDimensions: ['compute', 'foundry', 'cloud'],
    missingDimensions: ['memory'],
  }));
  assert.deepEqual(compareImproveCandidateForReport({
    beforeMetadata: better,
    afterMetadata: before,
    beforeCoverage: coverageStats(better),
    afterCoverage: coverageStats(before),
  }), { accepted: false, reason: 'candidate_regressed_available' });
}

function testUnreadyResearchCanImproveByFetchingCoreData() {
  const before = researchMetadata(['NVDA', 'TSM'], 'refining', readiness({
    status: 'refining',
    selectedCount: 8,
    roleCount: 2,
    coveredDimensions: ['compute', 'foundry'],
    missingDimensions: ['cloud', 'memory'],
  }));
  const after = buildReportRunMetadata({
    kind: 'research',
    query: 'AI infrastructure',
    symbols: ['NVDA', 'TSM'],
    range: '1y',
    generatedAt: '2026-05-27T10:05:00.000Z',
    coverage: [
      { symbol: 'NVDA', key: 'price', label: 'Price', data: { price: 100 }, priority: 'critical' },
      { symbol: 'TSM', key: 'price', label: 'Price', data: { price: 100 }, priority: 'critical' },
    ],
    researchUniverse: {
      ...before.researchUniverse,
      status: 'refining',
    },
  });
  assert.deepEqual(compareImproveCandidateForReport({
    beforeMetadata: before,
    afterMetadata: after,
    beforeCoverage: coverageStats(before),
    afterCoverage: coverageStats(after),
  }), { accepted: true, reason: 'candidate_improved_available' });
}

function testUnreadyResearchAcceptsProgressCheckpointAdvance() {
  const baseUniverse = {
    status: 'refining',
    selectedSymbols: ['NVDA', 'AMD'],
    qualifiedSymbols: [],
    candidates: [],
    readiness: readiness({
      status: 'refining',
      selectedCount: 0,
      roleCount: 0,
      coveredDimensions: [],
      missingDimensions: ['compute', 'cloud'],
    }),
  };
  const before = buildReportRunMetadata({
    kind: 'research',
    query: 'AI infrastructure',
    symbols: ['NVDA', 'AMD'],
    range: '1y',
    generatedAt: '2026-05-27T10:00:00.000Z',
    coverage: [],
    researchUniverse: {
      ...baseUniverse,
      progress: {
        targetCount: 2,
        batchSize: 2,
        cursor: 0,
        candidates: [
          { symbol: 'NVDA', rank: 0, selected: true, qualified: false, themeScore: 35, dataConfidenceScore: 70, universeScore: 50, reportScore: 0, finalScore: 30, roleCoverageScore: 0, state: 'unprocessed', attempts: 0 },
          { symbol: 'AMD', rank: 1, selected: true, qualified: false, themeScore: 34, dataConfidenceScore: 70, universeScore: 48, reportScore: 0, finalScore: 29, roleCoverageScore: 0, state: 'unprocessed', attempts: 0 },
        ],
      },
    },
  });
  const after = buildReportRunMetadata({
    kind: 'research',
    query: 'AI infrastructure',
    symbols: ['NVDA', 'AMD'],
    range: '1y',
    generatedAt: '2026-05-27T10:05:00.000Z',
    coverage: [],
    researchUniverse: {
      ...baseUniverse,
      progress: {
        targetCount: 2,
        batchSize: 2,
        cursor: 2,
        candidates: [
          { symbol: 'NVDA', rank: 0, selected: true, qualified: false, themeScore: 35, dataConfidenceScore: 70, universeScore: 50, reportScore: 76, finalScore: 55, roleCoverageScore: 0, state: 'basic_scored', attempts: 1 },
          { symbol: 'AMD', rank: 1, selected: true, qualified: false, themeScore: 34, dataConfidenceScore: 70, universeScore: 48, reportScore: 48, finalScore: 45, roleCoverageScore: 0, state: 'basic_scored', attempts: 1 },
        ],
      },
    },
  });

  assert.deepEqual(compareImproveCandidateForReport({
    beforeMetadata: before,
    afterMetadata: after,
    beforeCoverage: coverageStats(before),
    afterCoverage: coverageStats(after),
  }), { accepted: true, reason: 'research_progress_advanced' });
}

function testUnreadyResearchPassContinuesUntilPassLimit() {
  const metadata = researchMetadata(['NVDA'], 'failed', readiness({
    status: 'failed',
    selectedCount: 0,
    roleCount: 0,
    coveredDimensions: [],
    missingDimensions: ['additional role coverage'],
  }));
  assert.deepEqual(decideImproveStatus({
    before: coverageStats(metadata),
    after: coverageStats(metadata),
    passesDone: 1,
    config: { maxPasses: 7, minWaitMs: 1000, target: 'critical' },
    metadata,
  }), { status: 'continue', reason: 'research_universe_refining', nextRunAfterMs: 1000 });
  assert.deepEqual(decideImproveStatus({
    before: coverageStats(metadata),
    after: coverageStats(metadata),
    passesDone: 7,
    config: { maxPasses: 7, minWaitMs: 1000, target: 'critical' },
    metadata,
  }), { status: 'stopped', reason: 'max_passes_reached', nextRunAfterMs: 0 });
}

function main() {
  testPartialUnreadyResearchKeepsTargetCount();
  testFlatUnreadyCheckpointIsAcceptedButWorseOneIsRejected();
  testUnreadyResearchCanImproveByFetchingCoreData();
  testUnreadyResearchAcceptsProgressCheckpointAdvance();
  testUnreadyResearchPassContinuesUntilPassLimit();
  console.log('report improve smoke tests passed');
}

main();
