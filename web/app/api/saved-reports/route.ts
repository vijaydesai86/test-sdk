import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '../../lib/supabaseClient';

/**
 * GET /api/saved-reports
 * Returns metadata list (id, filename, title, created_at) for all saved reports.
 * Returns an empty list gracefully when Supabase is not configured or the table
 * has not been created yet.
 */
export async function GET() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    // Supabase not configured — degrade gracefully
    return NextResponse.json({ reports: [] });
  }

  const { data, error } = await supabase
    .from('saved_reports')
    .select('id, filename, title, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    // Table may not exist yet or connection failed — return empty list so the UI
    // can still render without an error state.
    console.error('[saved-reports] Supabase error:', error.message);
    return NextResponse.json({ reports: [], setupRequired: true });
  }

  return NextResponse.json({ reports: data ?? [] });
}

/**
 * POST /api/saved-reports
 * Body: { content: string, filename?: string, title?: string }
 * Persists a new report and returns the inserted row.
 */
export async function POST(request: NextRequest) {
  let body: { content?: unknown; filename?: unknown; title?: unknown };
  try {
    body = (await request.json()) as { content?: unknown; filename?: unknown; title?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const rawFilename = typeof body.filename === 'string' ? body.filename.trim() : '';
  // Sanitize filename: keep only safe characters
  const filename = rawFilename
    ? rawFilename.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/(^-|-$)/g, '') || 'report.md'
    : 'report.md';

  const title = typeof body.title === 'string' ? body.title.trim() || null : null;

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { data, error } = await supabase
    .from('saved_reports')
    .insert({ filename, title, content })
    .select('id, filename, title, created_at')
    .single();

  if (error) {
    console.error('[saved-reports] Supabase insert error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ report: data }, { status: 201 });
}
