import { NextResponse } from 'next/server';
import { AlphaVantageService } from '@/app/lib/stockDataService';

const TEST_SYMBOL = 'NVDA';

export async function GET() {
  const results: Record<string, any> = {};

  const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!alphaVantageKey) {
    results.alphaVantage = { ok: false, error: 'ALPHA_VANTAGE_API_KEY not set' };
  } else {
    const service = new AlphaVantageService(alphaVantageKey);
    try {
      const price = await service.getStockPrice(TEST_SYMBOL);
      results.alphaVantage = { ok: true, price: price?.price || null };
    } catch (error: any) {
      results.alphaVantage = { ok: false, error: error?.message || 'Failed' };
    }
  }

  return NextResponse.json({ ok: true, results });
}
