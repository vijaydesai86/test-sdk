import { describe, expect, it } from 'vitest';
import {
  buildResearchUniverseDependencySummary,
  buildResearchUniverseMermaid,
  evaluateResearchUniverseReadiness,
  selectResearchUniverse,
  type ResearchCandidateData,
} from '../web/app/lib/researchUniverseSelector';
import { buildDeepSectorReport, type DeepSectorReportData } from '../web/app/lib/reportGenerator';

const candidate = (
  symbol: string,
  description: string,
  overrides: Partial<ResearchCandidateData> = {}
): ResearchCandidateData => ({
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
});

describe('research universe selection', () => {
  it('selects the configured number from data-backed candidates and prefers stronger theme fit', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      finalCount: 2,
      candidates: [
        candidate('GPUA', 'AI infrastructure accelerator chips for data center training and inference'),
        candidate('CLOU', 'AI infrastructure cloud data center compute platform'),
        candidate('FOOD', 'Discount retail grocery stores and household merchandise', {
          overview: {
            name: 'FOOD Corp',
            sector: 'Consumer Defensive',
            industry: 'Discount Stores',
            description: 'Discount retail grocery stores and household merchandise',
            marketCapitalization: 50_000_000_000,
            forwardPE: 16,
          },
        }),
      ],
    });

    expect(selection.selectedSymbols).toHaveLength(2);
    expect(selection.selectedSymbols).toEqual(expect.arrayContaining(['GPUA', 'CLOU']));
    expect(selection.selectedSymbols).not.toContain('FOOD');
  });

  it('uses representative coverage to avoid selecting only one role when scores are close', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      finalCount: 3,
      candidates: [
        candidate('GPUA', 'AI infrastructure accelerator chips for data center training'),
        candidate('GPUB', 'AI infrastructure accelerator chips for data center inference'),
        candidate('MEMR', 'AI infrastructure memory systems and high bandwidth storage'),
        candidate('POWR', 'AI infrastructure power management and data center cooling'),
      ],
      llmFill: async () => JSON.stringify({
        candidates: [
          { symbol: 'GPUA', themeScore: 95, subtheme: 'Compute accelerators' },
          { symbol: 'GPUB', themeScore: 94, subtheme: 'Compute accelerators' },
          { symbol: 'MEMR', themeScore: 92, subtheme: 'Memory and storage' },
          { symbol: 'POWR', themeScore: 91, subtheme: 'Power and cooling' },
        ],
      }),
    });

    const selectedRoles = selection.candidates
      .filter((row) => row.selected)
      .map((row) => row.subtheme);

    expect(selection.selectedSymbols).toHaveLength(3);
    expect(new Set(selectedRoles).size).toBeGreaterThan(1);
    expect(selection.subthemes.map((role) => role.name)).toEqual(expect.arrayContaining(['Compute accelerators', 'Memory and storage']));
  });

  it('does not let data quality or coverage pull weak theme-fit candidates into the universe', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      finalCount: 3,
      candidates: [
        candidate('GPUA', 'AI infrastructure accelerator chips for data center training'),
        candidate('MEMR', 'AI infrastructure high bandwidth memory systems'),
        candidate('PAYX', 'Digital payment processing and merchant checkout software', {
          overview: {
            name: 'PAYX Corp',
            sector: 'Financial Services',
            industry: 'Payments',
            description: 'Digital payment processing and merchant checkout software',
            marketCapitalization: 400_000_000_000,
            forwardPE: 12,
          },
        }),
      ],
      llmFill: async () => JSON.stringify({
        candidates: [
          { symbol: 'GPUA', themeScore: 94, fit: 'core', subtheme: 'Compute accelerators' },
          { symbol: 'MEMR', themeScore: 88, fit: 'core', subtheme: 'Memory and storage' },
          { symbol: 'PAYX', themeScore: 30, fit: 'weak_adjacent', subtheme: 'Payments' },
        ],
      }),
    });

    expect(selection.selectedSymbols).toEqual(expect.arrayContaining(['GPUA', 'MEMR']));
    expect(selection.selectedSymbols).not.toContain('PAYX');
    expect(selection.selectedSymbols).toHaveLength(2);
    expect(selection.rejectedSymbols).toContain('PAYX');
  });

  it('does not let unrelated high-quality companies enter a fresh thematic universe', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      finalCount: 3,
      candidates: [
        candidate('GPUA', 'AI infrastructure accelerator chips for data center training'),
        candidate('FOUN', 'Semiconductor foundry manufacturing advanced chips for data centers'),
        candidate('RETL', 'Discount retail stores and household merchandise', {
          overview: {
            name: 'RETL Corp',
            sector: 'Consumer Defensive',
            industry: 'Discount Stores',
            description: 'Discount retail stores and household merchandise',
            marketCapitalization: 500_000_000_000,
            forwardPE: 12,
          },
          basicFinancials: {
            metric: {
              revenueGrowthTTM: 0.30,
              epsGrowthTTM: 0.35,
              grossMarginTTM: 0.80,
              operatingMarginTTM: 0.45,
              roeTTM: 0.40,
            },
          },
        }),
      ],
      llmFill: async () => JSON.stringify({
        candidates: [
          { symbol: 'GPUA', themeScore: 94, fit: 'core', evidenceLevel: 'direct', subtheme: 'Compute accelerators', rationale: 'Profile directly supports AI compute.' },
          { symbol: 'FOUN', themeScore: 88, fit: 'strong_adjacent', evidenceLevel: 'enabler', subtheme: 'Foundry manufacturing', rationale: 'Profile supports chip manufacturing enablement.' },
          { symbol: 'RETL', themeScore: 8, fit: 'reject', evidenceLevel: 'unrelated', subtheme: 'Retail', rationale: 'Profile is consumer retail, not AI infrastructure.' },
        ],
      }),
    });

    expect(selection.selectedSymbols).toEqual(expect.arrayContaining(['GPUA', 'FOUN']));
    expect(selection.selectedSymbols).not.toContain('RETL');
    expect(selection.candidates.find((row) => row.symbol === 'RETL')?.qualified).toBe(false);
    expect(selection.candidates.find((row) => row.symbol === 'RETL')?.themeEvidence.level).toBe('unrelated');
  });

  it('returns fewer than the configured slots instead of forcing rejected candidates', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      finalCount: 3,
      candidates: [
        candidate('GPUA', 'AI infrastructure accelerator chips for data center training'),
        candidate('SHOP', 'Consumer retail stores and merchandise logistics', {
          overview: {
            name: 'SHOP Corp',
            sector: 'Consumer Defensive',
            industry: 'Retail',
            description: 'Consumer retail stores and merchandise logistics',
            marketCapitalization: 80_000_000_000,
            forwardPE: 18,
          },
        }),
      ],
      llmFill: async () => JSON.stringify({
        candidates: [
          { symbol: 'GPUA', themeScore: 92, fit: 'core', subtheme: 'Compute accelerators' },
          { symbol: 'SHOP', themeScore: 12, fit: 'reject', subtheme: 'Retail' },
        ],
      }),
    });

    expect(selection.selectedSymbols).toEqual(['GPUA']);
    expect(selection.notes.join('\n')).toContain('Only 1 of 3 configured slots cleared the theme evidence/fit gate');
  });

  it('selects strong-adjacent companies only after fit gates and still excludes weak-adjacent names', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      finalCount: 3,
      candidates: [
        candidate('CORE', 'AI infrastructure accelerator chips and systems', { sourceFacets: ['compute accelerators'] }),
        candidate('CLOU', 'Cloud data center platform for AI workloads', { sourceFacets: ['cloud data center operators'] }),
        candidate('GENR', 'Generic enterprise workflow software', {
          sourceFacets: ['software applications'],
          overview: {
            name: 'GENR Corp',
            sector: 'Technology',
            industry: 'Application Software',
            description: 'Generic enterprise workflow software',
            marketCapitalization: 500_000_000_000,
            forwardPE: 14,
          },
        }),
      ],
      llmFill: async () => JSON.stringify({
        candidates: [
          { symbol: 'CORE', themeScore: 96, fit: 'core', subtheme: 'Compute accelerators' },
          { symbol: 'CLOU', themeScore: 76, fit: 'strong_adjacent', subtheme: 'Cloud data center operators' },
          { symbol: 'GENR', themeScore: 48, fit: 'weak_adjacent', subtheme: 'Generic software' },
        ],
      }),
    });

    expect(selection.selectedSymbols).toEqual(expect.arrayContaining(['CORE', 'CLOU']));
    expect(selection.selectedSymbols).not.toContain('GENR');
    expect(selection.fitCounts.strong_adjacent).toBe(1);
    expect(selection.fitCounts.weak_adjacent).toBe(1);
  });

  it('treats verified role-bucket evidence as real theme evidence for broad provider profiles', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      finalCount: 4,
      candidates: [
        candidate('NVDA', 'Semiconductors and data center accelerators', {
          sourceFacets: ['Compute chip designers'],
          sourceEvidence: [{
            role: 'Compute chip designers',
            level: 'direct',
            confidence: 98,
            rationale: 'Designs GPUs used for AI training and inference.',
            source: 'theme-candidate-plan',
          }],
        }),
        candidate('MSFT', 'Enterprise software and cloud platform', {
          overview: {
            name: 'Microsoft Corp',
            sector: 'Technology',
            industry: 'Software Infrastructure',
            description: 'Enterprise software and cloud platform',
            marketCapitalization: 3_000_000_000_000,
            forwardPE: 30,
          },
          sourceFacets: ['Cloud/Data-center operators'],
          sourceEvidence: [{
            role: 'Cloud/Data-center operators',
            level: 'direct',
            confidence: 96,
            rationale: 'Operates cloud infrastructure for AI workloads.',
            source: 'theme-candidate-plan',
          }],
        }),
        candidate('AMZN', 'Online retail and cloud services', {
          overview: {
            name: 'Amazon.com Inc',
            sector: 'Consumer Cyclical',
            industry: 'Internet Retail',
            description: 'Online retail and cloud services',
            marketCapitalization: 2_500_000_000_000,
            forwardPE: 35,
          },
          sourceFacets: ['Cloud/Data-center operators'],
          sourceEvidence: [{
            role: 'Cloud/Data-center operators',
            level: 'direct',
            confidence: 95,
            rationale: 'Operates cloud infrastructure for AI workloads.',
            source: 'theme-candidate-plan',
          }],
        }),
        candidate('VRT', 'Electrical equipment and thermal management', {
          overview: {
            name: 'Vertiv Holdings Co',
            sector: 'Industrials',
            industry: 'Electrical Equipment',
            description: 'Electrical equipment and thermal management',
            marketCapitalization: 40_000_000_000,
            forwardPE: 32,
          },
          sourceFacets: ['Physical power/cooling infrastructure'],
          sourceEvidence: [{
            role: 'Physical power/cooling infrastructure',
            level: 'enabler',
            confidence: 90,
            rationale: 'Provides power and cooling infrastructure for data centers.',
            source: 'theme-candidate-plan',
          }],
        }),
      ],
      llmFill: async () => JSON.stringify({
        candidates: [
          { symbol: 'NVDA', themeScore: 88, fit: 'core', evidenceLevel: 'direct', subtheme: 'Compute chip designers' },
          { symbol: 'MSFT', themeScore: 50, fit: 'weak_adjacent', evidenceLevel: 'beneficiary', subtheme: 'Technology' },
          { symbol: 'AMZN', themeScore: 48, fit: 'weak_adjacent', evidenceLevel: 'beneficiary', subtheme: 'Retail' },
          { symbol: 'VRT', themeScore: 52, fit: 'weak_adjacent', evidenceLevel: 'beneficiary', subtheme: 'Electrical Equipment' },
        ],
      }),
    });

    expect(selection.selectedSymbols).toEqual(expect.arrayContaining(['NVDA', 'MSFT', 'AMZN', 'VRT']));
    expect(selection.candidates.find((row) => row.symbol === 'MSFT')?.themeEvidence.level).toBe('direct');
    expect(selection.candidates.find((row) => row.symbol === 'VRT')?.themeEvidence.level).toBe('enabler');
    expect(selection.subthemes.map((role) => role.name)).toEqual(expect.arrayContaining([
      'Compute chip designers',
      'Cloud/Data-center operators',
      'Physical power/cooling infrastructure',
    ]));
  });

  it('locked diagnostics preserves prior qualified universe metadata instead of reclassifying it away', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      finalCount: 3,
      mode: 'locked_diagnostics',
      candidates: [
        candidate('NVDA', 'Semiconductors', {
          preservedQualified: true,
          preservedThemeFit: 'core',
          preservedThemeScore: 88,
          preservedThemeEvidence: {
            role: 'Compute chip designers',
            level: 'direct',
            confidence: 96,
            rationale: 'Prior verified bucket evidence.',
          },
        }),
        candidate('MSFT', 'Enterprise software', {
          preservedQualified: true,
          preservedThemeFit: 'strong_adjacent',
          preservedThemeScore: 76,
          preservedThemeEvidence: {
            role: 'Cloud/Data-center operators',
            level: 'direct',
            confidence: 92,
            rationale: 'Prior verified bucket evidence.',
          },
        }),
        candidate('RETL', 'Discount retail stores', {
          preservedQualified: false,
          preservedThemeFit: 'reject',
          preservedThemeScore: 5,
          preservedThemeEvidence: {
            role: 'Retail',
            level: 'unrelated',
            confidence: 90,
            rationale: 'Prior rejected candidate.',
          },
        }),
      ],
      llmFill: async () => JSON.stringify({
        candidates: [
          { symbol: 'NVDA', themeScore: 90, fit: 'core', evidenceLevel: 'direct' },
          { symbol: 'MSFT', themeScore: 10, fit: 'reject', evidenceLevel: 'unrelated' },
          { symbol: 'RETL', themeScore: 95, fit: 'core', evidenceLevel: 'direct' },
        ],
      }),
    });

    expect(selection.selectedSymbols).toEqual(expect.arrayContaining(['NVDA', 'MSFT', 'RETL']));
    expect(selection.qualifiedSymbols).toEqual(expect.arrayContaining(['NVDA', 'MSFT']));
    expect(selection.qualifiedSymbols).not.toContain('RETL');
    expect(selection.candidates.find((row) => row.symbol === 'MSFT')?.themeEvidence.role).toBe('Cloud/Data-center operators');
  });

  it('uses role concentration controls without hardcoding any production sectors', async () => {
    const selection = await selectResearchUniverse({
      query: 'industrial automation',
      finalCount: 4,
      maxRoleShare: 0.5,
      candidates: [
        candidate('AONE', 'industrial automation robotics controller', { sourceFacets: ['robotics controllers'] }),
        candidate('ATWO', 'industrial automation robotics controller', { sourceFacets: ['robotics controllers'] }),
        candidate('ATHR', 'industrial automation robotics controller', { sourceFacets: ['robotics controllers'] }),
        candidate('AFOR', 'industrial automation robotics controller', { sourceFacets: ['robotics controllers'] }),
        candidate('SENS', 'industrial automation sensors and machine vision', { sourceFacets: ['sensors and vision'] }),
        candidate('SOFT', 'industrial automation software platform', { sourceFacets: ['automation software'] }),
      ],
      llmFill: async () => JSON.stringify({
        candidates: [
          { symbol: 'AONE', themeScore: 96, fit: 'core', subtheme: 'Robotics controllers' },
          { symbol: 'ATWO', themeScore: 95, fit: 'core', subtheme: 'Robotics controllers' },
          { symbol: 'ATHR', themeScore: 94, fit: 'core', subtheme: 'Robotics controllers' },
          { symbol: 'AFOR', themeScore: 93, fit: 'core', subtheme: 'Robotics controllers' },
          { symbol: 'SENS', themeScore: 88, fit: 'core', subtheme: 'Sensors and vision' },
          { symbol: 'SOFT', themeScore: 84, fit: 'core', subtheme: 'Automation software' },
        ],
      }),
    });

    const selectedRoles = selection.candidates
      .filter((row) => row.selected)
      .map((row) => row.subtheme);
    const roboticsCount = selectedRoles.filter((role) => role === 'Robotics controllers').length;

    expect(selection.selectedSymbols).toHaveLength(4);
    expect(roboticsCount).toBeLessThanOrEqual(2);
    expect(selectedRoles).toEqual(expect.arrayContaining(['Sensors and vision', 'Automation software']));
  });

  it('builds a dependency map and summary from selected role groups without needing an LLM ecosystem pass', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      finalCount: 2,
      candidates: [
        candidate('GPUA', 'AI infrastructure accelerator chips for data center training'),
        candidate('MEMR', 'AI infrastructure memory systems and high bandwidth storage'),
      ],
      llmFill: async () => JSON.stringify({
        candidates: [
          { symbol: 'GPUA', themeScore: 95, subtheme: 'Compute accelerators' },
          { symbol: 'MEMR', themeScore: 92, subtheme: 'Memory and storage' },
        ],
      }),
    });

    const graph = buildResearchUniverseMermaid('AI infrastructure', selection);
    const summary = buildResearchUniverseDependencySummary(selection);

    expect(graph).toContain('graph LR');
    expect(graph).toContain('GPUA');
    expect(graph).toContain('MEMR');
    expect(summary).toContain('role/exposure map');
    expect(summary).toContain('Compute accelerators');
  });

  it('keeps the full locked universe selected while exposing a smaller qualified subset', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      mode: 'locked_diagnostics',
      finalCount: 4,
      candidates: [
        candidate('GPUA', 'AI infrastructure accelerator chips for data center training'),
        candidate('CLOU', 'Cloud platform for AI workloads'),
        candidate('RETL', 'Discount retail stores and household merchandise', {
          overview: {
            name: 'RETL Corp',
            sector: 'Consumer Defensive',
            industry: 'Discount Stores',
            description: 'Discount retail stores and household merchandise',
            marketCapitalization: 80_000_000_000,
            forwardPE: 16,
          },
        }),
        candidate('PAYX', 'Digital payment processing and merchant checkout software', {
          overview: {
            name: 'PAYX Corp',
            sector: 'Financial Services',
            industry: 'Payments',
            description: 'Digital payment processing and merchant checkout software',
            marketCapitalization: 100_000_000_000,
            forwardPE: 15,
          },
        }),
      ],
      llmFill: async () => JSON.stringify({
        candidates: [
          { symbol: 'GPUA', themeScore: 95, fit: 'core', evidenceLevel: 'direct', subtheme: 'Compute accelerators' },
          { symbol: 'CLOU', themeScore: 78, fit: 'strong_adjacent', evidenceLevel: 'enabler', subtheme: 'Cloud AI platforms' },
          { symbol: 'RETL', themeScore: 5, fit: 'reject', evidenceLevel: 'unrelated', subtheme: 'Retail' },
          { symbol: 'PAYX', themeScore: 10, fit: 'reject', evidenceLevel: 'unrelated', subtheme: 'Payments' },
        ],
      }),
    });

    expect(selection.selectedSymbols).toEqual(expect.arrayContaining(['GPUA', 'CLOU', 'RETL', 'PAYX']));
    expect(selection.qualifiedSymbols).toEqual(expect.arrayContaining(['GPUA', 'CLOU']));
    expect(selection.qualifiedSymbols).not.toContain('RETL');
    expect(selection.qualifiedSymbols).not.toContain('PAYX');

    const graph = buildResearchUniverseMermaid('AI infrastructure', selection);
    expect(graph).toContain('GPUA');
    expect(graph).toContain('CLOU');
    expect(graph).toContain('RETL');
    expect(graph).toContain('PAYX');
  });
});

