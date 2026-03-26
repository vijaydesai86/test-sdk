# Changelog
All notable changes to this project are recorded here.
## [Unreleased]
### Added
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
