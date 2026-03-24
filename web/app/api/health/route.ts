/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
import { createStockService } from '@/app/lib/stockDataService';

export async function GET() {
  const provider = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase();
  const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const fmpKey = process.env.FINANCIAL_MODELING_PREP_API_KEY;
  const twelveKey = process.env.TWELVE_DATA_API_KEY;

  const results: Record<string, any> = { provider };

  const usesAlpha = provider === 'alphavantage' || provider === 'hybrid' || provider === 'multi';
  const usesFinnhub = provider === 'finnhub' || provider === 'hybrid' || provider === 'multi';
  const usesFmp = provider === 'fmp' || provider === 'multi';
  const usesTwelve = provider === 'twelvedata' || provider === 'multi';
  const usesStooq = provider === 'stooq' || provider === 'multi';

  if (usesAlpha) {
    if (!alphaVantageKey) {
      results.alphaVantage = { ok: false, error: 'ALPHA_VANTAGE_API_KEY not set' };
    } else {
      // Only perform a live connectivity check when an explicit test symbol is configured.
      // Using process.env.HEALTH_CHECK_SYMBOL avoids hardcoding any ticker in the source.
      const testSymbol = process.env.HEALTH_CHECK_SYMBOL;
      if (testSymbol && provider !== 'multi') {
        const service = createStockService(alphaVantageKey);
        try {
          const price = await service.getStockPrice(testSymbol);
          results.alphaVantage = { ok: true, price: price?.price ?? null };
        } catch (error: any) {
          results.alphaVantage = { ok: false, error: error?.message || 'Failed' };
        }
      } else {
        results.alphaVantage = { ok: true, configured: true };
      }
    }
  }

  if (usesFinnhub) {
    results.finnhub = finnhubKey ? { ok: true, configured: true } : { ok: false, error: 'FINNHUB_API_KEY not set' };
  }
  if (usesFmp) {
    results.financialModelingPrep = fmpKey
      ? { ok: true, configured: true }
      : { ok: false, error: 'FINANCIAL_MODELING_PREP_API_KEY not set' };
  }
  if (usesTwelve) {
    results.twelveData = twelveKey
      ? { ok: true, configured: true }
      : { ok: false, error: 'TWELVE_DATA_API_KEY not set' };
  }
  if (usesStooq) {
    results.stooq = { ok: true, configured: true };
  }

  return NextResponse.json({ ok: true, results });
}
