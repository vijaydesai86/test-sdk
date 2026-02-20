import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';

const REPORTS_DIR = process.env.REPORTS_DIR || (process.env.VERCEL ? '/tmp/reports' : 'reports');

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  if (!filename || !/^[a-z0-9-]+-[0-9T\-]+\.md$/i.test(filename)) {
    return NextResponse.json({ error: 'Invalid report filename' }, { status: 400 });
  }

  const resolved = path.resolve(REPORTS_DIR, filename);
  if (!resolved.startsWith(path.resolve(REPORTS_DIR))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    const content = await fs.readFile(resolved, 'utf8');
    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  if (!filename || !/^[a-z0-9-]+-[0-9T\-]+\.md$/i.test(filename)) {
    return NextResponse.json({ error: 'Invalid report filename' }, { status: 400 });
  }

  const resolved = path.resolve(REPORTS_DIR, filename);
  if (!resolved.startsWith(path.resolve(REPORTS_DIR))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    await fs.unlink(resolved);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to delete report' }, { status: 500 });
  }
}
