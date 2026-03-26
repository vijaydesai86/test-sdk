import { NextRequest, NextResponse } from 'next/server';
import { addWatchlistItem } from '../../../lib/watchlistStore';
import { createStockService } from '../../../lib/stockDataService';
import { resolveSymbolFromQuery } from '../../../lib/stockTools';

export async function POST(request: NextRequest) {
  let body: { query?: unknown };
  try {
    body = (await request.json()) as { query?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 });
  }

  try {
    const stockService = createStockService();
    const resolved = await resolveSymbolFromQuery(stockService, query);
    if (!resolved.ok || !resolved.symbol) {
      return NextResponse.json(
        { error: `Could not resolve "${query}" to a ticker symbol.` },
        { status: 400 }
      );
    }

    const symbol = resolved.symbol;
    const overview = await stockService.getCompanyOverview(symbol).catch(() => null);
    const companyName = String(overview?.name || query || symbol).trim() || symbol;
    const watchlist = await addWatchlistItem({ symbol, companyName });
    return NextResponse.json({ watchlist, added: { symbol, companyName } }, { status: 201 });
  } catch (error: any) {
    const message = error?.message || 'Failed to add watchlist item.';
    const status = /limit reached/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
