import { describe, expect, it } from 'vitest';
import { inferReportFallback, isUpdateReportRequest } from '../web/app/lib/reportIntent';

describe('reportIntent update mode', () => {
  it('requires the word update and report for update mode', () => {
    expect(isUpdateReportRequest('update ARM stock report')).toBe(true);
    expect(isUpdateReportRequest('what was updated in the ARM report')).toBe(false);
    expect(isUpdateReportRequest('refresh ARM stock report')).toBe(false);
    expect(isUpdateReportRequest('update ARM')).toBe(false);
  });

  it('maps stock report updates to the existing stock report tool', () => {
    const fallback = inferReportFallback('update ARM stock report');
    expect(fallback?.toolName).toBe('generate_stock_report');
    expect(fallback?.args).toMatchObject({
      symbol: 'ARM',
      updateMode: true,
      updateQuery: 'update ARM stock report',
    });
  });

  it('maps comparison report updates to the existing comparison report tool', () => {
    const fallback = inferReportFallback('update comparison report of Nvidia and Arm');
    expect(fallback?.toolName).toBe('generate_comparison_report');
    expect(fallback?.args.updateMode).toBe(true);
    expect(fallback?.args.companies).toEqual(['Nvidia', 'Arm']);
  });

  it('maps research report updates to the existing research report tool', () => {
    const fallback = inferReportFallback('update research report of AI ecosystem');
    expect(fallback?.toolName).toBe('generate_research_report');
    expect(fallback?.args).toMatchObject({
      sector: 'AI ecosystem',
      updateMode: true,
    });
  });

  it('maps watchlist report updates to the existing watchlist report tool', () => {
    const fallback = inferReportFallback('update watchlist report');
    expect(fallback?.toolName).toBe('generate_watchlist_daily_report');
    expect(fallback?.args.updateMode).toBe(true);
  });

  it('keeps ordinary report requests in normal generation mode', () => {
    const fallback = inferReportFallback('generate ARM stock report');
    expect(fallback?.toolName).toBe('generate_stock_report');
    expect(fallback?.args.updateMode).toBeUndefined();
  });
});
