import { describe, expect, it } from 'vitest';
import {
  buildResearchUniverseDependencySummary,
  buildResearchUniverseMermaid,
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
          { symbol: 'PAYX', themeScore: 30, fit: 'weak', subtheme: 'Payments' },
        ],
      }),
    });

    expect(selection.selectedSymbols).toEqual(expect.arrayContaining(['GPUA', 'MEMR']));
    expect(selection.selectedSymbols).not.toContain('PAYX');
    expect(selection.selectedSymbols).toHaveLength(2);
    expect(selection.rejectedSymbols).toContain('PAYX');
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
    expect(selection.notes.join('\n')).toContain('Only 1 of 3 configured slots cleared the theme-fit gate');
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
});