describe('research report rendering', () => {
  it('renders universe selection and selective research allocation instead of forced comparison allocation', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      finalCount: 2,
      candidates: [
        candidate('GPUA', 'AI infrastructure accelerator chips for data center training'),
        candidate('MEMR', 'AI infrastructure memory systems and high bandwidth storage'),
      ],
      llmFill: async () => JSON.stringify({
        candidates: [
          { symbol: 'GPUA', themeScore: 95, subtheme: 'Compute accelerators' },
          { symbol: 'MEMR', themeScore: 92, subtheme: 'Memory and storage' },
        ],
      }),
    });
    const report: DeepSectorReportData = {
      sectorQuery: 'AI infrastructure',
      selectedBy: 'llm',
      generatedAt: '2026-01-01T00:00:00Z',
      range: '1y',
      universe: selection.selectedSymbols,
      initialCandidates: selection.candidates.map((row) => row.symbol),
      universeSelection: selection,
      dependencyAnalysis: buildResearchUniverseDependencySummary(selection),
      ecosystemDiagram: buildResearchUniverseMermaid('AI infrastructure', selection),
      items: selection.selectedSymbols.map((symbol) => ({
        symbol,
        price: { price: 100 },
        overview: {
          name: `${symbol} Corp`,
          marketCapitalization: 200_000_000_000,
          sector: 'Technology',
          industry: 'Semiconductors',
          forwardPE: 25,
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
      })),
      notes: ['Provider X high-priority field unavailable'],
    };

    const content = buildDeepSectorReport(report);

    expect(content).toContain('## 🧭 Universe Selection');
    expect(content).toContain('## 🕸️ Research Ecosystem & Dependencies');
    expect(content).toContain('## 🧭 Research Allocation Scenario (Not Investment Advice)');
    expect(content).not.toContain('## 🧭 Indicative Allocation (Not Investment Advice)');
    expect(content).not.toContain('## 🏦 Balance Sheet & Cash');
    expect(content).toContain('## ⚠️ Data Quality Summary');
  });

  it('renders locked research updates without shrinking the dependency graph or recommending weak locked names', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      mode: 'locked_diagnostics',
      finalCount: 3,
      candidates: [
        candidate('GPUA', 'AI infrastructure accelerator chips for data center training'),
        candidate('CLOU', 'Cloud platform for AI workloads'),
        candidate('RETL', 'Discount retail stores and household merchandise', {
          overview: {
            name: 'RETL Corp',
            sector: 'Consumer Defensive',
            industry: 'Discount Stores',
            description: 'Discount retail stores and household merchandise',
            marketCapitalization: 80_000_000_000,
            forwardPE: 16,
          },
        }),
      ],
      llmFill: async () => JSON.stringify({
        candidates: [
          { symbol: 'GPUA', themeScore: 95, fit: 'core', evidenceLevel: 'direct', subtheme: 'Compute accelerators' },
          { symbol: 'CLOU', themeScore: 78, fit: 'strong_adjacent', evidenceLevel: 'enabler', subtheme: 'Cloud AI platforms' },
          { symbol: 'RETL', themeScore: 5, fit: 'reject', evidenceLevel: 'unrelated', subtheme: 'Retail' },
        ],
      }),
    });
    const report: DeepSectorReportData = {
      sectorQuery: 'AI infrastructure',
      selectedBy: 'manual',
      generatedAt: '2026-01-01T00:00:00Z',
      range: '1y',
      universe: ['GPUA', 'CLOU', 'RETL'],
      initialCandidates: ['GPUA', 'CLOU', 'RETL'],
      universeSelection: selection,
      dependencyAnalysis: buildResearchUniverseDependencySummary(selection),
      ecosystemDiagram: buildResearchUniverseMermaid('AI infrastructure', selection),
      items: ['GPUA', 'CLOU', 'RETL'].map((symbol) => ({
        symbol,
        price: { price: 100 },
        overview: {
          name: `${symbol} Corp`,
          marketCapitalization: 200_000_000_000,
          sector: symbol === 'RETL' ? 'Consumer Defensive' : 'Technology',
          industry: symbol === 'RETL' ? 'Discount Stores' : 'Semiconductors',
          forwardPE: symbol === 'RETL' ? 12 : 25,
        },
        basicFinancials: {
          metric: {
            revenueGrowthTTM: 0.25,
            epsGrowthTTM: 0.20,
            grossMarginTTM: symbol === 'RETL' ? 0.85 : 0.55,
            operatingMarginTTM: symbol === 'RETL' ? 0.45 : 0.30,
            roeTTM: symbol === 'RETL' ? 0.45 : 0.25,
          },
        },
      })),
      notes: [],
    };

    const content = buildDeepSectorReport(report);

    expect(content).toContain('Locked companies: 3. Qualified allocation subset: GPUA, CLOU.');
    expect(content).toContain('RETL');
    expect(content).toContain('Qualified research subset: GPUA, CLOU');
    expect(content).not.toContain('Fresh-entry buys: RETL');
  });

  it('does not allow broad resolver beneficiary evidence to qualify or lock a fresh universe', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      finalCount: 3,
      candidates: [
        candidate('MSFT', 'Broad technology and software company', {
          sourceFacets: ['Broad resolver raw candidate'],
          sourceEvidence: [{
            role: 'Broad resolver raw candidate',
            level: 'beneficiary',
            rationale: 'Raw broad resolver result.',
            confidence: 80,
            source: 'broad-theme-resolver',
          }],
        }),
        candidate('AMZN', 'Broad online retail and cloud services company', {
          sourceFacets: ['Broad resolver raw candidate'],
          sourceEvidence: [{
            role: 'Broad resolver raw candidate',
            level: 'beneficiary',
            rationale: 'Raw broad resolver result.',
            confidence: 80,
            source: 'broad-theme-resolver',
          }],
        }),
      ],
    });

    expect(selection.selectedSymbols).toEqual([]);
    expect(selection.qualifiedSymbols).toEqual([]);

    const readiness = evaluateResearchUniverseReadiness({
      selection,
      roles: [{ label: 'Broad theme resolver' }],
      requiredDimensions: [{ label: 'compute accelerators' }, { label: 'cloud operators' }],
      targetCount: 3,
    });
    expect(readiness.status).not.toBe('locked');
    expect(readiness.repairActions.join(' ')).toContain('broad');
  });

  it('locks only when enough concrete role dimensions are covered by direct/enabler candidates', async () => {
    const selection = await selectResearchUniverse({
      query: 'AI infrastructure',
      finalCount: 6,
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
        candidate('NETW', 'Data center networking switches for AI clusters', {
          sourceEvidence: [{ role: 'Networking/connectivity', level: 'enabler', rationale: 'AI networking.', confidence: 90 }],
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
      ],
      requiredDimensions: [
        { label: 'compute accelerators' },
        { label: 'cloud/data-center operators' },
        { label: 'foundry/manufacturing' },
        { label: 'semiconductor equipment' },
        { label: 'memory/storage' },
        { label: 'networking/connectivity' },
      ],
      targetCount: 6,
    });

    expect(selection.selectedSymbols).toHaveLength(6);
    expect(readiness.status).toBe('locked');
    expect(readiness.coveredDimensions).toEqual(expect.arrayContaining(['compute accelerators', 'semiconductor equipment']));
  });
});
