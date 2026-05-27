/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('assert/strict');
const path = require('path');
const { createJiti } = require('jiti');

const jiti = createJiti(__filename);
const {
  buildImproveToolRequest,
  compareImproveCandidateForReport,
  coverageStats,
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
  }), { accepted: true, reason: 'research_universe_still_unready' });

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
  }), { accepted: false, reason: 'research_universe_still_unready' });
}

function main() {
  testPartialUnreadyResearchKeepsTargetCount();
  testFlatUnreadyCheckpointIsAcceptedButWorseOneIsRejected();
  console.log('report improve smoke tests passed');
}

main();
