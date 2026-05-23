import { describe, it, expect } from 'vitest';
import { CHAT_TOOL_NAMES, selectChatToolNames } from '../web/app/lib/chatToolPolicy';

describe('chat tool policy', () => {
  it('exposes the expanded decision-grade tool allow-list', () => {
    expect(CHAT_TOOL_NAMES).toContain('get_technical_indicators');
    expect(CHAT_TOOL_NAMES).toContain('get_sec_filings');
    expect(CHAT_TOOL_NAMES).toContain('get_sec_company_facts');
    expect(CHAT_TOOL_NAMES).toContain('get_sec_financial_statements');
    expect(CHAT_TOOL_NAMES).toContain('get_economic_indicators');
    expect(CHAT_TOOL_NAMES).toContain('get_treasury_yield_curve');
    expect(CHAT_TOOL_NAMES).toContain('get_bls_macro_indicators');
    expect(CHAT_TOOL_NAMES).toContain('get_bea_macro_indicators');
    expect(CHAT_TOOL_NAMES).toContain('get_eia_energy_indicators');
    expect(CHAT_TOOL_NAMES).toContain('get_dividend_analysis');
    expect(CHAT_TOOL_NAMES).toContain('get_dcf_valuation');
    expect(CHAT_TOOL_NAMES).toContain('get_market_sentiment');
    expect(CHAT_TOOL_NAMES).toContain('search_news');
    expect(CHAT_TOOL_NAMES).toContain('generate_stock_report');
    expect(CHAT_TOOL_NAMES).toContain('generate_comparison_report');
    expect(CHAT_TOOL_NAMES).toContain('generate_research_report');
    expect(CHAT_TOOL_NAMES).toContain('generate_watchlist_daily_report');
    expect(CHAT_TOOL_NAMES).not.toContain('update_report' as any);
    expect(CHAT_TOOL_NAMES).not.toContain('generate_sector_report' as any);
    expect(CHAT_TOOL_NAMES).not.toContain('generate_deep_sector_report' as any);
  });

  it('returns a copy of the allow-list for route use', () => {
    const selected = selectChatToolNames();
    expect(selected.toolNames).toEqual(CHAT_TOOL_NAMES);
    expect(selected.toolNames).not.toBe(CHAT_TOOL_NAMES);
  });
});
