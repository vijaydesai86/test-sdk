import { NextRequest, NextResponse } from 'next/server';
import { deleteReportFile, readReportFile, sanitizeReportStoragePath } from '@/app/lib/reportFileStore';
import { stripReportMetadata } from '@/app/lib/reportUpdate';

export const runtime = 'nodejs';

function getStoragePath(parts: string[]): string | null {
  return sanitizeReportStoragePath(parts.join('/'));
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const storagePath = getStoragePath(path);
  if (!storagePath) {
    return NextResponse.json({ error: 'Invalid report path' }, { status: 400 });
  }

  const report = await readReportFile(storagePath);
  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  return new NextResponse(stripReportMetadata(report.content), {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report.filename}"`,
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const storagePath = getStoragePath(path);
  if (!storagePath) {
    return NextResponse.json({ error: 'Invalid report path' }, { status: 400 });
  }

  const deleted = await deleteReportFile(storagePath);
  if (!deleted) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
