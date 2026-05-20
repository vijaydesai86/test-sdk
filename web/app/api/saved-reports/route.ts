import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { encodeReportStorageId, listFilesystemReports } from '../../lib/reportFileStore';
import { saveReport } from '../../lib/reportGenerator';

const DETAILED_COLUMNS = 'id, filename, title, summary, storage_path, report_kind, report_date, created_at';
const BASIC_COLUMNS = 'id, filename, title, created_at';

interface DetailedSavedReportRow {
  id: string;
  filename: string;
  title: string | null;
  summary: string | null;
  storage_path: string | null;
  report_kind: string | null;
  report_date: string | null;
  created_at: string;
}

interface BasicSavedReportRow {
  id: string;
  filename: string;
  title: string | null;
  created_at: string;
}

function isSchemaMismatch(message: string) {
  return (
    /column .* does not exist|schema cache/i.test(message) ||
    /<!DOCTYPE|<html/i.test(message) ||
    /fetch failed|ECONNREFUSED|ENOTFOUND|network error/i.test(message)
  );
}

function truncateErrorMsg(message: string, max = 200): string {
  if (!message) return '(no message)';
  const clean = message.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function normalizeLegacyReport(row: BasicSavedReportRow): DetailedSavedReportRow {
  return {
    ...row,
    summary: null,
    storage_path: null,
    report_kind: null,
    report_date: null,
  };
}

/**
 * GET /api/saved-reports
 * Returns metadata list for all saved reports.
 * Falls back to the older schema when library metadata columns are not present yet.
 */
export async function GET() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ reports: await listFilesystemReports(), storage: 'filesystem' });
  }

  const detailedQuery = await supabase
    .from('saved_reports')
    .select(DETAILED_COLUMNS)
    .order('report_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (detailedQuery.error && isSchemaMismatch(detailedQuery.error.message)) {
    const legacyQuery = await supabase
      .from('saved_reports')
      .select(BASIC_COLUMNS)
      .order('created_at', { ascending: false });

    if (legacyQuery.error) {
      console.error('[saved-reports] Supabase error:', truncateErrorMsg(legacyQuery.error.message));
      return NextResponse.json({
        reports: await listFilesystemReports(),
        setupRequired: true,
        storage: 'filesystem',
      });
    }

    return NextResponse.json({
      reports: ((legacyQuery.data ?? []) as BasicSavedReportRow[]).map(normalizeLegacyReport),
    });
  }

  if (detailedQuery.error) {
    console.error('[saved-reports] Supabase error:', truncateErrorMsg(detailedQuery.error.message));
    return NextResponse.json({
      reports: await listFilesystemReports(),
      setupRequired: true,
      storage: 'filesystem',
    });
  }

  return NextResponse.json({ reports: (detailedQuery.data ?? []) as DetailedSavedReportRow[] });
}

/**
 * POST /api/saved-reports
 * Body: { content: string, filename?: string, title?: string, summary?: string, storagePath?: string, reportKind?: string, reportDate?: string }
 * Persists a new report and returns the inserted row.
 */
export async function POST(request: NextRequest) {
  let body: {
    content?: unknown;
    filename?: unknown;
    title?: unknown;
    summary?: unknown;
    storagePath?: unknown;
    reportKind?: unknown;
    reportDate?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const rawFilename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const filename = rawFilename
    ? rawFilename.toLowerCase().replace(/[^a-z0-9._/-]/g, '-').replace(/(^-|-$)/g, '') || 'report.md'
    : 'report.md';

  const title = typeof body.title === 'string' ? body.title.trim() || null : null;
  const summary = typeof body.summary === 'string' ? body.summary.trim() || null : null;
  const storagePath = typeof body.storagePath === 'string' ? body.storagePath.trim() || null : null;
  const reportKind = typeof body.reportKind === 'string' ? body.reportKind.trim() || null : null;
  const reportDate = typeof body.reportDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.reportDate)
    ? body.reportDate
    : null;

  const supabase = getSupabaseClient();
  if (!supabase) {
    const saved = await saveReport(content, title || filename.replace(/\.md$/i, ''), undefined, {
      summary: summary || undefined,
      reportKind: reportKind || undefined,
    });
    return NextResponse.json(
      {
        report: {
          id: encodeReportStorageId(saved.storagePath),
          filename: saved.filename,
          title: saved.title,
          summary: saved.summary || null,
          storage_path: saved.storagePath,
          report_kind: saved.reportKind || null,
          report_date: saved.reportDate,
          created_at: new Date().toISOString(),
        },
        storage: 'filesystem',
      },
      { status: 201 }
    );
  }

  const detailedInsert = await supabase
    .from('saved_reports')
    .insert({
      filename,
      title,
      summary,
      content,
      storage_path: storagePath,
      report_kind: reportKind,
      report_date: reportDate,
    })
    .select(DETAILED_COLUMNS)
    .single();

  if (detailedInsert.error && isSchemaMismatch(detailedInsert.error.message)) {
    const legacyInsert = await supabase
      .from('saved_reports')
      .insert({ filename, title, content })
      .select(BASIC_COLUMNS)
      .single();

    if (legacyInsert.error) {
      console.error('[saved-reports] Supabase insert error:', truncateErrorMsg(legacyInsert.error.message));
      return NextResponse.json({ error: legacyInsert.error.message }, { status: 500 });
    }

    return NextResponse.json(
      { report: normalizeLegacyReport(legacyInsert.data as BasicSavedReportRow) },
      { status: 201 }
    );
  }

  if (detailedInsert.error) {
    console.error('[saved-reports] Supabase insert error:', truncateErrorMsg(detailedInsert.error.message));
    return NextResponse.json({ error: detailedInsert.error.message }, { status: 500 });
  }

  return NextResponse.json(
    { report: detailedInsert.data as DetailedSavedReportRow },
    { status: 201 }
  );
}
