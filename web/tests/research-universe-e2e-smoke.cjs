/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs/promises');
const { createJiti } = require('jiti');

const testRoot = path.join('/tmp', `test-sdk-research-e2e-${process.pid}`);
process.env.REPORTS_DIR = path.join(testRoot, 'reports');
process.env.WATCHLISTS_FILE = path.join(testRoot, 'watchlists.json');
process.env.RESEARCH_MEMORY_FILE = path.join(testRoot, 'research-memory.json');
process.env.NUM_COMPANIES = '15';
process.env.RESEARCH_THEME_FACET_COUNT = '7';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const jiti = createJiti(__filename);
const { executeTool } = jiti(path.join(process.cwd(), 'app/lib/stockTools.ts'));

const PROFILES = {
  INTC: { name: 'Intel Corp', sector: 'Technology', industry: 'Semiconductors', description: 'Semiconductor processor products and advanced manufacturing.', marketCapitalization: 200000000000, forwardPE: 60 },
  NVDA: { name: 'NVIDIA Corp', sector: 'Technology', industry: 'Semiconductors', description: 'GPU accelerators and networking for AI data centers.', marketCapitalization: 5000000000000, forwardPE: 35 },
  AMD: { name: 'Advanced Micro Devices Inc', sector: 'Technology', industry: 'Semiconductors', description: 'CPUs, GPUs, and data center accelerators.', marketCapitalization: 700000000000, forwardPE: 45 },
  ARM: { name: 'Arm Holdings PLC', sector: 'Technology', industry: 'Semiconductors', description: 'Processor IP and architecture for CPUs and AI chips.', marketCapitalization: 150000000000, forwardPE: 80 },
  AVGO: { name: 'Broadcom Inc', sector: 'Technology', industry: 'Semiconductors', description: 'Custom silicon, networking chips, and connectivity for data centers.', marketCapitalization: 1000000000000, forwardPE: 40 },
  MRVL: { name: 'Marvell Technology Inc', sector: 'Technology', industry: 'Semiconductors', description: 'Data infrastructure semiconductors, custom silicon, and optical networking.', marketCapitalization: 70000000000, forwardPE: 45 },
  MSFT: { name: 'Microsoft Corp', sector: 'Technology', industry: 'Software Infrastructure', description: 'Azure cloud infrastructure and AI data centers.', marketCapitalization: 3000000000000, forwardPE: 30 },
  GOOGL: { name: 'Alphabet Inc', sector: 'Communication Services', industry: 'Internet Content & Information', description: 'Google Cloud infrastructure, data centers, and AI platforms.', marketCapitalization: 2000000000000, forwardPE: 28 },
  AMZN: { name: 'Amazon.com Inc', sector: 'Consumer Cyclical', industry: 'Internet Retail', description: 'AWS cloud infrastructure and data center services.', marketCapitalization: 2000000000000, forwardPE: 35 },
  META: { name: 'Meta Platforms Inc', sector: 'Communication Services', industry: 'Internet Content & Information', description: 'AI infrastructure, data centers, and custom AI accelerators for platforms.', marketCapitalization: 1500000000000, forwardPE: 25 },
  TSM: { name: 'Taiwan Semiconductor Manufacturing Co Ltd', sector: 'Technology', industry: 'Semiconductors', description: 'Semiconductor foundry manufacturing advanced integrated circuits.', marketCapitalization: 900000000000, forwardPE: 25 },
  ASML: { name: 'ASML Holding NV', sector: 'Technology', industry: 'Semiconductor Equipment', description: 'Lithography semiconductor equipment for advanced chip manufacturing.', marketCapitalization: 350000000000, forwardPE: 35 },
  AMAT: { name: 'Applied Materials Inc', sector: 'Technology', industry: 'Semiconductor Equipment', description: 'Wafer fabrication and materials engineering semiconductor equipment.', marketCapitalization: 180000000000, forwardPE: 25 },
  LRCX: { name: 'Lam Research Corp', sector: 'Technology', industry: 'Semiconductor Equipment', description: 'Wafer fabrication equipment for semiconductor manufacturing.', marketCapitalization: 120000000000, forwardPE: 30 },
  KLAC: { name: 'KLA Corp', sector: 'Technology', industry: 'Semiconductor Equipment', description: 'Process control, metrology, and inspection equipment for semiconductor manufacturing.', marketCapitalization: 100000000000, forwardPE: 30 },
  MU: { name: 'Micron Technology Inc', sector: 'Technology', industry: 'Semiconductors', description: 'DRAM, NAND, high bandwidth memory, and storage for data center AI systems.', marketCapitalization: 150000000000, forwardPE: 35 },
  WDC: { name: 'Western Digital Corp', sector: 'Technology', industry: 'Computer Hardware', description: 'Storage drives and flash storage products for cloud and data centers.', marketCapitalization: 30000000000, forwardPE: 20 },
  STX: { name: 'Seagate Technology Holdings PLC', sector: 'Technology', industry: 'Computer Hardware', description: 'Mass-capacity storage systems for data center infrastructure.', marketCapitalization: 25000000000, forwardPE: 18 },
  ANET: { name: 'Arista Networks Inc', sector: 'Technology', industry: 'Communications Equipment', description: 'Cloud networking switches for data center and AI clusters.', marketCapitalization: 100000000000, forwardPE: 35 },
  CSCO: { name: 'Cisco Systems Inc', sector: 'Technology', industry: 'Communications Equipment', description: 'Networking, switching, routing, and data center connectivity.', marketCapitalization: 250000000000, forwardPE: 18 },
  VRT: { name: 'Vertiv Holdings Co', sector: 'Industrials', industry: 'Electrical Equipment', description: 'Critical digital infrastructure, power, cooling, and thermal management for data centers.', marketCapitalization: 40000000000, forwardPE: 30 },
  ETN: { name: 'Eaton Corp PLC', sector: 'Industrials', industry: 'Electrical Equipment', description: 'Power management and electrical equipment for data centers and infrastructure.', marketCapitalization: 120000000000, forwardPE: 28 },
  APH: { name: 'Amphenol Corp', sector: 'Technology', industry: 'Electronic Components', description: 'Interconnect, connectors, and connectivity systems for communications and data infrastructure.', marketCapitalization: 90000000000, forwardPE: 30 },
  GLW: { name: 'Corning Inc', sector: 'Technology', industry: 'Electronic Components', description: 'Optical connectivity and materials for communications and data infrastructure.', marketCapitalization: 45000000000, forwardPE: 32 },
  TXN: { name: 'Texas Instruments Inc', sector: 'Technology', industry: 'Semiconductors', description: 'Analog and embedded semiconductor products used in industrial and data infrastructure.', marketCapitalization: 180000000000, forwardPE: 30 },
  CDNS: { name: 'Cadence Design Systems Inc', sector: 'Technology', industry: 'Software Application', description: 'Electronic design automation software for semiconductor chip design.', marketCapitalization: 70000000000, forwardPE: 45 },
  SNPS: { name: 'Synopsys Inc', sector: 'Technology', industry: 'Software Application', description: 'Electronic design automation and semiconductor IP for chip design.', marketCapitalization: 90000000000, forwardPE: 45 },
  CRM: { name: 'Salesforce Inc', sector: 'Technology', industry: 'Software Application', description: 'Customer relationship management cloud application software.', marketCapitalization: 200000000000, forwardPE: 22 },
  PYPL: { name: 'PayPal Holdings Inc', sector: 'Financial Services', industry: 'Credit Services', description: 'Digital payments platform.', marketCapitalization: 70000000000, forwardPE: 15 },
  UBER: { name: 'Uber Technologies Inc', sector: 'Technology', industry: 'Software Application', description: 'Mobility and delivery marketplace application.', marketCapitalization: 150000000000, forwardPE: 25 },
};

