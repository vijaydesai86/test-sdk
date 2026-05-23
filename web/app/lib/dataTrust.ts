/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataTrustEntry, DataTrustSummary, FreshnessClass } from './investmentTypes';

export function getTtlMinutesForKey(key: string): number {
  if (key === 'price') return 10;
  if (key.startsWith('priceHistory:')) return 12 * 60;
  if (key === 'newsSentiment') return 30;
  if (key === 'companyNews') return 30;
  if (key === 'overview') return 12 * 60;
  if (key === 'priceTargets' || key === 'analystRatings' || key === 'analystRecommendations') return 24 * 60;
  if (key === 'incomeStatement' || key === 'balanceSheet' || key === 'cashFlow' || key === 'earningsHistory') return 24 * 60;
  return 6 * 60;
}

export function deriveAsOf(label: string, data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  if (/sec companyfacts/i.test(label) || data.facts) {
    const factDates = Object.values(data.facts || {})
      .map((fact: any) => fact?.end)
      .filter(Boolean)
      .map(String)
      .sort((a, b) => b.localeCompare(a));
    if (factDates.length > 0) return factDates[0];
  }
  const dateFields = [
    data.latestTradingDay,
    data.lastUpdated,
    data.updatedDate,
    data.reportDate,
    data.report_date,
    data.fetchedAt,
  ].filter(Boolean);
  if (dateFields.length > 0) return String(dateFields[0]);

  if (/company news/i.test(label)) {
    const article = Array.isArray(data.articles) ? data.articles[0] : null;
    if (article?.datetime) return String(article.datetime);
  }
  if (/earnings/i.test(label)) {
    const point = Array.isArray(data.quarterlyEarnings) ? data.quarterlyEarnings[0] : null;
    if (point?.fiscalQuarter) return String(point.fiscalQuarter);
  }
  if (/income statement|balance sheet|cash flow/i.test(label)) {
    const report = data?.quarterlyReports?.[0] || data?.annualReports?.[0];
    if (report?.fiscalQuarter) return String(report.fiscalQuarter);
    if (report?.fiscalYear) return String(report.fiscalYear);
    if (report?.fiscalDateEnding) return String(report.fiscalDateEnding);
  }
  return null;
}

function freshnessFromAge(ageMinutes: number, ttlMinutes: number): FreshnessClass {
  if (ageMinutes <= ttlMinutes) return 'fresh';
  if (ageMinutes <= ttlMinutes * 3) return 'aging';
  return 'stale';
}

export function createTrustEntry(args: {
  key: string;
  label: string;
  provider: string;
  fetchedAt: string;
  data: any;
}): DataTrustEntry {
  const ttlMinutes = getTtlMinutesForKey(args.key);
  const fetchedAtMs = new Date(args.fetchedAt).getTime();
  const ageMinutes = Number.isNaN(fetchedAtMs) ? ttlMinutes * 4 : Math.max(0, Math.round((Date.now() - fetchedAtMs) / 60000));
  return {
    key: args.key,
    label: args.label,
    provider: args.provider,
    fetchedAt: args.fetchedAt,
    asOf: deriveAsOf(args.label, args.data),
    freshness: freshnessFromAge(ageMinutes, ttlMinutes),
    ageMinutes,
    ttlMinutes,
    notes: ageMinutes > ttlMinutes ? [`${args.label} is older than its ideal freshness window.`] : [],
  };
}

export function summarizeTrust(entries: DataTrustEntry[]): DataTrustSummary {
  const criticalKeys = new Set(['price', 'newsSentiment', 'companyNews']);
  const staleLabels = entries
    .filter((entry) => criticalKeys.has(entry.key) && entry.freshness === 'stale')
    .map((entry) => entry.label);
  return {
    entries,
    criticalFresh: staleLabels.length === 0,
    staleLabels,
  };
}
