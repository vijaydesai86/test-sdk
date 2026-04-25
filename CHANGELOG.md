# Changelog
All notable changes to this project are recorded here.
## [Unreleased]
### Fixed
- **Gemini tool-calling 400 (`Value is not a string: null`)**: Gemini's OpenAI-compatible endpoint rejected assistant tool-call messages when `content` was `null`. `callGeminiAPI()` now sanitizes every Gemini-bound message so `content` is always a string before each tool-calling round.
- **Misleading Gemini 400 errors**: Gemini 400 responses no longer blame the user's selected model or tell users to open a dropdown. The route now distinguishes invalid model IDs from generic bad requests and returns server-side guidance.
- **Invalid Gemini fallback IDs**: Removed stale Gemini fallback IDs (`gemini-3.0-flash`, `gemini-3.1-flash-lite`) and replaced the safe internal Gemini ladder with `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-2.0-flash`.
- **Automatic model fan-out**: GitHub execution now fans out across the full live filtered GitHub Models catalog instead of a small static shortlist, while Gemini walks the safe internal ladder automatically.
- **User-facing model leakage**: Removed the starting-model picker and model/provider badges from the chat UI. Routing is automatic; users no longer need to know model names.
- **Raw `fetch failed` leaks from LLM providers**: GitHub/Gemini DNS/network failures are now normalized into transient provider errors so users get a clean fallback-exhausted message instead of a low-level fetch exception.
- **Supabase 521 HTML error pages logged verbatim**: `isSchemaMismatch` now also matches Cloudflare HTML error pages (`<!DOCTYPE`, `<html`) and connection failures (`fetch failed`, `ECONNREFUSED`, `ENOTFOUND`) in `researchMemoryStore.ts`, `saved-reports/route.ts`, and `watchlistStore.ts`. These are silently swallowed and the filesystem fallback runs without logging. Previously, a full 521 HTML page was logged for every Supabase request when the database server was down.
- **Noisy Vercel logs**: All `console.error` calls for Supabase errors now truncate the message to 200 characters. LLM API error bodies truncated to 300 characters in log output.
- **504 Vercel timeout (GitHub Models hung)**: Added `AbortSignal.timeout(60s)` to every `fetch` in `callGitHubModelsAPI` and `callGeminiAPI`. A hung upstream call now fails after 60 seconds and advances the fallback chain to the next model, instead of holding the Vercel function until the 300s hard limit. Configurable via `LLM_REQUEST_TIMEOUT_MS` env var.

### Fixed
- **400 error on follow-up messages** ("messages with role 'tool' must be a response to a preceding message with 'tool_calls'"): `toPersistentMessages` was saving all messages including `tool` result messages but stripping `tool_calls` metadata from the assistant messages. When reloaded, the `tool` messages had no preceding `tool_calls` assistant message → API 400. Fixed by saving only user messages and final assistant text replies — all `tool` result messages and assistant-only-tool_calls messages are now excluded from persistence.
- **`trimHistory` compacting**: Removed the "don't compact the last exchange" guard that treated all loaded historical exchanges as if they were in-progress. All loaded exchanges are now always compacted to `[user, assistant-text]`, preventing orphaned tool messages from ever reaching the API.
- **AI asking clarifying questions instead of acting**: System prompts now explicitly forbid asking the user for clarification. The AI must act immediately using `search_stock` to resolve company names, not prompt the user for ticker symbols.

### Changed
- **Exhaustive-by-default AI execution**: Removed `LLM_PROVIDER` config. The system always tries all configured providers in sequence — GitHub Models first (exhausting every fallback model), then Gemini. Never errors out until all models and providers are exhausted.
- **Exhaustive-by-default stock data**: Removed `STOCK_DATA_PROVIDER` config. `createStockService()` always returns `MultiSourceStockDataService`, using every configured key with full provider fallback chain. `HybridStockDataService` removed.
- **Three report tools only** (`generate_stock_report`, `generate_research_report`, `generate_watchlist_daily_report`): Removed `generate_comparison_report` and `generate_sector_report` from `CHAT_TOOL_NAMES` and from `buildToolDefinitions()`. Renamed `generate_deep_sector_report` → `generate_research_report`. The research report handles all non-single-stock queries: comparisons, sectors, themes, industries, portfolio ideas. Internal routing tools remain in `executeTool` for delegation only.
- **AI-first request handling**: Removed `parseReportRequest()` / `parseCompareRequest()` / `parseTimeframe()` fast-path pattern matching. All user messages go through the LLM first. The LLM reads intent and decides which tool to call.
- **No provider/model selector in UI**: Users no longer see or choose model names. The app routes automatically across the available providers/models and keeps model selection server-side.
- **Simplified `/api/providers`**: Returns `{ models }` only — a flat combined list of GitHub + Gemini models for internal inventory/debug use.
- **Updated system prompts**: Both SYSTEM_PROMPT and COMPACT_SYSTEM_PROMPT describe the three report tools and the AI-reads-first rule. Removed hardcoded source citations from prompt.
- **Source info hidden by default**: Data-source sections in reports only appear when `DEBUG=true` is set in Vercel environment variables.


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
