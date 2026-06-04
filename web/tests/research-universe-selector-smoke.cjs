/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('assert/strict');
const path = require('path');
const { createJiti } = require('jiti');

const jiti = createJiti(__filename);
const {
  buildResearchUniverseDependencySummary,
  buildResearchUniverseMermaid,
  PROVISIONAL_UNCLASSIFIED_ROLE,
  evaluateResearchUniverseReadiness,
  selectResearchUniverse,
} = jiti(path.join(process.cwd(), 'app/lib/researchUniverseSelector.ts'));
const { buildDeepSectorReport } = jiti(path.join(process.cwd(), 'app/lib/reportGenerator.ts'));

function candidate(symbol, description, overrides = {}) {
  return {
    symbol,
    price: { price: 100 },
    overview: {
      name: `${symbol} Corp`,
      sector: 'Technology',
      industry: 'Semiconductors',
      description,
      marketCapitalization: 200_000_000_000,
      forwardPE: 28,
    },
    basicFinancials: {
      metric: {
        revenueGrowthTTM: 0.25,
        epsGrowthTTM: 0.20,
        grossMarginTTM: 0.55,
        operatingMarginTTM: 0.30,
        roeTTM: 0.25,
      },
    },
    priceHistory: {
      prices: [
        { date: '2025-01-01', close: 90 },
        { date: '2025-12-31', close: 110 },
      ],
    },
    ...overrides,
  };
}

async function testBroadResolverCannotLock() {
  const selection = await selectResearchUniverse({
    query: 'AI infrastructure',
    finalCount: 3,
    candidates: [
      candidate('MSFT', 'Broad technology and software company', {
        sourceFacets: ['Broad resolver raw candidate'],
        sourceEvidence: [{
          role: 'Broad resolver raw candidate',
          level: 'beneficiary',
          rationale: 'Raw fallback candidate.',
          confidence: 90,
          source: 'broad-theme-resolver',
        }],
      }),
      candidate('AMZN', 'Broad retail and cloud services company', {
        sourceFacets: ['Broad resolver raw candidate'],
        sourceEvidence: [{
          role: 'Broad resolver raw candidate',
          level: 'beneficiary',
          rationale: 'Raw fallback candidate.',
          confidence: 90,
          source: 'broad-theme-resolver',
        }],
      }),
    ],
  });
  const readiness = evaluateResearchUniverseReadiness({
    selection,
    roles: [{ label: 'Broad theme resolver' }],
    requiredDimensions: [{ label: 'compute accelerators' }, { label: 'cloud operators' }],
    targetCount: 3,
  });
  assert.ok(selection.selectedSymbols.includes('MSFT'));
  assert.deepEqual(selection.qualifiedSymbols, []);
  assert.notEqual(readiness.status, 'locked');
  assert.notEqual(readiness.status, 'failed');
  assert.equal(readiness.selectedCount, 0);
  assert.match(readiness.repairActions.join(' '), /broad|concrete role/i);
}

async function testConcreteRolesCanLock() {
  const selection = await selectResearchUniverse({
    query: 'AI infrastructure',
    finalCount: 5,
    candidates: [
      candidate('GPUA', 'AI infrastructure accelerator chips for data center training', {
        sourceEvidence: [{ role: 'Compute accelerators', level: 'direct', rationale: 'Accelerator chips.', confidence: 90 }],
      }),
      candidate('CLOU', 'Cloud data center operator for AI workloads', {
        sourceEvidence: [{ role: 'Cloud/data-center operators', level: 'direct', rationale: 'Cloud AI data centers.', confidence: 90 }],
      }),
      candidate('FOUN', 'Semiconductor foundry manufacturing advanced nodes', {
        sourceEvidence: [{ role: 'Foundry/manufacturing', level: 'enabler', rationale: 'Foundry capacity.', confidence: 90 }],
      }),
      candidate('TOOL', 'Semiconductor equipment and process control tools', {
        sourceEvidence: [{ role: 'Semiconductor equipment', level: 'enabler', rationale: 'Chipmaking tools.', confidence: 90 }],
      }),
      candidate('MEMR', 'High bandwidth memory and AI storage systems', {
        sourceEvidence: [{ role: 'Memory/storage', level: 'enabler', rationale: 'AI memory systems.', confidence: 90 }],
      }),
    ],
  });
  const readiness = evaluateResearchUniverseReadiness({
    selection,
    roles: [
      { label: 'Compute accelerators', dimensions: ['compute accelerators'] },
      { label: 'Cloud/data-center operators', dimensions: ['cloud/data-center operators'] },
      { label: 'Foundry/manufacturing', dimensions: ['foundry/manufacturing'] },
      { label: 'Semiconductor equipment', dimensions: ['semiconductor equipment'] },
      { label: 'Memory/storage', dimensions: ['memory/storage'] },
    ],
    requiredDimensions: [
      { label: 'compute accelerators' },
      { label: 'cloud/data-center operators' },
      { label: 'foundry/manufacturing' },
      { label: 'semiconductor equipment' },
      { label: 'memory/storage' },
    ],
    targetCount: 5,
  });
  assert.equal(selection.selectedSymbols.length, 5);
  assert.equal(readiness.status, 'locked');
  assert.ok(readiness.coveredDimensions.includes('semiconductor equipment'));
}

