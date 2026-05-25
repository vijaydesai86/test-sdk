/* eslint-disable @typescript-eslint/no-explicit-any */
import { decodeReportStorageId, encodeReportStorageId, readReportFile } from './reportFileStore';
import { getSupabaseClient } from './supabaseClient';
import {
  extractReportMetadata,
  readReportMetadataSidecar,
  type ReportKind,
  type ReportRunMetadata,
} from './reportUpdate';

export type ImproveTarget = 'critical' | 'all';

export interface SavedReportForImprove {
  id: string;
  filename: string;
  title: string | null;
  summary: string | null;
  content: string;
  storagePath: string | null;
  reportKind: ReportKind | null;
  reportDate: string | null;
  createdAt: string | null;
  metadata: ReportRunMetadata | null;
}

export interface ImproveConfig {
  maxPasses: number;
  target: ImproveTarget;
  minWaitMs: number;
}

export interface CoverageStats {
  total: number;
  available: number;
  missing: number;
  criticalMissing: number;
  coveragePct: number | null;
}

export interface ImproveToolRequest {
  toolName: 'generate_stock_report' | 'generate_comparison_report' | 'generate_research_report' | 'generate_watchlist_daily_report';
  args: Record<string, any>;
}

const DEFAULT_IMPROVE_PASSES = 3;
const DEFAULT_IMPROVE_MAX_PASSES = 5;
const MAX_REASONABLE_IMPROVE_PASSES = 10;

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeReportKind(value: unknown): ReportKind | null {
  if (
    value === 'stock' ||
    value === 'comparison' ||
    value === 'research' ||
    value === 'watchlist-daily'
  ) {
    return value;
  }
  return null;
}

export function parseImproveConfig(input: {
  requestedPasses?: unknown;
  target?: unknown;
  env?: NodeJS.ProcessEnv;
} = {}): ImproveConfig {
  const env = input.env || process.env;
  const hardMax = boundedInt(
    env.REPORT_IMPROVE_MAX_PASSES,
    DEFAULT_IMPROVE_MAX_PASSES,
    1,
    MAX_REASONABLE_IMPROVE_PASSES
  );
  const defaultPasses = boundedInt(
    env.REPORT_IMPROVE_DEFAULT_PASSES,
    DEFAULT_IMPROVE_PASSES,
    1,
    hardMax
  );
  const maxPasses = boundedInt(input.requestedPasses, defaultPasses, 1, hardMax);
  const target = input.target === 'all' || env.REPORT_IMPROVE_TARGET === 'all' ? 'all' : 'critical';
  const minWaitMs = boundedInt(env.REPORT_IMPROVE_MIN_WAIT_MS, 0, 0, 30 * 60 * 1000);
  return { maxPasses, target, minWaitMs };
}

function isSchemaMismatch(message: string) {
  return /column .* does not exist|schema cache/i.test(message);
}

export async function loadSavedReportForImprove(id: string): Promise<SavedReportForImprove | null> {
  const filesystemPath = decodeReportStorageId(id);
  if (filesystemPath) {
    const report = await readReportFile(filesystemPath);
    if (!report) return null;
    const metadata = await readReportMetadataSidecar(filesystemPath) || extractReportMetadata(report.content);
    return {
      id,
      filename: report.filename,
      title: metadata?.query || report.filename,
      summary: null,
      content: report.content,
      storagePath: filesystemPath,
      reportKind: normalizeReportKind(metadata?.kind),
      reportDate: filesystemPath.split('/')[0] || null,
      createdAt: null,
      metadata,
    };
  }

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  let query: any = await supabase
    .from('saved_reports')
    .select('id, filename, title, summary, content, storage_path, report_kind, report_date, created_at, run_metadata')
    .eq('id', id)
    .single();

  if (query.error && isSchemaMismatch(query.error.message)) {
    query = await supabase
      .from('saved_reports')
      .select('id, filename, title, summary, content, storage_path, report_kind, report_date, created_at')
      .eq('id', id)
      .single();
  }

  if (query.error || !query.data) return null;
  const row = query.data as any;
  const content = String(row.content || '');
  const metadata = row.run_metadata || extractReportMetadata(content);
  return {
    id: row.id,
    filename: row.filename,
    title: row.title,
    summary: row.summary,
    content,
    storagePath: row.storage_path,
    reportKind: normalizeReportKind(metadata?.kind || row.report_kind),
    reportDate: row.report_date,
    createdAt: row.created_at,
    metadata,
  };
}

