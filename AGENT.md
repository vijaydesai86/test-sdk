# AGENT.md

This file is the operating contract for any agent or contributor changing this repo. Read it before touching code. Follow all rules. Update it when the architecture changes.

---

## Collaboration contract

These rules apply before implementation details:

1. **Discuss until explicitly released to implement.** Unless the user clearly says "go do", "make the change", "update it", or an equivalent direct instruction, only discuss, inspect, analyze, and design. Do not edit files, run mutating commands, commit, or push.

2. **Read this file at the start of repo work.** Any agent working in this repository must read `AGENT.md` before changing code or docs, then keep the implementation aligned with this contract and the current `README.md`.

3. **Use a holistic approach.** Do not make a narrow local fix without checking the impact on the product modes, shared report pipeline, provider fallbacks, Vercel runtime behavior, local behavior, persistence, docs, and tests.

4. **Verify before claiming done.** Run every practical relevant check before saying work is complete: targeted tests, broader test suites when available, typecheck, lint, production build, and install/build checks for dependency or deployment changes. If a check cannot run, state exactly why.

5. **Add tests for behavior changes.** New features, bug fixes, routing changes, provider fallback changes, data-quality guards, report-generation changes, and timeout behavior require focused tests where the repo has a practical test path.

6. **Commit and push only when requested.** Do not commit or push unless the user explicitly asks. When committing, include only related files and leave unrelated user changes untouched.

7. **Keep docs aligned.** Any change that affects behavior, setup, environment variables, supported flows, runtime assumptions, or architecture must update the relevant docs in the same change. If docs are not changed, be prepared to explain why.

---

## Product scope

The product is an AI-powered stock research assistant with exactly **three user-facing research modes**:

1. **Stock report** — full deep-dive on a single company
2. **Research report** — handles any multi-company, sector, theme, industry, or research question (comparisons, deep sector analysis, ecosystem dependency maps, universe refinement)
3. **Watchlist daily report** — daily pulse covering every company in the saved watchlist

General chat is supported for data-only questions (e.g. "what is NVDA's P/E?") but is not a separate report mode and must not grow into a parallel product surface.

---

## Non-negotiable rules

1. **Never fabricate financial data.** Prices, ratios, revenues, EPS, margins, insider activity, analyst targets — all must come from real provider API responses or direct arithmetic on those responses. If a field is unavailable, say so; do not fill it.

2. **Correctness beats completeness.** Wrong, guessed, stale-looking-but-unverified, non-meaningful, or training-data-derived values are worse than missing data. Suppress implausible provider values and mark data as unavailable rather than showing false precision.

3. **Never reintroduce synthetic fallbacks.** Do not generate fake income statement rows, balance sheet entries, cash flow entries, EPS history, market caps, 52-week ranges, yields, or price-derived fields from LLM memory, heuristics, or descriptions.

4. **Provider truth beats LLM confidence.** The LLM orchestrates, explains, and synthesises. It may reason from supplied verified data, but it must not silently substitute missing provider data with model memory or web/training knowledge.

5. **No production hardcoding.** Do not hardcode company/ticker lists, provider facts, financial values, or special-case production behavior for individual companies. Hardcoded symbols and values are acceptable only in tests, fixtures, and mocks.

6. **Local and Vercel both matter.** Vercel must respect the hard function timeout and still return a saved report with the highest-value verified data collected before the deadline. Local runs are not Vercel-truncated and should attempt the full available data set, subject to sensible provider rate-limit handling. Timeouts must be priority-aware: fetch critical decision inputs before optional enrichment, cap individual upstream waits, and reserve enough time to render, persist, and return the report.

7. **Use tools by data fit and quota.** Pick the provider/tool best suited to each data type, and treat all free-tier quotas as scarce. Low-quota providers such as Alpha Vantage must not be the default hammer when roomier or no-key providers can supply the same data.

8. **Use LLMs deliberately.** Use stronger models for accuracy-critical reasoning and lighter models only for lower-risk routing/formatting. Full fallback ladders and cooldowns must be honored before reporting provider/model exhaustion.

9. **Report tools are the three user-facing tools.** `generate_stock_report`, `generate_research_report`, and `generate_watchlist_daily_report` are the only tools the LLM exposes to users. Internal routing tools (`generate_comparison_report`, `generate_sector_report`, `generate_deep_sector_report`) exist in `executeTool` for internal delegation only and are not in `CHAT_TOOL_NAMES`.

