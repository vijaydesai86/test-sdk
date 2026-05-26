/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ResearchCandidateData {
  symbol: string;
  sourceFacets?: string[];
  price?: any;
  overview?: any;
  basicFinancials?: any;
  priceHistory?: any;
}

export interface ResearchUniverseWeights {
  themeRelevance: number;
  investmentReadiness: number;
  dataConfidence: number;
  liquidityScale: number;
  representativeCoverage: number;
}

export type ResearchThemeFit = 'core' | 'strong_adjacent' | 'weak_adjacent' | 'reject';

export interface ResearchCandidateScore {
  symbol: string;
  companyName: string;
  subtheme: string;
  themeFit: ResearchThemeFit;
  selected: boolean;
  totalScore: number;
  universeFitScore: number;
  themeScore: number;
  investmentReadinessScore: number;
  dataConfidenceScore: number;
  liquidityScaleScore: number;
  sourceFacetScore: number;
  representativeCoverageScore: number;
  factorScore: number;
  reasons: string[];
  exclusionReason?: string;
}

export interface ResearchUniverseSelection {
  query: string;
  requestedCount: number;
  candidateCount: number;
  selectedSymbols: string[];
  qualifiedSymbols: string[];
  rejectedSymbols: string[];
  weights: ResearchUniverseWeights;
  candidates: ResearchCandidateScore[];
  subthemes: Array<{ name: string; symbols: string[] }>;
  fitCounts: Record<ResearchThemeFit, number>;
  minThemeScore: number;
  strongAdjacentThemeScore: number;
  maxRoleShare: number;
  notes: string[];
}

type LLMFiller = (prompt: string) => Promise<string>;
type PricePoint = { date?: string; close?: string | number };

const DEFAULT_WEIGHTS: ResearchUniverseWeights = {
  themeRelevance: 0.40,
  investmentReadiness: 0.25,
  dataConfidence: 0.15,
  liquidityScale: 0.10,
  representativeCoverage: 0.10,
};

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'best', 'business', 'companies', 'company',
  'deep', 'equity', 'for', 'from', 'in', 'industry', 'investing', 'investment',
  'listed', 'market', 'of', 'on', 'public', 'publicly', 'report', 'research',
  'sector', 'stock', 'stocks', 'the', 'theme', 'to', 'traded', 'with',
]);

function normalizeSymbol(value: unknown): string {
  return String(value || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[$,%]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePercent(value: unknown): number | null {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeThemeFit(value: unknown): ResearchThemeFit | null {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (normalized === 'core') return 'core';
  if (normalized === 'strongadjacent' || normalized === 'adjacent' || normalized === 'strong') return 'strong_adjacent';
  if (normalized === 'weakadjacent' || normalized === 'weak') return 'weak_adjacent';
  if (normalized === 'reject' || normalized === 'rejected') return 'reject';
  return null;
}

function inferThemeFit(themeScore: number, llmFit: ResearchThemeFit | null, minThemeScore: number, strongAdjacentThemeScore: number): ResearchThemeFit {
  if (llmFit) {
    if (llmFit === 'core' && themeScore < strongAdjacentThemeScore) return 'weak_adjacent';
    if (llmFit === 'strong_adjacent' && themeScore < strongAdjacentThemeScore) return 'weak_adjacent';
    return llmFit;
  }
  if (themeScore >= minThemeScore) return 'core';
  if (themeScore >= strongAdjacentThemeScore) return 'strong_adjacent';
  if (themeScore >= Math.max(25, strongAdjacentThemeScore - 20)) return 'weak_adjacent';
  return 'reject';
}

function hasValue(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '' && value.trim().toUpperCase() !== 'N/A';
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === 'object') return Object.values(value).some(hasValue);
  return true;
}

function tokenize(value: string): string[] {
  return Array.from(new Set(value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))));
}

