# Changelog

All notable changes to the Stock Research Assistant are recorded here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Note:** Detailed per-commit history was not tracked from the project's inception.
> The sections below reflect the major capability milestones reconstructed from the codebase.
> From this point forward, every PR must add an entry under `[Unreleased]`.

---

## [Unreleased]

### Removed
- **`search_news` tool (`src/stockTools.ts`)** — dead code; had no entry in `buildToolDefinitions()` or `selectToolNames()` in the CLI, making it LLM-unreachable. The `searchNews` service method is retained (used internally by report tools).
- **`generate_peer_report` tool (`src/stockTools.ts`)** — violates AGENT.md "Five capabilities only" rule; the report type it generated (`buildPeerReport`) is not one of the five supported report types. Removed from tool list and handler.
- **`buildPeerReport` export (`src/reportGenerator.ts`)** — no longer called by any tool; removes ~200 lines of dead report-builder code.
- **`PeerReportItem` and `PeerReportData` interfaces (`src/reportGenerator.ts`)** — only referenced by the removed `buildPeerReport` function.
- **`buildPeerReport` import in `src/stockTools.ts`** — no longer needed after tool removal.
- **`builds a peer report` test (`src/__tests__/reportGenerator.test.ts`)** — tested `buildPeerReport` which no longer exists.
- **ESLint blanket disable in `web/app/api/health/route.ts`** — replaced with precise types.

### Changed
- **`src/stockTools.ts`** — added `NUM_COMPANIES` constant (`Math.max(2, Number(process.env.NUM_COMPANIES || 10))`); `generate_comparison_report` now uses `NUM_COMPANIES` instead of hardcoded `6`; `generate_sector_report` now uses `NUM_COMPANIES` instead of hardcoded `4`.
- **`src/reportGenerator.ts`** — `DEFAULT_REPORTS_DIR` now includes Vercel check (`process.env.VERCEL ? '/tmp/reports' : 'reports'`), matching the web version; `buildPerformanceChart` parameter type changed from `PeerReportItem[]` to a local minimal inline type; all helper function signatures simplified from `SectorReportItem | PeerReportItem` union to `SectorReportItem` only.
- **`web/app/api/health/route.ts`** — `results` typed as `Record<string, { ok: boolean; price?: string | null; error?: string; configured?: boolean }>` instead of `Record<string, any>`; catch block uses `error: unknown` with `instanceof Error` narrowing; `provider` moved to top-level response field.

### Added
- `web/app/lib/config.ts` — new shared module exporting `REPORTS_DIR` constant. Eliminates the triple-duplication of `process.env.REPORTS_DIR || (process.env.VERCEL ? '/tmp/reports' : 'reports')` that existed in `stockTools.ts`, `reportGenerator.ts`, and `reports/[filename]/route.ts`.
- `web/app/lib/githubModels.ts` — new shared module exporting `fetchGitHubModelsCatalog()`, `resolveGitHubToken()`, and `SAFE_DEFAULT_MODELS`. Eliminates the duplicated GitHub Models catalogue fetch/filter/sort/map pipeline that existed in both `models/route.ts` and `providers/route.ts`.

### Changed
- `web/app/api/models/route.ts` — rewritten to import from `githubModels.ts`; reduced from 80 lines to 18.
- `web/app/api/providers/route.ts` — rewritten to import from `githubModels.ts`; reduced from 80 lines to 28.
- `web/app/lib/stockTools.ts` — imports `REPORTS_DIR` from `config.ts`; updated `NUM_COMPANIES` and `DEEP_RESEARCH_DEPTH` comments to document production values (15 and 4 respectively).
- `web/app/lib/reportGenerator.ts` — imports `REPORTS_DIR` from `config.ts`; removes its own local `DEFAULT_REPORTS_DIR` definition.
- `web/app/api/reports/[filename]/route.ts` — imports `REPORTS_DIR` from `config.ts`; removes its own local definition.
- `AGENT.md` — env-var table updated: `STOCK_DATA_PROVIDER` notes production=`hybrid`; `NUM_COMPANIES` notes production=`15`; `DEEP_RESEARCH_DEPTH` notes production=`4`. Added **Production Configuration (Vercel)** section listing all deployed env-var values. Architecture diagram updated to include `config.ts` and `githubModels.ts`.
- `.env.example` (root and `web/`) — `STOCK_DATA_PROVIDER` default changed to `hybrid`; `NUM_COMPANIES` and `DEEP_RESEARCH_DEPTH` comments updated to show production values; `web/.env.example` now includes `NUM_COMPANIES` and `DEEP_RESEARCH_DEPTH` entries.

### Previous entries
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
