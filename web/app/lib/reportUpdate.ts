/* eslint-disable @typescript-eslint/no-explicit-any */
import { getReportFilePath, readReportFile, listFilesystemReports } from './reportFileStore';
import { getConfiguredEnv } from './env';
import { promises as fs } from 'fs';
import path from 'path';

export type ReportKind = 'stock' | 'comparison' | 'research' | 'watchlist-daily';

export type ReportCoverageStatus = 'available' | 'missing';

export interface ReportCoverageEntry {
  label: string;
  status: ReportCoverageStatus;
  provider?: string;
  asOf?: string | null;
}

export interface ReportCheckpointEntry extends ReportCoverageEntry {
  data?: any;
  fetchedAt?: string;
}

export interface ReportMissingDataEntry {
  symbol: string;
  key: string;
  label: string;
  priority: 'critical' | 'high' | 'optional';
}

export interface ReportImproveHistoryEntry {
  passNumber: number;
  accepted: boolean;
  reason: string;
  generatedAt: string;
  target: 'critical' | 'all';
  maxPasses: number;
  baseline?: {
    id?: string;
    title?: string | null;
    filename?: string | null;
    storagePath?: string | null;
  };
  candidate?: {
    id?: string;
    title?: string | null;
    filename?: string | null;
    storagePath?: string | null;
  };
  beforeCoverage?: {
    total: number;
    available: number;
    missing: number;
    criticalMissing: number;
    coveragePct: number | null;
  } | null;
  afterCoverage?: {
    total: number;
    available: number;
    missing: number;
    criticalMissing: number;
    coveragePct: number | null;
  } | null;
}

export interface ReportRunMetadata {
  version: 1;
  kind: ReportKind;
  reportVariant?: 'original' | 'updated';
  query?: string;
  symbols: string[];
  range?: string;
  generatedAt: string;
  updatedFrom?: {
    id?: string;
    title?: string | null;
    filename?: string | null;
    createdAt?: string | null;
    storagePath?: string | null;
  };
  lineage?: {
    originalStoragePath?: string | null;
    updatedFromStoragePath?: string | null;
  };
  coverage: Record<string, Record<string, ReportCoverageEntry>>;
  checkpoint?: Record<string, Record<string, ReportCheckpointEntry>>;
  missingData: ReportMissingDataEntry[];
  notes?: string[];
  improveHistory?: ReportImproveHistoryEntry[];
  researchUniverse?: {
    status?: 'discovering' | 'refining' | 'locked' | 'failed';
    selectedSymbols: string[];
    qualifiedSymbols: string[];
    requiredDimensions?: Array<{
      label: string;
      required?: boolean;
      searchQueries?: string[];
      rationale?: string;
    }>;
    coveredDimensions?: string[];
    missingDimensions?: string[];
    roles?: Array<{
      label: string;
      definition?: string;
      required?: boolean;
      query?: string;
      dimensions?: string[];
      searchQueries?: string[];
    }>;
    subthemes?: Array<{ name: string; symbols: string[] }>;
    readiness?: {
      status: 'discovering' | 'refining' | 'locked' | 'failed';
      selectedCount: number;
      targetCount?: number;
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
    };
    candidates: Array<{
      symbol: string;
      subtheme?: string;
      selected?: boolean;
      sourceFacets?: string[];
      sourceEvidence?: Array<{
        role: string;
        level: string;
        rationale: string;
        confidence: number;
        source?: string;
      }>;
      themeEvidence?: {
        level: string;
        role: string;
        rationale: string;
        confidence: number;
      };
      themeFit?: string;
      themeScore?: number;
      qualified?: boolean;
    }>;
  };
}

export interface CoverageInput {
  symbol: string;
  key: string;
  label: string;
  data: any;
  priority?: ReportMissingDataEntry['priority'];
  provider?: string;
  asOf?: string | null;
}

export interface PreviousReportMatch {
  id?: string;
  filename?: string | null;
  title?: string | null;
  summary?: string | null;
  content: string;
  storagePath?: string | null;
  reportKind?: string | null;
  createdAt?: string | null;
  reportDate?: string | null;
  metadata?: ReportRunMetadata | null;
  score: number;
}

const METADATA_PREFIX = 'stock-report-run-metadata:';
const METADATA_RE = /<!--\s*stock-report-run-metadata:([\s\S]*?)-->/;