10. **Keep user input simple.** Users must be able to type `google vs microsoft` or `deep research on tesla` and get the right report. Entity resolution may use the LLM for name-to-ticker mapping, but real provider verification (`search_stock`) is required before any market-data fetch.

11. **Research report is one mode.** The UI exposes one `generate_research_report` tool. Internally it routes by query type (explicit comparison → comparison path; single-company name → deep stock path; sector/theme → full ecosystem analysis), but this routing is hidden from the user and the LLM.

12. **Plain chat cannot satisfy report intent.** Users may ask in any natural wording. If a request maps to stock report, comparison/research report, theme/deep research, or watchlist daily and the LLM returns plain text without a report artifact, `route.ts` must run the matching report fallback from `reportIntent.ts`. Do not let stale model memory answer report requests.

13. **Only three top-level markdown docs.** `README.md`, `AGENT.md`, and `CHANGELOG.md` are the only markdown documents committed to the repo root. Do not add stale or duplicate docs.

14. **Keep common report plumbing shared.** New report types must reuse the existing data-fetching, timing, valuation, chart, moat analysis, conclusion, and persistence helpers. No copy-pasted report pipelines.

15. **Deployment-impacting changes require a clean install check.** Any dependency, lockfile, package manager, Vercel config, build script, or install-related change must be verified from a clean dependency state with the Vercel install command (`npm ci --no-audit --no-fund`) followed by `npm run build`. Do not rely only on an existing `node_modules` build.

16. **Optimise for free-tier operation.** Assume Vercel free tier, free provider quotas, and rate-limited model access. Prefer bounded concurrency (`DATA_FETCH_CONCURRENCY`), caching (`STOCK_CACHE_TTL_MS`), provider/model cooldowns, and graceful partial-data handling over brute force.

---

## Architecture

### Request flow

```
User message
  → POST /api/chat (chat/route.ts)
      → LLM reasoning loop (up to 30 rounds)
          → parallel tool calls → executeTool (stockTools.ts)
              → StockDataService.method() (stockDataService.ts)
          → report tool call → buildXxxReport() (reportGenerator.ts)
          → saveReport() → filesystem or Supabase
      → Response with report artifacts
```

### Key files

