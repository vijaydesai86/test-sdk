export const CHAT_TOOL_NAMES = [
  'search_stock',
  'get_stock_price',
  'get_company_overview',
  'get_basic_financials',
  'get_analyst_ratings',
  'get_analyst_recommendations',
  'get_price_targets',
  'get_news_sentiment',
  'get_company_news',
  'get_price_history',
  'get_earnings_history',
  'get_income_statement',
  'get_balance_sheet',
  'get_cash_flow',
  'get_peers',
  'get_insider_trading',
  'generate_stock_report',
  'generate_comparison_report',
  'generate_deep_sector_report',
  'generate_watchlist_daily_report',
  'get_technical_indicators',
  'get_sec_filings',
  'get_economic_indicators',
  'get_dividend_analysis',
  'get_dcf_valuation',
  'get_market_sentiment',
  'get_sector_performance',
  'get_top_gainers_losers',
] as const;

export function selectChatToolNames() {
  return { toolNames: [...CHAT_TOOL_NAMES] };
}