export function hasMeaningfulReportValue(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '' && value.trim().toUpperCase() !== 'N/A';
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulReportValue(item));
  if (typeof value === 'object') return Object.values(value).some((item) => hasMeaningfulReportValue(item));
  return true;
}

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeSymbol(value: string) {
  return value.replace(/[^A-Z0-9.]/gi, '').toUpperCase();
}

function inferKindFromText(text: string): ReportKind | null {
  const normalized = normalizeToken(text);
  if (/\bwatchlist\b|\bdaily\b/.test(normalized)) return 'watchlist-daily';
  if (/\bcomparison\b|\bcompare\b|\bvs\b|\bversus\b/.test(normalized)) return 'comparison';
  if (/\bresearch\b|\bsector\b|\btheme\b|\bindustry\b|\becosystem\b/.test(normalized)) return 'research';
  if (/\bstock\b|\bequity\b|\breport\b/.test(normalized)) return 'stock';
  return null;
}

function normalizeReportKindForMatch(value: unknown): ReportKind | null {
  if (value === 'stock' || value === 'comparison' || value === 'research' || value === 'watchlist-daily') {
    return value;
  }
  if (typeof value !== 'string') return null;
  return inferKindFromText(value);
}

export function appendReportMetadata(content: string, metadata?: ReportRunMetadata): string {
  if (!metadata) return content;
  const contentWithoutOldMetadata = content.replace(METADATA_RE, '').trimEnd();
  const payload = JSON.stringify(metadata);
  return `${contentWithoutOldMetadata}\n\n<!-- ${METADATA_PREFIX}${payload} -->\n`;
}

export function extractReportMetadata(content: string): ReportRunMetadata | null {
  const match = content.match(METADATA_RE);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed || parsed.version !== 1 || typeof parsed.kind !== 'string') return null;
    return parsed as ReportRunMetadata;
  } catch {
    return null;
  }
}

export function stripReportMetadata(content: string): string {
  return content.replace(METADATA_RE, '').trimEnd();
}

export async function writeReportMetadataSidecar(
  storagePath: string,
  metadata: ReportRunMetadata | undefined,
  reportsDir?: string
) {
  if (!metadata) return;
  const filePath = getReportFilePath(storagePath, reportsDir);
  if (!filePath) return;
  try {
    const metadataPath = `${filePath}.metadata.json`;
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  } catch {
    // Sidecar metadata is a resume optimization; the Markdown report remains source-readable.
  }
}

export async function readReportMetadataSidecar(storagePath: string): Promise<ReportRunMetadata | null> {
  const filePath = getReportFilePath(storagePath);
  if (!filePath) return null;
  try {
    const raw = await fs.readFile(`${filePath}.metadata.json`, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || typeof parsed.kind !== 'string') return null;
    return parsed as ReportRunMetadata;
  } catch {
    return null;
  }
}