async function testReadinessUsesSelectedRolesNotPlannedRoles() {
  const selection = await selectResearchUniverse({
    query: 'AI infrastructure',
    finalCount: 8,
    candidates: [
      candidate('NVDA', 'AI infrastructure accelerator chips for data center training', {
        sourceEvidence: [{ role: 'Compute accelerators', level: 'direct', rationale: 'Accelerator chips.', confidence: 90 }],
      }),
      candidate('AMD', 'AI infrastructure accelerator chips and CPUs for data centers', {
        sourceEvidence: [{ role: 'Compute accelerators', level: 'direct', rationale: 'Accelerator chips.', confidence: 88 }],
      }),
      candidate('APH', 'Interconnect and electrical components for data infrastructure', {
        sourceEvidence: [{ role: 'Power/cooling/data-center infrastructure', level: 'enabler', rationale: 'Data-center infrastructure components.', confidence: 82 }],
      }),
    ],
  });
  const readiness = evaluateResearchUniverseReadiness({
    selection,
    roles: [
      { label: 'Compute accelerators', dimensions: ['compute accelerators'] },
      { label: 'Cloud/data-center operators', dimensions: ['cloud/data-center operators'] },
      { label: 'Foundry/manufacturing', dimensions: ['foundry/manufacturing'] },
      { label: 'Semiconductor equipment', dimensions: ['semiconductor equipment'] },
      { label: 'Memory/storage', dimensions: ['memory/storage'] },
      { label: 'Networking/connectivity', dimensions: ['networking/connectivity'] },
      { label: 'Power/cooling/data-center infrastructure', dimensions: ['power/cooling'] },
    ],
    requiredDimensions: [
      { label: 'compute accelerators' },
      { label: 'cloud/data-center operators' },
      { label: 'foundry/manufacturing' },
      { label: 'semiconductor equipment' },
      { label: 'memory/storage' },
      { label: 'networking/connectivity' },
      { label: 'power/cooling', required: false },
    ],
    targetCount: 8,
  });
  assert.equal(readiness.roleCount, 2);
  assert.notEqual(readiness.status, 'locked');
  assert.ok(readiness.missingDimensions.includes('cloud/data-center operators'), `expected missing cloud role, got ${readiness.missingDimensions.join(', ')}`);
  assert.ok(readiness.missingDimensions.includes('semiconductor equipment'), `expected missing equipment role, got ${readiness.missingDimensions.join(', ')}`);
}

async function testFacetEvidenceKeepsCanonicalRole() {
  const selection = await selectResearchUniverse({
    query: 'AI infrastructure',
    finalCount: 2,
    candidates: [
      candidate('ASML', 'Semiconductor equipment and lithography tools for advanced chip manufacturing', {
        sourceFacets: ['Semiconductor equipment'],
        sourceEvidence: [{ role: 'Semiconductor equipment', level: 'enabler', rationale: 'Lithography equipment.', confidence: 90 }],
      }),
      candidate('NVDA', 'GPU accelerators and data center chips for AI training', {
        sourceFacets: ['Compute accelerators'],
        sourceEvidence: [{ role: 'Compute accelerators', level: 'direct', rationale: 'GPU accelerators.', confidence: 95 }],
      }),
    ],
  });
  const asml = selection.candidates.find((item) => item.symbol === 'ASML');
  assert.equal(asml?.subtheme, 'Semiconductor equipment');
  assert.notEqual(asml?.subtheme, 'Compute accelerators/chips');
}

