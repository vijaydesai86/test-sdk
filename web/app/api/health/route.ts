import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
import { createStockService, normalizeProvider } from '@/app/lib/stockDataService';

export async function GET() {
  const results: Record<string, any> = {};

  const provider = normalizeProvider();
  const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (provider === 'finnhub' && !finnhubKey) {
    results.dataProvider = { ok: false, error: 'FINNHUB_API_KEY not set' };
  } else if (provider !== 'finnhub' && !alphaVantageKey) {
    results.alphaVantage = { ok: false, error: 'ALPHA_VANTAGE_API_KEY not set' };
  } else {
    // Use an env-configured symbol for the live ping; fall back to a no-op config check.
    const testSymbol = process.env.HEALTH_CHECK_SYMBOL;
    if (testSymbol) {
      const service = createStockService(alphaVantageKey, finnhubKey);
      try {
        const price = await service.getStockPrice(testSymbol);
        results.dataProvider = { ok: true, provider, price: price?.price || null };
      } catch (error: any) {
        results.dataProvider = { ok: false, provider, error: error?.message || 'Failed' };
      }
    } else {
      results.dataProvider = { ok: true, provider, note: 'Set HEALTH_CHECK_SYMBOL to enable live ping' };
    }
  }

  return NextResponse.json({ ok: true, results });
}
