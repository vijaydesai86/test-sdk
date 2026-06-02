/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const productionFiles = [
  path.join(process.cwd(), 'app/lib/stockTools.ts'),
  path.join(process.cwd(), 'app/lib/researchUniverseSelector.ts'),
];

const bannedProductionMarkers = [
  'RESEARCH_PROFILE_ROLE_RULES',
  'themeHints',
  'Compute accelerators/chips',
  'Semiconductor equipment/tools',
  'Foundry/manufacturing',
  'Memory/storage',
  'Cloud/data-center operators',
  'Charging network/operators',
  'Cybersecurity platforms',
];

for (const filePath of productionFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  for (const marker of bannedProductionMarkers) {
    assert.ok(
      !source.includes(marker),
      `${path.relative(process.cwd(), filePath)} must not contain production baked-in domain taxonomy marker: ${marker}`
    );
  }
}

console.log('research universe production hardcoding smoke test passed');
