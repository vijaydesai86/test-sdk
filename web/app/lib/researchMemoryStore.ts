/* eslint-disable @typescript-eslint/no-explicit-any */
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getSupabaseClient } from './supabaseClient';
import { formatRecentRequestForMemory } from './reportReplayGuard';
import type {
  CompanyThesisRecord,
  DecisionJournalRecord,
  PortfolioProfile,
  ResearchMemoryContext,
  ResearchMessageRecord,
  ResearchSessionRecord,
  WatchlistPositionMeta,
} from './investmentTypes';

const MEMORY_FILE =
  process.env.RESEARCH_MEMORY_FILE
  || (process.env.VERCEL ? '/tmp/research-memory.json' : path.join(process.cwd(), 'reports', 'research-memory.json'));

type FileMemoryStore = {
  sessions: ResearchSessionRecord[];
  messages: ResearchMessageRecord[];
  theses: CompanyThesisRecord[];
  decisions: DecisionJournalRecord[];
};

type WatchlistContext = {
  name: string;
  profile?: PortfolioProfile;
  items: Array<{
    symbol: string;
    companyName?: string;
    position?: Partial<WatchlistPositionMeta>;
  }>;
};

function nowIso() {
  return new Date().toISOString();
}

async function readFileStore(): Promise<FileMemoryStore> {
  try {
    const raw = await fs.readFile(MEMORY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<FileMemoryStore>;
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      theses: Array.isArray(parsed.theses) ? parsed.theses : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    };
  } catch {
    return { sessions: [], messages: [], theses: [], decisions: [] };
  }
}

