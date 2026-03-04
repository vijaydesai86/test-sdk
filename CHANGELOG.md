# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added
- `CHANGELOG.md` — this file.

### Changed
- **Comparison report: all 13 sections specified**: Data Sources table, Snapshot, Scale & Profitability, Growth & Momentum, Valuation, Balance Sheet & Cash, Analyst View, Analyst Picks, Data Coverage (✅/❌), Price Performance Indexed chart, Valuation vs Growth scatter chart, Margin Comparison grouped bar chart, Indicative Allocation table with composite scores and disclaimer.
- **Single-stock report: all 17 sections specified**: Data Sources, Snapshot, Business Overview, Competitive Landscape, KPI Dashboard, Price & EPS Trends chart (dual-axis), Revenue & Margin Trends chart, Financials, Financial Deep Dive (3 tables), Valuation & Multiples, Growth Drivers, Risks & Headwinds, Investment Highlights (Bull/Bear/What-to-watch), Analyst View, Ownership & Sentiment, Guidance & Catalysts, Scorecard (radar chart with Growth/Profitability/Valuation/Momentum/Moat + composite score).
- **Report auto-opens on generation**: when the LLM saves a report the preview modal opens automatically, so the user sees the report without having to click in the sidebar.
- **Quick Research actions focused**: Quick Research now shows exactly two actions — "📈 Stock Report" and "⚖️ Compare Stocks". Clicking either fills the input with a prompt prefix so the user can type the stock name(s) and send. Sector/movers/news/peers shortcuts removed.
- **Tool set scoped to stock + comparison**: `get_sector_performance`, `get_stocks_by_sector`, `screen_stocks`, and `get_top_gainers_losers` removed from `REPORT_TOOL_NAMES`. These tools exist for future sector-analysis work (not yet exposed).
- **`selectToolNames` keyword expansion**: the words `research` and `deep-dive` now trigger the full report tool set, same as `report`/`compare`/`analysis`.
- **`reportGenerator.ts` cleaned up**: removed ~1 500 lines of dead legacy report-builder functions from the web layer; only `saveReport()` remains, which is the only function used.
- **Sidebar Coverage note updated**: removed reference to "Sector & thematic analysis" — scope is now individual stock reports and multi-stock comparisons.
- **README updated**: removed `QUICKSTART.md` reference (content merged inline); updated tool list and examples.
- **`QUICKSTART.md` removed**: setup instructions consolidated into `README.md`.
- **`AGENT.md` updated**: reflects cleaned tool set, focused scope, and auto-open report behaviour.

---

## [2025-05] — LLM-authored reports

### Added
- LLM-driven report generation: the model calls individual data tools, gathers all results, and writes the full markdown report itself before saving via `save_report`.
- `save_report` tool — LLM-facing tool to persist a completed markdown report and expose it as a downloadable artifact.
- Hybrid data provider: `HybridStockDataService` merges Alpha Vantage + Finnhub field-by-field.
- `get_insider_trading`, `get_analyst_recommendations`, `search_companies`, `search_news` tools.
- Per-symbol file cache with configurable TTL (`STOCK_CACHE_TTL_MS`).
- Mobile sidebar drawer with backdrop + ESC close.
- Report preview modal with download button.
- `AGENT.md` architecture reference.

### Removed
- `generate_stock_report`, `generate_comparison_report`, `generate_sector_report`, `generate_peer_report` tools — replaced by the LLM-authored workflow.

---

## [2025-04] — Initial release

### Added
- Next.js 16 web application with chat interface.
- Alpha Vantage and Finnhub data providers.
- Core stock tools: `search_stock`, `get_stock_price`, `get_price_history`, `get_company_overview`, `get_basic_financials`, `get_analyst_ratings`, `get_price_targets`, `get_peers`, `get_earnings_history`, `get_income_statement`, `get_balance_sheet`, `get_cash_flow`, `get_news_sentiment`, `get_company_news`.
- ECharts + Mermaid chart rendering in the report modal.
- Vercel deployment configuration (`vercel.json`, 300 s function timeout).
- CLI application in `src/` for local report generation.