| File | Role |
|---|---|
| `web/app/api/chat/route.ts` | Entry point. Parses requests, auto-routes across the available LLM model ladders, runs the tool-call loop, manages session history, handles rate-limit fallbacks. |
| `web/app/lib/stockTools.ts` | Tool definitions (`getToolDefinitions`), `executeTool` dispatch, report orchestration (generate_* tools), ticker resolution, sector company selection, moat/conclusion prompt builders, disk cache helpers. |
| `web/app/lib/reportIntent.ts` | Server-side free-form report intent fallback. Prevents plain LLM answers from satisfying stock/comparison/theme/watchlist report requests without a saved artifact. |
| `web/app/lib/stockDataService.ts` | All data provider implementations: `AlphaVantageService`, `FinnhubService`, `FinancialModelingPrepService`, `TwelveDataService`, `StooqService`, `MultiSourceStockDataService`. Also standalone services: `SecEdgarService` (SEC EDGAR filings), `FredService` (FRED economic data). `createStockService()` always returns `MultiSourceStockDataService` using all configured keys. |
| `web/app/lib/reportGenerator.ts` | Report builders (`buildStockReport`, `buildComparisonReport`, `buildSectorReport`, `buildDeepSectorReport`, `buildDeepStockReport`, `buildDeepComparisonReport`, `buildWatchlistDailyReport`), technical indicator computations (RSI, MACD, Bollinger, Stochastic, ATR, EMA), ECharts and Mermaid chart builders, `saveReport()` persistence. |
| `web/app/lib/llmProviderConfig.ts` | GitHub Models catalog fetching, Gemini model fallback list, token helpers. No provider selection — all available providers are always used. |
| `web/app/lib/decisionEngine.ts` | 7-pillar multi-factor equity decision engine. Computes weighted pillar scores (Profitability 25%, Growth 15%, Valuation 20%, Momentum 15%, Analyst Consensus 15%, Insider Activity 5%, Financial Health 5%), derives action (Initiate/Add/Hold/Trim/Exit/Wait), confidence, and a transparent summary showing the real data behind each score. Insider activity is market-cap normalized (basis points, no fixed $ thresholds). |
| `web/app/lib/investmentTypes.ts` | Shared TypeScript types and interfaces for the decision framework: `DecisionSnapshot`, `DecisionAction`, `PortfolioProfile`, `WatchlistPositionMeta`, `DataTrustSummary`, `CompanyThesisRecord`, `DecisionJournalRecord`, `ResearchSessionRecord`. |
| `web/app/lib/dataTrust.ts` | Data freshness tracker. Computes `DataTrustSummary` per report: each data source gets a freshness class (fresh/aging/stale) based on age vs configurable TTL. Used by the decision engine to set confidence levels. |
| `web/app/lib/chatToolPolicy.ts` | Declares the allowlist of tool names (`CHAT_TOOL_NAMES`) that the LLM is permitted to call during a chat session. |
| `web/app/lib/researchMemoryStore.ts` | Persistence layer for research sessions, company theses, and decision journal records. Backed by Supabase when available, otherwise filesystem JSON. |
| `web/app/lib/watchlistStore.ts` | Watchlist CRUD backed by Supabase (primary) or JSON file (fallback). Default watchlist seeded with 15 semiconductor/tech companies (max 25 items). Supabase seed failures return in-memory defaults (never empty). |
| `web/app/lib/supabaseClient.ts` | Lazy Supabase client singleton; returns `null` when env vars are absent. |
| `web/app/components/ChatInterface.tsx` | Full single-page UI: chat pane, workspace sidebar (Watchlist / Artifacts / Saved tabs), 4 themes (Aurora, Solstice, Ember, Graphite), ECharts and Mermaid rendering, quick prompts, automatic routing messaging. |
| `web/app/api/health/route.ts` | Provider health check. Reports which API keys are configured and whether the service is ready. Supports optional live price check via `HEALTH_CHECK_SYMBOL`. |
| `web/app/api/saved-reports/route.ts` | GET (list) and POST (persist) for the saved-report library. Uses Supabase when configured and local report files as fallback. Falls back to legacy schema when migration columns are absent. |
| `web/app/api/reports/[...path]/route.ts` | GET/DELETE route for local Markdown report artifacts created by filesystem fallback. |
| `web/app/api/watchlist/route.ts` | GET default watchlist; PATCH/DELETE individual items. |
| `web/app/api/models/route.ts` | Returns available GitHub Models from live catalog. |
| `web/app/api/providers/route.ts` | Returns combined list of available LLM models (GitHub + Gemini) for internal inventory/debug use. |

### Tool catalog (31 definitions / 28 chat-exposed tools)

**Data tools** — fetch real data, return structured JSON, make zero report-side decisions:

| Tool | StockDataService method |
|---|---|
| `search_stock` | `searchStock` |
| `get_stock_price` | `getStockPrice` |
| `get_price_history` | `getPriceHistory` |
| `get_company_overview` | `getCompanyOverview` |
| `get_basic_financials` | `getBasicFinancials` |
| `get_insider_trading` | `getInsiderTrading` |
| `get_analyst_ratings` | `getAnalystRatings` |
| `get_analyst_recommendations` | `getAnalystRecommendations` |
| `get_price_targets` | `getPriceTargets` |
| `get_peers` | `getPeers` |
| `get_earnings_history` | `getEarningsHistory` |
| `get_income_statement` | `getIncomeStatement` |
| `get_balance_sheet` | `getBalanceSheet` |
| `get_cash_flow` | `getCashFlow` |
| `get_news_sentiment` | `getNewsSentiment` |
| `get_company_news` | `getCompanyNews` |
| `search_news` | `searchNews` |
| `get_sector_performance` | `getSectorPerformance` |
| `get_top_gainers_losers` | `getTopGainersLosers` |

**Analysis tools** — compute derived metrics from real data, zero fabrication:

