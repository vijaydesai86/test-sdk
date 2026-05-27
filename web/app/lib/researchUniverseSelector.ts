/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ResearchCandidateData {
  symbol: string;
  sourceFacets?: string[];
  sourceEvidence?: ResearchSourceEvidence[];
  companyNames?: string[];
  preservedThemeEvidence?: ResearchThemeEvidence;
  preservedThemeFit?: ResearchThemeFit;
  preservedThemeScore?: number;
  preservedQualified?: boolean;
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
export type ResearchThemeEvidenceLevel = 'direct' | 'enabler' | 'beneficiary' | 'unrelated';
export type ResearchSelectionMode = 'fresh_selection' | 'locked_diagnostics';
export type ResearchUniverseStatus = 'discovering' | 'refining' | 'locked' | 'failed';

export interface ResearchThemeEvidence {
  level: ResearchThemeEvidenceLevel;
  role: string;
  rationale: string;
  confidence: number;
}

export interface ResearchSourceEvidence {
  role: string;
  level: ResearchThemeEvidenceLevel;
  rationale: string;
  confidence: number;
  source?: string;
}

export interface ResearchRequiredDimension {
  label: string;
  required?: boolean;
  searchQueries?: string[];
  rationale?: string;
}

export interface ResearchUniverseRole {
  label: string;
  definition?: string;
  required?: boolean;
  query?: string;
  dimensions?: string[];
  searchQueries?: string[];
}

export interface ResearchCandidateScore {
  symbol: string;
  companyName: string;
  subtheme: string;
  themeEvidence: ResearchThemeEvidence;
  themeFit: ResearchThemeFit;
  selected: boolean;
  qualified: boolean;
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
  mode: ResearchSelectionMode;
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

export interface ResearchUniverseReadiness {
  status: ResearchUniverseStatus;
  selectedCount: number;
  targetLockCount: number;
  targetPartialCount: number;
  roleCount: number;
  minRoleCount: number;
  directEnablerShare: number;
  broadShare: number;
  coveredDimensions: string[];
  missingDimensions: string[];
  repairActions: string[];
  canBuildFullReport: boolean;
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

const BROAD_ROLE_RE = /\b(broad|generic|catch\s*all|misc|general|beneficiar(?:y|ies)|theme resolver|resolver raw|fallback)\b/i;

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

export function isBroadResearchRole(value: unknown): boolean {
  return BROAD_ROLE_RE.test(String(value || ''));
}

function normalizeEvidenceLevel(value: unknown): ResearchThemeEvidenceLevel | null {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (normalized === 'direct' || normalized === 'core') return 'direct';
  if (normalized === 'enabler' || normalized === 'infrastructureenabler' || normalized === 'supplier' || normalized === 'operator') return 'enabler';
  if (normalized === 'beneficiary' || normalized === 'adjacent' || normalized === 'platform') return 'beneficiary';
  if (normalized === 'unrelated' || normalized === 'reject' || normalized === 'weak') return 'unrelated';
  return null;
}

function evidenceToFit(evidence: ResearchThemeEvidence, themeScore: number, minThemeScore: number, strongAdjacentThemeScore: number): ResearchThemeFit {
  if (evidence.level === 'direct' && themeScore >= minThemeScore) return 'core';
  if ((evidence.level === 'direct' || evidence.level === 'enabler') && themeScore >= strongAdjacentThemeScore) return 'strong_adjacent';
  if (evidence.level === 'unrelated') return 'reject';
  return 'weak_adjacent';
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

function candidateProviderProfileText(candidate: ResearchCandidateData): string {
  const overview = candidate.overview || {};
  return [
    candidate.symbol,
    overview.name,
    overview.sector,
    overview.industry,
    overview.description,
    overview.exchange,
  ].filter(Boolean).join(' ');
}

function inferSubtheme(candidate: ResearchCandidateData, llmSubtheme?: string): string {
  const cleanLlm = String(llmSubtheme || '').replace(/[^a-z0-9 /&.-]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (cleanLlm) return cleanLlm.slice(0, 60);
  const evidenceRole = bestSourceEvidence(candidate)?.role;
  if (evidenceRole) return evidenceRole.slice(0, 60);
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
  const profileTokens = new Set(tokenize(candidateProviderProfileText(candidate)));
  const sourceEvidence = bestSourceEvidence(candidate);
  const sourceEvidenceScore = sourceEvidence
    ? clamp((evidenceTierScore({
        level: sourceEvidence.level,
        role: sourceEvidence.role,
        rationale: sourceEvidence.rationale,
        confidence: sourceEvidence.confidence,
      }) * 0.70) + (sourceEvidence.confidence * 0.30))
    : null;
  if (queryTokens.length === 0) return llm ?? 0;
  const matched = queryTokens.filter((token) => profileTokens.has(token)).length;
  const lexicalScore = clamp((matched / queryTokens.length) * 100);
  if (llm !== null && sourceEvidenceScore !== null) {
    return clamp((llm * 0.45) + (sourceEvidenceScore * 0.40) + (lexicalScore * 0.10) + (resolverRankScore * 0.05));
  }
  if (llm !== null) return clamp((llm * 0.76) + (lexicalScore * 0.14) + (resolverRankScore * 0.10));
  return Math.max(lexicalScore, resolverRankScore * 0.35, sourceEvidenceScore ?? 0);
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

function evidenceTierScore(evidence: ResearchThemeEvidence): number {
  if (evidence.level === 'direct') return 100;
  if (evidence.level === 'enabler') return 88;
  if (evidence.level === 'beneficiary') return 58;
  return 0;
}

function roleCoveragePriorityScore(candidate: ResearchCandidateScore): number {
  return (
    candidate.themeScore * 0.42 +
    evidenceTierScore(candidate.themeEvidence) * 0.24 +
    candidate.themeEvidence.confidence * 0.16 +
    candidate.sourceFacetScore * 0.10 +
    candidate.dataConfidenceScore * 0.05 +
    candidate.factorScore * 0.03
  );
}

function roleTextOverlapScore(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = tokenize(right);
  if (!leftTokens.size || !rightTokens.length) return 0;
  const overlap = rightTokens.filter((token) => leftTokens.has(token)).length;
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  const exactBonus = normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft) ? 5 : 0;
  return overlap + exactBonus;
}

function roleRequirementWeight(roleName: string, roles: ResearchUniverseRole[] = []): number {
  if (!roles.length) return 1;
  let bestScore = 0;
  let bestWeight = 0.8;
  for (const role of roles) {
    const roleInput = [
      role.label,
      role.definition,
      role.query,
      ...(role.dimensions || []),
      ...(role.searchQueries || []),
    ].filter(Boolean).join(' ');
    const score = Math.max(
      roleTextOverlapScore(roleName, roleInput),
      roleTextOverlapScore(roleInput, roleName)
    );
    if (score > bestScore) {
      bestScore = score;
      bestWeight = role.required === false ? 0.6 : 1;
    }
  }
  return bestScore > 0 ? bestWeight : 0.8;
}

function roleCentralityWeight(roleName: string, roles: ResearchUniverseRole[] = []): number {
  if (!roles.length) return 0.5;
  let bestScore = 0;
  let bestIndex = roles.length;
  roles.forEach((role, index) => {
    const roleInput = [
      role.label,
      role.definition,
      role.query,
      ...(role.dimensions || []),
      ...(role.searchQueries || []),
    ].filter(Boolean).join(' ');
    const score = Math.max(
      roleTextOverlapScore(roleName, roleInput),
      roleTextOverlapScore(roleInput, roleName)
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  if (bestScore <= 0) return 0.5;
  return Math.max(0, 1 - (bestIndex / Math.max(1, roles.length)));
}

function bestSourceEvidence(candidate: ResearchCandidateData): ResearchSourceEvidence | null {
  const evidence = (candidate.sourceEvidence || [])
    .map((item) => ({
      role: String(item.role || '').trim(),
      level: normalizeEvidenceLevel(item.level) || 'unrelated',
      rationale: String(item.rationale || '').trim(),
      confidence: clamp(toNumber(item.confidence) ?? 0),
      source: item.source,
    }))
    .filter((item) => item.role && item.level !== 'unrelated' && !isBroadResearchRole(item.role))
    .sort((a, b) => {
      const tierDelta = evidenceTierScore({
        level: b.level,
        role: b.role,
        rationale: b.rationale,
        confidence: b.confidence,
      }) - evidenceTierScore({
        level: a.level,
        role: a.role,
        rationale: a.rationale,
        confidence: a.confidence,
      });
      return tierDelta || b.confidence - a.confidence;
    });
  return evidence[0] || null;
}

function hasDirectEnablerEvidence(score: Pick<ResearchCandidateScore, 'themeEvidence' | 'subtheme'>): boolean {
  return (score.themeEvidence.level === 'direct' || score.themeEvidence.level === 'enabler')
    && !isBroadResearchRole(score.themeEvidence.role)
    && !isBroadResearchRole(score.subtheme);
}

function dimensionText(value: ResearchRequiredDimension | ResearchUniverseRole | string): string {
  if (typeof value === 'string') return value;
  return [
    value.label,
    'definition' in value ? value.definition : '',
    'query' in value ? value.query : '',
    Array.isArray(value.searchQueries) ? value.searchQueries.join(' ') : '',
    'dimensions' in value && Array.isArray(value.dimensions) ? value.dimensions.join(' ') : '',
  ].filter(Boolean).join(' ');
}

function overlapsDimension(roleText: string, dimension: ResearchRequiredDimension): boolean {
  const roleTokens = new Set(tokenize(roleText));
  const dimensionTokens = tokenize(dimensionText(dimension));
  if (dimensionTokens.length === 0) return false;
  const matches = dimensionTokens.filter((token) => roleTokens.has(token)).length;
  return matches >= Math.min(2, dimensionTokens.length) || matches / dimensionTokens.length >= 0.45;
}

export function evaluateResearchUniverseReadiness(args: {
  selection: ResearchUniverseSelection;
  roles?: ResearchUniverseRole[];
  requiredDimensions?: ResearchRequiredDimension[];
  targetCount?: number;
  minSelectedRatio?: number;
  partialSelectedRatio?: number;
  minDirectEnablerShare?: number;
  maxBroadShare?: number;
  minRoleCount?: number;
}): ResearchUniverseReadiness {
  const targetCount = Math.max(1, args.targetCount ?? args.selection.requestedCount);
  const targetLockCount = Math.max(1, Math.ceil(targetCount * Math.min(1, Math.max(0.2, args.minSelectedRatio ?? 0.80))));
  const targetPartialCount = Math.max(1, Math.ceil(targetCount * Math.min(1, Math.max(0.1, args.partialSelectedRatio ?? 0.45))));
  const selected = args.selection.candidates.filter((candidate) => candidate.selected);
  const directSelected = selected.filter(hasDirectEnablerEvidence);
  const broadSelected = selected.filter((candidate) => isBroadResearchRole(candidate.subtheme) || isBroadResearchRole(candidate.themeEvidence.role));
  const selectedCount = directSelected.length;
  const selectedTotal = Math.max(1, selected.length);
  const directEnablerShare = directSelected.length / selectedTotal;
  const broadShare = broadSelected.length / selectedTotal;
  const roleNames = Array.from(new Set(directSelected.map((candidate) => candidate.subtheme).filter((role) => role && !isBroadResearchRole(role))));
  const roleCount = roleNames.length;
  const configuredMinRoleCount = args.minRoleCount ?? Math.min(5, Math.max(2, Math.ceil(targetCount / 4)));
  const minRoleCount = Math.min(configuredMinRoleCount, Math.max(1, targetLockCount));
  const requiredDimensions = (args.requiredDimensions || [])
    .map((dimension) => ({
      ...dimension,
      label: String(dimension.label || '').trim(),
      required: dimension.required !== false,
    }))
    .filter((dimension) => dimension.label);
  const roleInputs = [
    ...(args.roles || []),
    ...roleNames.map((label) => ({ label })),
  ].filter((role) => role.label && !isBroadResearchRole(role.label));
  const coveredDimensions = requiredDimensions
    .filter((dimension) => roleInputs.some((role) => overlapsDimension(dimensionText(role), dimension)))
    .map((dimension) => dimension.label);
  const missingDimensions = requiredDimensions
    .filter((dimension) => dimension.required !== false && !coveredDimensions.includes(dimension.label))
    .map((dimension) => dimension.label);
  const minDimensionCoverage = requiredDimensions.length
    ? Math.min(requiredDimensions.length, Math.max(2, Math.ceil(requiredDimensions.length * 0.65)))
    : 0;
  const dimensionReady = requiredDimensions.length === 0 || coveredDimensions.length >= minDimensionCoverage;
  const directShareReady = directEnablerShare >= Math.min(1, Math.max(0, args.minDirectEnablerShare ?? 0.75));
  const broadShareReady = broadShare <= Math.min(1, Math.max(0, args.maxBroadShare ?? 0.05));
  const roleReady = roleCount >= minRoleCount;
  const countReady = selectedCount >= targetLockCount;
  const repairActions: string[] = [];
  if (!countReady) repairActions.push(`Continue candidate discovery until at least ${targetLockCount} direct/enabler companies clear the theme gate.`);
  if (!roleReady) repairActions.push(`Classify candidates into at least ${minRoleCount} concrete theme roles; broad/catch-all roles cannot lock the universe.`);
  if (!directShareReady) repairActions.push('Reclassify or reject beneficiary-only candidates before allocation or conclusion.');
  if (!broadShareReady) repairActions.push('Quarantine broad resolver candidates until provider profiles support a concrete theme role.');
  if (!dimensionReady && missingDimensions.length) repairActions.push(`Expand discovery for missing required dimensions: ${missingDimensions.join(', ')}.`);

  const status: ResearchUniverseStatus = countReady && roleReady && directShareReady && broadShareReady && dimensionReady
    ? 'locked'
    : selected.length >= targetPartialCount || selectedCount >= targetPartialCount
      ? 'refining'
      : selected.length > 0
        ? 'discovering'
        : 'failed';

  return {
    status,
    selectedCount,
    targetLockCount,
    targetPartialCount,
    roleCount,
    minRoleCount,
    directEnablerShare,
    broadShare,
    coveredDimensions,
    missingDimensions,
    repairActions,
    canBuildFullReport: status === 'locked',
  };
}

function buildHeuristicEvidence(args: {
  query: string;
  candidate: ResearchCandidateData;
  resolverRankScore: number;
  llmEvidenceLevel?: ResearchThemeEvidenceLevel | null;
  llmRationale?: string;
  llmSubtheme?: string;
  llmConfidence?: number | null;
  themeScore: number;
  minThemeScore: number;
  strongAdjacentThemeScore: number;
}): ResearchThemeEvidence {
  if (args.candidate.preservedThemeEvidence) {
    return args.candidate.preservedThemeEvidence;
  }
  const providerText = candidateProviderProfileText(args.candidate);
  const providerTokens = new Set(tokenize(providerText));
  const queryTokens = tokenize(args.query);
  const facetTokens = new Set(tokenize((args.candidate.sourceFacets || []).join(' ')));
  const sourceEvidence = bestSourceEvidence(args.candidate);
  const queryMatches = queryTokens.filter((token) => providerTokens.has(token)).length;
  const facetProviderMatches = Array.from(facetTokens).filter((token) => providerTokens.has(token)).length;
  const profileEvidenceStrong = queryMatches >= Math.min(2, queryTokens.length) || facetProviderMatches >= 2;
  const profileEvidenceModerate = queryMatches >= 1 || facetProviderMatches >= 1;
  const role = inferSubtheme(args.candidate, args.llmSubtheme);
  const llmConfidence = clamp(args.llmConfidence ?? 60);

  if (
    sourceEvidence &&
    (sourceEvidence.level === 'direct' || sourceEvidence.level === 'enabler') &&
    sourceEvidence.confidence >= 65 &&
    !(args.llmEvidenceLevel === 'unrelated' && llmConfidence >= 90)
  ) {
    return {
      level: sourceEvidence.level,
      role: sourceEvidence.role,
      rationale: sourceEvidence.rationale || 'Verified bucket evidence supports material theme exposure.',
      confidence: Math.max(sourceEvidence.confidence, profileEvidenceStrong ? 75 : 0),
    };
  }

  if (args.llmEvidenceLevel === 'direct' || args.llmEvidenceLevel === 'enabler') {
    const level = profileEvidenceModerate || args.themeScore >= args.minThemeScore
      ? args.llmEvidenceLevel
      : 'beneficiary';
    return {
      level,
      role,
      rationale: args.llmRationale || (profileEvidenceModerate ? 'Profile evidence supports material theme exposure.' : 'LLM evidence was not strongly corroborated by provider profile text.'),
      confidence: profileEvidenceStrong ? Math.max(llmConfidence, 75) : llmConfidence,
    };
  }

  if (args.llmEvidenceLevel === 'beneficiary') {
    return {
      level: profileEvidenceModerate || args.themeScore >= args.strongAdjacentThemeScore ? 'beneficiary' : 'unrelated',
      role,
      rationale: args.llmRationale || 'Broad beneficiary exposure only.',
      confidence: llmConfidence,
    };
  }

  if (args.llmEvidenceLevel === 'unrelated') {
    return {
      level: 'unrelated',
      role,
      rationale: args.llmRationale || 'Provider profile does not support material theme exposure.',
      confidence: llmConfidence,
    };
  }

  if (profileEvidenceStrong) {
    return {
      level: 'enabler',
      role,
      rationale: 'Provider profile has direct overlap with the requested theme or source role.',
      confidence: 72,
    };
  }
  if (profileEvidenceModerate || args.resolverRankScore >= 85) {
    return {
      level: 'beneficiary',
      role,
      rationale: profileEvidenceModerate
        ? 'Provider profile has partial overlap with the requested theme or source role.'
        : 'High-ranked resolver candidate without enough profile evidence for direct/enabler status.',
      confidence: profileEvidenceModerate ? 58 : 45,
    };
  }
  return {
    level: 'unrelated',
    role,
    rationale: 'No sufficient provider-profile evidence for theme membership.',
    confidence: 50,
  };
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
  reasons.push(`${score.themeEvidence.level} theme evidence`);
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
}): Promise<Record<string, { themeScore?: number; themeFit?: ResearchThemeFit; evidenceLevel?: ResearchThemeEvidenceLevel; evidenceConfidence?: number; subtheme?: string; rationale?: string }>> {
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
    'Separately classify evidenceLevel:',
    '- direct: supplied profile shows direct products/services/operations in the theme.',
    '- enabler: supplied profile shows supplier, infrastructure, platform, or operator exposure that enables the theme.',
    '- beneficiary: broad financial or platform beneficiary with plausible but not direct profile evidence.',
    '- unrelated: profile does not support meaningful theme membership.',
    'Fit definitions:',
    '- core: the company directly sells, enables, operates, or supplies a main activity in the user theme.',
    '- strong_adjacent: the company is a major platform, operator, supplier, or financial beneficiary with clear material exposure to the theme, but it is not a pure/direct role.',
    '- weak_adjacent: the company is broad, generic, or only loosely exposed.',
    '- reject: the supplied profile does not support meaningful exposure to the theme.',
    'Prefer rejecting broad companies unless the profile clearly connects them to the theme.',
    'Use theme-derived roles/subthemes, not generic provider sectors like Technology, Retail, or Media when a better role is supported.',
    'Return weak_adjacent/reject when evidenceLevel is unrelated. Discovery/sourceFacets are hints, not proof.',
    'Return valid JSON only: {"candidates":[{"symbol":"TICKER","themeScore":0-100,"fit":"core|strong_adjacent|weak_adjacent|reject","evidenceLevel":"direct|enabler|beneficiary|unrelated","evidenceConfidence":0-100,"subtheme":"theme role","rationale":"short evidence reason from supplied text"}]}',
    JSON.stringify(payload),
  ].join('\n\n');
  try {
    const raw = await args.llmFill(prompt);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const rows = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    const result: Record<string, { themeScore?: number; themeFit?: ResearchThemeFit; evidenceLevel?: ResearchThemeEvidenceLevel; evidenceConfidence?: number; subtheme?: string; rationale?: string }> = {};
    for (const row of rows) {
      const symbol = normalizeSymbol(row?.symbol);
      if (!symbol) continue;
      result[symbol] = {
        themeScore: toNumber(row?.themeScore) ?? undefined,
        themeFit: normalizeThemeFit(row?.fit) ?? undefined,
        evidenceLevel: normalizeEvidenceLevel(row?.evidenceLevel ?? row?.themeEvidence ?? row?.level) ?? undefined,
        evidenceConfidence: toNumber(row?.evidenceConfidence ?? row?.confidence) ?? undefined,
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
  mode?: ResearchSelectionMode;
  roles?: ResearchUniverseRole[];
  llmFill?: LLMFiller;
  weights?: Partial<ResearchUniverseWeights>;
  minThemeScore?: number;
  strongAdjacentThemeScore?: number;
  allowStrongAdjacent?: boolean;
  maxRoleShare?: number;
}): Promise<ResearchUniverseSelection> {
  const weights = { ...DEFAULT_WEIGHTS, ...(args.weights || {}) };
  const mode = args.mode || 'fresh_selection';
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
    const themeScore = clamp(candidate.preservedThemeScore ?? scoreThemeRelevance(args.query, candidate, llm.themeScore ?? null, resolverRankScore));
    const themeEvidence = buildHeuristicEvidence({
      query: args.query,
      candidate,
      resolverRankScore,
      llmEvidenceLevel: llm.evidenceLevel ?? null,
      llmRationale: llm.rationale,
      llmSubtheme: llm.subtheme,
      llmConfidence: llm.evidenceConfidence ?? null,
      themeScore,
      minThemeScore,
      strongAdjacentThemeScore,
    });
    const themeFit = candidate.preservedThemeFit ?? (llm.themeFit
      ? inferThemeFit(themeScore, llm.themeFit, minThemeScore, strongAdjacentThemeScore)
      : evidenceToFit(themeEvidence, themeScore, minThemeScore, strongAdjacentThemeScore));
    const evidenceFit = evidenceToFit(themeEvidence, themeScore, minThemeScore, strongAdjacentThemeScore);
    const finalThemeFit = themeFit === 'core' && evidenceFit !== 'core'
      ? evidenceFit
      : themeFit === 'strong_adjacent' && evidenceFit === 'reject'
        ? 'weak_adjacent'
        : themeFit;
    const dataConfidenceScore = scoreDataConfidence(candidate);
    const liquidityScaleScore = scoreLiquidityScale(candidate);
    const sourceFacetScore = scoreSourceFacetSupport(candidate);
    const factorScore = scoreFinancialFactors(candidate);
    const investmentReadinessScore = clamp((factorScore * 0.60) + (dataConfidenceScore * 0.25) + (liquidityScaleScore * 0.15));
    const subtheme = themeEvidence.role;
    const universeFitScore = clamp(
      (themeScore * 0.28) +
      (fitTierScore(finalThemeFit) * 0.22) +
      (evidenceTierScore(themeEvidence) * 0.18) +
      (sourceFacetScore * 0.06) +
      (dataConfidenceScore * 0.12) +
      (liquidityScaleScore * 0.07) +
      (factorScore * 0.07)
    );
    const totalScore = universeFitScore;
    const partial = {
      symbol: candidate.symbol,
      companyName: candidate.overview?.name || candidate.symbol,
      subtheme,
      themeEvidence,
      themeFit: finalThemeFit,
      totalScore,
      universeFitScore,
      themeScore,
      investmentReadinessScore,
      dataConfidenceScore,
      liquidityScaleScore,
      sourceFacetScore,
      representativeCoverageScore: 0,
      factorScore,
      qualified: false,
      exclusionReason: undefined,
    };
    const reasons = reasonForCandidate(candidate, partial);
    if (llm.rationale) reasons.unshift(llm.rationale);
    return { ...partial, selected: false, reasons } as ResearchCandidateScore;
  });

  const pool = [...baseScores].sort((a, b) => b.totalScore - a.totalScore);
  const qualifiedPool = pool.filter((candidate) => {
    const source = candidates.find((item) => item.symbol === candidate.symbol);
    if (mode === 'locked_diagnostics' && source?.preservedQualified === false) return false;
    if (!hasDirectEnablerEvidence(candidate)) return false;
    if (source?.sourceEvidence?.some((item) => isBroadResearchRole(item.role) && item.level !== 'unrelated')
      && !source.sourceEvidence.some((item) => (item.level === 'direct' || item.level === 'enabler') && !isBroadResearchRole(item.role))) {
      return false;
    }
    if (candidate.themeFit === 'core') return candidate.themeScore >= minThemeScore;
    if (candidate.themeFit === 'strong_adjacent') return allowStrongAdjacent && candidate.themeScore >= strongAdjacentThemeScore;
    return false;
  });
  const selected: ResearchCandidateScore[] = [];
  const selectedSubthemes = new Set<string>();
  const selectedRoleCounts = new Map<string, number>();
  let roleSoftCap = Math.max(2, Math.ceil(args.finalCount * maxRoleShare));
  const remaining = new Map(qualifiedPool.map((candidate) => [candidate.symbol, candidate]));
  const selectionPriorityForCandidate = (candidate: ResearchCandidateScore): number =>
    (candidate.totalScore * 0.55) + (roleCoveragePriorityScore(candidate) * 0.45);
  const markSelected = (candidate: ResearchCandidateScore, representativeCoverageScore: number): void => {
    candidate.selected = true;
    candidate.qualified = true;
    candidate.representativeCoverageScore = representativeCoverageScore;
    candidate.totalScore = clamp(candidate.totalScore + (candidate.representativeCoverageScore * weights.representativeCoverage));
    selected.push(candidate);
    selectedSubthemes.add(candidate.subtheme);
    selectedRoleCounts.set(candidate.subtheme, (selectedRoleCounts.get(candidate.subtheme) || 0) + 1);
    remaining.delete(candidate.symbol);
  };
  if (mode === 'locked_diagnostics') {
    for (const candidate of pool) {
      candidate.selected = true;
      candidate.qualified = qualifiedPool.some((qualified) => qualified.symbol === candidate.symbol);
      candidate.representativeCoverageScore = 50;
      selected.push(candidate);
    }
  }

  if (mode === 'fresh_selection') {
    const byRole = new Map<string, ResearchCandidateScore[]>();
    for (const candidate of qualifiedPool) {
      byRole.set(candidate.subtheme, [...(byRole.get(candidate.subtheme) || []), candidate]);
    }
    roleSoftCap = Math.max(
      2,
      Math.min(roleSoftCap, Math.ceil(args.finalCount / Math.max(1, byRole.size)) + 1)
    );
    const roleRepresentatives = Array.from(byRole.values())
      .map((candidatesForRole) => [...candidatesForRole].sort((a, b) =>
        roleCoveragePriorityScore(b) - roleCoveragePriorityScore(a)
        || b.totalScore - a.totalScore
      )[0])
      .filter((candidate): candidate is ResearchCandidateScore => Boolean(candidate))
      .sort((a, b) =>
        roleCoveragePriorityScore(b) - roleCoveragePriorityScore(a)
        || b.totalScore - a.totalScore
      );

    for (const candidate of roleRepresentatives) {
      if (selected.length >= args.finalCount) break;
      markSelected(candidate, 100);
    }

    const roleNamesByPriority = Array.from(byRole.keys()).sort((a, b) => {
      const requirementDelta = roleRequirementWeight(b, args.roles) - roleRequirementWeight(a, args.roles);
      if (requirementDelta) return requirementDelta;
      const centralityDelta = roleCentralityWeight(b, args.roles) - roleCentralityWeight(a, args.roles);
      if (centralityDelta) return centralityDelta;
      const bestA = (byRole.get(a) || []).reduce((best, candidate) => Math.max(best, selectionPriorityForCandidate(candidate)), 0);
      const bestB = (byRole.get(b) || []).reduce((best, candidate) => Math.max(best, selectionPriorityForCandidate(candidate)), 0);
      return bestB - bestA;
    });
    const requiredRoleNames = roleNamesByPriority.filter((role) => roleRequirementWeight(role, args.roles) >= 1);

    for (let targetPerRole = 2; targetPerRole <= roleSoftCap && selected.length < args.finalCount; targetPerRole += 1) {
      for (const roleName of requiredRoleNames) {
        if (selected.length >= args.finalCount) break;
        if ((selectedRoleCounts.get(roleName) || 0) >= targetPerRole) continue;
        const candidate = Array.from(remaining.values())
          .filter((item) => item.subtheme === roleName)
          .sort((a, b) => selectionPriorityForCandidate(b) - selectionPriorityForCandidate(a))[0];
        if (candidate) markSelected(candidate, 50);
      }
    }
  }

  while (mode === 'fresh_selection' && selected.length < args.finalCount && remaining.size > 0) {
    let best: ResearchCandidateScore | null = null;
    let bestAdjusted = -Infinity;
    const candidatesToConsider = Array.from(remaining.values());
    const underRoleCap = candidatesToConsider.filter((candidate) => (selectedRoleCounts.get(candidate.subtheme) || 0) < roleSoftCap);
    const eligibleNow = underRoleCap.length > 0
      ? underRoleCap
      : candidatesToConsider.filter((candidate) => candidate.themeFit === 'core');
    const finalEligibleNow = eligibleNow.length > 0 ? eligibleNow : candidatesToConsider;
    for (const candidate of finalEligibleNow) {
      const selectedRoleCount = selectedRoleCounts.get(candidate.subtheme) || 0;
      const coverageBonus = selectedSubthemes.has(candidate.subtheme) ? 0 : weights.representativeCoverage * 100;
      const requirementWeight = roleRequirementWeight(candidate.subtheme, args.roles);
      const requiredRoleBonus = requirementWeight >= 1 ? 8 : 0;
      const centralityBonus = roleCentralityWeight(candidate.subtheme, args.roles) * 24;
      const optionalDuplicatePenalty = requirementWeight < 1 && selectedRoleCount > 0 ? 18 : 0;
      const rolePenalty = selectedRoleCount >= roleSoftCap ? weights.representativeCoverage * 50 : selectedRoleCount * 4;
      const fitPriority = candidate.themeFit === 'core' ? 8 : 0;
      const selectionPriority = selectionPriorityForCandidate(candidate);
      const adjusted = selectionPriority + coverageBonus + fitPriority + requiredRoleBonus + centralityBonus - optionalDuplicatePenalty - rolePenalty;
      if (adjusted > bestAdjusted) {
        best = candidate;
        bestAdjusted = adjusted;
      }
    }
    if (!best) break;
    markSelected(best, selectedSubthemes.has(best.subtheme) ? 50 : 100);
  }

  for (const candidate of pool) {
    candidate.qualified = qualifiedPool.some((qualified) => qualified.symbol === candidate.symbol);
    if (candidate.selected) continue;
    candidate.exclusionReason = candidate.themeFit === 'reject'
      ? 'Excluded: supplied profile does not support meaningful theme exposure.'
      : candidate.themeFit === 'weak_adjacent'
        ? 'Excluded: weak or generic theme exposure.'
        : candidate.themeFit === 'strong_adjacent' && !allowStrongAdjacent
          ? 'Excluded: strong-adjacent exposure disabled by configuration.'
          : candidate.themeScore < strongAdjacentThemeScore
            ? 'Excluded: below configured theme evidence/fit gate.'
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
    && mode === 'fresh_selection'
    ? [
        `Only ${selected.length} of ${args.finalCount} configured slots cleared the theme evidence/fit gate; weak or unsupported candidates were not forced into the universe.`,
        'Quality gates, runtime budget, and provider-data limits favor a qualified partial universe over filling every configured slot.',
      ]
    : [];

  return {
    query: args.query,
    mode,
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
      mode === 'locked_diagnostics'
        ? `Locked universe diagnostics scored ${candidates.length} preserved companies; ${qualifiedSymbols.length} currently clear the qualified theme gate.`
        : `Universe selection scored ${candidates.length} verified candidates for ${args.finalCount} configured slots.`,
      `Theme evidence/fit gates: core >= ${minThemeScore.toFixed(0)}, strong adjacent >= ${strongAdjacentThemeScore.toFixed(0)}${allowStrongAdjacent ? '' : ' (strong adjacent disabled)'}.`,
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
