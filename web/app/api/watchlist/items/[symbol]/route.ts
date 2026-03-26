import { NextRequest, NextResponse } from 'next/server';
import { removeWatchlistItem } from '../../../../lib/watchlistStore';

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