| Tool | Source |
|---|---|
| `get_technical_indicators` | Computed from price history: RSI(14), MACD(12,26,9), Bollinger Bands(20,2), Stochastic(14,3), ATR(14), EMA(12/26), SMA(50/200), volume analysis |
| `get_dividend_analysis` | Derived from company overview + cash flow: yield, payout ratio, FCF coverage, safety score |
| `get_dcf_valuation` | Computed from cash flow + overview: 10-year DCF, WACC, margin of safety, valuation verdict |
| `get_market_sentiment` | Aggregated from sector performance + gainers/losers: composite Fear & Greed index (0-100) |

**External data tools** — standalone services, not part of StockDataService interface:

| Tool | Service class |
|---|---|
| `get_sec_filings` | `SecEdgarService` — SEC EDGAR (free, no API key) |
| `get_economic_indicators` | `FredService` — FRED API (free key from fred.stlouisfed.org) |

**Report tools** — the three user-facing report tools exposed via `CHAT_TOOL_NAMES`:

| Tool | What it generates |
|---|---|
| `generate_stock_report` | Single-company deep-dive: `buildStockReport` + `buildDeepStockReport` |
| `generate_research_report` | All multi-company / thematic research — internally routes to comparison, sector, or deep-sector builder |
| `generate_watchlist_daily_report` | Daily pulse across the saved watchlist: `buildWatchlistDailyReport` |

**Internal routing tool definitions** — present in `getToolDefinitions()` for internal delegation, but filtered out of `CHAT_TOOL_NAMES`:

| Tool | What it generates |
|---|---|
| `generate_comparison_report` | Explicit ticker-vs-ticker comparison report |
| `generate_sector_report` | Sector/theme report without recursive deep refinement |
| `generate_deep_sector_report` | Recursive deep-sector research path |

### Report pipeline (generate_stock_report example)

1. LLM calls all data tools in one parallel round: price, overview, price history, financials, insider, analyst ratings, analyst recommendations, price targets, earnings, income statement, balance sheet, cash flow, news sentiment.
2. LLM calls a targeted LLM sub-call for moat analysis (`buildMoatAnalysisPrompt`).
3. LLM calls a targeted LLM sub-call for investment thesis conclusion (`buildStockConclusionPrompt`).
4. LLM calls `generate_stock_report` with all pre-fetched data.
5. `executeTool` calls `buildStockReport()` (produces Markdown + ECharts JSON).
6. `saveReport()` persists to Supabase or filesystem.
7. Report artifact is returned to the chat UI.

Deep-sector research is fixed at one core-data-first refinement pass. It resolves a live provider-confirmed universe, locks the saveable company list, fetches critical market data (price, overview, basic financials, price history) before optional ecosystem/dependency LLM enrichment, and never spends model calls refining a universe before a data-backed report body is possible.

---

## Data providers

### StockDataService interface

All providers implement `StockDataService`. `createStockService()` in `stockDataService.ts` always builds a `MultiSourceStockDataService` using every configured key, with Stooq always included as the no-key fallback for price history.

```
Configured keys  →  providers added to MultiSourceStockDataService
──────────────────────────────────────────────────────────────────
ALPHA_VANTAGE_API_KEY   →  AlphaVantageService
FINNHUB_API_KEY         →  FinnhubService
FINANCIAL_MODELING_PREP_API_KEY  →  FinancialModelingPrepService
TWELVE_DATA_API_KEY     →  TwelveDataService
(always)                →  StooqService (no key required)
```

### Rate limiting and caching

- Each provider has a per-instance throttle queue (`ALPHA_VANTAGE_MIN_INTERVAL_MS` etc.) to prevent bursting.
- `MultiSourceStockDataService` tracks provider cooldowns (`STOCK_PROVIDER_COOLDOWN_MS`, default 5 minutes) and skips cooled-down providers automatically.
- Disk cache at `CACHE_DIR` (inside `REPORTS_DIR`) with `STOCK_CACHE_TTL_MS` TTL (default 7 days) prevents redundant API calls across report runs.
- Vercel report generation must spend time in priority order: critical decision inputs first, high-value enrichment second, optional context third, LLM narration/refinement only when enough time remains to render and save the report.
- Local report generation should not use Vercel deadline truncation; it should try to collect the full configured data set while still respecting provider throttles/cooldowns.
- Single-stock and watchlist ticker inputs must be resolved through live provider search/validation before fetching market data. Display symbols or informal names (for example company names stored in a watchlist) must not be assumed to be official tickers.

