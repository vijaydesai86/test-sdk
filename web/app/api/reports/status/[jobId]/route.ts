import { NextResponse } from 'next/server';
import { getReportJob } from '@/app/lib/reportJobs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
  }

  const job = getReportJob(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    filename: job.filename,
    downloadUrl: job.downloadUrl,
    error: job.error,
  });
}