async function testProvisionalAllocationExcludesRejectedNames() {
  const selection = await selectResearchUniverse({
    query: 'AI infrastructure',
    finalCount: 2,
    candidates: [
      candidate('GOOD', 'Provider validated AI infrastructure platform candidate'),
      candidate('BAD', 'Unrelated document workflow software candidate'),
    ],
    llmFill: async () => JSON.stringify({
      candidates: [
        { symbol: 'GOOD', themeScore: 45, fit: 'weak_adjacent', evidenceLevel: 'beneficiary', subtheme: 'Provider candidate', rationale: 'Some adjacent exposure.' },
        { symbol: 'BAD', themeScore: 5, fit: 'reject', evidenceLevel: 'unrelated', subtheme: 'Unsupported provider candidate', rationale: 'No material theme exposure.' },
      ],
    }),
  });
  const items = selection.selectedSymbols.map((symbol, index) => ({
    symbol,
    price: { price: 100 + index },
    overview: {
      name: symbol + ' Corp',
      sector: 'Technology',
      industry: 'Infrastructure',
      description: symbol === 'GOOD' ? 'AI infrastructure platform candidate' : 'Unrelated workflow software',
      marketCapitalization: 100_000_000_000,
      forwardPE: 20,
    },
    basicFinancials: {
      metric: {
        revenueGrowthTTM: 0.25,
        epsGrowthTTM: 0.20,
        grossMarginTTM: 0.60,
        operatingMarginTTM: 0.30,
        roeTTM: 0.25,
      },
    },
    priceHistory: { prices: [{ date: '2025-01-01', close: 80 }, { date: '2026-01-01', close: 120 }] },
    decisionSnapshot: { overallScore: 80, action: 'Initiate', confidence: 'Medium', summary: 'Data-backed candidate.' },
  }));
  const report = buildDeepSectorReport({
    sectorQuery: 'AI infrastructure',
    selectedBy: 'llm',
    generatedAt: '2026-06-03T00:00:00.000Z',
    range: '1y',
    universe: selection.selectedSymbols,
    initialCandidates: selection.candidates.map((item) => item.symbol),
    universeSelection: selection,
    dependencyAnalysis: buildResearchUniverseDependencySummary(selection),
    ecosystemDiagram: buildResearchUniverseMermaid('AI infrastructure', selection),
    items,
    notes: [],
  });
  const allocationSection = report.split('## 🧭 Research Allocation Scenario')[1]?.split('## 🎯 Investment Conclusion')[0] || '';
  assert.ok(allocationSection.includes('GOOD Corp (GOOD)'), allocationSection);
  assert.ok(!allocationSection.includes('BAD Corp (BAD)'), allocationSection);
}

async function testGenericSectorLabelSupportsThemeButNotRole() {
  const selection = await selectResearchUniverse({
    query: 'AI infrastructure',
    finalCount: 1,
    candidates: [
      candidate('AMAT', 'Wafer fabrication and materials engineering equipment used to manufacture advanced AI data center semiconductors', {
        overview: { name: 'AMAT Corp', sector: 'Technology', industry: 'Semiconductors', description: 'Wafer fabrication and materials engineering equipment used to manufacture advanced AI data center semiconductors', marketCapitalization: 180_000_000_000, forwardPE: 25 },
      }),
      candidate('VEEV', 'Life sciences CRM and regulated healthcare content management software', {
        overview: { name: 'VEEV Corp', sector: 'Health Care', industry: 'Health Information Services', description: 'Life sciences CRM and regulated healthcare content management software', marketCapitalization: 30_000_000_000, forwardPE: 35 },
      }),
    ],
    llmFill: async () => JSON.stringify({
      candidates: [
        { symbol: 'AMAT', themeScore: 82, fit: 'strong_adjacent', evidenceLevel: 'enabler', evidenceConfidence: 82, subtheme: 'Semiconductors', rationale: 'Profile supports AI infrastructure manufacturing equipment exposure.' },
        { symbol: 'VEEV', themeScore: 8, fit: 'reject', evidenceLevel: 'unrelated', evidenceConfidence: 90, subtheme: 'Health Care', rationale: 'No material AI infrastructure exposure.' },
      ],
    }),
  });

  const amat = selection.candidates.find((item) => item.symbol === 'AMAT');
  const veev = selection.candidates.find((item) => item.symbol === 'VEEV');
  assert.ok(amat, 'expected AMAT diagnostics');
  assert.ok(veev, 'expected VEEV diagnostics');
  assert.deepEqual(selection.selectedSymbols, ['AMAT']);
  assert.ok(amat.themeScore >= 70, 'generic sector label should not collapse theme score: ' + amat.themeScore);
  assert.notEqual(amat.subtheme, 'Semiconductors', 'provider sector label must not become the theme role');
  assert.equal(veev.themeFit, 'reject');
  assert.notEqual(veev.subtheme, 'Health Care', 'unrelated provider sector label must not become a theme role');
}

