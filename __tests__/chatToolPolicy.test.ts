import { describe, it, expect } from 'vitest';
import { CHAT_TOOL_NAMES, selectChatToolNames } from '../web/app/lib/chatToolPolicy';

describe('chat tool policy', () => {
  it('exposes the expanded decision-grade tool allow-list', () => {
    expect(CHAT_TOOL_NAMES).toContain('get_technical_indicators');
    expect(CHAT_TOOL_NAMES).toContain('get_sec_filings');
    expect(CHAT_TOOL_NAMES).toContain('get_economic_indicators');
    expect(CHAT_TOOL_NAMES).toContain('get_dividend_analysis');
    expect(CHAT_TOOL_NAMES).toContain('get_dcf_valuation');
    expect(CHAT_TOOL_NAMES).toContain('get_market_sentiment');
    expect(CHAT_TOOL_NAMES).toContain('search_news');
    expect(CHAT_TOOL_NAMES).toContain('generate_watchlist_daily_report');
  });

  it('returns a copy of the allow-list for route use', () => {
    const selected = selectChatToolNames();
    expect(selected.toolNames).toEqual(CHAT_TOOL_NAMES);
    expect(selected.toolNames).not.toBe(CHAT_TOOL_NAMES);
  });
});