### Standalone services (not part of StockDataService interface)

These services are instantiated on-demand in `executeTool` and are NOT part of the multi-provider fallback chain:

| Service | API | Key required | Tools |
|---|---|---|---|
| `SecEdgarService` | SEC EDGAR EFTS | No (free, 10 req/s) | `get_sec_filings` |
| `FredService` | FRED (Federal Reserve) | `FRED_API_KEY` (free) | `get_economic_indicators` |

### Computed analysis (zero API calls)

Some tools derive insights purely from data already fetched by other tools:

| Tool | Inputs | What it computes |
|---|---|---|
| `get_technical_indicators` | Price history, overview | RSI, MACD, Bollinger, Stochastic, ATR, EMA, SMA, volume |
| `get_dividend_analysis` | Overview, cash flow | Yield, payout ratio, FCF coverage, safety score |
| `get_dcf_valuation` | Overview, cash flow, price | DCF intrinsic value, margin of safety, WACC |
| `get_market_sentiment` | Sector performance, gainers/losers | Composite sentiment score (0-100) |

---

## LLM providers

### Behaviour

The system **always uses all configured providers** in sequence — no configuration switch required. GitHub Models is tried first (exhausting every fallback model), then Gemini. Every request keeps retrying until all models across all providers are exhausted before giving up.

```
Available tokens  →  execution order
──────────────────────────────────────────────────────────────────
GITHUB_TOKEN only    →  GitHub Models only (all fallback models tried)
GEMINI_TOKEN only    →  Gemini only (all fallback models tried)
Both tokens set      →  GitHub Models first → Gemini fallback
```

### GitHub Models

- Endpoint: `https://models.github.ai/inference/chat/completions`
- Auth: `GITHUB_TOKEN` (or `GH_TOKEN`, `COPILOT_GITHUB_TOKEN`)
- Default model: `openai/gpt-4.1` (override with `COPILOT_MODEL`)
- Gap-fill (ticker resolution) model: `openai/gpt-4.1-mini` (override with `FILL_MODEL`)
- Fallback chain: `COPILOT_MODEL` / `COPILOT_FALLBACK_MODELS` are only the front of the ladder; the route then fans out across the full live GitHub catalog filtered to OpenAI/Anthropic/Google tool-calling models
- Live model catalog fetched from `https://models.github.ai/catalog/models`

### Gemini

- Endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- Auth: `GEMINI_TOKEN` — must come from [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys), NOT Google Cloud Console
- Default model: `gemini-2.5-flash` (override with `GEMINI_MODEL`)
- Internal fallback chain: gemini-2.5-flash → gemini-2.5-flash-lite → gemini-2.0-flash
- Gemini requests must never send `content: null`; the route normalizes Gemini-bound messages to string content before calling the OpenAI-compatible endpoint

### Model cooldown

Rate-limited models are cooled down for `LLM_MODEL_COOLDOWN_MS` (default 2 minutes). The loop advances to the next fallback model automatically; no request is dropped unless all models are exhausted.

---

## Storage

### Reports

Generated reports are Markdown files (`{slug}-{date}.md`) written to `REPORTS_DIR` (`reports/` locally, `/tmp/reports/` on Vercel). When Supabase is configured, reports are also inserted into the `saved_reports` table with metadata (title, summary, report_kind, report_date, storage_path).

### Watchlists

The default watchlist ("Core Watchlist") is stored in Supabase (`watchlists` + `watchlist_items` tables) when available, otherwise in a JSON file at `WATCHLISTS_FILE`. The watchlist is seeded with 15 semiconductor and tech companies on first load. Maximum 25 items.

### Supabase migrations

Run all `.sql` files in `supabase/migrations/` in the Supabase SQL editor to create the required tables:
- `saved_reports` — report library with metadata columns
- `watchlists` + `watchlist_items` — watchlist storage

---

## Key environment variables (complete reference)

See `web/.env.example` for annotated defaults. All variables prefixed with `STOCK_` or `ALPHA_VANTAGE_` etc. are read server-side only and never exposed to the browser.

**Provider tokens (set both for best resilience):**
- `GITHUB_TOKEN` / `GEMINI_TOKEN` — the system uses all configured tokens automatically