async function testProviderGroupsDoNotDriveFallbackMap() {
  const selection = await selectResearchUniverse({
    query: 'AI infrastructure',
    finalCount: 3,
    candidates: [
      candidate('TECH', 'Broad enterprise technology products', {
        overview: { name: 'TECH Corp', sector: 'Technology', industry: 'Software Application', description: 'Broad enterprise technology products', marketCapitalization: 100_000_000_000, forwardPE: 20 },
      }),
      candidate('SERV', 'Commercial services and marketplace operations', {
        overview: { name: 'SERV Corp', sector: 'Industrials', industry: 'Commercial Services & Supplies', description: 'Commercial services and marketplace operations', marketCapitalization: 120_000_000_000, forwardPE: 18 },
      }),
      candidate('MEDI', 'Media and internet content services', {
        overview: { name: 'MEDI Corp', sector: 'Communication Services', industry: 'Media', description: 'Media and internet content services', marketCapitalization: 140_000_000_000, forwardPE: 22 },
      }),
    ],
    llmFill: async () => JSON.stringify({
      candidates: [
        { symbol: 'TECH', themeScore: 10, fit: 'reject', evidenceLevel: 'unrelated', evidenceConfidence: 80, subtheme: 'Technology', rationale: 'No supplied theme evidence.' },
        { symbol: 'SERV', themeScore: 8, fit: 'reject', evidenceLevel: 'unrelated', evidenceConfidence: 80, subtheme: 'Commercial Services & Supplies', rationale: 'No supplied theme evidence.' },
        { symbol: 'MEDI', themeScore: 7, fit: 'reject', evidenceLevel: 'unrelated', evidenceConfidence: 80, subtheme: 'Media', rationale: 'No supplied theme evidence.' },
      ],
    }),
  });

  assert.equal(selection.selectedSymbols.length, 3, 'fallback must keep the configured company count when provider-validated candidates exist');
  assert.deepEqual(selection.subthemes, [{ name: PROVISIONAL_UNCLASSIFIED_ROLE, symbols: selection.selectedSymbols }]);
  assert.ok(selection.candidates.every((item) => item.providerGroup), 'provider groups should be preserved as diagnostics');
  assert.ok(selection.candidates.every((item) => item.subtheme === PROVISIONAL_UNCLASSIFIED_ROLE), 'provider groups must not become theme roles');
  const map = buildResearchUniverseMermaid('AI infrastructure', selection);
  assert.match(map, /Provisional/);
  assert.doesNotMatch(map, /Commercial Services|Technology|Media/);
}

async function testThemeFitBeatsUnrelatedFinancialQuality() {
  const selection = await selectResearchUniverse({
    query: 'AI infrastructure',
    finalCount: 1,
    candidates: [
      candidate('STOR', 'Storage systems and flash products for cloud and data center infrastructure', {
        overview: { name: 'STOR Corp', sector: 'Technology', industry: 'Computer Hardware', description: 'Storage systems and flash products for cloud and data center infrastructure', marketCapitalization: 30_000_000_000, forwardPE: 35 },
        basicFinancials: { metric: { revenueGrowthTTM: 0.04, epsGrowthTTM: 0.02, grossMarginTTM: 0.30, operatingMarginTTM: 0.10, roeTTM: 0.08 } },
      }),
      candidate('AUCT', 'Vehicle auctions, salvage services, and commercial marketplace operations', {
        overview: { name: 'AUCT Corp', sector: 'Industrials', industry: 'Commercial Services & Supplies', description: 'Vehicle auctions, salvage services, and commercial marketplace operations', marketCapitalization: 80_000_000_000, forwardPE: 16 },
        basicFinancials: { metric: { revenueGrowthTTM: 0.30, epsGrowthTTM: 0.25, grossMarginTTM: 0.75, operatingMarginTTM: 0.45, roeTTM: 0.35 } },
      }),
    ],
    llmFill: async () => JSON.stringify({
      candidates: [
        { symbol: 'STOR', themeScore: 45, fit: 'weak_adjacent', evidenceLevel: 'beneficiary', evidenceConfidence: 62, subtheme: 'Storage infrastructure', rationale: 'Supplied profile supports storage/data-center adjacency.' },
        { symbol: 'AUCT', themeScore: 5, fit: 'reject', evidenceLevel: 'unrelated', evidenceConfidence: 90, subtheme: 'Commercial Services & Supplies', rationale: 'No supplied AI infrastructure exposure.' },
      ],
    }),
  });

  assert.deepEqual(selection.selectedSymbols, ['STOR']);
  const unrelated = selection.candidates.find((item) => item.symbol === 'AUCT');
  assert.ok(unrelated, 'expected unrelated candidate diagnostics');
  assert.equal(unrelated.themeFit, 'reject');
  assert.ok(unrelated.totalScore <= 28, 'unrelated score should be capped, got ' + unrelated.totalScore);
}

async function main() {
  await testBroadResolverCannotLock();
  await testConcreteRolesCanLock();
  await testReadinessUsesSelectedRolesNotPlannedRoles();
  await testFacetEvidenceKeepsCanonicalRole();
  await testProvisionalAllocationExcludesRejectedNames();
  await testGenericSectorLabelSupportsThemeButNotRole();
  await testProviderGroupsDoNotDriveFallbackMap();
  await testThemeFitBeatsUnrelatedFinancialQuality();
  console.log('research universe selector smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
