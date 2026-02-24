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

  try {
    if (!process.env.FINNHUB_API_KEY) {
      results.finnhub = { ok: false, error: 'FINNHUB_API_KEY not set' };
    } else {
      const response = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${TEST_SYMBOL}&token=${process.env.FINNHUB_API_KEY}`
      );
      if (!response.ok) {
        results.finnhub = { ok: false, error: `HTTP ${response.status}` };
      } else {
        const data = await response.json();
        results.finnhub = { ok: true, price: data?.c ?? null };
      }
    }
  } catch (error: any) {
    results.finnhub = { ok: false, error: error?.message || 'Failed' };
  }

  try {
    if (process.env.ENABLE_FMP === 'false') {
      results.fmp = { ok: false, error: 'FMP disabled' };
    } else if (!process.env.FMP_API_KEY) {
      results.fmp = { ok: false, error: 'FMP_API_KEY not set' };
    } else {
      const response = await fetch(
        `https://financialmodelingprep.com/api/v3/profile/${TEST_SYMBOL}?apikey=${process.env.FMP_API_KEY}`
      );
      results.fmp = response.ok
        ? { ok: true }
        : { ok: false, error: `HTTP ${response.status}` };
    }
  } catch (error: any) {
    results.fmp = { ok: false, error: error?.message || 'Failed' };
  }

  try {
    if (!process.env.NEWSAPI_KEY) {
      results.newsApi = { ok: false, error: 'NEWSAPI_KEY not set' };
    } else {
      const response = await fetch(
        `https://newsapi.org/v2/everything?q=${TEST_SYMBOL}&pageSize=1&apiKey=${process.env.NEWSAPI_KEY}`
      );
      results.newsApi = response.ok
        ? { ok: true }
        : { ok: false, error: `HTTP ${response.status}` };
    }
  } catch (error: any) {
    results.newsApi = { ok: false, error: error?.message || 'Failed' };
  }

  return NextResponse.json({ ok: true, results });
}