const ROLE_RESULTS = {
  'compute accelerators': ['NVDA', 'AMD', 'ARM', 'AVGO', 'MRVL'],
  'cloud/data-center operators': ['MSFT', 'GOOGL', 'AMZN', 'META'],
  'foundry/manufacturing': ['TSM'],
  'semiconductor equipment': ['ASML', 'AMAT', 'LRCX', 'KLAC'],
  'memory/storage': ['MU', 'WDC', 'STX'],
  'networking/connectivity': ['ANET', 'CSCO', 'APH', 'MRVL'],
  'power/cooling': ['VRT', 'ETN'],
};

function searchRecord(symbol) {
  const profile = PROFILES[symbol];
  return { symbol, name: profile.name, type: 'Equity', region: 'United States', currency: 'USD' };
}

function createProductionLikeService() {
  return {
    async searchStock(query) {
      const text = String(query || '').toLowerCase();
      const matched = Object.entries(ROLE_RESULTS).find(([role]) => text.includes(role));
      const symbols = matched
        ? matched[1]
        : Object.keys(PROFILES);
      return { results: symbols.map(searchRecord), __source: 'Mock' };
    },
    async getStockPrice(symbol) {
      return { symbol, price: 100 + symbol.length, change: 1, changePercent: '1.0%', __source: 'Mock' };
    },
    async getCompanyOverview(symbol) {
      return { symbol, ...PROFILES[symbol], __source: 'Mock' };
    },
    async getBasicFinancials(symbol) {
      return {
        symbol,
        metric: {
          revenueGrowthTTM: symbol === 'CRM' || symbol === 'PYPL' || symbol === 'UBER' ? 0.05 : 0.22,
          epsGrowthTTM: symbol === 'INTC' ? -0.20 : 0.18,
          grossMarginTTM: 0.55,
          operatingMarginTTM: 0.28,
          roeTTM: 0.24,
          peBasicExclExtraTTM: 30,
        },
        __source: 'Mock',
      };
    },
    async getPriceHistory(symbol) {
      return {
        symbol,
        prices: [
          { date: '2025-06-01', close: 80 },
          { date: '2026-05-20', close: 104 },
        ],
        __source: 'Mock',
      };
    },
    async getEarningsHistory(symbol) { return { symbol, quarterlyEarnings: [], __source: 'Mock' }; },
    async getIncomeStatement(symbol) { return { symbol, quarterlyReports: [], annualReports: [], __source: 'Mock' }; },
    async getBalanceSheet(symbol) { return { symbol, quarterlyReports: [], annualReports: [], __source: 'Mock' }; },
    async getCashFlow(symbol) { return { symbol, quarterlyReports: [], annualReports: [], __source: 'Mock' }; },
    async getAnalystRatings(symbol) { return { symbol, strongBuy: 1, buy: 8, hold: 3, sell: 0, strongSell: 0, __source: 'Mock' }; },
    async getAnalystRecommendations(symbol) { return { symbol, trend: [], __source: 'Mock' }; },
    async getInsiderTrading(symbol) { return { symbol, transactions: [], __source: 'Mock' }; },
    async getPriceTargets(symbol) { return { symbol, targetMean: 120, __source: 'Mock' }; },
    async getPeers(symbol) { return { symbol, peers: [], __source: 'Mock' }; },
    async getNewsSentiment(symbol) { return { symbol, feed: [], __source: 'Mock' }; },
    async getCompanyNews(symbol) { return { symbol, articles: [], __source: 'Mock' }; },
    async getSectorPerformance() { return {}; },
    async getTopGainersLosers() { return {}; },
    async searchNews() { return { articles: [], __source: 'Mock' }; },
  };
}

