import { describe, it, expect } from 'vitest';
import { buildDecisionSnapshot } from '../web/app/lib/decisionEngine';
import type { DataTrustSummary } from '../web/app/lib/investmentTypes';

const freshTrust: DataTrustSummary = {
  criticalFresh: true,
  staleLabels: [],
  entries: [
    {
      key: 'price',
      label: 'Price',
      provider: 'Alpha Vantage',
      fetchedAt: '2026-03-30T11:55:00Z',
      asOf: '2026-03-30',
      freshness: 'fresh',
      ageMinutes: 5,
      ttlMinutes: 10,
    },
  ],
};

describe('decisionEngine', () => {
  it('forces a wait when critical data is stale', () => {
    const snapshot = buildDecisionSnapshot({
      symbol: 'AAPL',
      price: { price: '100' },
      companyOverview: { analystTargetPrice: '130', peRatio: '18', operatingMargin: '0.30', profitMargin: '0.35', returnOnEquity: '0.9' },
      basicFinancials: { metric: { grossMarginTTM: 0.5, operatingMarginTTM: 0.3, roeTTM: 0.9, revenueGrowthTTM: 0.12, epsGrowthTTM: 0.15 } },
      priceHistory: { prices: [{ date: '2026-01-01', close: '80' }, { date: '2026-03-30', close: '100' }] },
      trust: {
        criticalFresh: false,
        staleLabels: ['Price'],
        entries: [
          {
            key: 'price',
            label: 'Price',
            provider: 'Alpha Vantage',
            fetchedAt: '2026-03-29T08:00:00Z',
            asOf: '2026-03-29',
            freshness: 'stale',
            ageMinutes: 1500,
            ttlMinutes: 10,
          },
        ],
      },
    });

    expect(snapshot.action).toBe('Wait');
    expect(snapshot.freshness).toBe('stale');
    expect(snapshot.whyNot.join(' ')).toContain('Critical data is stale');
  });

  it('recommends initiate when the setup is strong and inside the preferred entry range', () => {
    const snapshot = buildDecisionSnapshot({
      symbol: 'MSFT',
      price: { price: '100' },
      companyOverview: { analystTargetPrice: '135', peRatio: '18', operatingMargin: '0.34', profitMargin: '0.32', returnOnEquity: '0.95' },
      basicFinancials: { metric: { grossMarginTTM: 0.68, operatingMarginTTM: 0.34, roeTTM: 0.95, revenueGrowthTTM: 0.18, epsGrowthTTM: 0.2 } },
      priceHistory: { prices: [{ date: '2026-01-01', close: '82' }, { date: '2026-03-30', close: '100' }] },
      companyNews: { articles: [{ headline: 'Positive catalyst' }] },
      trust: freshTrust,
      position: {
        ownershipStatus: 'watching',
        desiredEntryMin: 95,
        desiredEntryMax: 105,
      },
      portfolioProfile: {
        riskTolerance: 'medium',
        holdingHorizon: 'years',
        maxPositionWeight: 10,
        targetCashPct: 10,
        concentrationLimit: 35,
        strategyNotes: 'Quality growth.',
      },
    });

    expect(snapshot.action).toBe('Initiate');
    expect(snapshot.confidence).toBe('High');
    expect(snapshot.whyNow.join(' ')).toContain('preferred entry range');
  });

  it('trims an owned position that is oversized and weak', () => {
    const snapshot = buildDecisionSnapshot({
      symbol: 'RISK',
      price: { price: '100' },
      companyOverview: { analystTargetPrice: '80', peRatio: '90', operatingMargin: '-0.05', profitMargin: '-0.08', returnOnEquity: '-0.2' },
      basicFinancials: { metric: { grossMarginTTM: 0.12, operatingMarginTTM: -0.05, roeTTM: -0.2, revenueGrowthTTM: -0.15, epsGrowthTTM: -0.18 } },
      priceHistory: { prices: [{ date: '2026-01-01', close: '130' }, { date: '2026-03-30', close: '100' }] },
      companyNews: { articles: [{ headline: 'Negative catalyst' }] },
      trust: freshTrust,
      position: {
        ownershipStatus: 'owned',
        currentWeight: 14,
        targetWeight: 8,
        maxWeight: 10,
      },
      portfolioProfile: {
        riskTolerance: 'medium',
        holdingHorizon: 'years',
        maxPositionWeight: 10,
        targetCashPct: 10,
        concentrationLimit: 35,
        strategyNotes: 'Stay disciplined.',
      },
    });

    expect(['Trim', 'Exit']).toContain(snapshot.action);
    expect(snapshot.whyNot.join(' ')).toContain('above your max-weight guardrail');
  });
});
