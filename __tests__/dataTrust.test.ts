import { describe, it, expect, vi } from 'vitest';
import { createTrustEntry, getTtlMinutesForKey, summarizeTrust } from '../web/app/lib/dataTrust';

describe('dataTrust', () => {
  it('uses short TTLs for fast-moving inputs', () => {
    expect(getTtlMinutesForKey('price')).toBe(10);
    expect(getTtlMinutesForKey('newsSentiment')).toBe(30);
    expect(getTtlMinutesForKey('overview')).toBe(12 * 60);
  });

  it('marks old critical inputs as stale and surfaces them in the summary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T12:00:00Z'));

    const freshPrice = createTrustEntry({
      key: 'price',
      label: 'Price',
      provider: 'Alpha Vantage',
      fetchedAt: '2026-03-30T11:55:00Z',
      data: { price: '100.00', latestTradingDay: '2026-03-30' },
    });
    const staleNews = createTrustEntry({
      key: 'companyNews',
      label: 'Company news',
      provider: 'Finnhub',
      fetchedAt: '2026-03-30T09:00:00Z',
      data: { articles: [{ datetime: '2026-03-30T08:55:00Z' }] },
    });

    const summary = summarizeTrust([freshPrice, staleNews]);

    expect(freshPrice.freshness).toBe('fresh');
    expect(staleNews.freshness).toBe('stale');
    expect(summary.criticalFresh).toBe(false);
    expect(summary.staleLabels).toEqual(['Company news']);

    vi.useRealTimers();
  });

  it('derives SEC companyfacts as-of dates from fact period ends, not fetch time', () => {
    const entry = createTrustEntry({
      key: 'secFinancialFacts',
      label: 'SEC companyfacts',
      provider: 'SEC companyfacts',
      fetchedAt: '2026-05-23T11:23:16.679Z',
      data: {
        fetchedAt: '2026-05-23T11:23:16.679Z',
        facts: {
          revenue: { value: 4920000000, end: '2026-03-31' },
          assets: { value: 10703000000, end: '2026-03-31' },
          cash: { value: 2751000000, end: '2025-12-31' },
        },
      },
    });

    expect(entry.asOf).toBe('2026-03-31');
  });
});
