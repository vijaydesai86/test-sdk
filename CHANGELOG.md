# Changelog

All notable changes to the Stock Research Assistant are recorded here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Note:** Detailed per-commit history was not tracked from the project's inception.
> The sections below reflect the major capability milestones reconstructed from the codebase.
> From this point forward, every PR must add an entry under `[Unreleased]`.

---

## [Unreleased]

### Added
- **yfinance provider** — `YFinanceService` class in `src/stockDataService.ts` and `web/app/lib/stockDataService.ts`. Calls a Python HTTP microservice (configured via `YFINANCE_PROXY_URL`). All 19 `StockDataService` methods map to REST endpoints on the proxy.
- **Bundled Vercel Python serverless function** (`web/api/yf.py`) — implements the full yfinance proxy API. Deploys automatically alongside the Next.js app on Vercel. No separate server required. Set `YFINANCE_PROXY_URL=/api/yf` in Vercel env vars and the code auto-expands it to the full URL using Vercel's built-in `VERCEL_URL` env var.
- `web/requirements.txt` — `yfinance` dependency; Vercel installs it automatically for the Python function.
- `vercel.json` rewrite — maps `/api/yf/:endpoint` → `/api/yf?_path=:endpoint` so the single Python handler file routes all yfinance requests.
- `STOCK_DATA_PROVIDER=yfinance` — new sole-provider mode; returns `YFinanceService` directly.
- **Tertiary fallback in hybrid mode** — `HybridStockDataService` now accepts an optional `tertiary` provider. In `hybrid` mode with all three keys/URLs configured, the fallback chain is: Alpha Vantage → Finnhub → YFinance. The factory automatically wires the tertiary only if `YFINANCE_PROXY_URL` is set.
- `YFINANCE_PROXY_URL` environment variable — accepts absolute URL (`http://localhost:5001`) for local dev, or relative path (`/api/yf`) for Vercel (auto-expanded via `VERCEL_URL`).
- yfinance health check in `GET /api/health` — shown when `STOCK_DATA_PROVIDER=yfinance` or `hybrid`. Hits `{YFINANCE_PROXY_URL}/health`; supports relative URL auto-expansion via `VERCEL_URL`.
- Error suppression extended: `safeFetch` regex in `web/app/lib/stockTools.ts` updated from `(Alpha|Finnhub)` to `(Alpha|Finnhub|YFinance)` so yfinance unavailability errors are silently swallowed, consistent with AV and Finnhub behaviour.
- `YFINANCE_PROXY_URL` added to `.env.example` and `web/.env.example` with Vercel and local dev instructions.

### Changed
- `Provider` type in both service files updated from `'alphavantage' | 'finnhub' | 'hybrid'` to `'alphavantage' | 'finnhub' | 'yfinance' | 'hybrid'`.
- `HybridStockDataService` constructor now takes `primary`, `secondary`, and optional `tertiary` (was `primary`, `fallback`). `withFallback` updated to three-level chain: primary → secondary (tagged `__source: 'Finnhub'`) → tertiary (tagged `__source: 'YFinance'`). Existing two-provider behaviour is unchanged when `tertiary` is omitted.
- `createStockService` factory in `web/app/lib/stockDataService.ts` updated: handles new `yfinance` provider case and builds `HybridStockDataService` with tertiary when both `FINNHUB_API_KEY` and `YFINANCE_PROXY_URL` are set.
- README.md, web/README.md, and AGENT.md updated: yfinance section now documents Vercel-bundled deployment as the primary path; local dev via Flask as optional.

### Known Limitations
- yfinance data is delayed/end-of-day — not suitable for real-time quotes.
- `getSectorPerformance` and `getTopGainersLosers` are not available via the yfinance proxy; calls return a suppressed `Unavailable via YFinance` error.
- Yahoo Finance rate-limits `quoteSummary`-based endpoints (overview, financials, etc.) from Vercel cloud IPs. Price and price-history (chart-based) always work.