export function coverageStats(metadata?: ReportRunMetadata | null): CoverageStats | null {
  if (!metadata?.coverage) return null;
  const entries = Object.values(metadata.coverage).flatMap((item) => Object.values(item));
  const total = entries.length;
  const available = entries.filter((entry) => entry.status === 'available').length;
  const missing = Math.max(0, total - available);
  const criticalMissing = (metadata.missingData || []).filter((entry) => entry.priority === 'critical').length;
  return {
    total,
    available,
    missing,
    criticalMissing,
    coveragePct: total > 0 ? Math.round((available / total) * 100) : null,
  };
}

export function hasUsefulCoverageImprovement(before: CoverageStats | null, after: CoverageStats | null): boolean {
  if (!after) return false;
  if (!before) return after.available > 0;
  if (after.criticalMissing < before.criticalMissing) return true;
  if (after.missing < before.missing) return true;
  return after.available > before.available;
}

export function decideImproveStatus(args: {
  before: CoverageStats | null;
  after: CoverageStats | null;
  passesDone: number;
  config: ImproveConfig;
}): { status: 'complete' | 'continue' | 'stopped'; reason: string; nextRunAfterMs: number } {
  const after = args.after;
  if (!after) return { status: 'stopped', reason: 'missing_checkpoint', nextRunAfterMs: 0 };
  if (args.config.target === 'critical' && after.criticalMissing === 0) {
    return { status: 'complete', reason: 'critical_complete', nextRunAfterMs: 0 };
  }
  if (args.config.target === 'all' && after.missing === 0) {
    return { status: 'complete', reason: 'all_complete', nextRunAfterMs: 0 };
  }
  if (args.passesDone >= args.config.maxPasses) {
    return { status: 'stopped', reason: 'max_passes_reached', nextRunAfterMs: 0 };
  }
  if (!hasUsefulCoverageImprovement(args.before, after)) {
    return { status: 'stopped', reason: 'no_coverage_improvement', nextRunAfterMs: 0 };
  }
  return { status: 'continue', reason: 'coverage_improved_with_remaining_gaps', nextRunAfterMs: args.config.minWaitMs };
}

export function buildImproveToolRequest(report: SavedReportForImprove): ImproveToolRequest {
  const metadata = report.metadata;
  const kind = normalizeReportKind(metadata?.kind || report.reportKind);
  if (!kind) {
    throw new Error('Report is missing structured report kind metadata and cannot be improved automatically.');
  }
  const query = metadata?.query || report.title || report.filename.replace(/\.md$/i, '');
  const range = metadata?.range;
  const symbols = Array.from(new Set((metadata?.symbols || []).filter(Boolean)));
  const baseArgs = {
    updateMode: true,
    updateQuery: query,
  };

  if (kind === 'stock') {
    const symbol = symbols[0];
    if (!symbol) throw new Error('Stock report is missing symbol metadata.');
    return {
      toolName: 'generate_stock_report',
      args: { ...baseArgs, symbol, range: range || '5y', trustedTicker: true },
    };
  }

  if (kind === 'comparison') {
    if (symbols.length < 2) throw new Error('Comparison report is missing comparison universe metadata.');
    return {
      toolName: 'generate_comparison_report',
      args: { ...baseArgs, companies: symbols, range: range || '1y' },
    };
  }

  if (kind === 'research') {
    return {
      toolName: 'generate_research_report',
      args: { ...baseArgs, sector: query || symbols.join(', '), range: range || '1y', count: symbols.length || undefined },
    };
  }

  return {
    toolName: 'generate_watchlist_daily_report',
    args: { ...baseArgs, range: range || '1y' },
  };
}

export function savedReportMetaFromToolData(data: any) {
  const storagePath = typeof data?.storagePath === 'string' ? data.storagePath : null;
  const supabaseId = typeof data?.supabaseId === 'string' ? data.supabaseId : null;
  const id = supabaseId || (storagePath ? encodeReportStorageId(storagePath) : null);
  if (!id) return null;
  return {
    id,
    filename: data.filename || (storagePath ? storagePath.split('/').pop() : 'report.md'),
    title: data.title || null,
    summary: data.summary || null,
    storage_path: storagePath,
    report_kind: data.reportKind || null,
    report_date: data.reportDate || null,
    created_at: new Date().toISOString(),
    downloadUrl: supabaseId ? `/api/saved-reports/${supabaseId}` : `/api/saved-reports/${id}`,
  };
}
