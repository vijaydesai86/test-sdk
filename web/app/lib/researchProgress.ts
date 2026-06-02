export type ResearchProgressState = 'unprocessed' | 'basic_scored' | 'temporary_failed' | 'invalid';

export interface ResearchProgressCandidateInput {
  symbol: string;
  rank?: number;
  selected?: boolean;
  qualified?: boolean;
  subtheme?: string;
  themeScore?: number;
  dataConfidenceScore?: number;
  universeScore?: number;
  reportScore?: number;
  finalScore?: number;
  roleCoverageScore?: number;
  state?: ResearchProgressState;
  attempts?: number;
}

export interface ResearchProgressCandidate extends Required<Pick<ResearchProgressCandidateInput, 'symbol' | 'rank' | 'selected' | 'qualified' | 'themeScore' | 'dataConfidenceScore' | 'universeScore' | 'reportScore' | 'finalScore' | 'roleCoverageScore' | 'state' | 'attempts'>> {
  subtheme?: string;
}

export interface ResearchProgressCheckpoint {
  targetCount: number;
  batchSize: number;
  cursor: number;
  candidates: ResearchProgressCandidate[];
}

export interface ResearchProgressScoreUpdate {
  symbol: string;
  reportScore?: number | null;
  dataConfidenceScore?: number | null;
  themeScore?: number | null;
  universeScore?: number | null;
  roleCoverageScore?: number | null;
  state?: ResearchProgressState;
}

function normalizeSymbol(value: unknown): string {
  return String(value || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase();
}

function finite(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeState(value: unknown): ResearchProgressState {
  return value === 'basic_scored' || value === 'temporary_failed' || value === 'invalid' || value === 'unprocessed'
    ? value
    : 'unprocessed';
}

export function computeResearchProgressFinalScore(candidate: Pick<ResearchProgressCandidate, 'themeScore' | 'dataConfidenceScore' | 'universeScore' | 'reportScore' | 'roleCoverageScore'>): number {
  return Math.max(0, Math.min(100,
    finite(candidate.themeScore) * 0.30 +
    finite(candidate.universeScore) * 0.20 +
    finite(candidate.reportScore) * 0.35 +
    finite(candidate.dataConfidenceScore) * 0.10 +
    finite(candidate.roleCoverageScore) * 0.05
  ));
}

export function buildResearchProgressCheckpoint(args: {
  targetCount: number;
  rankedCandidates: ResearchProgressCandidateInput[];
  previous?: Partial<ResearchProgressCheckpoint> | null;
  initialBatchMultiplier?: number;
  improveBatchSize?: number;
}): ResearchProgressCheckpoint {
  const targetCount = Math.max(1, Math.trunc(args.targetCount || 1));
  const previousBySymbol = new Map((args.previous?.candidates || []).map((candidate) => [normalizeSymbol(candidate.symbol), candidate]));
  const seen = new Set<string>();
  const candidates: ResearchProgressCandidate[] = [];

  args.rankedCandidates.forEach((input, index) => {
    const symbol = normalizeSymbol(input.symbol);
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    const previous = previousBySymbol.get(symbol);
    const base = {
      symbol,
      rank: Number.isFinite(input.rank) ? Math.trunc(input.rank as number) : index,
      selected: Boolean(input.selected ?? previous?.selected),
      qualified: Boolean(input.qualified ?? previous?.qualified),
      subtheme: input.subtheme ?? previous?.subtheme,
      themeScore: finite(input.themeScore, finite(previous?.themeScore)),
      dataConfidenceScore: finite(input.dataConfidenceScore, finite(previous?.dataConfidenceScore)),
      universeScore: finite(input.universeScore, finite(previous?.universeScore)),
      reportScore: finite(previous?.reportScore, finite(input.reportScore)),
      roleCoverageScore: finite(input.roleCoverageScore, finite(previous?.roleCoverageScore)),
      state: normalizeState(previous?.state ?? input.state),
      attempts: Math.max(0, Math.trunc(finite(previous?.attempts, finite(input.attempts))))
    };
    candidates.push({
      ...base,
      finalScore: finite(previous?.finalScore, computeResearchProgressFinalScore(base)),
    });
  });

  const cursorCandidate = candidates.find((candidate) => candidate.state === 'unprocessed');
  const cursor = Number.isFinite(args.previous?.cursor)
    ? Math.max(0, Math.min(candidates.length, Math.trunc(args.previous?.cursor as number)))
    : (cursorCandidate ? cursorCandidate.rank : candidates.length);
  const batchSize = Math.max(1, Math.trunc(args.improveBatchSize || targetCount));
  return { targetCount, batchSize, cursor, candidates: candidates.sort((a, b) => a.rank - b.rank) };
}

export function selectResearchProgressBatch(checkpoint: ResearchProgressCheckpoint, maxBatch = checkpoint.batchSize): { symbols: string[]; retrySymbols: string[]; unprocessedSymbols: string[]; nextCursor: number } {
  const limit = Math.max(1, Math.trunc(maxBatch || checkpoint.batchSize || 1));
  const retry = checkpoint.candidates
    .filter((candidate) => candidate.state === 'temporary_failed')
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);
  const remaining = Math.max(0, limit - retry.length);
  const unprocessed = checkpoint.candidates
    .filter((candidate) => candidate.state === 'unprocessed' && candidate.rank >= checkpoint.cursor)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, remaining);
  const symbols = Array.from(new Set([...retry, ...unprocessed].map((candidate) => candidate.symbol)));
  const nextCursor = unprocessed.length
    ? Math.max(checkpoint.cursor, unprocessed[unprocessed.length - 1].rank + 1)
    : checkpoint.cursor;
  return {
    symbols,
    retrySymbols: retry.map((candidate) => candidate.symbol),
    unprocessedSymbols: unprocessed.map((candidate) => candidate.symbol),
    nextCursor,
  };
}

