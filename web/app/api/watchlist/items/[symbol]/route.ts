import { NextRequest, NextResponse } from 'next/server';
import { removeWatchlistItem, updateWatchlistItemPosition } from '../../../../lib/watchlistStore';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const watchlist = await removeWatchlistItem(symbol);
    return NextResponse.json({ watchlist });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to remove watchlist item.' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const { symbol } = await params;
    const watchlist = await updateWatchlistItemPosition(symbol, {
      ownershipStatus: typeof body.ownershipStatus === 'string' ? body.ownershipStatus as any : undefined,
      currentWeight: body.currentWeight as number | null | undefined,
      targetWeight: body.targetWeight as number | null | undefined,
      maxWeight: body.maxWeight as number | null | undefined,
      costBasis: body.costBasis as number | null | undefined,
      conviction: typeof body.conviction === 'string' ? body.conviction as any : undefined,
      thesis: typeof body.thesis === 'string' ? body.thesis : undefined,
      desiredEntryMin: body.desiredEntryMin as number | null | undefined,
      desiredEntryMax: body.desiredEntryMax as number | null | undefined,
      trimAbove: body.trimAbove as number | null | undefined,
      invalidation: typeof body.invalidation === 'string' ? body.invalidation : undefined,
      reviewDate: typeof body.reviewDate === 'string' ? body.reviewDate : body.reviewDate === null ? null : undefined,
      lastReviewedAt: typeof body.lastReviewedAt === 'string' ? body.lastReviewedAt : body.lastReviewedAt === null ? null : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });
    return NextResponse.json({ watchlist });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to update watchlist item.' },
      { status: 500 }
    );
  }
}