async function writeFileStore(store: FileMemoryStore) {
  await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });
  await fs.writeFile(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function buildSessionTitle(messages: Array<{ role: string; content: string | null }>, fallback = 'Research Session') {
  const firstUser = messages.find((message) => message.role === 'user' && message.content)?.content?.trim();
  if (!firstUser) return fallback;
  return firstUser.length > 80 ? `${firstUser.slice(0, 77)}...` : firstUser;
}

function buildSessionSummary(messages: Array<{ role: string; content: string | null }>) {
  const recentUser = messages
    .filter((message) => message.role === 'user' && message.content)
    .slice(-2)
    .map((message) => message.content?.trim())
    .filter(Boolean)
    .join(' | ');
  return recentUser || 'Active investment research session.';
}

function normalizeContent(content: string | null) {
  if (!content) return null;
  return content.length > 6000 ? `${content.slice(0, 6000)}… [truncated]` : content;
}

function summarizeDecisionAction(action: DecisionJournalRecord['action']): string {
  if (action === 'Initiate') return 'Start a position';
  if (action === 'Add') return 'Add to the position';
  if (action === 'Hold') return 'Keep holding';
  if (action === 'Trim') return 'Trim the position';
  if (action === 'Exit') return 'Exit the position';
  return 'Wait for a better setup';
}

function isSchemaMismatch(message: string) {
  return (
    // Supabase schema not migrated yet
    /does not exist|schema cache|Could not find the table/i.test(message) ||
    // Cloudflare 521 / 502 — Supabase origin server down (HTML error page returned)
    /<!DOCTYPE|<html/i.test(message) ||
    // Network-level failures (DNS, TCP, TLS)
    /fetch failed|ECONNREFUSED|ENOTFOUND|network error/i.test(message)
  );
}

function truncateErrorMsg(message: string, max = 200): string {
  if (!message) return '(no message)';
  const clean = message.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

export async function loadSessionMessages(sessionId: string): Promise<ResearchMessageRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const query = await supabase
      .from('research_messages')
      .select('id, session_id, role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (!query.error) {
      return (query.data ?? []).map((row: any) => ({
        id: String(row.id),
        sessionId: String(row.session_id),
        role: row.role,
        content: row.content,
        createdAt: String(row.created_at),
      }));
    }
    if (!isSchemaMismatch(query.error.message)) {
      console.error('[research-memory] Failed to load session messages:', truncateErrorMsg(query.error.message));
    }
  }

  const store = await readFileStore();
  return store.messages
    .filter((message) => message.sessionId === sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function saveSessionMessages(
  sessionId: string,
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string | null }>,
  metadata?: { title?: string; summary?: string }
) {
  const createdAt = nowIso();
  const sessionRecord: ResearchSessionRecord = {
    id: sessionId,
    title: metadata?.title || buildSessionTitle(messages),
    summary: metadata?.summary || buildSessionSummary(messages),
    createdAt,
    updatedAt: createdAt,
  };
  const normalizedMessages: ResearchMessageRecord[] = messages.map((message, index) => ({
    id: `${sessionId}-${index}-${createdAt}`,
    sessionId,
    role: message.role,
    content: normalizeContent(message.content),
    createdAt: new Date(Date.now() + index).toISOString(),
  }));

  const supabase = getSupabaseClient();
  if (supabase) {
    const existing = await supabase
      .from('research_sessions')
      .upsert({
        id: sessionRecord.id,
        title: sessionRecord.title,
        summary: sessionRecord.summary,
        updated_at: sessionRecord.updatedAt,
      })
      .select('id')
      .single();
    if (existing.error && !isSchemaMismatch(existing.error.message)) {
      console.error('[research-memory] Failed to upsert session:', truncateErrorMsg(existing.error.message));
    } else if (!existing.error) {
      await supabase.from('research_messages').delete().eq('session_id', sessionId);
      const insert = await supabase.from('research_messages').insert(
        normalizedMessages.map((message) => ({
          id: message.id,
          session_id: message.sessionId,
          role: message.role,
          content: message.content,
          created_at: message.createdAt,
        }))
      );
      if (insert.error && !isSchemaMismatch(insert.error.message)) {
        console.error('[research-memory] Failed to save session messages:', truncateErrorMsg(insert.error.message));
      } else {
        return;
      }
    }
  }

  const store = await readFileStore();
  const sessions = [
    sessionRecord,
    ...store.sessions.filter((session) => session.id !== sessionId),
  ];
  const messagesWithoutSession = store.messages.filter((message) => message.sessionId !== sessionId);
  await writeFileStore({
    ...store,
    sessions,
    messages: [...messagesWithoutSession, ...normalizedMessages],
  });
}

export async function deleteSession(sessionId: string) {
  const supabase = getSupabaseClient();
  if (supabase) {
    const del = await supabase.from('research_sessions').delete().eq('id', sessionId);
    if (del.error && !isSchemaMismatch(del.error.message)) {
      console.error('[research-memory] Failed to delete session:', truncateErrorMsg(del.error.message));
    }
  }

  const store = await readFileStore();
  await writeFileStore({
    ...store,
    sessions: store.sessions.filter((session) => session.id !== sessionId),
    messages: store.messages.filter((message) => message.sessionId !== sessionId),
  });
}

export async function appendDecisionJournal(entry: Omit<DecisionJournalRecord, 'id' | 'createdAt'>) {
  const record: DecisionJournalRecord = {
    id: randomUUID(),
    createdAt: nowIso(),
    ...entry,
  };
  const supabase = getSupabaseClient();
  if (supabase) {
    const insert = await supabase.from('decision_journal').insert({
      id: record.id,
      session_id: record.sessionId ?? null,
      symbol: record.symbol ?? null,
      action: record.action,
      confidence: record.confidence,
      summary: record.summary,
      score: record.score,
      price: record.price,
      created_at: record.createdAt,
    });
    if (!insert.error) return;
    if (!isSchemaMismatch(insert.error.message)) {
      console.error('[research-memory] Failed to write decision journal:', truncateErrorMsg(insert.error.message));
    }
  }

  const store = await readFileStore();
  await writeFileStore({
    ...store,
    decisions: [record, ...store.decisions].slice(0, 500),
  });
}

export async function getLatestDecision(symbol: string): Promise<DecisionJournalRecord | null> {
  const normalized = symbol.toUpperCase();
  const supabase = getSupabaseClient();
  if (supabase) {
    const query = await supabase
      .from('decision_journal')
      .select('id, session_id, symbol, action, confidence, summary, score, price, created_at')
      .eq('symbol', normalized)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!query.error && query.data) {
      return {
        id: String(query.data.id),
        sessionId: query.data.session_id ? String(query.data.session_id) : undefined,
        symbol: query.data.symbol ? String(query.data.symbol) : undefined,
        action: query.data.action,
        confidence: query.data.confidence,
        summary: query.data.summary,
        score: query.data.score,
        price: query.data.price,
        createdAt: String(query.data.created_at),
      };
    }
    if (query.error && !isSchemaMismatch(query.error.message)) {
      console.error('[research-memory] Failed to load latest decision:', truncateErrorMsg(query.error.message));
    }
  }

  const store = await readFileStore();
  return store.decisions.find((decision) => decision.symbol === normalized) || null;
}