function createFallbackStressService() {
  const broadSymbols = [
    'INTC', 'APH', 'NVDA', 'MU', 'ASML', 'LRCX', 'AMAT', 'GLW', 'KLAC', 'TXN', 'AMD', 'QCOM',
    'MSFT', 'GOOGL', 'AMZN', 'TSM', 'AVGO', 'MRVL', 'ANET', 'VRT', 'ETN', 'CDNS', 'SNPS',
    'CRM', 'PYPL', 'UBER',
  ];
  const stressProfiles = {
    ...PROFILES,
    MSFT: { ...PROFILES.MSFT, description: 'Enterprise software, productivity platforms, and cloud services.' },
    GOOGL: { ...PROFILES.GOOGL, description: 'Search, advertising, internet services, and cloud services.' },
    AMZN: { ...PROFILES.AMZN, description: 'E-commerce, digital services, and cloud services.' },
    ASML: { ...PROFILES.ASML, description: 'Semiconductor systems and manufacturing technology.' },
    AMAT: { ...PROFILES.AMAT, description: 'Semiconductor systems and materials technology.' },
    LRCX: { ...PROFILES.LRCX, description: 'Semiconductor systems and manufacturing technology.' },
    KLAC: { ...PROFILES.KLAC, description: 'Semiconductor systems and process technology.' },
  };
  return {
    ...createProductionLikeService(),
    async searchStock(query) {
      const text = String(query || '').toLowerCase();
      const matched = Object.entries(ROLE_RESULTS).find(([role]) => text.includes(role));
      const symbols = matched
        ? matched[1]
        : broadSymbols;
      return { results: symbols.map((symbol) => ({ symbol, name: stressProfiles[symbol].name, type: 'Equity', region: 'United States', currency: 'USD' })), __source: 'Mock' };
    },
    async getCompanyOverview(symbol) {
      return { symbol, ...stressProfiles[symbol], __source: 'Mock' };
    },
  };
}

