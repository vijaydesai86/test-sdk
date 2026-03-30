import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

describe('watchlistStore', () => {
  let tempDir: string;
  let watchlistsFile: string;
  const originalEnv = {
    WATCHLISTS_FILE: process.env.WATCHLISTS_FILE,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'watchlist-store-'));
    watchlistsFile = path.join(tempDir, 'watchlists.json');
    process.env.WATCHLISTS_FILE = watchlistsFile;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.WATCHLISTS_FILE = originalEnv.WATCHLISTS_FILE;
    process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.SUPABASE_SERVICE_ROLE_KEY;
    vi.resetModules();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('updates the portfolio profile in filesystem mode', async () => {
    const store = await import('../web/app/lib/watchlistStore');
    const updated = await store.updateWatchlistProfile({
      riskTolerance: 'high',
      maxPositionWeight: 12,
      targetCashPct: 5,
      concentrationLimit: 40,
      strategyNotes: 'Concentrate in best ideas.',
    });

    expect(updated.profile.riskTolerance).toBe('high');
    expect(updated.profile.maxPositionWeight).toBe(12);
    expect(updated.profile.concentrationLimit).toBe(40);

    const reloaded = await store.getDefaultWatchlist();
    expect(reloaded.profile.strategyNotes).toBe('Concentrate in best ideas.');
  });

  it('updates watchlist item position metadata in filesystem mode', async () => {
    const store = await import('../web/app/lib/watchlistStore');
    const watchlist = await store.getDefaultWatchlist();
    const symbol = watchlist.items[0].symbol;

    const updated = await store.updateWatchlistItemPosition(symbol, {
      ownershipStatus: 'owned',
      currentWeight: 6,
      targetWeight: 8,
      maxWeight: 10,
      costBasis: 123.45,
      conviction: 'high',
      thesis: 'High-quality compounder with durable cash generation.',
      desiredEntryMin: 110,
      desiredEntryMax: 125,
      trimAbove: 155,
      invalidation: 'Revenue growth slips below expectations for two quarters.',
      reviewDate: '2026-04-30',
      lastReviewedAt: '2026-03-30T12:00:00Z',
      notes: 'Prefer adding on post-earnings weakness.',
    });

    const item = updated.items.find((entry) => entry.symbol === symbol);
    expect(item).toBeDefined();
    expect(item?.ownershipStatus).toBe('owned');
    expect(item?.currentWeight).toBe(6);
    expect(item?.desiredEntryMax).toBe(125);
    expect(item?.notes).toContain('post-earnings weakness');
  });
});