function metricValue(candidate: ResearchCandidateData, keys: string[]): number | null {
  const metric = candidate.basicFinancials?.metric || {};
  for (const key of keys) {
    const value = toNumber(metric[key] ?? candidate.basicFinancials?.[key] ?? candidate.overview?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function candidateProfileText(candidate: ResearchCandidateData): string {
  const overview = candidate.overview || {};
  return [
    candidate.symbol,
    overview.name,
    overview.sector,
    overview.industry,
    overview.description,
    ...(candidate.sourceFacets || []),
    overview.exchange,
  ].filter(Boolean).join(' ');
}

function inferSubtheme(candidate: ResearchCandidateData, llmSubtheme?: string): string {
  const cleanLlm = String(llmSubtheme || '').replace(/[^a-z0-9 /&.-]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (cleanLlm) return cleanLlm.slice(0, 60);
  const overview = candidate.overview || {};
  const industry = String(overview.industry || overview.Industry || '').trim();
  if (industry) return industry.slice(0, 60);
  const sector = String(overview.sector || overview.Sector || '').trim();
  if (sector) return sector.slice(0, 60);
  return 'Unclassified';
}

function scoreThemeRelevance(query: string, candidate: ResearchCandidateData, llmScore?: number | null, resolverRankScore = 0): number {
  const llm = llmScore === null || llmScore === undefined ? null : clamp(llmScore);
  const queryTokens = tokenize(query);
  const profileTokens = new Set(tokenize(candidateProfileText(candidate)));
  if (queryTokens.length === 0) return llm ?? 0;
  const matched = queryTokens.filter((token) => profileTokens.has(token)).length;
  const lexicalScore = clamp((matched / queryTokens.length) * 100);
  const facetTokens = new Set(tokenize((candidate.sourceFacets || []).join(' ')));
  const facetMatched = queryTokens.filter((token) => facetTokens.has(token)).length;
  const facetScore = queryTokens.length === 0 ? 0 : clamp((facetMatched / queryTokens.length) * 100);
  if (llm !== null) return clamp((llm * 0.72) + (lexicalScore * 0.12) + (facetScore * 0.08) + (resolverRankScore * 0.08));
  return Math.max(lexicalScore, resolverRankScore * 0.60);
}

function scoreSourceFacetSupport(candidate: ResearchCandidateData): number {
  const facets = Array.from(new Set((candidate.sourceFacets || []).map((item) => item.trim()).filter(Boolean)));
  if (facets.length === 0) return 35;
  return clamp(50 + (Math.min(4, facets.length) * 12.5));
}

function fitTierScore(fit: ResearchThemeFit): number {
  if (fit === 'core') return 100;
  if (fit === 'strong_adjacent') return 72;
  if (fit === 'weak_adjacent') return 25;
  return 0;
}

function scoreDataConfidence(candidate: ResearchCandidateData): number {
  const overview = candidate.overview || {};
  const fields = [
    candidate.price?.price,
    overview.name,
    overview.marketCapitalization ?? overview.MarketCapitalization,
    overview.sector ?? overview.Sector,
    overview.industry ?? overview.Industry,
    overview.description,
    metricValue(candidate, ['revenueGrowthTTM', 'revenueGrowthAnnual']),
    metricValue(candidate, ['epsGrowthTTM', 'epsGrowthAnnual']),
    metricValue(candidate, ['grossMarginTTM']),
    metricValue(candidate, ['operatingMarginTTM']),
    overview.forwardPE ?? metricValue(candidate, ['peNormalizedAnnual']),
  ];
  return clamp((fields.filter(hasValue).length / fields.length) * 100);
}

function scoreLiquidityScale(candidate: ResearchCandidateData): number {
  const marketCap = toNumber(candidate.overview?.marketCapitalization ?? candidate.overview?.MarketCapitalization);
  if (marketCap === null || marketCap <= 0) return 0;
  return clamp((Math.log10(marketCap) - 8) * 25);
}

function scoreFinancialFactors(candidate: ResearchCandidateData): number {
  const overview = candidate.overview || {};
  const revenueGrowth = normalizePercent(metricValue(candidate, ['revenueGrowthTTM', 'revenueGrowthAnnual']) ?? overview.quarterlyRevenueGrowth);
  const epsGrowth = normalizePercent(metricValue(candidate, ['epsGrowthTTM', 'epsGrowthAnnual']) ?? overview.quarterlyEarningsGrowth);
  const grossMargin = normalizePercent(metricValue(candidate, ['grossMarginTTM', 'grossProfitMarginTTM']) ?? overview.grossMarginTTM);
  const operatingMargin = normalizePercent(metricValue(candidate, ['operatingMarginTTM', 'operatingProfitMarginTTM']) ?? overview.operatingMargin);
  const roe = normalizePercent(metricValue(candidate, ['roeTTM', 'returnOnEquityTTM']) ?? overview.returnOnEquity);
  const forwardPE = toNumber(overview.forwardPE ?? metricValue(candidate, ['peNormalizedAnnual']));
  const pe = toNumber(overview.peRatio ?? metricValue(candidate, ['peBasicExclExtraTTM']));
  const priceChange = computePriceChange(candidate.priceHistory?.prices || []);

  const quality = average([
    grossMargin === null ? null : clamp((grossMargin / 60) * 100),
    operatingMargin === null ? null : clamp((operatingMargin / 35) * 100),
    roe === null ? null : clamp((roe / 30) * 100),
  ]);
  const growth = average([
    revenueGrowth === null ? null : clamp(((revenueGrowth + 10) / 40) * 100),
    epsGrowth === null ? null : clamp(((epsGrowth + 10) / 45) * 100),
  ]);
  const activePE = forwardPE ?? pe;
  const valuation = activePE === null || activePE <= 0
    ? null
    : clamp(100 - ((activePE - 15) / 60) * 100);
  const momentum = priceChange === null
    ? null
    : clamp(((priceChange + 30) / 90) * 100);

  return average([quality, growth, valuation, momentum]) ?? 0;
}

function average(values: Array<number | null | undefined>): number | null {
  const usable = values.filter((value): value is number => Number.isFinite(value));
  if (!usable.length) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function computePriceChange(prices: PricePoint[] = []): number | null {
  if (prices.length < 2) return null;
  const sorted = [...prices].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const first = toNumber(sorted[0]?.close);
  const last = toNumber(sorted[sorted.length - 1]?.close);
  if (!first || !last) return null;
  return ((last - first) / first) * 100;
}

function reasonForCandidate(candidate: ResearchCandidateData, score: Omit<ResearchCandidateScore, 'selected' | 'reasons'>): string[] {
  const reasons: string[] = [];
  if (score.themeFit === 'core') reasons.push('core theme fit');
  else if (score.themeFit === 'strong_adjacent') reasons.push('strong adjacent theme fit');
  else if (score.themeFit === 'weak_adjacent') reasons.push('weak adjacent theme fit');
  else reasons.push('rejected theme fit');
  if (score.sourceFacetScore >= 75) reasons.push('multi-facet theme support');
  if (score.dataConfidenceScore >= 70) reasons.push('good provider coverage');
  else if (score.dataConfidenceScore < 35) reasons.push('limited provider coverage');
  if (score.factorScore >= 70) reasons.push('strong preliminary financial factors');
  if (score.liquidityScaleScore >= 70) reasons.push('large/liquid scale');
  if (!hasValue(candidate.price?.price)) reasons.push('price unavailable');
  if (!hasValue(candidate.overview?.marketCapitalization ?? candidate.overview?.MarketCapitalization)) reasons.push('market cap unavailable');
  return reasons;
}

async function classifyThemeWithLLM(args: {
  query: string;
  candidates: ResearchCandidateData[];
  llmFill?: LLMFiller;
}): Promise<Record<string, { themeScore?: number; themeFit?: ResearchThemeFit; subtheme?: string; rationale?: string }>> {
  if (!args.llmFill || args.candidates.length === 0) return {};
  const payload = args.candidates.map((candidate) => ({
    symbol: candidate.symbol,
    name: candidate.overview?.name || candidate.symbol,
    sector: candidate.overview?.sector || candidate.overview?.Sector || '',
    industry: candidate.overview?.industry || candidate.overview?.Industry || '',
    description: String(candidate.overview?.description || '').slice(0, 500),
    sourceFacets: candidate.sourceFacets || [],
  }));
  const prompt = [
    `Classify each public company against the investment theme "${args.query}".`,
    'Use only the supplied company profile text. Do not add financial facts, supplier/customer claims, or unsupported claims.',
    'Fit definitions:',
    '- core: the company directly sells, enables, operates, or supplies a main activity in the user theme.',
    '- strong_adjacent: the company is a major platform, operator, supplier, or financial beneficiary with clear material exposure to the theme, but it is not a pure/direct role.',
    '- weak_adjacent: the company is broad, generic, or only loosely exposed.',
    '- reject: the supplied profile does not support meaningful exposure to the theme.',
    'Prefer rejecting broad companies unless the profile clearly connects them to the theme.',
    'Use theme-derived roles/subthemes, not generic provider sectors like Technology, Retail, or Media when a better role is supported.',
    'Return valid JSON only: {"candidates":[{"symbol":"TICKER","themeScore":0-100,"fit":"core|strong_adjacent|weak_adjacent|reject","subtheme":"theme role","rationale":"short evidence reason"}]}',
    JSON.stringify(payload),
  ].join('\n\n');
  try {
    const raw = await args.llmFill(prompt);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const rows = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    const result: Record<string, { themeScore?: number; themeFit?: ResearchThemeFit; subtheme?: string; rationale?: string }> = {};
    for (const row of rows) {
      const symbol = normalizeSymbol(row?.symbol);
      if (!symbol) continue;
      result[symbol] = {
        themeScore: toNumber(row?.themeScore) ?? undefined,
        themeFit: normalizeThemeFit(row?.fit) ?? undefined,
        subtheme: typeof row?.subtheme === 'string' ? row.subtheme : undefined,
        rationale: typeof row?.rationale === 'string' ? row.rationale : undefined,
      };
    }
    return result;
  } catch {
    return {};
  }
}

export async function selectResearchUniverse(args: {
  query: string;
  candidates: ResearchCandidateData[];
  finalCount: number;
  llmFill?: LLMFiller;
  weights?: Partial<ResearchUniverseWeights>;
  minThemeScore?: number;
  strongAdjacentThemeScore?: number;
  allowStrongAdjacent?: boolean;
  maxRoleShare?: number;
}): Promise<ResearchUniverseSelection> {
  const weights = { ...DEFAULT_WEIGHTS, ...(args.weights || {}) };
  const minThemeScore = clamp(args.minThemeScore ?? 70);
  const strongAdjacentThemeScore = clamp(args.strongAdjacentThemeScore ?? Math.max(55, minThemeScore - 15), 0, minThemeScore);
  const allowStrongAdjacent = args.allowStrongAdjacent !== false;
  const maxRoleShare = Math.min(1, Math.max(0.15, args.maxRoleShare ?? 0.35));
  const unique = new Map<string, ResearchCandidateData>();
  for (const candidate of args.candidates) {
    const symbol = normalizeSymbol(candidate.symbol);
    if (!symbol || !/^[A-Z0-9.]+$/.test(symbol)) continue;
    if (!unique.has(symbol)) unique.set(symbol, { ...candidate, symbol });
  }
  const candidates = Array.from(unique.values());
  const llmClassifications = await classifyThemeWithLLM({
    query: args.query,
    candidates,
    llmFill: args.llmFill,
  });

  const baseScores = candidates.map((candidate, index) => {
    const llm = llmClassifications[candidate.symbol] || {};
    const resolverRankScore = candidates.length <= 1
      ? 100
      : clamp(100 - ((index / (candidates.length - 1)) * 40));
    const themeScore = scoreThemeRelevance(args.query, candidate, llm.themeScore ?? null, resolverRankScore);
    const themeFit = inferThemeFit(themeScore, llm.themeFit ?? null, minThemeScore, strongAdjacentThemeScore);
    const dataConfidenceScore = scoreDataConfidence(candidate);
    const liquidityScaleScore = scoreLiquidityScale(candidate);
    const sourceFacetScore = scoreSourceFacetSupport(candidate);
    const factorScore = scoreFinancialFactors(candidate);
    const investmentReadinessScore = clamp((factorScore * 0.60) + (dataConfidenceScore * 0.25) + (liquidityScaleScore * 0.15));
    const subtheme = inferSubtheme(candidate, llm.subtheme);
    const universeFitScore = clamp(
      (themeScore * 0.36) +
      (fitTierScore(themeFit) * 0.26) +
      (sourceFacetScore * 0.12) +
      (dataConfidenceScore * 0.12) +
      (liquidityScaleScore * 0.07) +
      (factorScore * 0.07)
    );
    const totalScore = universeFitScore;
    const partial = {
      symbol: candidate.symbol,
      companyName: candidate.overview?.name || candidate.symbol,
      subtheme,
      themeFit,
      totalScore,
      universeFitScore,
      themeScore,
      investmentReadinessScore,
      dataConfidenceScore,
      liquidityScaleScore,
      sourceFacetScore,
      representativeCoverageScore: 0,
      factorScore,
      exclusionReason: undefined,
    };
    const reasons = reasonForCandidate(candidate, partial);
    if (llm.rationale) reasons.unshift(llm.rationale);
    return { ...partial, selected: false, reasons } as ResearchCandidateScore;
  });

  const pool = [...baseScores].sort((a, b) => b.totalScore - a.totalScore);
  const qualifiedPool = pool.filter((candidate) => {
    if (candidate.themeFit === 'core') return candidate.themeScore >= minThemeScore;
    if (candidate.themeFit === 'strong_adjacent') return allowStrongAdjacent && candidate.themeScore >= strongAdjacentThemeScore;
    return false;
  });
  const selected: ResearchCandidateScore[] = [];
  const selectedSubthemes = new Set<string>();
  const selectedRoleCounts = new Map<string, number>();
  const roleSoftCap = Math.max(2, Math.ceil(args.finalCount * maxRoleShare));
  const remaining = new Map(qualifiedPool.map((candidate) => [candidate.symbol, candidate]));
  while (selected.length < args.finalCount && remaining.size > 0) {
    let best: ResearchCandidateScore | null = null;
    let bestAdjusted = -Infinity;
    const candidatesToConsider = Array.from(remaining.values());
    const underRoleCap = candidatesToConsider.filter((candidate) => (selectedRoleCounts.get(candidate.subtheme) || 0) < roleSoftCap);
    const eligibleNow = underRoleCap.length > 0
      ? underRoleCap
      : candidatesToConsider.filter((candidate) => candidate.themeFit === 'core');
    const finalEligibleNow = eligibleNow.length > 0 ? eligibleNow : candidatesToConsider;
    for (const candidate of finalEligibleNow) {
      const coverageBonus = selectedSubthemes.has(candidate.subtheme) ? 0 : weights.representativeCoverage * 100;
      const rolePenalty = (selectedRoleCounts.get(candidate.subtheme) || 0) >= roleSoftCap ? weights.representativeCoverage * 50 : 0;
      const fitPriority = candidate.themeFit === 'core' ? 8 : 0;
      const adjusted = candidate.totalScore + coverageBonus + fitPriority - rolePenalty;
      if (adjusted > bestAdjusted) {
        best = candidate;
        bestAdjusted = adjusted;
      }
    }
    if (!best) break;
    best.selected = true;
    best.representativeCoverageScore = selectedSubthemes.has(best.subtheme) ? 50 : 100;
    best.totalScore = clamp(best.totalScore + (best.representativeCoverageScore * weights.representativeCoverage));
    selected.push(best);
    selectedSubthemes.add(best.subtheme);
    selectedRoleCounts.set(best.subtheme, (selectedRoleCounts.get(best.subtheme) || 0) + 1);
    remaining.delete(best.symbol);
  }

  for (const candidate of pool) {
    if (candidate.selected) continue;
    candidate.exclusionReason = candidate.themeFit === 'reject'
      ? 'Excluded: supplied profile does not support meaningful theme exposure.'
      : candidate.themeFit === 'weak_adjacent'
        ? 'Excluded: weak or generic theme exposure.'
        : candidate.themeFit === 'strong_adjacent' && !allowStrongAdjacent
          ? 'Excluded: strong-adjacent exposure disabled by configuration.'
          : candidate.themeScore < strongAdjacentThemeScore
            ? 'Excluded: below configured theme-fit gate.'
            : candidate.dataConfidenceScore < 35
              ? 'Excluded: weaker provider coverage than selected candidates.'
              : 'Excluded: lower combined score or redundant qualified role coverage.';
  }

  const subthemeMap = new Map<string, string[]>();
  for (const candidate of selected) {
    subthemeMap.set(candidate.subtheme, [...(subthemeMap.get(candidate.subtheme) || []), candidate.symbol]);
  }

  const fitCounts = pool.reduce<Record<ResearchThemeFit, number>>((counts, candidate) => {
    counts[candidate.themeFit] += 1;
    return counts;
  }, { core: 0, strong_adjacent: 0, weak_adjacent: 0, reject: 0 });
  const qualifiedSymbols = qualifiedPool.map((candidate) => candidate.symbol);
  const rejectedSymbols = pool
    .filter((candidate) => !qualifiedSymbols.includes(candidate.symbol))
    .map((candidate) => candidate.symbol);
  const shortfallNote = selected.length < args.finalCount
    ? [
        `Only ${selected.length} of ${args.finalCount} configured slots cleared the theme-fit gate; weak or unsupported candidates were not forced into the universe.`,
        'Quality gates, runtime budget, and provider-data limits favor a qualified partial universe over filling every configured slot.',
      ]
    : [];

  return {
    query: args.query,
    requestedCount: args.finalCount,
    candidateCount: candidates.length,
    selectedSymbols: selected.map((candidate) => candidate.symbol),
    qualifiedSymbols,
    rejectedSymbols,
    weights,
    candidates: pool,
    subthemes: Array.from(subthemeMap.entries()).map(([name, symbols]) => ({ name, symbols })),
    fitCounts,
    minThemeScore,
    strongAdjacentThemeScore,
    maxRoleShare,
    notes: [
      `Universe selection scored ${candidates.length} verified candidates for ${args.finalCount} configured slots.`,
      `Theme-fit gates: core >= ${minThemeScore.toFixed(0)}, strong adjacent >= ${strongAdjacentThemeScore.toFixed(0)}${allowStrongAdjacent ? '' : ' (strong adjacent disabled)'}.`,
      `Candidate fit mix: core ${fitCounts.core}, strong adjacent ${fitCounts.strong_adjacent}, weak adjacent ${fitCounts.weak_adjacent}, rejected ${fitCounts.reject}.`,
      ...shortfallNote,
      `Selection weights: theme purity, fit tier, source-facet support, data readiness, liquidity/scale, preliminary financial sanity, and representative coverage; financial attractiveness cannot override weak theme fit.`,
    ],
  };
}

export function buildResearchUniverseMermaid(query: string, selection: Pick<ResearchUniverseSelection, 'subthemes' | 'selectedSymbols'>): string {
  const cleanNode = (value: string) => value.replace(/[^a-zA-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Theme';
  const root = cleanNode(query);
  const lines = ['graph LR', `  Theme["${root}"]`];
  selection.subthemes.forEach((subtheme, index) => {
    const subthemeNode = `S${index}`;
    lines.push(`  Theme --> ${subthemeNode}["${cleanNode(subtheme.name)}"]`);
    for (const symbol of subtheme.symbols) {
      const symbolNode = symbol.replace(/[^A-Z0-9]/gi, '');
      lines.push(`  ${subthemeNode} --> ${symbolNode}["${symbol}"]`);
    }
  });
  if (selection.subthemes.length === 0) {
    for (const symbol of selection.selectedSymbols) {
      const symbolNode = symbol.replace(/[^A-Z0-9]/gi, '');
      lines.push(`  Theme --> ${symbolNode}["${symbol}"]`);
    }
  }
  return lines.join('\n');
}

export function buildResearchUniverseDependencySummary(selection: ResearchUniverseSelection): string {
  const subthemes = selection.subthemes.length
    ? selection.subthemes
    : [{ name: 'Selected universe', symbols: selection.selectedSymbols }];
  const roleLines = subthemes.map((subtheme) => `- **${subtheme.name}:** ${subtheme.symbols.join(', ')}`);
  const selectedScores = selection.candidates
    .filter((candidate) => candidate.selected)
    .sort((a, b) => b.totalScore - a.totalScore);
  const strongest = selectedScores[0];
  const weakest = selectedScores[selectedScores.length - 1];

  return [
    '### Role Map',
    'The dependency map groups selected companies by provider profile, industry, and grounded theme classification. It is a role/exposure map, not a claim of verified supplier or customer contracts.',
    roleLines.join('\n'),
    '### Universe Quality',
    strongest
      ? `Highest combined universe score: ${strongest.symbol} (${strongest.totalScore.toFixed(1)}/100).`
      : 'Highest combined universe score: N/A.',
    weakest && weakest !== strongest
      ? `Lowest selected combined universe score: ${weakest.symbol} (${weakest.totalScore.toFixed(1)}/100).`
      : '',
    '### Selection Constraints',
    `The final list is bounded by the configured company count (${selection.requestedCount}) and balances theme fit, investability/data quality, liquidity/scale, preliminary financial factors, and representative coverage.`,
  ].filter(Boolean).join('\n\n');
}
