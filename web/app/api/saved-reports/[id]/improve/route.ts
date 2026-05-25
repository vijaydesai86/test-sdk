import { NextRequest, NextResponse } from 'next/server';
import { executeTool } from '@/app/lib/stockTools';
import { createStockService } from '@/app/lib/stockDataService';
import {
  buildImproveToolRequest,
  coverageStats,
  decideImproveStatus,
  loadSavedReportForImproveByStoragePath,
  loadSavedReportForImprove,
  parseImproveConfig,
  sameReportUniverse,
  savedReportMetaFromToolData,
} from '@/app/lib/reportImprove';

export const maxDuration = 300;
export const runtime = 'nodejs';

const VERCEL_FUNCTION_TIMEOUT_MS = Number(process.env.VERCEL_FUNCTION_TIMEOUT_MS || 300000);
const VERCEL_INTERNAL_DEADLINE_BUFFER_MS = Number(process.env.VERCEL_INTERNAL_DEADLINE_BUFFER_MS || 25000);
const VERCEL_REQUEST_DEADLINE_MS = Math.max(60000, VERCEL_FUNCTION_TIMEOUT_MS - VERCEL_INTERNAL_DEADLINE_BUFFER_MS);

type ImproveBody = {
  maxPasses?: unknown;
  passNumber?: unknown;
  target?: unknown;
  storagePath?: unknown;
};

function parsePassNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.trunc(parsed));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: ImproveBody = {};
  try {
    body = (await request.json()) as ImproveBody;
  } catch {
    body = {};
  }

  const config = parseImproveConfig({
    requestedPasses: body.maxPasses,
    target: body.target,
  });
  const passNumber = parsePassNumber(body.passNumber);
  const report = await loadSavedReportForImprove(id)
    || (typeof body.storagePath === 'string'
      ? await loadSavedReportForImproveByStoragePath(body.storagePath)
      : null);
  if (!report) {
    return NextResponse.json({ error: 'Report not found or cannot be loaded for improvement.' }, { status: 404 });
  }

  const beforeCoverage = coverageStats(report.metadata);
  let toolRequest;
  try {
    toolRequest = buildImproveToolRequest(report);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Report cannot be improved automatically.' },
      { status: 400 }
    );
  }

  const stockService = createStockService();
  const deadlineAt = Date.now() + VERCEL_REQUEST_DEADLINE_MS;
  const result = await executeTool(toolRequest.toolName, toolRequest.args, stockService, { deadlineAt });
  if (!result.success) {
    return NextResponse.json(
      {
        error: result.error || result.message || 'Improve pass failed.',
        status: 'failed',
        beforeCoverage,
        passesDone: passNumber,
        maxPasses: config.maxPasses,
      },
      { status: 500 }
    );
  }

  const latestReport = savedReportMetaFromToolData(result.data);
  const latestSavedReport = latestReport?.id ? await loadSavedReportForImprove(latestReport.id) : null;
  const afterMetadata = latestSavedReport?.metadata || result.data?.runMetadata || null;
  const afterCoverage = coverageStats(afterMetadata);
  if (!sameReportUniverse(report.metadata, afterMetadata)) {
    return NextResponse.json(
      {
        error: 'Improve pass changed the saved report universe and was stopped.',
        status: 'failed',
        reason: 'universe_changed',
        latestReport,
        beforeCoverage,
        afterCoverage,
        passesDone: passNumber,
        maxPasses: config.maxPasses,
      },
      { status: 409 }
    );
  }
  const decision = decideImproveStatus({
    before: beforeCoverage,
    after: afterCoverage,
    passesDone: passNumber,
    config,
  });

  return NextResponse.json({
    success: true,
    status: decision.status,
    reason: decision.reason,
    latestReport,
    beforeCoverage,
    afterCoverage,
    passesDone: passNumber,
    maxPasses: config.maxPasses,
    nextRunAfterMs: decision.nextRunAfterMs,
  });
}
