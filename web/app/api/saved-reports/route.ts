import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '../../lib/supabaseClient';

const DETAILED_COLUMNS = 'id, filename, title, summary, storage_path, report_kind, report_date, created_at';
const BASIC_COLUMNS = 'id, filename, title, created_at';

function isSchemaMismatch(message: string) {
  return /column .* does not exist|schema cache/i.test(message);
}

/**
 * GET /api/saved-reports
 * Returns metadata list for all saved reports.
 * Falls back to the older schema when library metadata columns are not present yet.
 */
export async function GET() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ reports: [] });
  }

  let query = await supabase
    .from('saved_reports')
    .select(DETAILED_COLUMNS)
    .order('report_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (query.error && isSchemaMismatch(query.error.message)) {
    query = await supabase
      .from('saved_reports')
      .select(BASIC_COLUMNS)
      .order('created_at', { ascending: false });
  }

  if (query.error) {
    console.error('[saved-reports] Supabase error:', query.error.message);
    return NextResponse.json({ reports: [], setupRequired: true });
  }

  return NextResponse.json({ reports: query.data ?? [] });
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
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  let insert = await supabase
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

  if (insert.error && isSchemaMismatch(insert.error.message)) {
    insert = await supabase
      .from('saved_reports')
      .insert({ filename, title, content })
      .select(BASIC_COLUMNS)
      .single();
  }

  if (insert.error) {
    console.error('[saved-reports] Supabase insert error:', insert.error.message);
    return NextResponse.json({ error: insert.error.message }, { status: 500 });
  }

  return NextResponse.json({ report: insert.data }, { status: 201 });
}