function taxonomyResponse() {
  return JSON.stringify({
    requiredDimensions: [
      { label: 'compute accelerators', required: true },
      { label: 'cloud/data-center operators', required: true },
      { label: 'foundry/manufacturing', required: true },
      { label: 'semiconductor equipment', required: true },
      { label: 'memory/storage', required: true },
      { label: 'networking/connectivity', required: true },
      { label: 'power/cooling', required: false },
    ],
    roles: [
      {
        label: 'Compute accelerators',
        dimensions: ['compute accelerators'],
        query: 'AI infrastructure compute accelerators',
        candidates: [
          { companyName: 'NVIDIA', likelyTicker: 'NVDA', evidenceLevel: 'direct', confidence: 95, reason: 'GPU accelerators' },
          { companyName: 'AMD', likelyTicker: 'AMD', evidenceLevel: 'direct', confidence: 88, reason: 'AI accelerators' },
          { companyName: 'Arm', likelyTicker: 'ARM', evidenceLevel: 'enabler', confidence: 82, reason: 'CPU IP' },
        ],
      },
      {
        label: 'Cloud/data-center operators',
        dimensions: ['cloud/data-center operators'],
        query: 'AI infrastructure cloud data center operators',
        candidates: [
          { companyName: 'Microsoft', likelyTicker: 'MSFT', evidenceLevel: 'enabler', confidence: 90, reason: 'Azure AI infrastructure' },
          { companyName: 'Alphabet', likelyTicker: 'GOOGL', evidenceLevel: 'enabler', confidence: 86, reason: 'Google Cloud AI infrastructure' },
          { companyName: 'Amazon', likelyTicker: 'AMZN', evidenceLevel: 'enabler', confidence: 86, reason: 'AWS AI infrastructure' },
          { companyName: 'Meta', likelyTicker: 'META', evidenceLevel: 'enabler', confidence: 75, reason: 'AI data centers' },
        ],
      },
      {
        label: 'Foundry/manufacturing',
        dimensions: ['foundry/manufacturing'],
        query: 'AI infrastructure semiconductor foundry manufacturing',
        candidates: [
          { companyName: 'Taiwan Semiconductor Manufacturing', likelyTicker: 'TSM', evidenceLevel: 'enabler', confidence: 95, reason: 'advanced foundry' },
        ],
      },
      {
        label: 'Semiconductor equipment',
        dimensions: ['semiconductor equipment'],
        query: 'AI infrastructure semiconductor equipment',
        candidates: [
          { companyName: 'ASML', likelyTicker: 'ASML', evidenceLevel: 'enabler', confidence: 90, reason: 'lithography' },
          { companyName: 'Applied Materials', likelyTicker: 'AMAT', evidenceLevel: 'enabler', confidence: 86, reason: 'wafer fabrication equipment' },
          { companyName: 'Lam Research', likelyTicker: 'LRCX', evidenceLevel: 'enabler', confidence: 85, reason: 'wafer fabrication equipment' },
        ],
      },
      {
        label: 'Memory/storage',
        dimensions: ['memory/storage'],
        query: 'AI infrastructure memory storage',
        candidates: [
          { companyName: 'Micron', likelyTicker: 'MU', evidenceLevel: 'enabler', confidence: 90, reason: 'high bandwidth memory' },
          { companyName: 'Western Digital', likelyTicker: 'WDC', evidenceLevel: 'enabler', confidence: 75, reason: 'data center storage' },
        ],
      },
      {
        label: 'Networking/connectivity',
        dimensions: ['networking/connectivity'],
        query: 'AI infrastructure networking connectivity',
        candidates: [
          { companyName: 'Arista Networks', likelyTicker: 'ANET', evidenceLevel: 'enabler', confidence: 90, reason: 'data center networking' },
          { companyName: 'Cisco', likelyTicker: 'CSCO', evidenceLevel: 'enabler', confidence: 78, reason: 'networking' },
          { companyName: 'Amphenol', likelyTicker: 'APH', evidenceLevel: 'enabler', confidence: 72, reason: 'interconnect systems' },
        ],
      },
      {
        label: 'Power/cooling',
        dimensions: ['power/cooling'],
        query: 'AI infrastructure data center power cooling',
        candidates: [
          { companyName: 'Vertiv', likelyTicker: 'VRT', evidenceLevel: 'enabler', confidence: 88, reason: 'power and cooling' },
          { companyName: 'Eaton', likelyTicker: 'ETN', evidenceLevel: 'enabler', confidence: 78, reason: 'power management' },
        ],
      },
    ],
  });
}

