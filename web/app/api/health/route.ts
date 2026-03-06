import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
import { createStockService } from '@/app/lib/stockDataService';

export async function GET() {
  const provider = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase();
  const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;

  const results: Record<string, { ok: boolean; price?: string | null; error?: string; configured?: boolean }> = {};

  if (provider !== 'finnhub') {
    if (!alphaVantageKey) {
      results.alphaVantage = { ok: false, error: 'ALPHA_VANTAGE_API_KEY not set' };
    } else {
      // Only perform a live connectivity check when an explicit test symbol is configured.
      // Using process.env.HEALTH_CHECK_SYMBOL avoids hardcoding any ticker in the source.
      const testSymbol = process.env.HEALTH_CHECK_SYMBOL;
      if (testSymbol) {
        const service = createStockService(alphaVantageKey);
        try {
          const price = await service.getStockPrice(testSymbol);
          results.alphaVantage = { ok: true, price: price?.price ?? null };
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : 'Failed';
          results.alphaVantage = { ok: false, error: msg };
        }
      } else {
        results.alphaVantage = { ok: true, configured: true };
      }
    }
  }

  if (provider === 'finnhub' || provider === 'hybrid') {
    results.finnhub = finnhubKey ? { ok: true, configured: true } : { ok: false, error: 'FINNHUB_API_KEY not set' };
  }

  return NextResponse.json({ ok: true, provider, results });
}
