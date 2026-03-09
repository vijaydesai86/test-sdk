/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
import { createStockService, resolveProxyUrl } from '@/app/lib/stockDataService';

export async function GET() {
  const provider = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase();
  const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const yfinanceUrl = process.env.YFINANCE_PROXY_URL;

  const results: Record<string, any> = { provider };

  if (provider !== 'finnhub' && provider !== 'yfinance') {
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
        } catch (error: any) {
          results.alphaVantage = { ok: false, error: error?.message || 'Failed' };
        }
      } else {
        results.alphaVantage = { ok: true, configured: true };
      }
    }
  }

  if (provider === 'finnhub' || provider === 'hybrid') {
    results.finnhub = finnhubKey ? { ok: true, configured: true } : { ok: false, error: 'FINNHUB_API_KEY not set' };
  }

  if (provider === 'yfinance' || provider === 'hybrid') {
    if (!yfinanceUrl) {
      results.yfinance = { ok: false, error: 'YFINANCE_PROXY_URL not set' };
    } else {
      try {
        const { default: axios } = await import('axios');
        const absoluteUrl = resolveProxyUrl(yfinanceUrl.replace(/\/$/, ''));
        const resp = await axios.get(`${absoluteUrl}/health`, { timeout: 5000 });
        results.yfinance = resp.data?.ok === true
          ? { ok: true, configured: true }
          : { ok: false, error: resp.data?.error || 'Proxy returned unhealthy status' };
      } catch (error: any) {
        results.yfinance = { ok: false, error: error?.message || 'Proxy unreachable' };
      }
    }
  }

  return NextResponse.json({ ok: true, results });
}
