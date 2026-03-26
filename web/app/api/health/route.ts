/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
import { createStockService } from '@/app/lib/stockDataService';

function buildProviderStatus(configured: boolean, role: 'required' | 'optional' | 'fallback', missingKey: string) {
  if (configured) {
    return { ok: true, configured: true, role };
  }

  if (role === 'required') {
    return { ok: false, configured: false, role, error: `${missingKey} not set` };
  }

  return {
    ok: true,
    configured: false,
    role,
    note: role === 'fallback' ? 'Always available as fallback.' : 'Optional for the selected provider mode.',
  };
}

export async function GET() {
  const provider = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase();
  const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const fmpKey = process.env.FINANCIAL_MODELING_PREP_API_KEY;
  const twelveKey = process.env.TWELVE_DATA_API_KEY;
  const testSymbol = process.env.HEALTH_CHECK_SYMBOL;

  const alphaRole = provider === 'alphavantage' ? 'required' : provider === 'hybrid' || provider === 'multi' ? 'optional' : null;
  const finnhubRole = provider === 'finnhub' ? 'required' : provider === 'hybrid' || provider === 'multi' ? 'optional' : null;
  const fmpRole = provider === 'fmp' ? 'required' : provider === 'multi' ? 'optional' : null;
  const twelveRole = provider === 'twelvedata' ? 'required' : provider === 'multi' ? 'optional' : null;
  const stooqRole = provider === 'stooq' ? 'required' : provider === 'multi' ? 'fallback' : null;

  const results: Record<string, any> = { provider };

  if (alphaRole) {
    results.alphaVantage = buildProviderStatus(Boolean(alphaVantageKey), alphaRole, 'ALPHA_VANTAGE_API_KEY');
  }
  if (finnhubRole) {
    results.finnhub = buildProviderStatus(Boolean(finnhubKey), finnhubRole, 'FINNHUB_API_KEY');
  }
  if (fmpRole) {
    results.financialModelingPrep = buildProviderStatus(Boolean(fmpKey), fmpRole, 'FINANCIAL_MODELING_PREP_API_KEY');
  }
  if (twelveRole) {
    results.twelveData = buildProviderStatus(Boolean(twelveKey), twelveRole, 'TWELVE_DATA_API_KEY');
  }
  if (stooqRole) {
    results.stooq = buildProviderStatus(true, stooqRole, '');
  }

  const configuredProviders = [
    alphaVantageKey ? 'alphavantage' : null,
    finnhubKey ? 'finnhub' : null,
    fmpKey ? 'fmp' : null,
    twelveKey ? 'twelvedata' : null,
    provider === 'multi' || provider === 'stooq' ? 'stooq' : null,
  ].filter(Boolean);

  let ready = false;
  if (provider === 'alphavantage') ready = Boolean(alphaVantageKey);
  else if (provider === 'finnhub') ready = Boolean(finnhubKey);
  else if (provider === 'fmp') ready = Boolean(fmpKey);
  else if (provider === 'twelvedata') ready = Boolean(twelveKey);
  else if (provider === 'stooq') ready = true;
  else if (provider === 'hybrid') ready = Boolean(alphaVantageKey || finnhubKey);
  else if (provider === 'multi') ready = true;

  const optionalMissing = [
    provider === 'multi' && !alphaVantageKey ? 'alphavantage' : null,
    provider === 'multi' && !finnhubKey ? 'finnhub' : null,
    provider === 'multi' && !fmpKey ? 'fmp' : null,
    provider === 'multi' && !twelveKey ? 'twelvedata' : null,
    provider === 'hybrid' && !alphaVantageKey ? 'alphavantage' : null,
    provider === 'hybrid' && !finnhubKey ? 'finnhub' : null,
  ].filter(Boolean);

  if (testSymbol && ['alphavantage', 'finnhub', 'fmp', 'twelvedata', 'stooq'].includes(provider) && ready) {
    const service = createStockService(alphaVantageKey);
    try {
      const price = await service.getStockPrice(testSymbol);
      results.liveCheck = { ok: true, symbol: testSymbol, price: price?.price ?? null };
    } catch (error: any) {
      results.liveCheck = { ok: false, symbol: testSymbol, error: error?.message || 'Failed' };
    }
  } else if (testSymbol) {
    results.liveCheck = {
      ok: true,
      skipped: true,
      symbol: testSymbol,
      note: 'Live price checks are skipped for multi/hybrid because the active provider chain is composite.',
    };
  }

  return NextResponse.json({
    ok: ready,
    summary: {
      provider,
      ready,
      configuredProviders,
      configuredProviderCount: configuredProviders.length,
      optionalMissing,
      note: provider === 'multi'
        ? 'Multi mode can still run with a subset of providers; missing providers here are optional, not hard failures.'
        : provider === 'hybrid'
          ? 'Hybrid mode only requires one of Alpha Vantage or Finnhub; the other provider is optional.'
          : undefined,
    },
    results,
  });
}
