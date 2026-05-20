/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
import { createStockService } from '@/app/lib/stockDataService';
import { getConfiguredEnv } from '@/app/lib/env';

function buildProviderStatus(configured: boolean, label: string, envName?: string) {
  return configured
    ? { ok: true, configured: true, role: 'configured', label }
    : {
      ok: true,
      configured: false,
      role: 'optional',
      label,
      note: envName ? `${envName} not set; provider skipped.` : 'Always available as final fallback.',
    };
}

export async function GET() {
  const provider = 'automatic';
  const alphaVantageKey = getConfiguredEnv('ALPHA_VANTAGE_API_KEY');
  const finnhubKey = getConfiguredEnv('FINNHUB_API_KEY');
  const fmpKey = getConfiguredEnv('FINANCIAL_MODELING_PREP_API_KEY');
  const twelveKey = getConfiguredEnv('TWELVE_DATA_API_KEY');
  const testSymbol = process.env.HEALTH_CHECK_SYMBOL;

  const configuredProviders = [
    alphaVantageKey ? 'alphavantage' : null,
    finnhubKey ? 'finnhub' : null,
    fmpKey ? 'fmp' : null,
    twelveKey ? 'twelvedata' : null,
  ].filter(Boolean);
  const optionalMissing = [
    !alphaVantageKey ? 'alphavantage' : null,
    !finnhubKey ? 'finnhub' : null,
    !fmpKey ? 'fmp' : null,
    !twelveKey ? 'twelvedata' : null,
  ].filter(Boolean);
  const ready = configuredProviders.length > 0;

  const results: Record<string, any> = {
    provider,
    alphaVantage: buildProviderStatus(Boolean(alphaVantageKey), 'Alpha Vantage', 'ALPHA_VANTAGE_API_KEY'),
    finnhub: buildProviderStatus(Boolean(finnhubKey), 'Finnhub', 'FINNHUB_API_KEY'),
    financialModelingPrep: buildProviderStatus(Boolean(fmpKey), 'Financial Modeling Prep', 'FINANCIAL_MODELING_PREP_API_KEY'),
    twelveData: buildProviderStatus(Boolean(twelveKey), 'Twelve Data', 'TWELVE_DATA_API_KEY'),
    stooq: buildProviderStatus(true, 'Stooq'),
  };

  if (testSymbol && ready) {
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
      note: 'Live price check skipped because no keyed stock data provider is configured.',
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
      note: 'The stock data service automatically tries all configured providers; Stooq is always available as final price-history fallback.',
    },
    results,
  });
}
