/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('assert/strict');
const path = require('path');
const { createJiti } = require('jiti');

const jiti = createJiti(__filename);
const {
  evaluateResearchUniverseReadiness,
  selectResearchUniverse,
} = jiti(path.join(process.cwd(), 'app/lib/researchUniverseSelector.ts'));

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
  assert.deepEqual(selection.selectedSymbols, []);
  assert.deepEqual(selection.qualifiedSymbols, []);
  assert.notEqual(readiness.status, 'locked');
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

async function main() {
  await testBroadResolverCannotLock();
  await testConcreteRolesCanLock();
  await testReadinessUsesSelectedRolesNotPlannedRoles();
  await testFacetEvidenceKeepsCanonicalRole();
  console.log('research universe selector smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
