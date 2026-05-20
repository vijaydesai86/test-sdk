import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '../../../lib/supabaseClient';
import { decodeReportStorageId, deleteReportFile, readReportFile } from '../../../lib/reportFileStore';

/**
 * GET /api/saved-reports/[id]
 * Returns the full report as a downloadable markdown attachment.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const filesystemPath = decodeReportStorageId(id);
  if (filesystemPath) {
    const report = await readReportFile(filesystemPath);
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    return new NextResponse(report.content, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${report.filename}"`,
      },
    });
  }

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid report id' }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { data, error } = await supabase
    .from('saved_reports')
    .select('id, filename, title, content, created_at')
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  const filename = data.filename as string;
  const content = data.content as string;

  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

/**
 * DELETE /api/saved-reports/[id]
 * Removes a saved report from Supabase.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const filesystemPath = decodeReportStorageId(id);
  if (filesystemPath) {
    const deleted = await deleteReportFile(filesystemPath);
    if (!deleted) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid report id' }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { error } = await supabase.from('saved_reports').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
