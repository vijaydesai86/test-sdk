import { NextResponse } from 'next/server';
import { createStockService } from '@/app/lib/stockDataService';

const TEST_SYMBOL = 'NVDA';

export async function GET() {
  const results: Record<string, any> = {};

  const provider = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase();
  const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (provider !== 'yfinance' && !alphaVantageKey) {
    results.alphaVantage = { ok: false, error: 'ALPHA_VANTAGE_API_KEY not set' };
  } else {
    const service = createStockService(alphaVantageKey);
    try {
      const price = await service.getStockPrice(TEST_SYMBOL);
      results.alphaVantage = { ok: true, price: price?.price || null };
    } catch (error: any) {
      results.alphaVantage = { ok: false, error: error?.message || 'Failed' };
    }
  }

  return NextResponse.json({ ok: true, results });
}
