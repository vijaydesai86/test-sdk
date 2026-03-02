import { NextResponse } from 'next/server';
import { createStockService } from '@/app/lib/stockDataService';

const TEST_SYMBOL = 'NVDA';

export async function GET() {
  const results: Record<string, any> = {};

  const { service, provider, missingKey } = createStockService();
  if (missingKey) {
    results[provider] = { ok: false, error: `${missingKey} not set` };
  } else {
    try {
      const price = await service.getStockPrice(TEST_SYMBOL);
      results[provider] = { ok: true, price: price?.price ?? null };
    } catch (error: any) {
      results[provider] = { ok: false, error: error?.message || 'Failed' };
    }
  }

  return NextResponse.json({ ok: true, provider, results });
}