export function buildReportRunMetadata(args: {
  kind: ReportKind;
  query?: string;
  symbols: string[];
  range?: string;
  generatedAt: string;
  coverage: CoverageInput[];
  updatedFrom?: PreviousReportMatch | null;
  notes?: string[];
  researchUniverse?: ReportRunMetadata['researchUniverse'];
}): ReportRunMetadata {
  const coverage: ReportRunMetadata['coverage'] = {};
  const checkpoint: NonNullable<ReportRunMetadata['checkpoint']> = {};
  const missingData: ReportMissingDataEntry[] = [];
  for (const item of args.coverage) {
    const symbol = normalizeSymbol(item.symbol || 'REPORT') || 'REPORT';
    const status: ReportCoverageStatus = hasMeaningfulReportValue(item.data) ? 'available' : 'missing';
    coverage[symbol] = coverage[symbol] || {};
    coverage[symbol][item.key] = {
      label: item.label,
      status,
      provider: item.provider,
      asOf: item.asOf ?? null,
    };
    checkpoint[symbol] = checkpoint[symbol] || {};
    checkpoint[symbol][item.key] = {
      ...coverage[symbol][item.key],
      fetchedAt: args.generatedAt,
      data: status === 'available' ? item.data : undefined,
    };
    if (status === 'missing') {
      missingData.push({
        symbol,
        key: item.key,
        label: item.label,
        priority: item.priority || 'optional',
      });
    }
  }

  const priorLineage = args.updatedFrom?.metadata?.lineage;
  const originalStoragePath = args.updatedFrom
    ? priorLineage?.originalStoragePath || args.updatedFrom.storagePath || null
    : undefined;

  return {
    version: 1,
    kind: args.kind,
    reportVariant: args.updatedFrom ? 'updated' : 'original',
    query: args.query,
    symbols: Array.from(new Set(args.symbols.map(normalizeSymbol).filter(Boolean))),
    range: args.range,
    generatedAt: args.generatedAt,
    updatedFrom: args.updatedFrom
      ? {
          id: args.updatedFrom.id,
          title: args.updatedFrom.title,
          filename: args.updatedFrom.filename,
          createdAt: args.updatedFrom.createdAt,
          storagePath: args.updatedFrom.storagePath,
        }
      : undefined,
    lineage: args.updatedFrom
      ? {
          originalStoragePath,
          updatedFromStoragePath: args.updatedFrom.storagePath || null,
        }
      : undefined,
    coverage,
    checkpoint,
    missingData,
    notes: args.notes,
    researchUniverse: args.researchUniverse,
    improveHistory: args.updatedFrom?.metadata?.improveHistory?.length
      ? args.updatedFrom.metadata.improveHistory
      : undefined,
  };
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeMissingReportValues(current: any, previous: any): { data: any; changed: boolean } {
  if (!hasMeaningfulReportValue(current) && hasMeaningfulReportValue(previous)) {
    return { data: previous, changed: true };
  }
  if (!hasMeaningfulReportValue(previous)) {
    return { data: current, changed: false };
  }
  if (!isPlainObject(current) || !isPlainObject(previous)) {
    return { data: current, changed: false };
  }

  let changed = false;
  const merged: Record<string, any> = { ...current };
  for (const [key, previousValue] of Object.entries(previous)) {
    const currentValue = current[key];
    const next = mergeMissingReportValues(currentValue, previousValue);
    if (next.changed) {
      merged[key] = next.data;
      changed = true;
    }
  }
  return { data: changed ? merged : current, changed };
}

export interface ReportFieldMergeResult<T = any> {
  data: T;
  carriedForward: boolean;
  prior?: ReportCheckpointEntry;
}

export function getPreviousCheckpointField(
  previous: PreviousReportMatch | null | undefined,
  symbol: string,
  key: string
): ReportCheckpointEntry | null {
  const normalizedSymbol = normalizeSymbol(symbol || 'REPORT') || 'REPORT';
  return previous?.metadata?.checkpoint?.[normalizedSymbol]?.[key] || null;
}

export function mergeWithPreviousReportField<T = any>(args: {
  previous: PreviousReportMatch | null | undefined;
  symbol: string;
  key: string;
  label: string;
  data: T;
  notes?: string[];
}): ReportFieldMergeResult<T> {
  const prior = getPreviousCheckpointField(args.previous, args.symbol, args.key);
  if (!prior || prior.status !== 'available' || !hasMeaningfulReportValue(prior.data)) {
    return { data: args.data, carriedForward: false, prior: prior || undefined };
  }

  const merged = mergeMissingReportValues(args.data, prior.data);
  if (!merged.changed) {
    return { data: args.data, carriedForward: false, prior };
  }

  const symbol = normalizeSymbol(args.symbol || 'REPORT') || 'REPORT';
  const timestamp = prior.asOf || prior.fetchedAt || args.previous?.createdAt || args.previous?.reportDate || 'the prior report';
  const note = hasMeaningfulReportValue(args.data)
    ? `${symbol}: ${args.label} had missing fields in this update; filled only those gaps from the prior verified checkpoint (${timestamp}).`
    : `${symbol}: ${args.label} was unavailable in this update; carried forward the prior verified checkpoint (${timestamp}).`;
  if (args.notes && !args.notes.includes(note)) args.notes.push(note);
  return { data: merged.data as T, carriedForward: true, prior };
}

function scoreCandidate(candidate: PreviousReportMatch, kind: ReportKind, query?: string, symbols: string[] = []) {
  const text = normalizeToken([
    candidate.filename,
    candidate.title,
    candidate.summary,
    candidate.metadata?.query,
    candidate.metadata?.symbols?.join(' '),
    candidate.content.slice(0, 2000),
  ].filter(Boolean).join(' '));
  const metadataKind = normalizeReportKindForMatch(candidate.metadata?.kind);
  const rowKind = normalizeReportKindForMatch(candidate.reportKind);
  const textKind = inferKindFromText(text);
  let score = 0;
  if (metadataKind === kind) score += 80;
  else if (rowKind === kind) score += 65;
  else if (textKind === kind) score += 25;
  else return 0;

  const wantedSymbols = symbols.map(normalizeSymbol).filter(Boolean);
  if (wantedSymbols.length > 0) {
    const candidateSymbols = new Set((candidate.metadata?.symbols || []).map(normalizeSymbol));
    let matched = 0;
    for (const symbol of wantedSymbols) {
      if (candidateSymbols.has(symbol) || text.includes(normalizeToken(symbol))) matched += 1;
    }
    if (matched === wantedSymbols.length) score += 80;
    else if (matched > 0) score += 25 * matched;
    else if (kind !== 'watchlist-daily') score -= 50;
  }

  const normalizedQuery = normalizeToken(query || '');
  if (normalizedQuery) {
    const queryTokens = normalizedQuery.split(' ').filter((token) => token.length > 2 && !['update', 'report', 'stock', 'comparison', 'research'].includes(token));
    const matchedTokens = queryTokens.filter((token) => text.includes(token)).length;
    score += Math.min(40, matchedTokens * 8);
  }

  return score;
}

async function loadSupabaseCandidates(): Promise<PreviousReportMatch[]> {
  if (!getConfiguredEnv('SUPABASE_URL') || !getConfiguredEnv('SUPABASE_SERVICE_ROLE_KEY')) return [];
  try {
    const { getSupabaseClient } = await import('./supabaseClient');
    const client = getSupabaseClient();
    if (!client) return [];

    let query: any = await client
      .from('saved_reports')
      .select('id, filename, title, summary, content, storage_path, report_kind, report_date, created_at, run_metadata')
      .order('created_at', { ascending: false })
      .limit(50);

    if (query.error && /column .* does not exist|schema cache/i.test(query.error.message)) {
      query = await client
        .from('saved_reports')
        .select('id, filename, title, summary, content, storage_path, report_kind, report_date, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
    }

    if (query.error) return [];
    return ((query.data || []) as any[]).map((row) => {
      const content = String(row.content || '');
      return {
        id: row.id,
        filename: row.filename,
        title: row.title,
        summary: row.summary,
        content,
        storagePath: row.storage_path,
        reportKind: row.report_kind,
        reportDate: row.report_date,
        createdAt: row.created_at,
        metadata: row.run_metadata || extractReportMetadata(content),
        score: 0,
      };
    });
  } catch {
    return [];
  }
}

async function loadFilesystemCandidates(): Promise<PreviousReportMatch[]> {
  const reports = await listFilesystemReports();
  const loaded: Array<PreviousReportMatch | null> = await Promise.all(reports.slice(0, 100).map(async (report) => {
    const file = await readReportFile(report.storage_path);
    if (!file) return null;
    const metadata = await readReportMetadataSidecar(report.storage_path) || extractReportMetadata(file.content);
    return {
      id: report.id,
      filename: report.filename,
      title: report.title,
      summary: report.summary,
      content: file.content,
      storagePath: report.storage_path,
      reportKind: report.report_kind || metadata?.kind || null,
      reportDate: report.report_date,
      createdAt: report.created_at,
      metadata,
      score: 0,
    };
  }));
  return loaded.filter((item): item is PreviousReportMatch => Boolean(item));
}

export async function findPreviousReportForUpdate(args: {
  kind: ReportKind;
  query?: string;
  symbols?: string[];
  excludeStoragePath?: string | null;
}): Promise<PreviousReportMatch | null> {
  const candidates = [
    ...await loadSupabaseCandidates(),
    ...await loadFilesystemCandidates(),
  ];
  const scored = candidates
    .filter((candidate) => candidate.storagePath !== args.excludeStoragePath)
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate, args.kind, args.query, args.symbols || []),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  return scored[0] || null;
}

export function buildUpdateNotes(previous: PreviousReportMatch | null, kind: ReportKind): string[] {
  if (!previous) {
    return [`Update mode requested for ${kind}; no prior matching report was found, so this run generated a fresh report using the normal verified-data path.`];
  }
  const notes = [
    `Update mode requested for ${kind}; started from prior report "${previous.title || previous.filename || previous.id || 'matched report'}" and will use fresh/cached provider data first, then carry forward prior verified checkpoint fields only where this update cannot replace them.`,
  ];
  const missing = previous.metadata?.missingData || [];
  if (missing.length) {
    const compact = missing.slice(0, 8).map((item) => `${item.symbol} ${item.label}`).join('; ');
    notes.push(`Prior report missing-data checkpoint: ${compact}${missing.length > 8 ? `; plus ${missing.length - 8} more` : ''}.`);
  }
  return notes;
}
