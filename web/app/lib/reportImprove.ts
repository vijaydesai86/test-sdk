/* eslint-disable @typescript-eslint/no-explicit-any */
import { promises as fs } from 'fs';
import {
  decodeReportStorageId,
  deleteReportFile,
  encodeReportStorageId,
  getReportFilePath,
  readReportFile,
} from './reportFileStore';
import { getSupabaseClient } from './supabaseClient';
import {
  extractReportMetadata,
  readReportMetadataSidecar,
  stripReportMetadata,
  writeReportMetadataSidecar,
  type ReportImproveHistoryEntry,
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

export interface ImproveCandidateDecision {
  accepted: boolean;
  reason: 'missing_candidate_checkpoint'
    | 'research_universe_locked'
    | 'research_universe_readiness_improved'
    | 'research_universe_still_unready'
    | 'candidate_improved_critical'
    | 'candidate_improved_missing'
    | 'candidate_improved_available'
    | 'candidate_regressed_critical'
    | 'candidate_regressed_missing'
    | 'candidate_regressed_available'
    | 'candidate_regressed_coverage'
    | 'candidate_flat';
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

function normalizeReportSymbol(value: unknown): string {
  return String(value || '').replace(/[^A-Z0-9.]/gi, '').toUpperCase();
}

export function metadataSymbols(metadata?: Pick<ReportRunMetadata, 'symbols'> | null): string[] {
  return Array.from(new Set((metadata?.symbols || []).map(normalizeReportSymbol).filter(Boolean)));
}

export function sameReportUniverse(
  before?: Pick<ReportRunMetadata, 'symbols'> | null,
  after?: Pick<ReportRunMetadata, 'symbols'> | null
): boolean {
  const beforeSymbols = metadataSymbols(before);
  const afterSymbols = metadataSymbols(after);
  if (beforeSymbols.length === 0) return true;
  if (afterSymbols.length === 0) return false;
  if (beforeSymbols.length !== afterSymbols.length) return false;
  const afterSet = new Set(afterSymbols);
  return beforeSymbols.every((symbol) => afterSet.has(symbol));
}

export function researchUniverseStatus(metadata?: Pick<ReportRunMetadata, 'kind' | 'researchUniverse'> | null) {
  return metadata?.kind === 'research' ? metadata.researchUniverse?.status || null : null;
}

export function isResearchUniverseLocked(metadata?: Pick<ReportRunMetadata, 'kind' | 'researchUniverse'> | null): boolean {
  const status = researchUniverseStatus(metadata);
  return metadata?.kind !== 'research' || !status || status === 'locked';
}

export function shouldEnforceSameReportUniverse(
  before?: Pick<ReportRunMetadata, 'kind' | 'symbols' | 'researchUniverse'> | null
): boolean {
  return before?.kind !== 'research' || isResearchUniverseLocked(before);
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

export async function loadSavedReportForImproveByStoragePath(storagePath: string): Promise<SavedReportForImprove | null> {
  const filesystemId = encodeReportStorageId(storagePath);
  const filesystemReport = await loadSavedReportForImprove(filesystemId);
  if (filesystemReport) return filesystemReport;

  const supabase = getSupabaseClient();
  if (!supabase) return null;

  let query: any = await supabase
    .from('saved_reports')
    .select('id, filename, title, summary, content, storage_path, report_kind, report_date, created_at, run_metadata')
    .eq('storage_path', storagePath)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (query.error && isSchemaMismatch(query.error.message)) {
    query = await supabase
      .from('saved_reports')
      .select('id, filename, title, summary, content, storage_path, report_kind, report_date, created_at')
      .eq('storage_path', storagePath)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
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

export function compareImproveCandidate(before: CoverageStats | null, after: CoverageStats | null): ImproveCandidateDecision {
  if (!after) return { accepted: false, reason: 'missing_candidate_checkpoint' };
  if (!before) {
    return after.available > 0
      ? { accepted: true, reason: 'candidate_improved_available' }
      : { accepted: false, reason: 'candidate_flat' };
  }
  if (after.criticalMissing > before.criticalMissing) {
    return { accepted: false, reason: 'candidate_regressed_critical' };
  }
  if (after.missing > before.missing) {
    return { accepted: false, reason: 'candidate_regressed_missing' };
  }
  if (after.available < before.available) {
    return { accepted: false, reason: 'candidate_regressed_available' };
  }
  if (after.coveragePct !== null && before.coveragePct !== null && after.coveragePct < before.coveragePct) {
    return { accepted: false, reason: 'candidate_regressed_coverage' };
  }
  if (after.criticalMissing < before.criticalMissing) {
    return { accepted: true, reason: 'candidate_improved_critical' };
  }
  if (after.missing < before.missing) {
    return { accepted: true, reason: 'candidate_improved_missing' };
  }
  if (after.available > before.available) {
    return { accepted: true, reason: 'candidate_improved_available' };
  }
  return { accepted: false, reason: 'candidate_flat' };
}

function researchReadinessScore(metadata?: Pick<ReportRunMetadata, 'researchUniverse'> | null): number {
  const universe = metadata?.researchUniverse;
  const readiness = universe?.readiness;
  if (!universe || !readiness) return 0;
  return (
    (universe.status === 'locked' ? 100_000 : 0) +
    (readiness.selectedCount || 0) * 1_000 +
    (readiness.roleCount || 0) * 100 +
    (readiness.coveredDimensions?.length || 0) * 25 -
    (readiness.missingDimensions?.length || 0) * 25
  );
}

export function compareImproveCandidateForReport(args: {
  beforeMetadata?: ReportRunMetadata | null;
  afterMetadata?: ReportRunMetadata | null;
  beforeCoverage: CoverageStats | null;
  afterCoverage: CoverageStats | null;
}): ImproveCandidateDecision {
  const beforeStatus = researchUniverseStatus(args.beforeMetadata);
  const afterStatus = researchUniverseStatus(args.afterMetadata);
  if (args.beforeMetadata?.kind === 'research' && beforeStatus && beforeStatus !== 'locked') {
    if (!args.afterMetadata) return { accepted: false, reason: 'missing_candidate_checkpoint' };
    if (afterStatus === 'locked') return { accepted: true, reason: 'research_universe_locked' };
    if (researchReadinessScore(args.afterMetadata) > researchReadinessScore(args.beforeMetadata)) {
      return { accepted: true, reason: 'research_universe_readiness_improved' };
    }
    return { accepted: false, reason: 'research_universe_still_unready' };
  }
  return compareImproveCandidate(args.beforeCoverage, args.afterCoverage);
}

export function isImproveTargetComplete(stats: CoverageStats | null, target: ImproveTarget): boolean {
  if (!stats) return false;
  if (target === 'all') return stats.missing === 0;
  return stats.criticalMissing === 0;
}

export function isImproveTargetCompleteForReport(
  metadata: ReportRunMetadata | null | undefined,
  stats: CoverageStats | null,
  target: ImproveTarget
): boolean {
  if (metadata?.kind === 'research' && !isResearchUniverseLocked(metadata)) return false;
  return isImproveTargetComplete(stats, target);
}

export function decideImproveStatus(args: {
  before: CoverageStats | null;
  after: CoverageStats | null;
  passesDone: number;
  config: ImproveConfig;
  metadata?: ReportRunMetadata | null;
}): { status: 'complete' | 'continue' | 'stopped'; reason: string; nextRunAfterMs: number } {
  const after = args.after;
  if (!after) return { status: 'stopped', reason: 'missing_checkpoint', nextRunAfterMs: 0 };
  if (args.metadata?.kind === 'research' && !isResearchUniverseLocked(args.metadata)) {
    if (args.passesDone >= args.config.maxPasses) {
      return { status: 'stopped', reason: 'max_passes_reached', nextRunAfterMs: 0 };
    }
    return { status: 'continue', reason: 'research_universe_refining', nextRunAfterMs: args.config.minWaitMs };
  }
  if (isImproveTargetCompleteForReport(args.metadata, after, args.config.target)) {
    return {
      status: 'complete',
      reason: args.config.target === 'all' ? 'all_complete' : 'critical_complete',
      nextRunAfterMs: 0,
    };
  }
  if (args.passesDone >= args.config.maxPasses) {
    return { status: 'stopped', reason: 'max_passes_reached', nextRunAfterMs: 0 };
  }
  if (!hasUsefulCoverageImprovement(args.before, after)) {
    return { status: 'continue', reason: 'coverage_flat_with_remaining_gaps', nextRunAfterMs: args.config.minWaitMs };
  }
  return { status: 'continue', reason: 'coverage_improved_with_remaining_gaps', nextRunAfterMs: args.config.minWaitMs };
}

export async function deleteSavedReportForImprove(id: string): Promise<boolean> {
  const filesystemPath = decodeReportStorageId(id);
  if (filesystemPath) return deleteReportFile(filesystemPath);

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  const existing: any = await supabase
    .from('saved_reports')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();
  const storagePath = typeof existing.data?.storage_path === 'string' ? existing.data.storage_path : null;
  const { error } = await supabase.from('saved_reports').delete().eq('id', id);
  if (!error && storagePath) {
    await deleteReportFile(storagePath).catch(() => false);
  }
  return !error;
}

function serializedSourceReport(report: SavedReportForImprove) {
  return {
    id: report.id,
    filename: report.filename,
    title: report.title,
    summary: report.summary,
    content: '',
    storagePath: report.storagePath,
    reportKind: report.reportKind,
    reportDate: report.reportDate,
    createdAt: report.createdAt,
    metadata: report.metadata,
  };
}

const IMPROVE_HISTORY_SECTION_RE = /\n\n## Improve History\n[\s\S]*$/;

function formatCoverageForHistory(stats: CoverageStats | null | undefined): string {
  if (!stats) return 'N/A';
  const pct = stats.coveragePct === null ? 'N/A' : `${stats.coveragePct}%`;
  return `${pct}, ${stats.criticalMissing} critical missing, ${stats.missing} missing`;
}

function withImproveHistoryContent(content: string, metadata: ReportRunMetadata): string {
  const visible = stripReportMetadata(content).replace(IMPROVE_HISTORY_SECTION_RE, '').trimEnd();
  if (process.env.DEBUG !== 'true' || !metadata.improveHistory?.length) {
    return visible;
  }

  const rows = metadata.improveHistory.map((entry) => [
    String(entry.passNumber),
    entry.accepted ? 'Accepted' : 'Discarded',
    entry.reason,
    formatCoverageForHistory(entry.beforeCoverage),
    formatCoverageForHistory(entry.afterCoverage),
  ]);
  const table = [
    '## Improve History',
    '',
    '| Pass | Result | Reason | Before | Candidate |',
    '|---:|---|---|---|---|',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
  return `${visible}\n\n${table}`;
}

export async function appendImproveHistoryToSavedReport(
  id: string,
  entry: ReportImproveHistoryEntry
): Promise<SavedReportForImprove | null> {
  const report = await loadSavedReportForImprove(id);
  if (!report?.metadata) return report;
  const metadata: ReportRunMetadata = {
    ...report.metadata,
    improveHistory: [...(report.metadata.improveHistory || []), entry],
  };
  const content = withImproveHistoryContent(report.content, metadata);
  const filesystemPath = decodeReportStorageId(id) || report.storagePath || null;

  if (filesystemPath) {
    const filePath = getReportFilePath(filesystemPath);
    if (filePath) {
      await fs.writeFile(filePath, content, 'utf8').catch(() => undefined);
      await writeReportMetadataSidecar(filesystemPath, metadata).catch(() => undefined);
    }
  }

  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const supabase = getSupabaseClient();
    if (supabase) {
      let update: any = await supabase
        .from('saved_reports')
        .update({ content, run_metadata: metadata })
        .eq('id', id);
      if (update.error && isSchemaMismatch(update.error.message)) {
        update = await supabase.from('saved_reports').update({ content }).eq('id', id);
      }
    }
  }

  return {
    ...report,
    content,
    metadata,
  };
}

export function buildImproveToolRequest(report: SavedReportForImprove): ImproveToolRequest {
  const metadata = report.metadata;
  const kind = normalizeReportKind(metadata?.kind || report.reportKind);
  if (!kind) {
    throw new Error('Report is missing structured report kind metadata and cannot be improved automatically.');
  }
  const query = metadata?.query || report.title || report.filename.replace(/\.md$/i, '');
  const range = metadata?.range;
  const symbols = metadataSymbols(metadata);
  const baseArgs = {
    updateMode: true,
    updateQuery: query,
    lockedSymbols: symbols,
    updateSourceReport: serializedSourceReport(report),
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
    if (symbols.length === 0 && isResearchUniverseLocked(metadata)) {
      throw new Error('Research report is missing universe metadata.');
    }
    return {
      toolName: 'generate_research_report',
      args: {
        ...baseArgs,
        sector: query || symbols.join(', '),
        range: range || '1y',
        count: symbols.length || metadata?.researchUniverse?.readiness?.targetLockCount || undefined,
      },
    };
  }

  if (symbols.length === 0) throw new Error('Watchlist report is missing universe metadata.');
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
    run_metadata: data.runMetadata || null,
    created_at: new Date().toISOString(),
    downloadUrl: supabaseId ? `/api/saved-reports/${supabaseId}` : `/api/saved-reports/${id}`,
  };
}
