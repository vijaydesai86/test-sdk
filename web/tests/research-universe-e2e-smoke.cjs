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
      return { results: symbols.map((symbol) => ({ symbol, name: stressProfiles[symbol]?.name || symbol, type: 'Equity', region: 'United States', currency: 'USD' })), __source: 'Mock' };
    },
    async getCompanyOverview(symbol) {
      return { symbol, ...stressProfiles[symbol], __source: 'Mock' };
    },
  };
}

function createLimitedRoleService() {
  const symbols = ['TSM', 'INTC', 'NVDA', 'MU', 'ASML', 'LRCX', 'AMAT', 'KLAC', 'AMD', 'ADI', 'QCOM', 'GLW'];
  const limitedProfiles = Object.fromEntries(symbols.map((symbol) => [
    symbol,
    {
      ...(PROFILES[symbol] || {
        name: `${symbol} Corp`,
        sector: 'Technology',
        industry: 'Semiconductors',
        description: 'Semiconductor products for data infrastructure.',
        marketCapitalization: 100000000000,
        forwardPE: 35,
      }),
      description: symbol === 'GLW'
        ? 'Optical connectivity and materials for data infrastructure.'
        : 'Semiconductor products for AI infrastructure and data center systems.',
    },
  ]));
  return {
    ...createProductionLikeService(),
    async searchStock() {
      return { results: symbols.map((symbol) => ({ symbol, name: limitedProfiles[symbol].name, type: 'Equity', region: 'United States', currency: 'USD' })), __source: 'Mock' };
    },
    async getCompanyOverview(symbol) {
      return { symbol, ...limitedProfiles[symbol], __source: 'Mock' };
    },
  };
}

const BROAD_ONLY_SYMBOLS = [
  'NVDA', 'AMD', 'INTC', 'MSFT', 'GOOGL', 'META', 'TSM', 'AMAT', 'LRCX', 'QCOM',
  'AVGO', 'MRVL', 'TER', 'CRWD', 'PANW', 'FTNT', 'NOW', 'SNPS', 'CDNS', 'ZG',
  'MDB', 'OKTA', 'SNOW', 'NET', 'FIVE', 'DLTR', 'CLS', 'ZI', 'DOCU', 'TEAM',
  'BIDU', 'BABA', 'VIVO', 'ORCL', 'SAP', 'IBM', 'CSCO', 'TWLO', 'DDOG', 'ZTS',
  'TXN', 'XLNX', 'HPE', 'DELL', 'CRM',
];