export function updateResearchProgressScores(checkpoint: ResearchProgressCheckpoint, updates: ResearchProgressScoreUpdate[], attemptedSymbols: string[] = []): ResearchProgressCheckpoint {
  const updateBySymbol = new Map(updates.map((update) => [normalizeSymbol(update.symbol), update]));
  const attempted = new Set(attemptedSymbols.map(normalizeSymbol).filter(Boolean));
  let cursor = checkpoint.cursor;
  const candidates = checkpoint.candidates.map((candidate) => {
    const update = updateBySymbol.get(candidate.symbol);
    if (!update && !attempted.has(candidate.symbol)) return candidate;
    const next = {
      ...candidate,
      attempts: candidate.attempts + 1,
      themeScore: update?.themeScore === null || update?.themeScore === undefined ? candidate.themeScore : finite(update.themeScore, candidate.themeScore),
      dataConfidenceScore: update?.dataConfidenceScore === null || update?.dataConfidenceScore === undefined ? candidate.dataConfidenceScore : finite(update.dataConfidenceScore, candidate.dataConfidenceScore),
      universeScore: update?.universeScore === null || update?.universeScore === undefined ? candidate.universeScore : finite(update.universeScore, candidate.universeScore),
      reportScore: update?.reportScore === null || update?.reportScore === undefined ? candidate.reportScore : finite(update.reportScore, candidate.reportScore),
      roleCoverageScore: update?.roleCoverageScore === null || update?.roleCoverageScore === undefined ? candidate.roleCoverageScore : finite(update.roleCoverageScore, candidate.roleCoverageScore),
      state: update?.state || (update ? 'basic_scored' as const : 'temporary_failed' as const),
    };
    next.finalScore = computeResearchProgressFinalScore(next);
    return next;
  });
  for (const symbol of attempted) {
    const candidate = candidates.find((item) => item.symbol === symbol);
    if (candidate && candidate.state !== 'unprocessed') cursor = Math.max(cursor, candidate.rank + 1);
  }
  return { ...checkpoint, cursor: Math.min(candidates.length, cursor), candidates };
}

export function selectResearchProgressUniverse(checkpoint: ResearchProgressCheckpoint, targetCount = checkpoint.targetCount): string[] {
  const selected = checkpoint.candidates
    .filter((candidate) => candidate.state === 'basic_scored')
    .sort((a, b) => b.finalScore - a.finalScore || b.themeScore - a.themeScore || a.rank - b.rank)
    .slice(0, Math.max(1, targetCount));
  return selected.map((candidate) => candidate.symbol);
}

export function applyResearchProgressSelection(checkpoint: ResearchProgressCheckpoint, selectedSymbols: string[]): ResearchProgressCheckpoint {
  const selected = new Set(selectedSymbols.map(normalizeSymbol));
  return {
    ...checkpoint,
    candidates: checkpoint.candidates.map((candidate) => ({
      ...candidate,
      selected: selected.has(candidate.symbol),
    })),
  };
}
