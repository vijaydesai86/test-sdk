# Changelog
All notable changes to this project are recorded here.
## [Unreleased]
### Added
- **7-pillar decision engine** (`decisionEngine.ts`): Research-backed multi-factor scoring model producing transparent `DecisionSnapshot` for every company. Pillars: Profitability (25%), Growth (15%), Valuation (20%), Momentum (15%), Analyst Consensus (15%), Insider Activity (5%), Financial Health (5%). Each pillar shows its score and the real data behind it in the summary. Action thresholds: ≥65 Buy/Initiate, 45–64 Hold/Wait, <45 Wait/Sell.
- **Analyst consensus as a scoring pillar**: Weighted strongBuy/buy/hold/sell/strongSell counts from Finnhub, Alpha Vantage, and FMP are aggregated into a 0–100 score with 15% weight.
- **Insider activity as a scoring pillar**: Net insider buying is normalised as basis points of market cap — no fixed dollar thresholds. $5M of buying means very different things for a $500M vs $1T company. Returns null when market cap is unavailable. 5% weight.
- **Financial health pillar**: Debt/equity, current ratio, operating cash flow, FCF yield scored 0–100 with 5% weight.
- **Investment types** (`investmentTypes.ts`): Shared interfaces — `DecisionSnapshot`, `DecisionAction`, `PortfolioProfile`, `WatchlistPositionMeta`, `DataTrustSummary`, `CompanyThesisRecord`, `DecisionJournalRecord`.
- **Data trust tracking** (`dataTrust.ts`): Freshness classification (fresh/aging/stale) per data source. Decision engine uses this to calibrate confidence without penalising scores.
- **Research memory store** (`researchMemoryStore.ts`): Persistence for research sessions, company theses, and decision journal records (Supabase or filesystem).
- **Chat tool policy** (`chatToolPolicy.ts`): Allowlist of tool names the LLM may call during a chat session.
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
- Decision engine now drives all position guidance across all four report types (stock, comparison, deep research, watchlist daily). Previous heuristic scoring replaced by 7-pillar weighted model.
- Insider trading scoring uses **only** market-cap normalisation (basis points). No fixed dollar thresholds — $5M of buying is weighted differently for a $500M vs $1T company.
- P/E scoring recalibrated from log scale to linear scale: P/E 5 → 100, P/E 25 → 64, P/E 60 → 0. Old log scale scored P/E 18 → 29 (too harsh for a reasonable valuation).
- `insiderTrading` data now passed to `buildDecisionSnapshot` from all 4 report call sites (was fetched but never forwarded).
- LLM rationale prompt updated to include all 7 pillar scores (analyst consensus, insider) and new scoring scale.
- Report-generator thresholds aligned with new decision engine thresholds.
- Balance sheet and cash-flow sections now prefer the most complete real provider report instead of blindly using the first row returned.
- Stock financial deep dives now show recent reported periods instead of a single latest row when multiple real statement rows are available.
- Comparison balance/cash sections now expose more usable real fields, including equity and free cash flow.
- Root documentation now reflects the current product scope: three report modes, free-tier-safe operation, and no fabricated data.
### Fixed
- **Watchlist "no companies" error**: Supabase seed failure now returns in-memory default items instead of `null`, so users always see the default 15 companies even when the Supabase insert fails.
- **Watchlist add item error**: `addWatchlistItem` falls back to basic-column insert when detailed columns fail due to schema mismatch.
- **Watchlist seed fallback type error**: Fixed `fi.position?.ownershipStatus` → `fi.ownershipStatus` in seed-failure fallback path. `WatchlistItem` extends `WatchlistPositionMeta` directly (no nested `position` property).
- **Watchlist report data missing after ~4 companies**: Per-company `generate_stock_report` calls made 3 redundant LLM calls each (ticker resolution, moat, conclusion) on top of the batch LLM calls the watchlist report already performs. Added `skipLLM` flag so watchlist callers skip per-company LLM overhead, dramatically reducing API/LLM load and preventing rate-limit-driven data gaps.
- **Deep research / sector "Could not identify companies" error**: When the LLM returned invalid JSON or was unavailable, sector and deep-research reports failed with no fallback. Added `resolveSectorTickers()` with a 3-tier live-data strategy: LLM primary → LLM retry with simpler prompt → API search fallback. All data comes from live sources — no hardcoded ticker lists.
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