function createBroadOnlyFailureService() {
  const profiles = {
    ...Object.fromEntries(BROAD_ONLY_SYMBOLS.map((symbol) => [
      symbol,
      {
        name: `${symbol} Corp`,
        sector: 'Technology',
        industry: 'Software Application',
        description: 'General software and digital services.',
        marketCapitalization: 25000000000,
        forwardPE: 30,
      },
    ])),
    ...PROFILES,
    TER: { name: 'Teradyne Inc', sector: 'Technology', industry: 'Semiconductor Equipment', description: 'Automated test equipment for semiconductor manufacturing.', marketCapitalization: 18000000000, forwardPE: 28 },
    CLS: { name: 'Celestica Inc', sector: 'Technology', industry: 'Electronic Components', description: 'Design and manufacturing services for cloud and communications infrastructure hardware.', marketCapitalization: 8000000000, forwardPE: 18 },
    HPE: { name: 'Hewlett Packard Enterprise Co', sector: 'Technology', industry: 'Communication Equipment', description: 'Servers, networking, and hybrid cloud infrastructure systems.', marketCapitalization: 30000000000, forwardPE: 12 },
    DELL: { name: 'Dell Technologies Inc', sector: 'Technology', industry: 'Computer Hardware', description: 'Servers, storage, and infrastructure systems for enterprise and AI workloads.', marketCapitalization: 90000000000, forwardPE: 14 },
  };
  return {
    ...createProductionLikeService(),
    async searchStock(query) {
      const text = String(query || '').trim().toUpperCase();
      if (BROAD_ONLY_SYMBOLS.includes(text)) {
        const profile = profiles[text];
        return { results: [{ symbol: text, name: profile.name, type: 'Equity', region: 'United States', currency: 'USD' }], __source: 'Mock' };
      }
      return { results: [], __source: 'Mock' };
    },
    async getCompanyOverview(symbol) {
      return { symbol, ...profiles[symbol], __source: 'Mock' };
    },
    async getBasicFinancials(symbol) {
      return {
        symbol,
        metric: {
          revenueGrowthTTM: ['FIVE', 'DLTR', 'ZTS'].includes(symbol) ? 0.03 : 0.20,
          epsGrowthTTM: 0.15,
          grossMarginTTM: 0.52,
          operatingMarginTTM: 0.24,
          roeTTM: 0.22,
          peBasicExclExtraTTM: 28,
        },
        __source: 'Mock',
      };
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

function limitedRoleTaxonomyResponse() {
  return JSON.stringify({
    requiredDimensions: [
      { label: 'Compute accelerators/chips', required: true },
      { label: 'Cloud/data-center operators', required: true },
      { label: 'Semiconductor equipment/tools', required: true },
      { label: 'Foundry/manufacturing', required: true },
      { label: 'Memory/storage', required: true },
      { label: 'Networking/connectivity', required: true },
    ],
    roles: [
      {
        label: 'Compute accelerators/chips',
        dimensions: ['Compute accelerators/chips'],
        query: 'AI infrastructure compute accelerators chips',
        candidates: ['TSM', 'INTC', 'NVDA', 'MU', 'ASML', 'LRCX', 'AMAT', 'KLAC', 'AMD', 'ADI', 'QCOM'].map((symbol) => ({
          companyName: PROFILES[symbol]?.name || `${symbol} Corp`,
          likelyTicker: symbol,
          evidenceLevel: symbol === 'NVDA' || symbol === 'AMD' ? 'direct' : 'enabler',
          confidence: 86,
          reason: 'Semiconductor exposure in AI infrastructure.',
        })),
      },
      {
        label: 'Power/cooling/data-center infrastructure',
        dimensions: ['Power/cooling/data-center infrastructure'],
        query: 'AI infrastructure data center infrastructure components',
        candidates: [
          { companyName: 'Corning', likelyTicker: 'GLW', evidenceLevel: 'enabler', confidence: 78, reason: 'Data infrastructure materials.' },
        ],
      },
    ],
  });
}

function collapsedSingleBucketTaxonomyResponse() {
  const symbols = ['NVDA', 'AMD', 'INTC', 'TSM', 'MU', 'AVGO', 'MRVL', 'ASML', 'LRCX', 'AMAT', 'KLAC', 'MSFT', 'GOOGL', 'AMZN', 'ANET', 'WDC'];
  return JSON.stringify({
    requiredDimensions: [
      { label: 'compute accelerators', required: true },
      { label: 'cloud/data-center operators', required: true },
      { label: 'foundry/manufacturing', required: true },
      { label: 'semiconductor equipment', required: true },
      { label: 'memory/storage', required: true },
      { label: 'networking/connectivity', required: true },
    ],
    roles: [
      {
        label: 'Compute accelerators',
        dimensions: ['compute accelerators'],
        query: 'AI infrastructure compute accelerators',
        candidates: symbols.map((symbol) => ({
          companyName: PROFILES[symbol]?.name || `${symbol} Corp`,
          likelyTicker: symbol,
          evidenceLevel: symbol === 'NVDA' || symbol === 'AMD' ? 'direct' : 'enabler',
          confidence: 82,
          reason: 'Intentionally coarse generated bucket for regression coverage.',
        })),
      },
    ],
  });
}

function verifiedProfileRoleRepairResponse() {
  const roleBySymbol = {
    NVDA: ['direct', 'AI accelerator silicon', 92, 'GPU accelerators and networking for AI data centers.'],
    AMD: ['direct', 'AI accelerator silicon', 88, 'CPUs, GPUs, and data center accelerators.'],
    TSM: ['enabler', 'Advanced chip manufacturing', 92, 'Semiconductor foundry manufacturing advanced integrated circuits.'],
    ASML: ['enabler', 'Semiconductor fabrication equipment', 90, 'Lithography semiconductor equipment for advanced chip manufacturing.'],
    AMAT: ['enabler', 'Semiconductor fabrication equipment', 88, 'Wafer fabrication and materials engineering semiconductor equipment.'],
    LRCX: ['enabler', 'Semiconductor fabrication equipment', 88, 'Wafer fabrication equipment for semiconductor manufacturing.'],
    KLAC: ['enabler', 'Semiconductor fabrication equipment', 86, 'Process control, metrology, and inspection equipment for semiconductor manufacturing.'],
    MU: ['enabler', 'Memory and storage infrastructure', 88, 'DRAM, NAND, high bandwidth memory, and storage for data center AI systems.'],
    WDC: ['enabler', 'Memory and storage infrastructure', 76, 'Storage drives and flash storage products for cloud and data centers.'],
    STX: ['enabler', 'Memory and storage infrastructure', 74, 'Mass-capacity storage systems for data center infrastructure.'],
    MSFT: ['enabler', 'Cloud data center platforms', 86, 'Azure cloud infrastructure and AI data centers.'],
    GOOGL: ['enabler', 'Cloud data center platforms', 84, 'Google Cloud infrastructure, data centers, and AI platforms.'],
    AMZN: ['enabler', 'Cloud data center platforms', 84, 'AWS cloud infrastructure and data center services.'],
    ANET: ['enabler', 'Data center networking', 84, 'Cloud networking switches for data center and AI clusters.'],
    CSCO: ['enabler', 'Data center networking', 80, 'Networking, switching, routing, and data center connectivity.'],
    VRT: ['enabler', 'Power and thermal infrastructure', 82, 'Power, cooling, and thermal management for data centers.'],
    ETN: ['enabler', 'Power and thermal infrastructure', 78, 'Power management and electrical equipment for data centers.'],
    APH: ['enabler', 'Interconnect and optical infrastructure', 76, 'Interconnect, connectors, and connectivity systems for communications and data infrastructure.'],
    GLW: ['enabler', 'Interconnect and optical infrastructure', 74, 'Optical connectivity and materials for communications and data infrastructure.'],
    CDNS: ['enabler', 'Chip design automation', 72, 'Electronic design automation software for semiconductor chip design.'],
    SNPS: ['enabler', 'Chip design automation', 72, 'Electronic design automation and semiconductor IP for chip design.'],
  };
  return JSON.stringify({
    roles: [
      { label: 'AI accelerator silicon', definition: 'Processor, GPU, or custom silicon products used for AI compute.', required: true },
      { label: 'Advanced chip manufacturing', definition: 'Foundry or manufacturing capacity for advanced integrated circuits.', required: true },
      { label: 'Semiconductor fabrication equipment', definition: 'Equipment used to manufacture or inspect advanced semiconductors.', required: true },
      { label: 'Cloud data center platforms', definition: 'Cloud or data-center platforms operating AI infrastructure.', required: true },
      { label: 'Data center networking', definition: 'Networking and switching products for data-center infrastructure.', required: false },
      { label: 'Memory and storage infrastructure', definition: 'Memory or storage products used in data-center systems.', required: false },
      { label: 'Power and thermal infrastructure', definition: 'Power or cooling systems for data-center infrastructure.', required: false },
      { label: 'Interconnect and optical infrastructure', definition: 'Optical or interconnect components for data infrastructure.', required: false },
      { label: 'Chip design automation', definition: 'Design tools or IP used to create semiconductors.', required: false },
    ],
    candidates: Object.entries(roleBySymbol).map(([symbol, [evidenceLevel, role, confidence, rationale]]) => ({
      symbol,
      role,
      evidenceLevel,
      confidence,
      rationale,
    })),
  });
}

function broadOnlyClassifierResponse() {
  const roleBySymbol = {
    NVDA: ['direct', 'AI accelerator providers', 94, 'GPU accelerators and networking for AI data centers.'],
    AMD: ['direct', 'AI accelerator providers', 88, 'CPUs, GPUs, and data center accelerators.'],
    TSM: ['enabler', 'Foundry and manufacturing providers', 92, 'Semiconductor foundry manufacturing advanced integrated circuits.'],
    AMAT: ['enabler', 'Semiconductor equipment providers', 86, 'Wafer fabrication and materials engineering semiconductor equipment.'],
    LRCX: ['enabler', 'Semiconductor equipment providers', 86, 'Wafer fabrication equipment for semiconductor manufacturing.'],
    AVGO: ['enabler', 'AI infrastructure silicon and networking suppliers', 86, 'Custom silicon, networking chips, and connectivity for data centers.'],
    MRVL: ['enabler', 'AI infrastructure silicon and networking suppliers', 84, 'Data infrastructure semiconductors, custom silicon, and optical networking.'],
    MSFT: ['enabler', 'Cloud and data-center operators', 88, 'Azure cloud infrastructure and AI data centers.'],
    GOOGL: ['enabler', 'Cloud and data-center operators', 86, 'Google Cloud infrastructure, data centers, and AI platforms.'],
    META: ['enabler', 'Cloud and data-center operators', 80, 'AI infrastructure, data centers, and custom AI accelerators.'],
    CSCO: ['enabler', 'Networking and connectivity providers', 76, 'Networking, switching, routing, and data center connectivity.'],
    DELL: ['enabler', 'Servers and infrastructure systems', 76, 'Servers, storage, and infrastructure systems for enterprise and AI workloads.'],
    TXN: ['enabler', 'Infrastructure semiconductor suppliers', 72, 'Analog and embedded semiconductor products used in industrial and data infrastructure.'],
  };
  const candidates = BROAD_ONLY_SYMBOLS.map((symbol) => {
    const mapped = roleBySymbol[symbol];
    if (!mapped) {
      return {
        symbol,
        themeScore: 25,
        fit: 'reject',
        evidenceLevel: 'unrelated',
        evidenceConfidence: 75,
        subtheme: 'Unsupported broad candidate',
        rationale: 'Supplied profile does not support material AI infrastructure exposure.',
      };
    }
    const [evidenceLevel, subtheme, confidence, rationale] = mapped;
    return {
      symbol,
      themeScore: confidence,
      fit: evidenceLevel === 'direct' ? 'core' : 'strong_adjacent',
      evidenceLevel,
      evidenceConfidence: confidence,
      subtheme,
      rationale,
    };
  });
  return JSON.stringify({ candidates });
}

function broadOnlyTickerResponse() {
  return JSON.stringify(BROAD_ONLY_SYMBOLS);
}

async function runCompleteUniverseScenario() {
  await fs.rm(testRoot, { recursive: true, force: true });
  let taxonomyCalls = 0;
  const result = await executeTool(
    'generate_research_report',
    { sector: 'AI infrastructure', range: '1y', count: 15 },
    createProductionLikeService(),
    {
      deadlineAt: Date.now() + 240000,
      async llmFill(prompt) {
        if (prompt.includes('Build a verified-candidate proposal')) {
          taxonomyCalls += 1;
          return taxonomyCalls === 1 ? '{}' : taxonomyResponse();
        }
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
  assert.ok(taxonomyCalls >= 2, 'expected taxonomy retry before generic fallback');
  assert.match(result.data.content, /Theme taxonomy attempt 1 returned 0 concrete role buckets; retrying before generic fallback/);
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
  for (const expected of ['NVDA', 'AMD', 'MSFT', 'TSM', 'MU']) {
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

async function runCollapsedBucketRepairScenario() {
  await fs.rm(testRoot, { recursive: true, force: true });
  const result = await executeTool(
    'generate_research_report',
    { sector: 'AI infrastructure', range: '1y', count: 15 },
    createProductionLikeService(),
    {
      deadlineAt: Date.now() + 240000,
      async llmFill(prompt) {
        if (prompt.includes('Build a verified-candidate proposal')) return collapsedSingleBucketTaxonomyResponse();
        if (prompt.includes('deep research ecosystem analysis')) return '{}';
        return '{}';
      },
    }
  );

  assert.equal(result.success, true, result.error || 'collapsed-bucket repair report failed');
  assert.equal(result.data.reportKind, 'research');
  assert.ok(!/No market-data-backed decision was generated/.test(result.data.content), 'specific generated dimensions plus provider evidence should repair the coarse bucket');
  assert.ok(!/Verified Data Status/.test(result.data.content), 'coarse generated bucket should not force an unavailable-data checkpoint');
  const universe = result.data.runMetadata.researchUniverse;
  const symbols = result.data.runMetadata.symbols;
  const roleText = JSON.stringify(universe.subthemes || []);
  assert.ok((universe.readiness?.roleCount || 0) >= 4, `expected repaired role coverage, got ${universe.readiness?.roleCount}: ${roleText}`);
  assert.ok(symbols.length >= 12, `expected near-configured repaired universe, got ${symbols.length}: ${symbols.join(', ')}`);
  for (const expected of ['NVDA', 'TSM', 'MU', 'ASML']) {
    assert.ok(symbols.includes(expected), `expected ${expected} after coarse-bucket repair: ${symbols.join(', ')}`);
  }
  const cloudMatches = ['MSFT', 'GOOGL', 'AMZN', 'META'].filter((symbol) => symbols.includes(symbol));
  assert.ok(cloudMatches.length >= 1, `expected at least one cloud/data-center operator after repair: ${symbols.join(', ')}`);
  for (const expectedRole of ['cloud/data-center operators', 'foundry/manufacturing', 'semiconductor equipment', 'memory/storage']) {
    assert.match(roleText, new RegExp(expectedRole.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `missing repaired role ${expectedRole}: ${roleText}`);
  }
  console.log(`research collapsed-bucket repair e2e smoke passed with ${symbols.length} symbols: ${symbols.join(', ')}`);
}

async function runBroadOnlyClassifierRescueScenario() {
  await fs.rm(testRoot, { recursive: true, force: true });
  const result = await executeTool(
    'generate_research_report',
    { sector: 'AI infrastructure', range: '1y', count: 15 },
    createBroadOnlyFailureService(),
    {
      deadlineAt: Date.now() + 240000,
      async llmFill(prompt) {
        if (prompt.includes('Build a verified-candidate proposal')) return '{}';
        if (prompt.includes('Return ONLY official NYSE/NASDAQ/US ADR ticker symbols')) return broadOnlyTickerResponse();
        if (prompt.includes('Classify each public company against')) return broadOnlyClassifierResponse();
        if (prompt.includes('deep research ecosystem analysis')) return '{}';
        return '{}';
      },
    }
  );

  assert.equal(result.success, true, result.error || 'broad-only classifier rescue report failed');
  assert.equal(result.data.reportKind, 'research');
  assert.ok(!/No market-data-backed decision was generated/.test(result.data.content), 'broad candidates classified from provider profiles should produce market-backed report');
  assert.ok(!/Selected universe: none/.test(result.data.content), 'classified broad candidates should not leave selected universe empty');
  assert.ok(!/Qualified candidates: none/.test(result.data.content), 'classified broad candidates should produce qualified candidates');
  const symbols = result.data.runMetadata.symbols;
  const universe = result.data.runMetadata.researchUniverse;
  const roleText = JSON.stringify(universe.subthemes || []);
  assert.ok(symbols.length >= 10, `expected useful broad-only classified universe, got ${symbols.length}: ${symbols.join(', ')}`);
  for (const expected of ['NVDA', 'TSM', 'MSFT', 'GOOGL', 'AVGO', 'AMD']) {
    assert.ok(symbols.includes(expected), `expected ${expected} in broad-only classified universe: ${symbols.join(', ')}`);
  }
  assert.ok((universe.readiness?.selectedCount || 0) >= 10, `expected selected direct/enabler coverage, got ${universe.readiness?.selectedCount}`);
  assert.ok((universe.readiness?.roleCount || 0) >= 4, `expected concrete role coverage, got ${universe.readiness?.roleCount}: ${roleText}`);
  for (const rejected of ['FIVE', 'DLTR', 'ZTS']) {
    assert.ok(!symbols.includes(rejected), `did not expect unrelated ${rejected} in broad-only classified universe`);
  }
  console.log(`research broad-only classifier rescue e2e smoke passed with ${symbols.length} symbols: ${symbols.join(', ')}`);
}

async function runLimitedRoleProvisionalDataScenario() {
  await fs.rm(testRoot, { recursive: true, force: true });
  const priorDebug = process.env.DEBUG;
  process.env.DEBUG = 'true';
  try {
    const result = await executeTool(
      'generate_research_report',
      { sector: 'AI infrastructure', range: '1y', count: 15 },
      createLimitedRoleService(),
      {
        deadlineAt: Date.now() + 240000,
        async llmFill(prompt) {
          if (prompt.includes('Build a verified-candidate proposal')) return limitedRoleTaxonomyResponse();
          if (prompt.includes('deep research ecosystem analysis')) return '{}';
          return '{}';
        },
      }
    );

    assert.equal(result.success, true, result.error || 'limited-role provisional research report failed');
    assert.equal(result.data.reportKind, 'research');
    assert.ok(!/No market-data-backed decision was generated/.test(result.data.content), 'useful limited-role universe should fetch core data');
    assert.ok(!/Verified Data Status/.test(result.data.content), 'useful limited-role universe should not render only a discovery checkpoint');
    assert.match(result.data.content, /Snapshot/);
    assert.match(result.data.content, /Research Allocation Scenario/);
    assert.match(result.data.content, /Missing required dimensions:/i);
    const readiness = result.data.runMetadata.researchUniverse.readiness;
    const pipeline = result.data.runMetadata.researchUniverse.pipeline;
    assert.equal(result.data.runMetadata.researchUniverse.status, 'refining');
    assert.equal(pipeline.stage, 'core_data');
    assert.equal(pipeline.stageStatus, 'provisional_market_backed');
    assert.equal(pipeline.targetFinalCount, 15);
    assert.match(pipeline.nextObjective, /provisional market-backed report/i);
    assert.ok(readiness.roleCount >= 2, `expected at least 2 concrete roles, got ${readiness.roleCount}`);
    assert.ok(readiness.missingDimensions.length > 0, 'limited-role report should remain visibly incomplete');
    assert.ok(result.data.runMetadata.symbols.length >= 10, `expected data-backed limited-role universe, got ${result.data.runMetadata.symbols.join(', ')}`);
    console.log(`research limited-role provisional e2e smoke passed with ${result.data.runMetadata.symbols.length} symbols: ${result.data.runMetadata.symbols.join(', ')}`);
  } finally {
    if (priorDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = priorDebug;
    await fs.rm(testRoot, { recursive: true, force: true });
  }
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
    assert.ok(['refining', 'locked'].includes(result.data.runMetadata.researchUniverse.status));
    assert.ok(result.data.runMetadata.researchUniverse.readiness.selectedCount >= result.data.runMetadata.researchUniverse.readiness.targetLockCount);
    assert.ok(result.data.runMetadata.researchUniverse.readiness.roleCount >= 3);
    if (result.data.runMetadata.researchUniverse.status === 'refining') {
      assert.match(result.data.content, /Missing required dimensions: memory\/storage/i);
    } else {
      assert.equal(result.data.runMetadata.researchUniverse.readiness.canBuildFullReport, true);
    }
    assert.ok(result.data.runMetadata.symbols.length >= 12, `expected near-ready provisional universe, got ${result.data.runMetadata.symbols.join(', ')}`);
    console.log(`research near-ready provisional e2e smoke passed with ${result.data.runMetadata.symbols.length} symbols: ${result.data.runMetadata.symbols.join(', ')}`);
  } finally {
    if (priorDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = priorDebug;
    await fs.rm(testRoot, { recursive: true, force: true });
  }
}

async function runVerifiedProfileLLMRoleRepairScenario() {
  await fs.rm(testRoot, { recursive: true, force: true });
  const priorDebug = process.env.DEBUG;
  process.env.DEBUG = 'true';
  let roleRepairCalls = 0;
  try {
    const result = await executeTool(
      'generate_research_report',
      { sector: 'AI infrastructure', range: '1y', count: 15 },
      createFallbackStressService(),
      {
        deadlineAt: Date.now() + 240000,
        async llmFill(prompt) {
          if (prompt.includes('Build a verified-candidate proposal')) return '{}';
          if (prompt.includes('Classify this already provider-verified public-company universe')) {
            roleRepairCalls += 1;
            return verifiedProfileRoleRepairResponse();
          }
          if (prompt.includes('deep research ecosystem analysis')) return '{}';
          return '{}';
        },
      }
    );

    assert.equal(result.success, true, result.error || 'verified-profile LLM role repair report failed');
    assert.equal(result.data.reportKind, 'research');
    assert.equal(roleRepairCalls, 1, 'expected one verified-profile role repair LLM call');
    assert.ok(!/Verified Data Status/.test(result.data.content), 'LLM role repair should still produce a market-backed report');
    const universe = result.data.runMetadata.researchUniverse;
    const symbols = result.data.runMetadata.symbols;
    const roleText = JSON.stringify(universe.subthemes || []);
    const roleTextLower = roleText.toLowerCase();
    assert.match(result.data.content, /Verified-profile LLM role repair produced/);
    assert.doesNotMatch(result.data.content, /Profile-derived role buckets repaired missing generated taxonomy/);
    assert.ok((universe.readiness?.selectedCount || 0) >= 12, 'expected enough direct/enabler classifications, got ' + universe.readiness?.selectedCount);
    assert.ok((universe.readiness?.roleCount || 0) >= 4, 'expected concrete LLM role coverage, got ' + universe.readiness?.roleCount + ': ' + roleText);
    for (const expectedRole of ['AI accelerator silicon', 'Advanced chip manufacturing', 'Semiconductor fabrication equipment', 'Cloud data center platforms']) {
      assert.ok(roleTextLower.includes(expectedRole.toLowerCase()), 'missing LLM-repaired role ' + expectedRole + ': ' + roleText);
    }
    for (const providerOnlyRole of ['Provider profile group', 'Provisional / unclassified', 'Communications', 'Machinery', 'Based Data']) {
      assert.ok(!roleTextLower.includes(providerOnlyRole.toLowerCase()), 'did not expect provider/fallback role ' + providerOnlyRole + ': ' + roleText);
    }
    for (const expected of ['NVDA', 'TSM', 'MSFT', 'MU']) {
      assert.ok(symbols.includes(expected), 'expected ' + expected + ' in LLM-repaired universe: ' + symbols.join(', '));
    }
    console.log('research verified-profile LLM role repair e2e smoke passed with ' + symbols.length + ' symbols: ' + symbols.join(', '));
  } finally {
    if (priorDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = priorDebug;
    await fs.rm(testRoot, { recursive: true, force: true });
  }
}

async function runGenericFallbackCheckpointScenario() {
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

    assert.equal(result.success, true, result.error || 'generic fallback research report failed');
    assert.equal(result.data.reportKind, 'research');
    assert.ok(!/Verified Data Status/.test(result.data.content), 'valid fallback candidates should produce a provisional market-backed report');
    assert.match(result.data.content, /Snapshot/);
    assert.match(result.data.content, /Research Allocation Scenario/);
    const universe = result.data.runMetadata.researchUniverse;
    assert.ok(['refining', 'locked'].includes(universe.status), `expected usable fallback universe status, got ${universe.status}`);
    assert.ok(['core_data', 'final_universe'].includes(universe.pipeline.stage), `expected market-backed fallback stage, got ${universe.pipeline.stage}`);
    assert.ok(['provisional_market_backed', 'locked'].includes(universe.pipeline.stageStatus), `expected usable fallback stage status, got ${universe.pipeline.stageStatus}`);
    assert.ok(result.data.runMetadata.symbols.length >= 8, 'expected profile-repaired fallback universe');
    const roleText = JSON.stringify(universe.subthemes || []);
    assert.ok(!/Provider profile group:/i.test(roleText), `provider profile groups must stay diagnostic-only, not dependency-map roles: ${roleText}`);
    assert.ok(!/direct providers\/operators|critical suppliers|tools\/services providers/i.test(roleText), `generic fallback archetypes must not masquerade as concrete dependency roles: ${roleText}`);
    assert.ok((universe.candidates || []).some((candidate) => candidate.providerGroup), 'generic fallback should preserve provider groups as diagnostics');
    assert.ok((universe.roles || []).length >= 2, 'profile-derived fallback should store concrete classification roles');
    assert.ok((universe.requiredDimensions || []).length >= 2, 'profile-derived fallback should store readiness dimensions');
    assert.ok((universe.candidates || []).some((candidate) => candidate.selected && ['direct', 'enabler'].includes(candidate.themeEvidence?.level) && candidate.subtheme && candidate.subtheme !== 'Provisional / unclassified'), 'profile-derived fallback should classify selected companies into concrete direct/enabler roles');
    assert.match(result.data.content, /Fallback query-derived generic buckets added discovery searches only/);
    assert.match(result.data.content, /Profile-derived role buckets repaired missing generated taxonomy/);
    assert.ok((universe.readiness?.roleCount || 0) >= 2, `profile-derived fallback should repair concrete role coverage: ${roleText}`);
    console.log(`research profile-derived fallback repair e2e smoke passed with status ${universe.status}`);
  } finally {
    if (priorDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = priorDebug;
    await fs.rm(testRoot, { recursive: true, force: true });
  }
}

async function main() {
  await runCompleteUniverseScenario();
  await runCollapsedBucketRepairScenario();
  await runBroadOnlyClassifierRescueScenario();
  await runLimitedRoleProvisionalDataScenario();
  await runNearReadyProvisionalScenario();
  await runVerifiedProfileLLMRoleRepairScenario();
  await runGenericFallbackCheckpointScenario();
}

main().catch(async (error) => {
  await fs.rm(testRoot, { recursive: true, force: true }).catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