function nearReadyTaxonomyResponse() {
  return JSON.stringify({
    requiredDimensions: [
      { label: 'compute accelerators', required: true },
      { label: 'cloud/data-center operators', required: true },
      { label: 'semiconductor equipment', required: true },
      { label: 'memory/storage', required: true },
    ],
    roles: [
      {
        label: 'Compute accelerators',
        dimensions: ['compute accelerators'],
        query: 'AI infrastructure compute accelerators',
        candidates: [
          { companyName: 'NVIDIA', likelyTicker: 'NVDA', evidenceLevel: 'direct', confidence: 95, reason: 'GPU accelerators' },
          { companyName: 'AMD', likelyTicker: 'AMD', evidenceLevel: 'direct', confidence: 88, reason: 'AI accelerators' },
          { companyName: 'Arm', likelyTicker: 'ARM', evidenceLevel: 'enabler', confidence: 82, reason: 'CPU IP' },
          { companyName: 'Broadcom', likelyTicker: 'AVGO', evidenceLevel: 'enabler', confidence: 80, reason: 'custom silicon' },
          { companyName: 'Marvell', likelyTicker: 'MRVL', evidenceLevel: 'enabler', confidence: 78, reason: 'data infrastructure silicon' },
        ],
      },
      {
        label: 'Cloud/data-center operators',
        dimensions: ['cloud/data-center operators'],
        query: 'AI infrastructure cloud data center operators',
        candidates: [
          { companyName: 'Microsoft', likelyTicker: 'MSFT', evidenceLevel: 'enabler', confidence: 90, reason: 'Azure AI infrastructure' },
          { companyName: 'Alphabet', likelyTicker: 'GOOGL', evidenceLevel: 'enabler', confidence: 86, reason: 'Google Cloud AI infrastructure' },
          { companyName: 'Amazon', likelyTicker: 'AMZN', evidenceLevel: 'enabler', confidence: 86, reason: 'AWS AI infrastructure' },
          { companyName: 'Meta', likelyTicker: 'META', evidenceLevel: 'enabler', confidence: 75, reason: 'AI data centers' },
        ],
      },
      {
        label: 'Semiconductor equipment',
        dimensions: ['semiconductor equipment'],
        query: 'AI infrastructure semiconductor equipment',
        candidates: [
          { companyName: 'Taiwan Semiconductor Manufacturing', likelyTicker: 'TSM', evidenceLevel: 'enabler', confidence: 85, reason: 'advanced chip manufacturing' },
          { companyName: 'ASML', likelyTicker: 'ASML', evidenceLevel: 'enabler', confidence: 90, reason: 'lithography' },
          { companyName: 'Applied Materials', likelyTicker: 'AMAT', evidenceLevel: 'enabler', confidence: 86, reason: 'wafer fabrication equipment' },
          { companyName: 'Lam Research', likelyTicker: 'LRCX', evidenceLevel: 'enabler', confidence: 85, reason: 'wafer fabrication equipment' },
          { companyName: 'KLA', likelyTicker: 'KLAC', evidenceLevel: 'enabler', confidence: 84, reason: 'process control equipment' },
          { companyName: 'Amphenol', likelyTicker: 'APH', evidenceLevel: 'enabler', confidence: 70, reason: 'electronic components for data infrastructure' },
        ],
      },
    ],
  });
}