export async function upsertCompanyThesis(record: CompanyThesisRecord) {
  const normalized = {
    ...record,
    symbol: record.symbol.toUpperCase(),
    updatedAt: record.updatedAt || nowIso(),
  };
  const supabase = getSupabaseClient();
  if (supabase) {
    const upsert = await supabase.from('company_theses').upsert({
      symbol: normalized.symbol,
      thesis: normalized.thesis,
      conviction: normalized.conviction,
      invalidation: normalized.invalidation,
      last_action: normalized.lastAction,
      summary: normalized.summary ?? null,
      updated_at: normalized.updatedAt,
    });
    if (!upsert.error) return;
    if (!isSchemaMismatch(upsert.error.message)) {
      console.error('[research-memory] Failed to upsert company thesis:', truncateErrorMsg(upsert.error.message));
    }
  }

  const store = await readFileStore();
  await writeFileStore({
    ...store,
    theses: [
      normalized,
      ...store.theses.filter((entry) => entry.symbol !== normalized.symbol),
    ],
  });
}

async function loadRecentTheses(symbols: string[]): Promise<CompanyThesisRecord[]> {
  const normalizedSymbols = Array.from(new Set(symbols.map((symbol) => symbol.toUpperCase()).filter(Boolean)));
  const supabase = getSupabaseClient();
  if (supabase && normalizedSymbols.length > 0) {
    const query = await supabase
      .from('company_theses')
      .select('symbol, thesis, conviction, invalidation, last_action, updated_at, summary')
      .in('symbol', normalizedSymbols)
      .order('updated_at', { ascending: false });
    if (!query.error) {
      return (query.data ?? []).map((row: any) => ({
        symbol: String(row.symbol),
        thesis: String(row.thesis || ''),
        conviction: row.conviction,
        invalidation: String(row.invalidation || ''),
        lastAction: row.last_action,
        updatedAt: String(row.updated_at),
        summary: row.summary ? String(row.summary) : undefined,
      }));
    }
    if (!isSchemaMismatch(query.error.message)) {
      console.error('[research-memory] Failed to load theses:', truncateErrorMsg(query.error.message));
    }
  }

  const store = await readFileStore();
  return store.theses.filter((entry) => normalizedSymbols.includes(entry.symbol));
}

async function loadRecentDecisions(symbols: string[]): Promise<DecisionJournalRecord[]> {
  const normalizedSymbols = Array.from(new Set(symbols.map((symbol) => symbol.toUpperCase()).filter(Boolean)));
  const supabase = getSupabaseClient();
  if (supabase && normalizedSymbols.length > 0) {
    const query = await supabase
      .from('decision_journal')
      .select('id, session_id, symbol, action, confidence, summary, score, price, created_at')
      .in('symbol', normalizedSymbols)
      .order('created_at', { ascending: false })
      .limit(8);
    if (!query.error) {
      return (query.data ?? []).map((row: any) => ({
        id: String(row.id),
        sessionId: row.session_id ? String(row.session_id) : undefined,
        symbol: row.symbol ? String(row.symbol) : undefined,
        action: row.action,
        confidence: row.confidence,
        summary: String(row.summary || ''),
        score: row.score,
        price: row.price,
        createdAt: String(row.created_at),
      }));
    }
    if (!isSchemaMismatch(query.error.message)) {
      console.error('[research-memory] Failed to load decision journal:', truncateErrorMsg(query.error.message));
    }
  }

  const store = await readFileStore();
  return store.decisions.filter((entry) => entry.symbol && normalizedSymbols.includes(entry.symbol)).slice(0, 8);
}

