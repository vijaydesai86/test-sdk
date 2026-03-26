import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getSupabaseClient } from './supabaseClient';

export interface WatchlistItem {
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

function normalizeSymbol(symbol: string) {
  return String(symbol || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase();
}

function toSeedItems(seed = DEFAULT_WATCHLIST_SEED): WatchlistItem[] {
  const createdAt = nowIso();
  return seed.map((item, index) => ({
    id: randomUUID(),
    symbol: normalizeSymbol(item.symbol),
    companyName: item.companyName,
    displayOrder: index,
    createdAt,
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
    items: sortItems(
      Array.isArray(record.items)
        ? record.items.map((item: any) => ({
            id: String(item.id),
            symbol: normalizeSymbol(item.symbol),
            companyName: String(item.company_name ?? item.companyName ?? item.symbol),
            displayOrder: Number(item.display_order ?? item.displayOrder ?? 0),
            createdAt: String(item.created_at ?? item.createdAt ?? nowIso()),
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

  const { data: watchlists, error: watchlistError } = await supabase
    .from('watchlists')
    .select('id, name, slug, is_default, created_at, updated_at')
    .eq('slug', DEFAULT_WATCHLIST_SLUG)
    .limit(1);

  if (watchlistError) return null;

  let watchlist = watchlists?.[0];
  if (!watchlist) {
    const createdAt = nowIso();
    const { data: inserted, error: insertError } = await supabase
      .from('watchlists')
      .insert({
        name: DEFAULT_WATCHLIST_NAME,
        slug: DEFAULT_WATCHLIST_SLUG,
        is_default: true,
        created_at: createdAt,
        updated_at: createdAt,
      })
      .select('id, name, slug, is_default, created_at, updated_at')
      .single();

    if (insertError || !inserted) return null;
    watchlist = inserted;
  }

  const { data: items, error: itemError } = await supabase
    .from('watchlist_items')
    .select('id, symbol, company_name, display_order, created_at')
    .eq('watchlist_id', watchlist.id)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (itemError) return null;

  const existingItems = Array.isArray(items) ? items : [];
  if (existingItems.length === 0) {
    const seedRows = DEFAULT_WATCHLIST_SEED.map((item, index) => ({
      watchlist_id: watchlist.id,
      symbol: normalizeSymbol(item.symbol),
      company_name: item.companyName,
      display_order: index,
    }));

    const { data: insertedItems, error: seedError } = await supabase
      .from('watchlist_items')
      .insert(seedRows)
      .select('id, symbol, company_name, display_order, created_at');

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
      })
      .select('id, symbol, company_name, display_order, created_at')
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
      },
    ]),
  };
  await saveFileWatchlist(nextWatchlist);
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
