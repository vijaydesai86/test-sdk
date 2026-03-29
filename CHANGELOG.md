# Changelog
All notable changes to this project are recorded here.
## [Unreleased]
### Added
- **7 new research tools** (30 total): `get_technical_indicators`, `get_sec_filings`, `get_economic_indicators`, `get_dividend_analysis`, `get_dcf_valuation`, `get_market_sentiment`, bringing total tool count from 23 to 30.
- **Advanced technical indicators**: MACD(12,26,9), Bollinger Bands(20,2), Stochastic Oscillator(14,3,3), ATR(14), EMA(12/26), volume analysis — all computed from existing price data with zero extra API calls.
- **SEC EDGAR integration**: `SecEdgarService` fetches recent 10-K, 10-Q, 8-K filings with direct links. Completely free — no API key needed.
- **FRED economic data**: `FredService` provides GDP growth, CPI/inflation, Federal Funds rate, unemployment, 10Y/2Y Treasury yields, yield curve spread (recession indicator), consumer sentiment, initial jobless claims. Requires free `FRED_API_KEY`.
- **Dividend analysis tool**: Comprehensive dividend metrics including yield, payout ratio, FCF coverage ratio, dividend safety score, ex-dividend dates. Derived entirely from existing provider data.
- **DCF valuation tool**: Simplified 10-year discounted cash flow model with growth fade, CAPM-based WACC, terminal value, margin of safety, and valuation verdict. Uses only real financial data from providers.
- **Market sentiment indicator**: Composite Fear & Greed-style index (0-100) aggregating sector breadth, gainers/losers ratio, gain/loss magnitude, and market momentum from real market data.
- **Enhanced stock report sections**: Timing & Trade Setup now includes MACD, Bollinger Bands, Stochastic, ATR, EMA indicators. New Dividend Analysis and DCF Valuation Estimate sections appear when data is available.
- Stock reports now surface a timing layer derived from real price history: RSI, moving-average trend, 52-week range position, and a data-driven buy/hold/wait/sell stance.
- Stock reports now include analyst recommendation trend tables when provider recommendation history is available.
- Stock reports now surface recent insider activity summaries and transaction tables when provider data is available.
- Comparison and deep-research comparison bodies now include per-company timing/action tables.
- Comparison and deep-research comparison bodies now include ownership/positioning tables.
- Stock reports now show provider-derived peer tickers as alternative stocks to research.
### Changed
- Balance sheet and cash-flow sections now prefer the most complete real provider report instead of blindly using the first row returned.
- Stock financial deep dives now show recent reported periods instead of a single latest row when multiple real statement rows are available.
- Comparison balance/cash sections now expose more usable real fields, including equity and free cash flow.
- Root documentation now reflects the current product scope: three report modes, free-tier-safe operation, and no fabricated data.
### Removed
- Removed extra markdown docs and markdown report artifacts from version-controlled documentation so only `README.md`, `AGENT.md`, and `CHANGELOG.md` remain as repo docs.
## [2026-03-26]
### Previously completed architectural pass
- Centered the product around three report modes: stock, comparison, and deep research.
- Routed deep research by target type so single-company, explicit-comparison, and sector/theme requests all stay under one mode.
- Removed synthetic stock-report fallbacks for missing statement data.
- Improved stock-provider fallback behavior for `multi` and `hybrid` modes.
- Made LLM provider and model selection real in both backend and UI.
- Surfaced LLM execution metadata in chat for operational visibility.
- Centralized LLM provider configuration.
- Hardened free-tier limits and health reporting for composite provider modes.
