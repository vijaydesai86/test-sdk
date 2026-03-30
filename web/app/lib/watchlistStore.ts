import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getSupabaseClient } from './supabaseClient';
import type { ConvictionLabel, HoldingHorizon, OwnershipStatus, PortfolioProfile, RiskTolerance, WatchlistPositionMeta } from './investmentTypes';

export interface WatchlistItem extends WatchlistPositionMeta {
  id: string;
  symbol: string;
  companyName: string;
  displayOrder: number;
  createdAt: string;
}

export interface Watchlist {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  items: WatchlistItem[];
  profile: PortfolioProfile;
  storage: 'supabase' | 'filesystem';
}

type FileStore = {
  watchlists: Watchlist[];
};

type SeedItem = { symbol: string; companyName: string };

const WATCHLISTS_FILE =
  process.env.WATCHLISTS_FILE
  || (process.env.VERCEL ? '/tmp/watchlists.json' : path.join(process.cwd(), 'reports', 'watchlists.json'));

export const MAX_WATCHLIST_ITEMS = 25;
export const DEFAULT_WATCHLIST_NAME = 'Core Watchlist';
export const DEFAULT_WATCHLIST_SLUG = 'default';
export const DEFAULT_PORTFOLIO_PROFILE: PortfolioProfile = {
  riskTolerance: 'medium',
  holdingHorizon: 'years',
  maxPositionWeight: 10,
  targetCashPct: 10,
  concentrationLimit: 35,
  strategyNotes: 'Focus on high-quality businesses, maintain valuation discipline, and prefer waiting over forcing a trade.',
};
export const DEFAULT_WATCHLIST_SEED: SeedItem[] = [
  { symbol: 'NVDA', companyName: 'NVIDIA' },
  { symbol: 'ARM', companyName: 'Arm Holdings' },
  { symbol: 'AMD', companyName: 'Advanced Micro Devices' },
  { symbol: 'AVGO', companyName: 'Broadcom' },
  { symbol: 'QCOM', companyName: 'Qualcomm' },
  { symbol: 'MSFT', companyName: 'Microsoft' },
  { symbol: 'DELL', companyName: 'Dell Technologies' },
  { symbol: 'GOOGL', companyName: 'Alphabet' },
  { symbol: 'MU', companyName: 'Micron Technology' },
  { symbol: 'VRT', companyName: 'Vertiv' },
  { symbol: 'ETN', companyName: 'Eaton' },
  { symbol: 'ASML', companyName: 'ASML Holding' },
  { symbol: 'AMAT', companyName: 'Applied Materials' },
  { symbol: 'TSM', companyName: 'Taiwan Semiconductor Manufacturing' },
  { symbol: 'META', companyName: 'Meta Platforms' },
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSymbol(symbol: string) {
  return String(symbol || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase();
}

function buildDefaultPositionMeta(): WatchlistPositionMeta {
  return {
    ownershipStatus: 'watching',
    currentWeight: null,
    targetWeight: null,
    maxWeight: null,
    costBasis: null,
    conviction: 'medium',
    thesis: '',
    desiredEntryMin: null,
    desiredEntryMax: null,
    trimAbove: null,
    invalidation: '',
    reviewDate: null,
    lastReviewedAt: null,
    notes: '',
  };
}

function normalizePortfolioProfile(record: any): PortfolioProfile {
  return {
    riskTolerance: (record.risk_tolerance ?? record.riskTolerance ?? DEFAULT_PORTFOLIO_PROFILE.riskTolerance) as RiskTolerance,
    holdingHorizon: (record.holding_horizon ?? record.holdingHorizon ?? DEFAULT_PORTFOLIO_PROFILE.holdingHorizon) as HoldingHorizon,
    maxPositionWeight: normalizeNullableNumber(record.max_position_weight ?? record.maxPositionWeight ?? DEFAULT_PORTFOLIO_PROFILE.maxPositionWeight),
    targetCashPct: normalizeNullableNumber(record.target_cash_pct ?? record.targetCashPct ?? DEFAULT_PORTFOLIO_PROFILE.targetCashPct),
    concentrationLimit: normalizeNullableNumber(record.concentration_limit ?? record.concentrationLimit ?? DEFAULT_PORTFOLIO_PROFILE.concentrationLimit),
    strategyNotes: String(record.strategy_notes ?? record.strategyNotes ?? DEFAULT_PORTFOLIO_PROFILE.strategyNotes ?? ''),
    updatedAt: String(record.updated_at ?? record.updatedAt ?? nowIso()),
  };
}

function toSeedItems(seed = DEFAULT_WATCHLIST_SEED): WatchlistItem[] {
  const createdAt = nowIso();
  return seed.map((item, index) => ({
    id: randomUUID(),
    symbol: normalizeSymbol(item.symbol),
    companyName: item.companyName,
    displayOrder: index,
    createdAt,
    ...buildDefaultPositionMeta(),
  }));
}

function buildDefaultWatchlist(storage: Watchlist['storage']): Watchlist {
  const createdAt = nowIso();
  return {
    id: randomUUID(),
    name: DEFAULT_WATCHLIST_NAME,
    slug: DEFAULT_WATCHLIST_SLUG,
    isDefault: true,
    createdAt,
    updatedAt: createdAt,
    items: toSeedItems(),
    profile: { ...DEFAULT_PORTFOLIO_PROFILE, updatedAt: createdAt },
    storage,
  };
}

function sortItems(items: WatchlistItem[]) {
  return [...items].sort((a, b) =>
    a.displayOrder - b.displayOrder || a.createdAt.localeCompare(b.createdAt)
  );
}

async function readFileStore(): Promise<FileStore> {
  try {
    const raw = await fs.readFile(WATCHLISTS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<FileStore>;
    return {
      watchlists: Array.isArray(parsed.watchlists) ? parsed.watchlists : [],
    };
  } catch {
    return { watchlists: [] };
  }
}

async function writeFileStore(store: FileStore) {
  await fs.mkdir(path.dirname(WATCHLISTS_FILE), { recursive: true });
  await fs.writeFile(WATCHLISTS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function normalizeWatchlistRecord(record: any, storage: Watchlist['storage']): Watchlist {
  return {
    id: String(record.id),
    name: String(record.name),
    slug: String(record.slug),
    isDefault: Boolean(record.is_default ?? record.isDefault),
    createdAt: String(record.created_at ?? record.createdAt ?? nowIso()),
    updatedAt: String(record.updated_at ?? record.updatedAt ?? nowIso()),
    profile: normalizePortfolioProfile(record),
    items: sortItems(
      Array.isArray(record.items)
        ? record.items.map((item: any) => ({
            id: String(item.id),
            symbol: normalizeSymbol(item.symbol),
            companyName: String(item.company_name ?? item.companyName ?? item.symbol),
            displayOrder: Number(item.display_order ?? item.displayOrder ?? 0),
            createdAt: String(item.created_at ?? item.createdAt ?? nowIso()),
            ownershipStatus: String(item.ownership_status ?? item.ownershipStatus ?? 'watching') as OwnershipStatus,
            currentWeight: normalizeNullableNumber(item.current_weight ?? item.currentWeight),
            targetWeight: normalizeNullableNumber(item.target_weight ?? item.targetWeight),
            maxWeight: normalizeNullableNumber(item.max_weight ?? item.maxWeight),
            costBasis: normalizeNullableNumber(item.cost_basis ?? item.costBasis),
            conviction: String(item.conviction ?? 'medium') as ConvictionLabel,
            thesis: String(item.thesis ?? ''),
            desiredEntryMin: normalizeNullableNumber(item.desired_entry_min ?? item.desiredEntryMin),
            desiredEntryMax: normalizeNullableNumber(item.desired_entry_max ?? item.desiredEntryMax),
            trimAbove: normalizeNullableNumber(item.trim_above ?? item.trimAbove),
            invalidation: String(item.invalidation ?? ''),
            reviewDate: item.review_date ?? item.reviewDate ?? null,
            lastReviewedAt: item.last_reviewed_at ?? item.lastReviewedAt ?? null,
            notes: String(item.notes ?? ''),
          }))
        : []
    ),
    storage,
  };
}

async function ensureDefaultFileWatchlist(): Promise<Watchlist> {
  const store = await readFileStore();
  const existing = store.watchlists.find((watchlist) => watchlist.slug === DEFAULT_WATCHLIST_SLUG);
  if (existing) {
    const normalized = normalizeWatchlistRecord(existing, 'filesystem');
    if (normalized.items.length > 0) return normalized;
  }

  const watchlist = buildDefaultWatchlist('filesystem');
  const nextStore: FileStore = {
    watchlists: [
      watchlist,
      ...store.watchlists.filter((entry) => String(entry.slug) !== DEFAULT_WATCHLIST_SLUG),
    ],
  };
  await writeFileStore(nextStore);
  return watchlist;
}

async function loadDefaultSupabaseWatchlist(): Promise<Watchlist | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const detailedWatchlistColumns =
    'id, name, slug, is_default, created_at, updated_at, risk_tolerance, holding_horizon, max_position_weight, target_cash_pct, concentration_limit, strategy_notes';
  const basicWatchlistColumns = 'id, name, slug, is_default, created_at, updated_at';
  const detailedItemsColumns =
    'id, symbol, company_name, display_order, created_at, ownership_status, current_weight, target_weight, max_weight, cost_basis, conviction, thesis, desired_entry_min, desired_entry_max, trim_above, invalidation, review_date, last_reviewed_at, notes';
  const basicItemsColumns = 'id, symbol, company_name, display_order, created_at';
  const isSchemaMismatch = (message: string) => /column .* does not exist|schema cache/i.test(message);

  let watchlistsQuery = await supabase
    .from('watchlists')
    .select(detailedWatchlistColumns)
    .eq('slug', DEFAULT_WATCHLIST_SLUG)
    .limit(1);

  if (watchlistsQuery.error && isSchemaMismatch(watchlistsQuery.error.message)) {
    watchlistsQuery = await supabase
      .from('watchlists')
      .select(basicWatchlistColumns)
      .eq('slug', DEFAULT_WATCHLIST_SLUG)
      .limit(1);
  }

  const { data: watchlists, error: watchlistError } = watchlistsQuery;

  if (watchlistError) return null;

  let watchlist = watchlists?.[0];
  if (!watchlist) {
    const createdAt = nowIso();
    let insertQuery = await supabase
      .from('watchlists')
      .insert({
        name: DEFAULT_WATCHLIST_NAME,
        slug: DEFAULT_WATCHLIST_SLUG,
        is_default: true,
        created_at: createdAt,
        updated_at: createdAt,
        risk_tolerance: DEFAULT_PORTFOLIO_PROFILE.riskTolerance,
        holding_horizon: DEFAULT_PORTFOLIO_PROFILE.holdingHorizon,
        max_position_weight: DEFAULT_PORTFOLIO_PROFILE.maxPositionWeight,
        target_cash_pct: DEFAULT_PORTFOLIO_PROFILE.targetCashPct,
        concentration_limit: DEFAULT_PORTFOLIO_PROFILE.concentrationLimit,
        strategy_notes: DEFAULT_PORTFOLIO_PROFILE.strategyNotes,
      })
      .select(detailedWatchlistColumns)
      .single();

    if (insertQuery.error && isSchemaMismatch(insertQuery.error.message)) {
      insertQuery = await supabase
        .from('watchlists')
        .insert({
          name: DEFAULT_WATCHLIST_NAME,
          slug: DEFAULT_WATCHLIST_SLUG,
          is_default: true,
          created_at: createdAt,
          updated_at: createdAt,
        })
        .select(basicWatchlistColumns)
        .single();
    }

    const { data: inserted, error: insertError } = insertQuery;

    if (insertError || !inserted) return null;
    watchlist = inserted;
  }

  let itemsQuery = await supabase
    .from('watchlist_items')
    .select(detailedItemsColumns)
    .eq('watchlist_id', watchlist.id)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (itemsQuery.error && isSchemaMismatch(itemsQuery.error.message)) {
    itemsQuery = await supabase
      .from('watchlist_items')
      .select(basicItemsColumns)
      .eq('watchlist_id', watchlist.id)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
  }

  const { data: items, error: itemError } = itemsQuery;

  if (itemError) return null;

  const existingItems = Array.isArray(items) ? items : [];
  if (existingItems.length === 0) {
    const seedRows = DEFAULT_WATCHLIST_SEED.map((item, index) => ({
      watchlist_id: watchlist.id,
      symbol: normalizeSymbol(item.symbol),
      company_name: item.companyName,
      display_order: index,
      ownership_status: 'watching',
      conviction: 'medium',
      thesis: '',
      invalidation: '',
      notes: '',
    }));

    let seedQuery = await supabase
      .from('watchlist_items')
      .insert(seedRows)
      .select(detailedItemsColumns);

    if (seedQuery.error && isSchemaMismatch(seedQuery.error.message)) {
      seedQuery = await supabase
        .from('watchlist_items')
        .insert(seedRows)
        .select(basicItemsColumns);
    }

    const { data: insertedItems, error: seedError } = seedQuery;

    if (seedError) return null;

    return normalizeWatchlistRecord({ ...watchlist, items: insertedItems || [] }, 'supabase');
  }

  return normalizeWatchlistRecord({ ...watchlist, items: existingItems }, 'supabase');
}

export async function getDefaultWatchlist(): Promise<Watchlist> {
  const supabaseWatchlist = await loadDefaultSupabaseWatchlist();
  if (supabaseWatchlist) return supabaseWatchlist;
  return ensureDefaultFileWatchlist();
}

async function saveFileWatchlist(watchlist: Watchlist) {
  const store = await readFileStore();
  const normalized = { ...watchlist, storage: 'filesystem' as const };
  const nextStore: FileStore = {
    watchlists: [
      normalized,
      ...store.watchlists.filter((entry) => String(entry.slug) !== normalized.slug),
    ],
  };
  await writeFileStore(nextStore);
}

export async function addWatchlistItem(input: { symbol: string; companyName: string }): Promise<Watchlist> {
  const symbol = normalizeSymbol(input.symbol);
  const companyName = String(input.companyName || symbol).trim() || symbol;
  if (!symbol) {
    throw new Error('A valid ticker symbol is required.');
  }

  const watchlist = await getDefaultWatchlist();
  if (watchlist.items.some((item) => item.symbol === symbol)) {
    return watchlist;
  }
  if (watchlist.items.length >= MAX_WATCHLIST_ITEMS) {
    throw new Error(`Watchlist limit reached (${MAX_WATCHLIST_ITEMS} companies).`);
  }

  if (watchlist.storage === 'supabase') {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client unavailable.');
    }
    const { data, error } = await supabase
      .from('watchlist_items')
      .insert({
        watchlist_id: watchlist.id,
        symbol,
        company_name: companyName,
        display_order: watchlist.items.length,
        ownership_status: 'watching',
        conviction: 'medium',
        thesis: '',
        invalidation: '',
        notes: '',
      })
      .select('id, symbol, company_name, display_order, created_at, ownership_status, current_weight, target_weight, max_weight, cost_basis, conviction, thesis, desired_entry_min, desired_entry_max, trim_above, invalidation, review_date, last_reviewed_at, notes')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to add watchlist item.');
    }
    return {
      ...watchlist,
      items: sortItems([
        ...watchlist.items,
        {
          id: String(data.id),
          symbol,
          companyName: String(data.company_name),
          displayOrder: Number(data.display_order),
          createdAt: String(data.created_at),
          ownershipStatus: String(data.ownership_status ?? 'watching') as OwnershipStatus,
          currentWeight: normalizeNullableNumber(data.current_weight),
          targetWeight: normalizeNullableNumber(data.target_weight),
          maxWeight: normalizeNullableNumber(data.max_weight),
          costBasis: normalizeNullableNumber(data.cost_basis),
          conviction: String(data.conviction ?? 'medium') as ConvictionLabel,
          thesis: String(data.thesis ?? ''),
          desiredEntryMin: normalizeNullableNumber(data.desired_entry_min),
          desiredEntryMax: normalizeNullableNumber(data.desired_entry_max),
          trimAbove: normalizeNullableNumber(data.trim_above),
          invalidation: String(data.invalidation ?? ''),
          reviewDate: data.review_date ?? null,
          lastReviewedAt: data.last_reviewed_at ?? null,
          notes: String(data.notes ?? ''),
        },
      ]),
    };
  }

  const nextWatchlist: Watchlist = {
    ...watchlist,
    updatedAt: nowIso(),
    items: sortItems([
      ...watchlist.items,
      {
        id: randomUUID(),
        symbol,
        companyName,
        displayOrder: watchlist.items.length,
        createdAt: nowIso(),
        ...buildDefaultPositionMeta(),
      },
    ]),
  };
  await saveFileWatchlist(nextWatchlist);
  return nextWatchlist;
}

export async function updateWatchlistProfile(input: Partial<PortfolioProfile>): Promise<Watchlist> {
  const watchlist = await getDefaultWatchlist();
  const nextProfile: PortfolioProfile = {
    ...watchlist.profile,
    ...input,
    riskTolerance: (input.riskTolerance ?? watchlist.profile.riskTolerance) as RiskTolerance,
    holdingHorizon: (input.holdingHorizon ?? watchlist.profile.holdingHorizon) as HoldingHorizon,
    maxPositionWeight: input.maxPositionWeight !== undefined ? normalizeNullableNumber(input.maxPositionWeight) : watchlist.profile.maxPositionWeight,
    targetCashPct: input.targetCashPct !== undefined ? normalizeNullableNumber(input.targetCashPct) : watchlist.profile.targetCashPct,
    concentrationLimit: input.concentrationLimit !== undefined ? normalizeNullableNumber(input.concentrationLimit) : watchlist.profile.concentrationLimit,
    strategyNotes: input.strategyNotes !== undefined ? String(input.strategyNotes) : watchlist.profile.strategyNotes,
    updatedAt: nowIso(),
  };

  if (watchlist.storage === 'supabase') {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable.');
    const { error } = await supabase
      .from('watchlists')
      .update({
        risk_tolerance: nextProfile.riskTolerance,
        holding_horizon: nextProfile.holdingHorizon,
        max_position_weight: nextProfile.maxPositionWeight,
        target_cash_pct: nextProfile.targetCashPct,
        concentration_limit: nextProfile.concentrationLimit,
        strategy_notes: nextProfile.strategyNotes,
        updated_at: nextProfile.updatedAt,
      })
      .eq('id', watchlist.id);
    if (error && !/column .* does not exist|schema cache/i.test(error.message)) {
      throw new Error(error.message);
    }
  }

  const nextWatchlist = {
    ...watchlist,
    updatedAt: nowIso(),
    profile: nextProfile,
  };
  if (watchlist.storage === 'filesystem') {
    await saveFileWatchlist(nextWatchlist);
  }
  return nextWatchlist;
}

export async function updateWatchlistItemPosition(
  symbolOrId: string,
  input: Partial<WatchlistPositionMeta>
): Promise<Watchlist> {
  const watchlist = await getDefaultWatchlist();
  const needle = String(symbolOrId || '').trim();
  const normalizedSymbol = normalizeSymbol(needle);
  const index = watchlist.items.findIndex((item) => item.id === needle || item.symbol === normalizedSymbol);
  if (index === -1) {
    throw new Error('Watchlist item not found.');
  }
  const current = watchlist.items[index];
  const nextItem: WatchlistItem = {
    ...current,
    ...input,
    ownershipStatus: (input.ownershipStatus ?? current.ownershipStatus) as OwnershipStatus,
    currentWeight: input.currentWeight !== undefined ? normalizeNullableNumber(input.currentWeight) : current.currentWeight,
    targetWeight: input.targetWeight !== undefined ? normalizeNullableNumber(input.targetWeight) : current.targetWeight,
    maxWeight: input.maxWeight !== undefined ? normalizeNullableNumber(input.maxWeight) : current.maxWeight,
    costBasis: input.costBasis !== undefined ? normalizeNullableNumber(input.costBasis) : current.costBasis,
    conviction: (input.conviction ?? current.conviction) as ConvictionLabel,
    thesis: input.thesis !== undefined ? String(input.thesis) : current.thesis,
    desiredEntryMin: input.desiredEntryMin !== undefined ? normalizeNullableNumber(input.desiredEntryMin) : current.desiredEntryMin,
    desiredEntryMax: input.desiredEntryMax !== undefined ? normalizeNullableNumber(input.desiredEntryMax) : current.desiredEntryMax,
    trimAbove: input.trimAbove !== undefined ? normalizeNullableNumber(input.trimAbove) : current.trimAbove,
    invalidation: input.invalidation !== undefined ? String(input.invalidation) : current.invalidation,
    reviewDate: input.reviewDate !== undefined ? input.reviewDate : current.reviewDate,
    lastReviewedAt: input.lastReviewedAt !== undefined ? input.lastReviewedAt : current.lastReviewedAt,
    notes: input.notes !== undefined ? String(input.notes) : current.notes,
  };

  const nextItems = [...watchlist.items];
  nextItems[index] = nextItem;

  if (watchlist.storage === 'supabase') {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client unavailable.');
    const { error } = await supabase
      .from('watchlist_items')
      .update({
        ownership_status: nextItem.ownershipStatus,
        current_weight: nextItem.currentWeight,
        target_weight: nextItem.targetWeight,
        max_weight: nextItem.maxWeight,
        cost_basis: nextItem.costBasis,
        conviction: nextItem.conviction,
        thesis: nextItem.thesis,
        desired_entry_min: nextItem.desiredEntryMin,
        desired_entry_max: nextItem.desiredEntryMax,
        trim_above: nextItem.trimAbove,
        invalidation: nextItem.invalidation,
        review_date: nextItem.reviewDate,
        last_reviewed_at: nextItem.lastReviewedAt,
        notes: nextItem.notes,
      })
      .eq('id', nextItem.id);
    if (error && !/column .* does not exist|schema cache/i.test(error.message)) {
      throw new Error(error.message);
    }
  }

  const nextWatchlist = {
    ...watchlist,
    updatedAt: nowIso(),
    items: sortItems(nextItems),
  };
  if (watchlist.storage === 'filesystem') {
    await saveFileWatchlist(nextWatchlist);
  }
  return nextWatchlist;
}

export async function removeWatchlistItem(symbolOrId: string): Promise<Watchlist> {
  const needle = String(symbolOrId || '').trim();
  const normalizedSymbol = normalizeSymbol(needle);
  const watchlist = await getDefaultWatchlist();
  const nextItems = watchlist.items.filter((item) => item.id !== needle && item.symbol !== normalizedSymbol);

  if (nextItems.length === watchlist.items.length) {
    return watchlist;
  }

  if (watchlist.storage === 'supabase') {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client unavailable.');
    }
    const target = watchlist.items.find((item) => item.id === needle || item.symbol === normalizedSymbol);
    if (target) {
      const { error } = await supabase
        .from('watchlist_items')
        .delete()
        .eq('id', target.id);
      if (error) {
        throw new Error(error.message);
      }
    }
    for (const [index, item] of nextItems.entries()) {
      const { error } = await supabase
        .from('watchlist_items')
        .update({ display_order: index })
        .eq('id', item.id);
      if (error) {
        throw new Error(error.message);
      }
    }
    return {
      ...watchlist,
      items: nextItems.map((item, index) => ({ ...item, displayOrder: index })),
    };
  }

  const nextWatchlist: Watchlist = {
    ...watchlist,
    updatedAt: nowIso(),
    items: nextItems.map((item, index) => ({ ...item, displayOrder: index })),
  };
  await saveFileWatchlist(nextWatchlist);
  return nextWatchlist;
}