async function loadRecentSessions(limit = 5, excludeSessionId?: string): Promise<ResearchSessionRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    let query = supabase
      .from('research_sessions')
      .select('id, title, summary, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit + (excludeSessionId ? 1 : 0));
    if (excludeSessionId) {
      query = query.neq('id', excludeSessionId);
    }
    const result = await query;
    if (!result.error) {
      return (result.data ?? []).map((row: any) => ({
        id: String(row.id),
        title: String(row.title || 'Research Session'),
        summary: String(row.summary || ''),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      })).slice(0, limit);
    }
    if (!isSchemaMismatch(result.error.message)) {
      console.error('[research-memory] Failed to load recent sessions:', truncateErrorMsg(result.error.message));
    }
  }

  const store = await readFileStore();
  return [...store.sessions]
    .filter((session) => session.id !== excludeSessionId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

function summarizePortfolioContext(watchlist?: WatchlistContext): string[] {
  if (!watchlist) return [];
  const lines: string[] = [];
  if (watchlist.profile) {
    const profile = watchlist.profile;
    lines.push(
      `Portfolio profile: risk=${profile.riskTolerance}, horizon=${profile.holdingHorizon}, ` +
      `max position=${profile.maxPositionWeight ?? 'n/a'}%, target cash=${profile.targetCashPct ?? 'n/a'}%.`
    );
    if (profile.strategyNotes) {
      lines.push(`Investor notes: ${profile.strategyNotes}`);
    }
  }
  const owned = watchlist.items
    .filter((item) => item.position?.ownershipStatus === 'owned')
    .slice(0, 8)
    .map((item) => {
      const position = item.position || {};
      const weight = position.currentWeight != null ? `${position.currentWeight}%` : 'n/a';
      const costBasis = position.costBasis != null ? `$${position.costBasis}` : 'n/a';
      const target = position.targetWeight != null ? `${position.targetWeight}%` : 'n/a';
      return `${item.symbol} (${item.companyName || item.symbol}) weight=${weight}, cost basis=${costBasis}, target=${target}.`;
    });
  if (owned.length > 0) {
    lines.push(`Owned positions: ${owned.join(' ')}`);
  }
  return lines;
}

export async function buildResearchContext(args: {
  sessionId: string;
  userMessage: string;
  watchlist?: WatchlistContext;
}): Promise<ResearchMemoryContext> {
  const symbols = Array.from(new Set([
    ...args.watchlist?.items.map((item) => item.symbol) || [],
    ...Array.from(args.userMessage.matchAll(/\b[A-Z]{1,5}\b/g)).map((match) => match[0]),
  ]))
    .slice(0, 12);
  const [theses, recentDecisions, previousMessages, recentSessions] = await Promise.all([
    loadRecentTheses(symbols),
    loadRecentDecisions(symbols),
    loadSessionMessages(args.sessionId),
    loadRecentSessions(4, args.sessionId),
  ]);
  const lines: string[] = [];
  lines.push(...summarizePortfolioContext(args.watchlist));
  const recentUserHistory = previousMessages
    .filter((message) => message.role === 'user' && message.content)
    .slice(-3)
    .map((message) => formatRecentRequestForMemory(message.content || ''));
  lines.push(...recentUserHistory);
  const recentAssistantHistory = previousMessages
    .filter((message) => message.role === 'assistant' && message.content)
    .slice(-2)
    .map((message) => `Recent assistant conclusion: ${message.content}`);
  lines.push(...recentAssistantHistory);
  if (theses.length > 0) {
    lines.push(
      `Stored theses: ${theses
        .slice(0, 5)
        .map((thesis) => `${thesis.symbol}=${thesis.summary || thesis.thesis}`)
        .join(' | ')}`
    );
  }
  if (recentDecisions.length > 0) {
    lines.push(
      `Recent decisions: ${recentDecisions
        .slice(0, 5)
        .map((decision) => `${decision.symbol || 'portfolio'} ${summarizeDecisionAction(decision.action)} (${decision.confidence}) - ${decision.summary}`)
        .join(' | ')}`
    );
  }
  if (recentSessions.length > 0) {
    lines.push(
      `Recent session memory: ${recentSessions
        .map((session) => `${session.title} - ${session.summary}`)
        .join(' | ')}`
    );
  }
  return {
    summary: lines.join('\n'),
    theses,
    recentDecisions,
  };
}