### Added
- **Gemini API integration** — `callGeminiAPI()` in `web/app/api/chat/route.ts` calls Gemini via its OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`). Same request/response format as GitHub Models; all existing message building, tool definitions, and response parsing work unchanged.
- `GEMINI_TOKEN` environment variable — supply a Gemini API key (get one at [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys)). **Server-side only** — never exposed to client-side code.
- `LLM_PROVIDER` environment variable (default: `github`) — selects the LLM API provider, mirroring the `STOCK_DATA_PROVIDER` pattern used for data services:
  - `github`: GitHub Models API only (existing behaviour, `GITHUB_TOKEN` required)
  - `gemini`: Gemini API only (`GEMINI_TOKEN` required)
  - `hybrid`: GitHub Models as primary; Gemini auto-fallback when GitHub returns HTTP 429 rate limit
- `GEMINI_MODEL` environment variable (default: `gemini-2.5-flash`) — Gemini model name for both main reasoning and gap-fill calls in `gemini` / `hybrid` mode. `gemini-2.0-flash` is **not** used as default because it has zero free-tier quota on AI Studio keys.
- `callGeminiWithFallback()` — tries `GEMINI_FALLBACK_MODELS` in order (`gemini-2.5-flash` → `gemini-2.5-flash-lite`) on 429, with per-model retry delay. All Gemini call sites use this instead of `callGeminiAPI` directly.
- Gemini 429 response parsing: `callGeminiAPI` now extracts `retryDelay` from `RetryInfo` details in the response body and attaches it as `retryAfterMs` on the thrown error. The outer retry loop and `callLLMForDataFill` both honor this delay instead of always waiting a fixed 2 s.
- `callLLMForDataFill` and `createLLMFiller` updated: both now accept `geminiToken` and select the correct provider for gap-fill / ticker-resolution based on `LLM_PROVIDER`. In `hybrid` mode, gap-fill also falls back to Gemini on 429.
- `callProvider` (inside `POST /api/chat`) updated: implements provider selection/fallback logic for the main LLM tool-calling loop, consistent with `LLM_PROVIDER`.

### Changed
- `provider` field in `POST /api/chat` response now reflects `LLM_PROVIDER` (was hardcoded `'github'`).
- Error detail message for HTTP 503 (missing token) is now provider-aware: guides users to set `GEMINI_TOKEN` in Gemini/hybrid mode, or `GITHUB_TOKEN` in GitHub mode.
- `web/.env.example` and `.env.example` (root/CLI): added commented `GEMINI_TOKEN` and `LLM_PROVIDER` entries with usage notes.
- README.md and AGENT.md: updated environment variables table, troubleshooting, tech stack, and architecture sections to document the new Gemini integration and `LLM_PROVIDER` options.
- `NUM_COMPANIES` env var (default: `10`) — controls the number of companies in comparison, sector, and deep-sector reports. Replaces previously hardcoded limits (6 for comparison/sector, 8 for deep sector). Optimal value is 10; controllable via Vercel environment variables.
- `DEEP_RESEARCH_DEPTH` env var (default: `2`) — controls how many recursive refinement passes Phase 3 of `generate_deep_sector_report` runs. Each pass feeds the prior dependency analysis as context so the LLM progressively deepens its ecosystem insights and company selection. Optimal value is 2; set to 1 to disable recursion, 3 for maximum depth.
- `DeepSectorPassContext` exported interface in `stockTools.ts` — carries prior-pass analysis (universe, dependencyAnalysis, ecosystemDiagram, refinementNotes) between recursive Phase 3 iterations.
- `buildDeepSectorDependencyPrompt` now accepts an optional `previousPass: DeepSectorPassContext` argument; when present the prior analysis is injected into the prompt so the LLM can deepen and correct its previous output.
- `get_sector_performance` tool — exposes `AlphaVantageService.getSectorPerformance()` (AV `SECTOR` endpoint) to the LLM; returns real-time and historical sector returns across 1d/5d/1m/3m/YTD/1y timeframes
- `get_top_gainers_losers` tool — exposes `AlphaVantageService.getTopGainersLosers()` (AV `TOP_GAINERS_LOSERS` endpoint) to the LLM; returns today's top gaining, top losing, and most actively traded US stocks
- Tests: `routes get_sector_performance to getSectorPerformance` and `routes get_top_gainers_losers to getTopGainersLosers` in `webStockTools.test.ts`
- Test: `search_news has no tool definition and returns unknown tool error` confirms correct rejection

### Removed
- **Dead code: `search_news` case in `executeTool`** — `search_news` had an `executeTool` handler but no entry in `buildToolDefinitions()` or `selectToolNames()`, making it LLM-unreachable. The dead `case` was removed. The `searchNews` service method is retained (used internally by report tools).
- **Dead interface surface: `getStocksBySector` and `screenStocks`** — both methods threw `'unavailable'` errors in all implementations and were never called by any tool or report path. Removed from `StockDataService` interface, `AlphaVantageService`, `FinnhubService`, and `HybridStockDataService` in both `web/app/lib/stockDataService.ts` and `src/stockDataService.ts`.
- **Duplicate method: `searchCompanies`** — was a pass-through to `searchStock()` in all implementations. Removed from `StockDataService` interface and all implementations in both `web/` and `src/`. The `search_companies` CLI tool definition also removed from `src/stockTools.ts`.
- **Stale config: `yahoo-finance2` in `next.config.js`** — `serverExternalPackages` and `outputFileTracingIncludes` entries for `yahoo-finance2` were referencing a library no longer used in the codebase. Removed entirely; `next.config.js` now exports an empty config object.
- **OpenAI proxy path removed** — `callOpenAIProxyAPI`, `OPENAI_PROXY_BASE_URL`, `proxyKey`, and all `openai-proxy` provider branches removed from `web/app/api/chat/route.ts`. `callLLMForDataFill` and `createLLMFiller` simplified to GitHub Models only.
- **`/api/providers` proxy entry removed** — `web/app/api/providers/route.ts` no longer returns an `openai-proxy` provider; only GitHub Models is returned. `OPENAI_PROXY_MODELS` env var support removed.
- **`OPENAI_API_KEY`, `OPENAI_TOKEN`, `OPENAI_PROXY_BASE_URL`, `OPENAI_PROXY_MODELS`** — removed from all code and documentation. The only LLM provider is now GitHub Models (`GITHUB_TOKEN`).

### Changed
- Rewrote README.md, AGENT.md, and CHANGELOG.md to reflect full project requirements and architecture
- Removed DEPLOYMENT.md and QUICKSTART.md (documentation consolidated to three files only per project rule)
- AGENT.md tool table updated: added `get_sector_performance` and `get_top_gainers_losers`; removed stale Common Pitfalls entries that are now resolved (`search_news` dead code, `next.config.js` yahoo-finance2, `quoteSummary()` warning)

---

## [2026-03-05] — Deep Sector Research (commit 4104fa0)

### Added
- `generate_deep_sector_report` tool — 4-phase sector deep-dive:
  - **Phase 1:** LLM selects ~2× initial candidate tickers for the sector (up to 12)
  - **Phase 2:** Fetch real ecosystem data (overview, news sentiment, peers) for all candidates
  - **Phase 3:** LLM maps supply-chain, customer and competitive dependencies; produces Mermaid diagram; refines the list to the most strategically significant companies
  - **Phase 4:** Full financial comparison data fetched for the refined universe
- `buildDeepSectorDependencyPrompt()` in `web/app/lib/stockTools.ts` — structured prompt for ecosystem analysis and list refinement
- `buildDeepSectorReport()` in `web/app/lib/reportGenerator.ts` — report builder with dependency analysis, Mermaid ecosystem diagram, and refinement notes
- `DeepSectorReportData` interface with `initialCandidates`, `dependencyAnalysis`, `ecosystemDiagram`, `refinementNotes` fields

---

## [Prior History] — Reconstructed from Codebase

The following capabilities were in place before commit tracking began.
Exact dates are unknown; features are listed in approximate development order.

### Core Platform
- Next.js 16 web app (`web/`) with React 19, Tailwind CSS v4, TypeScript
- `ChatInterface.tsx` — full-featured responsive chat UI with report preview, model selector, sidebar
- `POST /api/chat` — main LLM orchestration endpoint; tool-calling loop (max 30 rounds); session history management
- `GET/DELETE /api/reports/{filename}` — report serve and delete endpoints
- `GET /api/providers`, `GET /api/models`, `GET /api/health` — utility endpoints
- CLI interface (`src/index.ts`) using `@github/copilot-sdk`
- Vitest test suite: `src/__tests__/webStockTools.test.ts`, `reportGenerator.test.ts`, `stockDataService.test.ts` (20 tests, all passing)

### LLM Orchestration
- GitHub Models API integration (`GITHUB_TOKEN` authentication with required `User-Agent`, `Accept`, `X-GitHub-Api-Version` headers)
- `SYSTEM_PROMPT` (verbose) and `COMPACT_SYSTEM_PROMPT` (token-efficient, default); controlled by `USE_FULL_SYSTEM_PROMPT` env var
- `AUTO_DOWNGRADE_GPT5` — silently downgrades `gpt-5` requests to `gpt-4.1` on GitHub provider
- Multi-model fallback chain: `COPILOT_FALLBACK_MODELS` (comma-separated list); falls back to `openai/gpt-4.1-mini`, `google/gemini-3-flash`
- `trimHistory()` — keeps last 2 exchanges; prevents 413 token-budget errors on Vercel

### Tool Definitions (20 LLM-callable tools)
- **Data tools:** `search_stock`, `get_stock_price`, `get_price_history`, `get_company_overview`, `get_basic_financials`, `get_earnings_history`, `get_income_statement`, `get_balance_sheet`, `get_cash_flow`, `get_analyst_ratings`, `get_analyst_recommendations`, `get_price_targets`, `get_peers`, `get_insider_trading`, `get_news_sentiment`, `get_company_news`
- **Report tools:** `generate_stock_report`, `generate_comparison_report`, `generate_sector_report`

### LLM-Primary Ticker Resolution
- `buildTickerResolutionPrompt()` — LLM resolves informal names/tickers to official US symbols before any API call
- `search_stock` (AV `SYMBOL_SEARCH`) as fallback; `resolveSymbolFromQuery()` scores results and detects share-class variants
- When resolution fails, `executeTool` returns error with candidate list; LLM surfaces to user naturally

### LLM Gap-Fill for Data Completeness
- `buildStockFillPrompt()` / `applyLLMFillToStockData()` — detects null fields; LLM fills only verifiable values; never overwrites API data
- `buildBatchStockFillPrompt()` — single LLM call fills all companies in a comparison report
- `FILL_MODEL` (default `openai/gpt-4.1-mini`) — lighter model for gap-fill; preserves main model's rate-limit quota
- Single retry with 2-second delay on 429 in `callLLMForDataFill`

### Hybrid Data Service
- `AlphaVantageService` — primary; full free-tier implementation; 25 req/day, 5/min; 7-day per-ticker JSON cache
- `FinnhubService` — secondary; full free-tier implementation; 60 req/min
- `HybridStockDataService` — `withFallback()` retries any AV failure on Finnhub; tags results with `__source: 'Finnhub'`
- Falls back to AV-only if `STOCK_DATA_PROVIDER=hybrid` but `FINNHUB_API_KEY` is not set
- Finnhub financials from `/stock/metric?metric=all` → `series.quarterly.ic/bs/cf`; `pivotSeries()` converts to per-quarter records

### Report Generation
- `buildStockReport()`, `buildComparisonReport()`, `buildSectorReport()` in `web/app/lib/reportGenerator.ts`
- `generate_sector_report` tool — LLM selects top N companies via `buildSectorCompaniesPrompt()`; generates ranked comparison
- ECharts interactive chart blocks (` ```chart ``` ` fences); Mermaid ecosystem diagrams
- `saveReport()` — saves `.md` as `{safe-title}-{ISO-timestamp}.md`; served via `GET /api/reports/{filename}`
- `applyChartTheme()` — consistent chart styling across all report types

### Rate Limiting and Error Handling
- `safeFetch` wrapper with `rateLimitHit` flag — stops all remaining API calls on first rate-limit hit
- Error suppression: `/unavailable (in|via) (Alpha|Finnhub)/i` and `Alpha-only mode` errors silently swallowed
- Rate-limit detection: `frequency`, `Thank you for using Alpha Vantage`, `/rate limit|too many requests/i`
- AV free-tier safety: `TIME_SERIES_WEEKLY` for ≥1y ranges; `TIME_SERIES_MONTHLY` for max; never `TIME_SERIES_DAILY outputsize=full`