async function runCompleteUniverseScenario() {
  await fs.rm(testRoot, { recursive: true, force: true });
  const result = await executeTool(
    'generate_research_report',
    { sector: 'AI infrastructure', range: '1y', count: 15 },
    createProductionLikeService(),
    {
      deadlineAt: Date.now() + 240000,
      async llmFill(prompt) {
        if (prompt.includes('Build a verified-candidate proposal')) return taxonomyResponse();
        if (prompt.includes('deep research ecosystem analysis')) {
          return JSON.stringify({
            dependencyAnalysis: '### Role Map\n\nAI infrastructure spans compute, cloud, foundry, equipment, memory, networking, and power/cooling.',
            ecosystemDiagram: 'graph LR\n  NVDA-->MSFT\n  ASML-->TSM\n  MU-->Cloud\n  VRT-->Cloud',
          });
        }
        return '{}';
      },
    }
  );

  assert.equal(result.success, true, result.error || 'research report failed');
  assert.equal(result.data.reportKind, 'research');
  assert.ok(!/Verified Data Status/.test(result.data.content), 'did not expect unavailable-data placeholder');
  assert.ok(!/Broad theme resolver/.test(result.data.content), 'did not expect broad resolver role in final report');
  assert.match(result.data.content, /Snapshot/);
  assert.match(result.data.content, /Research Allocation Scenario/);
  const symbols = result.data.runMetadata.symbols;
  const universe = result.data.runMetadata.researchUniverse;
  const candidates = universe.candidates || [];
  const qualified = candidates.filter((candidate) => candidate.qualified).map((candidate) => `${candidate.symbol}:${candidate.subtheme || candidate.themeEvidence?.role}:${candidate.themeFit}:${candidate.themeScore}:${candidate.themeEvidence?.confidence}`);
  const rejected = candidates.filter((candidate) => !candidate.qualified).map((candidate) => `${candidate.symbol}:${candidate.subtheme || candidate.themeEvidence?.role}:${candidate.themeFit}:${candidate.themeScore}:${candidate.exclusionReason || ''}`);
  if (process.env.DEBUG_RESEARCH_E2E) {
    console.log('qualified candidates:', qualified.join(' | '));
    console.log('rejected candidates:', rejected.join(' | '));
  }
  assert.ok(symbols.length >= 12, `expected near-configured refined universe, got ${symbols.length}: ${symbols.join(', ')}`);
  for (const expected of ['NVDA', 'AMD', 'MSFT', 'TSM', 'MU', 'ANET']) {
    assert.ok(symbols.includes(expected), `expected ${expected} in selected universe: ${symbols.join(', ')}`);
  }
  const expectAtLeast = (label, minimum, bucket) => {
    const matches = bucket.filter((symbol) => symbols.includes(symbol));
    assert.ok(matches.length >= minimum, `expected at least ${minimum} ${label}, got ${matches.join(', ') || 'none'} from ${symbols.join(', ')}`);
  };
  expectAtLeast('cloud/data-center operators', 3, ['MSFT', 'GOOGL', 'AMZN', 'META']);
  expectAtLeast('compute/custom silicon names', 3, ['NVDA', 'AMD', 'ARM', 'AVGO', 'MRVL']);
  expectAtLeast('semiconductor equipment names', 2, ['ASML', 'AMAT', 'LRCX', 'KLAC']);
  expectAtLeast('networking/connectivity names', 1, ['ANET', 'CSCO', 'APH']);
  expectAtLeast('power/cooling names', 1, ['VRT', 'ETN']);
  for (const rejected of ['CRM', 'PYPL', 'UBER']) {
    assert.ok(!symbols.includes(rejected), `did not expect unrelated ${rejected} in selected universe`);
  }
  const roleText = result.data.runMetadata.researchUniverse.subthemes
    ? JSON.stringify(result.data.runMetadata.researchUniverse.subthemes)
    : result.data.content;
  for (const role of ['Compute accelerators', 'Cloud/data-center operators', 'Foundry/manufacturing', 'Semiconductor equipment', 'Memory/storage', 'Networking/connectivity']) {
    assert.match(roleText, new RegExp(role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `missing role ${role}`);
  }
  await fs.rm(testRoot, { recursive: true, force: true });
  console.log(`research universe e2e smoke passed with ${symbols.length} symbols: ${symbols.join(', ')}`);
}

async function runNearReadyProvisionalScenario() {
  await fs.rm(testRoot, { recursive: true, force: true });
  const priorDebug = process.env.DEBUG;
  process.env.DEBUG = 'true';
  try {
    const result = await executeTool(
      'generate_research_report',
      { sector: 'AI infrastructure', range: '1y', count: 15 },
      createProductionLikeService(),
      {
        deadlineAt: Date.now() + 240000,
        async llmFill(prompt) {
          if (prompt.includes('Build a verified-candidate proposal')) return nearReadyTaxonomyResponse();
          if (prompt.includes('deep research ecosystem analysis')) {
            return JSON.stringify({
              dependencyAnalysis: '### Role Map\n\nNear-ready universe with one missing required role.',
              ecosystemDiagram: 'graph LR\n  NVDA-->MSFT',
            });
          }
          return '{}';
        },
      }
    );

    assert.equal(result.success, true, result.error || 'near-ready research report failed');
    assert.equal(result.data.reportKind, 'research');
    assert.ok(!/Verified Data Status/.test(result.data.content), 'near-ready universe should render a provisional market-backed report');
    assert.match(result.data.content, /Snapshot/);
    assert.match(result.data.content, /Research Allocation Scenario/);
    assert.match(result.data.content, /Debug Data Quality Notes/);
    assert.match(result.data.content, /Missing required dimensions: memory\/storage/i);
    assert.equal(result.data.runMetadata.researchUniverse.status, 'refining');
    assert.ok(result.data.runMetadata.researchUniverse.readiness.selectedCount >= result.data.runMetadata.researchUniverse.readiness.targetLockCount);
    assert.equal(result.data.runMetadata.researchUniverse.readiness.roleCount, 3);
    assert.ok(result.data.runMetadata.symbols.length >= 12, `expected near-ready provisional universe, got ${result.data.runMetadata.symbols.join(', ')}`);
    console.log(`research near-ready provisional e2e smoke passed with ${result.data.runMetadata.symbols.length} symbols: ${result.data.runMetadata.symbols.join(', ')}`);
  } finally {
    if (priorDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = priorDebug;
    await fs.rm(testRoot, { recursive: true, force: true });
  }
}

async function runFallbackTaxonomyRepairScenario() {
  await fs.rm(testRoot, { recursive: true, force: true });
  const priorDebug = process.env.DEBUG;
  process.env.DEBUG = 'true';
  try {
    const result = await executeTool(
      'generate_research_report',
      { sector: 'AI infrastructure', range: '1y', count: 15 },
      createFallbackStressService(),
      {
        deadlineAt: Date.now() + 240000,
        async llmFill(prompt) {
          if (prompt.includes('Build a verified-candidate proposal')) return '{}';
          if (prompt.includes('deep research ecosystem analysis')) return '{}';
          return '{}';
        },
      }
    );

    assert.equal(result.success, true, result.error || 'fallback-taxonomy research report failed');
    assert.equal(result.data.reportKind, 'research');
    assert.ok(!/Verified Data Status/.test(result.data.content), 'fallback taxonomy with role-search repair should still render a useful report');
    assert.match(result.data.content, /Debug Data Quality Notes/);
    const symbols = result.data.runMetadata.symbols;
    const universe = result.data.runMetadata.researchUniverse;
    const roleText = JSON.stringify(universe.subthemes || []);
    const candidateText = JSON.stringify((universe.candidates || [])
      .filter((candidate) => ['NVDA', 'AMD', 'ARM', 'AVGO', 'MRVL'].includes(candidate.symbol))
      .map((candidate) => ({
        symbol: candidate.symbol,
        selected: candidate.selected,
        role: candidate.subtheme,
        fit: candidate.themeFit,
        theme: candidate.themeScore,
        evidence: candidate.themeEvidence,
        qualified: candidate.qualified,
      })));
    assert.ok(symbols.length >= 12, `expected repaired fallback universe, got ${symbols.length}: ${symbols.join(', ')}`);
    assert.ok((universe.readiness?.roleCount || 0) >= 4, `expected at least 4 selected roles, got ${universe.readiness?.roleCount}: ${roleText}`);
    assert.ok(!(universe.readiness?.missingDimensions || []).includes('cloud/data-center operators'), `cloud should not be missing after role repair: ${(universe.readiness?.missingDimensions || []).join(', ')}`);
    for (const expectedRole of ['Cloud/data-center operators', 'Semiconductor equipment', 'Memory/storage', 'Networking/connectivity']) {
      assert.match(roleText, new RegExp(expectedRole.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `missing selected role ${expectedRole}: ${roleText}`);
    }
    for (const expected of ['NVDA', 'MSFT', 'ASML', 'MU', 'ANET']) {
      assert.ok(symbols.includes(expected), `expected ${expected} in repaired fallback universe: ${symbols.join(', ')} candidates=${candidateText}`);
    }
    const repairedCloudMatches = ['MSFT', 'GOOGL', 'AMZN', 'META'].filter((symbol) => symbols.includes(symbol));
    assert.ok(repairedCloudMatches.length >= 3, `expected at least 3 repaired cloud/data-center operators, got ${repairedCloudMatches.join(', ') || 'none'} from ${symbols.join(', ')}`);
    for (const excluded of ['CRM', 'PYPL', 'UBER', 'FB', 'VMW']) {
      assert.ok(!symbols.includes(excluded), `did not expect unrelated/stale ${excluded} in selected universe`);
    }
    const equipment = (universe.subthemes || []).find((role) => /semiconductor equipment/i.test(role.name));
    assert.ok(equipment?.symbols?.some((symbol) => ['ASML', 'AMAT', 'LRCX', 'KLAC'].includes(symbol)), `expected equipment role to keep equipment symbols: ${roleText}`);
    assert.ok(!/Missing required dimensions: none/i.test(result.data.content), 'report should not say missing dimensions are none when selected roles are still short');
    console.log(`research fallback taxonomy repair e2e smoke passed with ${symbols.length} symbols: ${symbols.join(', ')}`);
  } finally {
    if (priorDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = priorDebug;
    await fs.rm(testRoot, { recursive: true, force: true });
  }
}

async function main() {
  await runCompleteUniverseScenario();
  await runNearReadyProvisionalScenario();
  await runFallbackTaxonomyRepairScenario();
}

main().catch(async (error) => {
  await fs.rm(testRoot, { recursive: true, force: true }).catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
