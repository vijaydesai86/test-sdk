import { NextRequest, NextResponse } from 'next/server';
import { getDefaultWatchlist, updateWatchlistProfile } from '../../lib/watchlistStore';

export async function GET() {
  try {
    const watchlist = await getDefaultWatchlist();
    return NextResponse.json({ watchlist });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load watchlist.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const watchlist = await updateWatchlistProfile({
      riskTolerance: typeof body.riskTolerance === 'string' ? body.riskTolerance as any : undefined,
      holdingHorizon: typeof body.holdingHorizon === 'string' ? body.holdingHorizon as any : undefined,
      maxPositionWeight: body.maxPositionWeight as number | null | undefined,
      targetCashPct: body.targetCashPct as number | null | undefined,
      concentrationLimit: body.concentrationLimit as number | null | undefined,
      strategyNotes: typeof body.strategyNotes === 'string' ? body.strategyNotes : undefined,
    });
    return NextResponse.json({ watchlist });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to update watchlist profile.' },
      { status: 500 }
    );
  }
}
