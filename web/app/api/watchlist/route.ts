import { NextResponse } from 'next/server';
import { getDefaultWatchlist } from '../../lib/watchlistStore';

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