**Optional standalone API keys:**
- `FRED_API_KEY` — free from [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html). Enables `get_economic_indicators` tool (GDP, CPI, Fed Funds rate, unemployment, Treasury yields, yield curve).

**LLM model overrides:**
- `COPILOT_MODEL`, `COPILOT_FALLBACK_MODEL`, `COPILOT_FALLBACK_MODELS`
- `FILL_MODEL`, `GEMINI_MODEL`
- `AUTO_DOWNGRADE_GPT5` (default `true`)

**Scaling:**
- `NUM_COMPANIES` — companies per sector/comparison report (2–15, default 10)
- `DEEP_RESEARCH_DEPTH` — optional post-core-data ecosystem/refinement passes for deep-sector reports (1–3, default 1)
- `DEEP_RESEARCH_MAX_MS` — deep-research runtime budget in ms (default 240000)
- `DATA_FETCH_CONCURRENCY` — parallel ticker fetches (1–4, default 3)
- `VERCEL_EXTENDED_DATA_MAX_COMPANIES` — on Vercel, large reports prioritize core decision inputs and cached optional sections
- `VERCEL_REPORT_RETURN_BUFFER_MS` — minimum Vercel time reserved for report rendering/persistence before the hard timeout

**Storage:**
- `REPORTS_DIR`, `WATCHLISTS_FILE`, `STOCK_CACHE_TTL_MS`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

**Throttling:**
- `ALPHA_VANTAGE_MIN_INTERVAL_MS` (12000), `FINNHUB_MIN_INTERVAL_MS` (1100), `FMP_MIN_INTERVAL_MS` (12000), `TWELVE_DATA_MIN_INTERVAL_MS` (8000), `STOOQ_MIN_INTERVAL_MS` (1000)
- `LLM_REQUEST_TIMEOUT_MS` (30000 on Vercel, 90000 local), `LLM_FILL_REQUEST_TIMEOUT_MS` (12000 on Vercel, 60000 local), `LLM_FILL_TOTAL_BUDGET_MS` (20000 on Vercel, 120000 local)
- `LLM_MODEL_COOLDOWN_MS` (120000), `STOCK_PROVIDER_COOLDOWN_MS` (300000)

**Debug:**
- `DEBUG=true` — adds data-source and data-coverage diagnostic sections to reports
- `HEALTH_CHECK_SYMBOL` — enables live price check in `/api/health`

---

## Production configuration (Vercel)

Set these in Vercel project Settings → Environment Variables in addition to your API keys:

```
GITHUB_TOKEN=your_github_pat
GEMINI_TOKEN=your_gemini_key
ALPHA_VANTAGE_API_KEY=your_av_key
FINNHUB_API_KEY=your_finnhub_key
NUM_COMPANIES=15
DEEP_RESEARCH_DEPTH=1
```

These give broader sector analysis and better free-tier resilience than the code defaults.

---

## Change checklist

Before merging any change, verify:

- [ ] Did the user explicitly authorize implementation, mutation, commit, or push?
- [ ] Was `AGENT.md` read before changing code/docs?
- [ ] Does this align with the product intent in `README.md` and the architecture in this file?
- [ ] Does this keep all report data truthful (no fabricated fields)?
- [ ] Does this prefer missing/suppressed data over wrong or non-meaningful data?
- [ ] Does this preserve the three research modes (stock report, research report, watchlist daily)?
- [ ] Does this keep the user input flow simple?
- [ ] Does this work correctly both locally and on Vercel?
- [ ] On Vercel, does it reserve enough time to save/return a report before the hard timeout?
- [ ] Locally, does it avoid unnecessary Vercel-style truncation?
- [ ] Does this stay within free-tier rate-limit budgets?
- [ ] Does this use the right data provider/tool for each data type?
- [ ] Does this use LLMs only for orchestration/reasoning/synthesis, not factual market data?
- [ ] Does this avoid duplicating report/data logic that should be shared?
- [ ] Were focused tests added for new or changed behavior where practical?
- [ ] Were all practical relevant checks run (targeted tests, suites, typecheck, lint, build, install/build when needed)?
- [ ] Does this keep README.md, AGENT.md, and CHANGELOG.md aligned with the current code?
- [ ] Does CHANGELOG.md have an entry for this change?

---

## Anti-patterns

Do not do these:

