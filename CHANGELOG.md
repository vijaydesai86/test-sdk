# Changelog

All notable changes to the Stock Research Assistant are recorded here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Note:** Detailed per-commit history was not tracked from the project's inception.
> The sections below reflect the major capability milestones reconstructed from the codebase.
> From this point forward, every PR must add an entry under `[Unreleased]`.

---

## [Unreleased]

### Changed — LLM-first report architecture (breaking change)
- **Report tools no longer call data APIs internally.** `generate_stock_report`, `generate_comparison_report`, `generate_sector_report`, and `generate_deep_sector_report` now accept pre-fetched data as arguments and only render it — zero API calls inside the tool handler.
- **LLM is now fully responsible for data orchestration.** Before calling a report tool, the LLM must batch all required data tool calls (`get_stock_price`, `get_company_overview`, etc.) in one round and pass results directly.
- **`generate_stock_report` parameters changed**: now accepts `symbol` + all 14 data fields (`price`, `companyOverview`, `priceHistory`, `earningsHistory`, `incomeStatement`, `balanceSheet`, `cashFlow`, `analystRatings`, `analystRecommendations`, `priceTargets`, `peers`, `newsSentiment`, `companyNews`, `insiderTransactions`) instead of `{symbol, range}`.
- **`generate_comparison_report` parameters changed**: now accepts `{range, universe, items[], notes?}` where `items` is an array of pre-fetched company data objects, instead of `{companies[], range}`.
- **`generate_sector_report` parameters changed**: now accepts `{sectorQuery, range, universe, items[], notes?}` with pre-fetched data, instead of `{sector, count, range}`.
- **`generate_deep_sector_report` parameters changed**: now accepts `{sectorQuery, range, universe, items[], dependencyAnalysis, ecosystemDiagram, refinementNotes, scenarioSimulations, supplierCustomerMap, innovationHighlights, notes?}` with all phases pre-completed by the LLM, instead of `{sector, count, range}`.
- **Removed `parseReportRequest` shortcut path** in `route.ts`: all requests now go through the LLM tool-calling loop — no more direct `executeTool` bypass for detected report patterns.
- **SYSTEM_PROMPT and COMPACT_SYSTEM_PROMPT** updated with explicit report workflow instructions for each of the 4 report types.

### Removed
- `buildSectorCompaniesPrompt` function — sector company selection is now done by the LLM natively.
- `buildDeepSectorDependencyPrompt` function — deep sector dependency analysis is now done by the LLM natively.
- `DeepSectorPassContext` interface — no longer needed; LLM manages recursive analysis in its own context.
- `NUM_COMPANIES` and `DEEP_RESEARCH_DEPTH` constants — report tool orchestration is now fully LLM-driven.
- `parseReportRequest`, `parseCompareRequest`, `parseTimeframe` functions from `route.ts`.
- Per-ticker JSON cache (`loadSymbolCache`, `saveSymbolCache`, `getCachedValue`, `setCachedValue`) and supporting utilities (`scoreSearchMatch`, `baseCompanyName`, `resolveSymbolFromQuery`, `DEFAULT_SOURCE`, `SOURCE_LEGEND`) from `web/app/lib/stockTools.ts` — these were only used by the old report case implementations.

### Added
- `buildBasicFinancialsFallback(overview)` — module-level helper in `web/app/lib/stockTools.ts` that derives key financial metrics from a company overview object; used by all 4 report cases.
- New tests in `webStockTools.test.ts` verifying that all 4 report tools accept pre-fetched data and make **zero** service API calls.


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
- `FILL_MODEL` (default `openai/gpt-4.1-mini`) — lighter model for ticker resolution and sector selection; draws from a separate, higher quota pool; **never used to fill financial data values**

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
