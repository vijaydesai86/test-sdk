import { describe, expect, it } from 'vitest';
import {
  applyResearchProgressSelection,
  buildResearchProgressCheckpoint,
  selectResearchProgressBatch,
  selectResearchProgressUniverse,
  updateResearchProgressScores,
} from '../web/app/lib/researchProgress';

const ranked = Array.from({ length: 8 }, (_, index) => ({
  symbol: `C${index + 1}`,
  themeScore: 70 - index,
  dataConfidenceScore: 60,
  universeScore: 65 - index,
  subtheme: index % 2 === 0 ? 'Role A' : 'Role B',
}));

describe('researchProgress', () => {
  it('builds an initial checkpoint and starts from the first unprocessed candidate', () => {
    const checkpoint = buildResearchProgressCheckpoint({ targetCount: 3, rankedCandidates: ranked, improveBatchSize: 3 });
    const batch = selectResearchProgressBatch(checkpoint, 3);

    expect(checkpoint.cursor).toBe(0);
    expect(batch.symbols).toEqual(['C1', 'C2', 'C3']);
    expect(batch.nextCursor).toBe(3);
  });

  it('retries temporary failures before continuing from the cursor', () => {
    const checkpoint = buildResearchProgressCheckpoint({
      targetCount: 3,
      rankedCandidates: ranked,
      previous: {
        targetCount: 3,
        batchSize: 3,
        cursor: 3,
        candidates: [
          { ...ranked[0], rank: 0, selected: false, qualified: false, reportScore: 0, finalScore: 0, roleCoverageScore: 0, state: 'basic_scored', attempts: 1 },
          { ...ranked[1], rank: 1, selected: false, qualified: false, reportScore: 0, finalScore: 0, roleCoverageScore: 0, state: 'temporary_failed', attempts: 1 },
          { ...ranked[2], rank: 2, selected: false, qualified: false, reportScore: 0, finalScore: 0, roleCoverageScore: 0, state: 'basic_scored', attempts: 1 },
        ],
      },
      improveBatchSize: 3,
    });
    const batch = selectResearchProgressBatch(checkpoint, 3);

    expect(batch.retrySymbols).toEqual(['C2']);
    expect(batch.unprocessedSymbols).toEqual(['C4', 'C5']);
    expect(batch.symbols).toEqual(['C2', 'C4', 'C5']);
  });

  it('updates scores, advances cursor, and selects the best scored candidates', () => {
    const checkpoint = buildResearchProgressCheckpoint({ targetCount: 3, rankedCandidates: ranked, improveBatchSize: 3 });
    const batch = selectResearchProgressBatch(checkpoint, 3);
    const updated = updateResearchProgressScores(checkpoint, [
      { symbol: 'C1', reportScore: 55, state: 'basic_scored' },
      { symbol: 'C2', reportScore: 80, state: 'basic_scored' },
      { symbol: 'C3', reportScore: 50, state: 'basic_scored' },
    ], batch.symbols);

    expect(updated.cursor).toBe(3);
    expect(updated.candidates.filter((candidate) => candidate.state === 'basic_scored')).toHaveLength(3);
    expect(selectResearchProgressUniverse(updated, 2)).toEqual(['C2', 'C1']);
  });

  it('re-ranks old and new scored candidates so better later candidates replace weak selected names', () => {
    const first = updateResearchProgressScores(
      buildResearchProgressCheckpoint({ targetCount: 3, rankedCandidates: ranked, improveBatchSize: 3 }),
      [
        { symbol: 'C1', reportScore: 45, state: 'basic_scored' },
        { symbol: 'C2', reportScore: 44, state: 'basic_scored' },
        { symbol: 'C3', reportScore: 43, state: 'basic_scored' },
      ],
      ['C1', 'C2', 'C3']
    );
    const secondBatch = selectResearchProgressBatch(first, 3);
    const second = updateResearchProgressScores(first, [
      { symbol: 'C4', reportScore: 92, state: 'basic_scored' },
      { symbol: 'C5', reportScore: 91, state: 'basic_scored' },
      { symbol: 'C6', reportScore: 42, state: 'basic_scored' },
    ], secondBatch.symbols);
    const selected = selectResearchProgressUniverse(second, 3);
    const marked = applyResearchProgressSelection(second, selected);

    expect(selected).toEqual(expect.arrayContaining(['C4', 'C5']));
    expect(selected).toHaveLength(3);
    expect(marked.candidates.find((candidate) => candidate.symbol === 'C4')?.selected).toBe(true);
    expect(marked.candidates.find((candidate) => candidate.symbol === 'C3')?.selected).toBe(false);
  });
});