- Add a fifth report mode or duplicate the report pipeline for a new type.
- Fabricate financial values from LLM training data — even as a "fallback".
- Skip `search_stock` for ticker verification and guess tickers from LLM memory.
- Hardcode provider-specific fake defaults for missing fields.
- Let missing fields appear populated (show "N/A" or omit the row instead).
- Add markdown documentation files anywhere other than `README.md`, `AGENT.md`, and `CHANGELOG.md` in the repo root.
- Revert parallel `Promise.all` fan-out in comparison/sector/deep-sector phases to sequential loops.
- Introduce a new LLM call that supplies financial data rather than routing to a data tool.

---

## Reporting guidance

When improving reports, prefer additions that come from real data:

- Timing signals derived from price history: RSI-14, MACD(12,26,9), Bollinger Bands, Stochastic, ATR, EMA, moving-average trend, 52-week range position, action stance
- Insider and institutional ownership summaries when provider data is available
- Analyst consensus, recommendation trends, and price-target distributions
- Earnings surprise history and EPS trend charts
- Peer alternatives sourced from real `get_peers` results, not LLM brainstorming
- Sector dependency diagrams sourced from real overview and news data
- Dividend analysis sections (yield, payout ratio, FCF coverage, safety) for dividend-paying stocks
- DCF valuation estimates derived from real free cash flow, growth rates, and beta
- SEC filings context from EDGAR when due-diligence depth is needed
- Macroeconomic context from FRED when market-level analysis is relevant
- Market sentiment (Fear & Greed) indicators computed from real sector and market breadth data

---

## Decision engine (`decisionEngine.ts`)

The decision engine produces a `DecisionSnapshot` for every company analysed. It runs automatically inside all four report types and in comparison/sector/deep-sector per-company loops.

### 7-pillar scoring model

Each pillar returns a 0–100 score **and** a human-readable detail string showing the real numbers behind the score. Missing data makes a pillar return `null`. A buy/add score is only shown when enough verified core decision coverage exists: current price plus at least two of profitability, growth, and valuation with at least 40% total pillar weight. If coverage is weaker, the engine waits for verified inputs instead of forcing a decision from one partial signal.

| Pillar | Weight | Inputs | Rationale |
|---|---|---|---|
| Profitability | 25% | Gross margin, operating margin, ROE, ROA | Strongest long-term predictor (Piotroski, Seeking Alpha Quant) |
| Growth | 15% | Revenue growth, EPS growth | Forward-looking trajectory |
| Valuation | 20% | P/E (linear scale), analyst target upside | Price vs fair value; avoids overpaying |
| Momentum | 15% | Price return over observation period | Price trend confirmation (Fama-French) |
| Analyst Consensus | 15% | Weighted strongBuy/buy/hold/sell/strongSell counts | Aggregate Wall Street view; reduces noise |
| Insider Activity | 5% | Net insider buying as basis points of market cap | Confirmatory signal; market-cap normalised only — **no fixed $ thresholds** (Seyhun research) |
| Financial Health | 5% | Debt/equity, current ratio, OCF, FCF yield | Leverage & liquidity guard (Piotroski) |

### Multi-provider field support

Analyst rating counts are read from whichever provider returned data:
- Finnhub: `analystRatings.strongBuy`, `analystRatings.buy`, etc.
- Alpha Vantage: `companyOverview.analystRatingStrongBuy`, etc.
- FMP: `getAnalystRecommendations` response

Market capitalisation: `marketCapitalization` (Finnhub/FMP lowercase) or `MarketCapitalization` (AV uppercase).

### Action thresholds

| Overall score | Action (not owned) | Action (owned) |
|---|---|---|
| ≥ 65 | Initiate / Buy | Add |
| 45–64 | Wait / Watch | Hold |
| < 45 | Wait | Trim / Exit |

Position-size guardrails (max weight, concentration limit) can override scores to force a Trim.

### Transparency principle

The `summary` field of `DecisionSnapshot` always shows **what data drove the decision**, not what is missing. Example: `"Profitability 82 — 56% gross margin, 30% op margin, 35% ROE. Analysts 78 — 12 buy, 3 hold, 2 sell."` Missing inputs are listed separately in `missingInputs[]` and reduce `confidence` (High → Medium → Low) but do not appear in the main summary.
