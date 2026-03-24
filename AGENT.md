# AGENT.md — Stock Research Assistant

**Read this entire file before making any change to the codebase.** It is the authoritative protocol for every AI agent, LLM, or developer working on this project.

---

## Project Scope — Five Capabilities, No More

This app has exactly **five user-facing capabilities**. Never add features outside this list.

| # | Capability | Entry Tool |
|---|---|---|
| 1 | **Stock Details** | `generate_stock_report` |
| 2 | **Stock Comparison** | `generate_comparison_report` |
| 3 | **Top Stocks in Sector** | `generate_sector_report` |
| 4 | **Deep Sector Research** | `generate_deep_sector_report` |
| 5 | **General Chat** | Direct LLM response (no tool) |

Any feature request outside these five (screeners, portfolio tracking, alerts, etc.) must be declined with a clear explanation.

---

## LLM is the Final Boss

The LLM is the **central decision-maker** for all operations. This is not negotiable.

### ⛔ ABSOLUTE RULE — No Training Data for Financial Values

**The LLM MUST NEVER provide financial figures from training knowledge.** This means: prices, revenue, EPS, margins, PE ratios, debt, book value, market cap, analyst targets, or any numeric financial metric.

- If a tool returns `null` or fails → the report shows **N/A**. That is correct and honest.
- **N/A is always preferable to training-data estimates, approximations, or "reasonable guesses".**
- Training knowledge is permitted ONLY for: (a) mapping company names → ticker symbols, (b) qualitative analysis (moat assessment, sector dependencies) based on real data already provided by tools.

This rule is enforced in every system prompt and every LLM prompt builder. Any change that relaxes this rule must be rejected.

### Rules

1. **LLM resolves all company names to tickers.** It runs `buildTickerResolutionPrompt` first (before any API call). The search API (`search_stock`) is a fallback, not the primary resolver.

2. **When the LLM cannot resolve a ticker, it surfaces candidates and the conversation pauses.** If `executeTool` cannot resolve a symbol, it returns an error with candidate matches (e.g. `"Did you mean: GOOGL (Alphabet Class A), GOOG (Alphabet Class C)?"`). The LLM receives this error and naturally asks the user for clarification. This is LLM-emergent behaviour — not an explicit code branch that waits for user input. The LLM decides to re-prompt the user; the task restarts on the next message.

3. **LLM stitches data from multiple sources.** It never surfaces raw API errors to the user. If Alpha Vantage fails, it tries Finnhub. If both fail for a field, the field shows **N/A** — the LLM does NOT fill it from training knowledge.

4. **`FILL_MODEL` (`openai/gpt-4.1-mini`) handles qualitative tasks only.** It is called via `callLLMForDataFill` for: ticker resolution, moat analysis, and sector dependency mapping. It NEVER fills numeric financial values. It always uses only data provided in the prompt.

5. **LLM handles rate limits silently.** When a rate limit is hit, it skips remaining API calls for that session (to protect the daily budget) and uses cached data where available. Fields without real data show N/A.

6. **LLM manages token budgets.** Conversation history is trimmed to the last 2 exchanges (`trimHistory()`). Tool call results are summarised before being added to history. The 5-minute Vercel timeout and 30-round tool-call limit are hard caps.

---

## Architecture

```
web/
  app/
    api/
      chat/route.ts           ← LLM orchestrator: POST handler, tool loop, gap-fill, session history
      reports/[filename]/     ← Serve (GET) and delete (DELETE) saved .md report files
      providers/route.ts      ← List available AI providers and models
      models/route.ts         ← Fetch live GitHub Models catalogue
      health/route.ts         ← Connectivity and API key health check
    lib/
      stockTools.ts           ← Tool definitions (buildToolDefinitions), tool dispatcher (executeTool),
                                 symbol resolution, LLM prompt builders, per-ticker JSON cache
      stockDataService.ts     ← StockDataService interface; AlphaVantageService, FinnhubService,
                                 HybridStockDataService, createStockService() factory
      reportGenerator.ts      ← buildStockReport, buildComparisonReport, buildSectorReport,
                                 buildDeepSectorReport, saveReport; ECharts chart blocks
    components/
      ChatInterface.tsx        ← Single-page React UI: chat, report preview, sidebar, model selector
    page.tsx                   ← Root page (renders ChatInterface)
    layout.tsx                 ← HTML shell, global styles, metadata
src/
  index.ts                    ← CLI entry point (Node.js chat loop)
  stockDataService.ts         ← CLI version of data service (mirrors web version)
  stockTools.ts               ← CLI version of tool dispatcher
  reportGenerator.ts          ← CLI version of report generator
  __tests__/
    webStockTools.test.ts     ← Tests for web/app/lib/stockTools.ts
    reportGenerator.test.ts   ← Tests for web/app/lib/reportGenerator.ts
    stockDataService.test.ts  ← Tests for web/app/lib/stockDataService.ts
```

---

## Key Files — Responsibilities and Rules

### `web/app/api/chat/route.ts`

**What it does:**
- `POST /api/chat` — main entry point for all user messages
- Detects intent: `parseReportRequest()` identifies stock/comparison/sector/deep-sector requests
- For report requests: calls `executeTool()` directly (bypasses LLM round-trip for speed)
- For general queries: runs LLM tool-calling loop (max `MAX_TOOL_ROUNDS = 30`)
- Manages per-session conversation history in `sessions` Map (in-memory, resets on cold start)
- `trimHistory()` — keeps last 2 exchanges; drops intermediate tool messages to stay within token limit
- `callLLMForDataFill()` — uses `FILL_MODEL` (GitHub) or `GEMINI_MODEL` (Gemini) for gap-fill/ticker-resolution; provider selection mirrors `LLM_PROVIDER`
- `createLLMFiller()` — creates a bound `LLMFiller` callback passed to `executeTool` via `options.llmFill`; receives both `githubToken` and `geminiToken`
- Rate-limit fallback: in `hybrid` mode, HTTP 429 from GitHub Models automatically switches to Gemini API

**Constants:**
```typescript
MAX_TOOL_ROUNDS = 30
MAX_HISTORY_MESSAGE_CHARS = 4000
maxDuration = 300  // Vercel: 5 minutes
DEFAULT_MODEL = process.env.COPILOT_MODEL || 'openai/gpt-4.1'
FILL_MODEL = process.env.FILL_MODEL || 'openai/gpt-4.1-mini'
GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
LLM_PROVIDER = process.env.LLM_PROVIDER || 'github'  // 'github' | 'gemini' | 'hybrid'
```

**LLM provider selection (`LLM_PROVIDER`):**
- `github`: `callGitHubModelsAPI` — GitHub Models REST API with mandatory headers
- `gemini`: `callGeminiWithFallback` — tries `GEMINI_FALLBACK_MODELS` in order (`gemini-2.5-flash` → `gemini-2.5-flash-lite`)
- `hybrid`: `callGitHubModelsAPI` primary; auto-falls back to `callGeminiWithFallback` on HTTP 429; mirrors `STOCK_DATA_PROVIDER` hybrid pattern

**GitHub Models API headers (mandatory):**
```typescript
'Authorization': `Bearer ${githubToken}`,
'Content-Type': 'application/json',
'User-Agent': 'stock-research-assistant/1.0',
'Accept': 'application/vnd.github+json',
'X-GitHub-Api-Version': '2022-11-28'
```
`User-Agent` is required — its absence triggers GitHub's anti-abuse 429.

---

### `web/app/lib/stockTools.ts`

**What it does:**
- `buildToolDefinitions()` — returns all OpenAI-compatible tool definitions for the LLM
- `executeTool(name, args, options)` — dispatches to `StockDataService`, `reportGenerator`, or supplementary services
- `resolveSymbolFromQuery()` — scores `searchStock` results; detects share-class variants
- `buildTickerResolutionPrompt(queries[])` — maps informal names/tickers → official US symbols
- `buildSectorCompaniesPrompt(sector, count)` — LLM selects top N tickers for a sector/theme
- `buildDeepSectorDependencyPrompt(sector, finalCount, ecosystemData[], previousPass?)` — dependency analysis + list refinement + Mermaid diagram; optional `previousPass` context enables recursive deepening
- `buildMoatAnalysisPrompt(symbol, overview, basicFinancials)` — single-company moat analysis from real API data
- `buildBatchMoatAnalysisPrompt(companies[])` — batch moat analysis for comparison/sector reports
- Per-ticker JSON cache: `loadSymbolCache()`, `saveSymbolCache()` — stored in `{REPORTS_DIR}/cache/{SYMBOL}.json`, TTL 7 days

**Tool list:**

| Tool | Data Source | Description |
|---|---|---|
| `search_stock` | AV / Finnhub | Find ticker by name or partial symbol |
| `get_stock_price` | AV / Finnhub | Real-time quote, change, volume |
| `get_price_history` | AV / Finnhub | OHLCV history (1w/1m/3m/6m/1y/3y/5y/max) |
| `get_company_overview` | AV / Finnhub | Fundamentals: EPS, PE, PEG, margins, description |
| `get_basic_financials` | AV / Finnhub | Key ratios and metric history |
| `get_earnings_history` | AV / Finnhub | Quarterly/annual EPS with beat/miss |
| `get_income_statement` | AV / Finnhub | Revenue, gross profit, EBITDA, net income |
| `get_balance_sheet` | AV / Finnhub | Assets, liabilities, equity, cash, debt |
| `get_cash_flow` | AV / Finnhub | Operating CF, free CF, capex, dividends |
| `get_analyst_ratings` | AV / Finnhub | Buy/hold/sell consensus breakdown |
| `get_analyst_recommendations` | Finnhub | Recommendation history (last 4 periods) |
| `get_price_targets` | Finnhub | Analyst price target mean/high/low/median |
| `get_peers` | AV / Finnhub | Comparable company peer list |
| `get_insider_trading` | AV / Finnhub | Insider buy/sell transactions |
| `get_news_sentiment` | Finnhub | News volume + sentiment score |
| `get_company_news` | Finnhub | Recent company news articles (last N days) |
| `get_sector_performance` | AV | Real-time sector returns across 1d/5d/1m/3m/YTD/1y |
| `get_top_gainers_losers` | AV | Today's top gaining, losing, and most active US stocks |
| `get_dividend_history` | Finnhub | Historical dividend payments (ex-date, amount, currency) |
| `get_stock_splits` | Finnhub | Historical stock split record |
| `get_earnings_calendar` | Finnhub | Upcoming earnings announcements (with EPS estimates) |
| `get_ipo_calendar` | Finnhub | Upcoming IPO listings on US exchanges |
| `get_economic_indicators` | AV | US macro: GDP, Fed funds rate, CPI, inflation, 10y Treasury |
| `get_technical_indicators` | AV / Finnhub | RSI-14, MACD, SMA-20/50, Bollinger Bands — computed from price history, zero extra API calls |
| `get_commodity_prices` | AV | WTI, Brent, Natural Gas, Copper, Aluminum, Wheat, Corn |
| `get_forex_rate` | AV / Finnhub | Real-time currency exchange rate (e.g. USD/EUR) |
| `get_market_status` | Finnhub | US market open/closed, session type, holidays |
| `get_recent_filings` | SEC EDGAR | Recent 8-K, 10-K, 10-Q, DEF14A filings with dates and EDGAR links — **no API key needed** |
| `get_market_indicators` | FRED | VIX, S&P 500, yield curve + recession signal, 2y/10y/3m yields, Fed rate, unemployment, CPI, Core PCE, mortgage rate, Baa spread, housing starts, retail sales, consumer sentiment |
| `get_crypto_price` | CoinGecko | Single crypto: price, market cap, rank, 24h/7d/30d/1y changes, ATH, supply |
| `get_top_cryptos` | CoinGecko | Top N cryptos by market cap with price changes and volume |
| `generate_stock_report` | All above | Full stock research report + save |
| `generate_comparison_report` | All above | Multi-company comparison + save |
| `generate_sector_report` | All above | LLM-selected sector report + save |
| `generate_deep_sector_report` | All above + LLM | 4-phase deep sector research with recursive dependency analysis (DEEP_RESEARCH_DEPTH passes) + save |

**LLM fallback strategy for data tools:**
- AV hits daily limit → Finnhub fallback (via `HybridStockDataService.withFallback`)
- `get_technical_indicators`: computed from price history — AV price fetch fails → Finnhub price fetch
- `get_forex_rate`: AV primary → Finnhub `/forex/rates` fallback
- `get_market_status`: Finnhub only (AV has no equivalent)
- `get_commodity_prices`: AV only (Finnhub has no commodity data)
- `get_economic_indicators`: AV only — if quota exhausted, use `get_market_indicators` (FRED) for overlapping series
- `get_recent_filings`: SEC EDGAR (no quota, no key — always available)
- `get_market_indicators`: FRED (requires `FRED_API_KEY`) — if not set, returns a clear error with setup instructions
- `get_crypto_price` / `get_top_cryptos`: CoinGecko — works without a key (rate-limited), faster with `COINGECKO_API_KEY`

**Error suppression in `safeFetch`:**
Errors matching these patterns are silently swallowed (not shown in report Data Gaps):
- `/unavailable (in|via) (Alpha|Finnhub)/i`
- `message.includes('Alpha-only mode')`

All other errors appear in the report's `## ⚠️ Data Gaps` section.

**Rate-limit detection (`isRateLimit`):**
- `message.includes('frequency')` — AV per-minute limit
- `message.includes('Thank you for using Alpha Vantage')` — AV daily limit or premium feature
- `/rate limit|too many requests/i` — generic rate-limit

When `isRateLimit` triggers: `rateLimitHit = true` → all remaining fetches skipped.

**AV circuit breaker (`AlphaVantageService.rateLimitedUntilMs`):**

`AlphaVantageService.makeRequest()` checks a static timestamp flag before throttling:
- If `rateLimitedUntilMs > Date.now()`: immediately throw `'Unavailable via Alpha Vantage: rate limit active'` — **no throttle wait, no HTTP call**.
- When AV returns `data.Note` or `data.Information` (rate-limit response): set the flag and throw the same suppressed error.
  - Daily limit (`/per day|\d+ requests per day/i`): lock out for **1 hour**
  - Per-minute limit: lock out for **65 seconds**

**Why this matters:** Without the circuit breaker, each AV call in hybrid mode wastes ~1200 ms (throttle) before the rate-limit error is detected and Finnhub is tried. With the circuit breaker, once the limit fires, every subsequent call immediately falls through to Finnhub in ~0 ms, reducing fallback path from ~2200 ms to ~800 ms per data point.

### `web/app/lib/stockDataService.ts`

**What it does:**
- `createStockService(alphaVantageKey?)` — factory returns the correct service based on `STOCK_DATA_PROVIDER`
- `AlphaVantageService` — primary data source (free tier, rate-limited, cached, **circuit-breaker protected**)
- `FinnhubService` — secondary data source (free tier, higher rate limit)
- `HybridStockDataService` — wraps both; `withFallback()` retries AV failures on Finnhub; tags results with `__source: 'Finnhub'`
- `SecEdgarService` — SEC EDGAR (no API key required); CIK lookup + recent filings
- `FredService` — FRED macroeconomic database (requires `FRED_API_KEY`); VIX, yield curve, S&P 500, CPI, PCE, unemployment, mortgage rates, credit spreads, consumer sentiment
- `CoinGeckoService` — cryptocurrency market data (no key required; optional `COINGECKO_API_KEY` for higher rate limits)
- `computeTechnicalIndicators()` — module-level helper computing RSI-14 (Wilder), MACD(12,26,9), SMA-20, SMA-50, Bollinger Bands(20,2σ) from a closing-price array; used by both AV and Finnhub `getTechnicalIndicators()`

**IMPORTANT implementation rules:**
- **Never use `TIME_SERIES_DAILY outputsize=full`** — this is a premium Alpha Vantage feature and fails on free tier.
- **Never call Finnhub `/financials-reported`** — returns 403 on free tier.
- **Never call Finnhub `/stock/financials`** — deprecated, removed from API.
- Finnhub `/quote` returns `{c:0,t:0}` for unknown symbols — check `data.t===0`, not just falsy.
- Finnhub `/stock/candle` returns `{s:"no_data"}` for bad symbols — check `data.s !== 'ok'`.
- Finnhub financial statements come from `/stock/metric?metric=all` → `series.quarterly.ic/bs/cf`; `pivotSeries()` converts to per-quarter records.
- SEC EDGAR requires `User-Agent` header with contact info or requests may be blocked (10 req/s max).
- `HybridStockDataService.getNewsSentiment` and `getCompanyNews` MUST use `withFallback` — AV throws "Alpha-only mode"; Finnhub provides both endpoints.

**Alpha Vantage free-tier endpoint map:**

| Endpoint | Free | Notes |
|---|---|---|
| `GLOBAL_QUOTE` | ✅ | Real-time quote |
| `OVERVIEW` | ✅ | Fundamentals + analyst ratings + margins |
| `EARNINGS` | ✅ | Quarterly & annual EPS |
| `INCOME_STATEMENT` | ✅ | Quarterly & annual P&L |
| `BALANCE_SHEET` | ✅ | Quarterly & annual balance sheet |
| `CASH_FLOW` | ✅ | Quarterly & annual cash flow |
| `TIME_SERIES_DAILY outputsize=compact` | ✅ | Last 100 trading days |
| `TIME_SERIES_DAILY outputsize=full` | ❌ **PREMIUM** | Never use |
| `TIME_SERIES_WEEKLY` | ✅ | Full history, weekly candles |
| `TIME_SERIES_MONTHLY` | ✅ | Full history, monthly candles |
| `SYMBOL_SEARCH` | ✅ | Ticker search |
| `SECTOR` | ✅ | Sector performance |
| `TOP_GAINERS_LOSERS` | ✅ | Market movers |
| `CURRENCY_EXCHANGE_RATE` | ✅ | Real-time FX rate |
| `WTI` / `BRENT` / `NATURAL_GAS` / `COPPER` / `ALUMINUM` / `WHEAT` / `CORN` | ✅ | Commodity price series |
| `REAL_GDP` / `FEDERAL_FUNDS_RATE` / `CPI` / `INFLATION` / `TREASURY_YIELD` | ✅ | US macro series |
| `INSIDER_TRANSACTIONS` | ❌ **PREMIUM** | Returns premium error; wrapped in try/catch |
| `NEWS_SENTIMENT` | ❌ **PREMIUM** | Throws suppressed "Alpha-only mode" error |

**Price history range → AV endpoint:**
- `1w`, `1m`, `3m`, `6m` → `TIME_SERIES_DAILY` + `outputsize=compact`
- `1y`, `3y`, `5y`, `weekly` → `TIME_SERIES_WEEKLY`
- `max`, `all`, `monthly` → `TIME_SERIES_MONTHLY`

**Finnhub free-tier endpoint map:**

| Endpoint | Free | Notes |
|---|---|---|
| `/quote` | ✅ | Real-time quote |
| `/stock/candle` | ✅ | Historical OHLCV |
| `/stock/profile2` | ✅ | Company profile; may return `{}` for unknown symbol |
| `/stock/metric?metric=all` | ✅ | Key metrics + quarterly financial series |
| `/stock/recommendation` | ✅ | Analyst recommendations |
| `/stock/price-target` | ✅ | Analyst price targets |
| `/stock/earnings` | ✅ | EPS history |
| `/stock/peers` | ✅ | Peer ticker list |
| `/stock/insider-transactions` | ✅ | Insider trades |
| `/company-news` | ✅ | Company news |
| `/news-sentiment` | ✅ | News sentiment |
| `/search` | ✅ | Symbol/company search |
| `/stock/dividend` | ✅ | Dividend payment history |
| `/stock/split` | ✅ | Stock split history |
| `/calendar/earnings` | ✅ | Upcoming earnings calendar |
| `/calendar/ipo` | ✅ | Upcoming IPO calendar |
| `/market-status` | ✅ | US market open/closed status |
| `/forex/rates` | ✅ | FX rates relative to base currency |
| `/financials-reported` | ❌ **PREMIUM** | Returns 403. Never call. |
| `/stock/financials` | ❌ **DEPRECATED** | Removed from API. Never call. |

**SEC EDGAR endpoint map (no API key):**

| Endpoint | Notes |
|---|---|
| `https://www.sec.gov/files/company_tickers.json` | Ticker → CIK mapping, ~10k entries, cached 24h |
| `https://data.sec.gov/submissions/CIK{10-digit}.json` | Company filing history (form type, date, accession number), cached 6h |

Rate limit: 10 req/s max. `User-Agent` header with contact info is mandatory.

**FRED endpoint map (free with API key):**

Key series IDs used by `getMarketIndicators()`:
`VIXCLS`, `SP500`, `T10Y2Y`, `DGS10`, `DGS2`, `DTB3`, `FEDFUNDS`, `A191RL1Q225SBEA`, `UNRATE`, `CPIAUCSL`, `PCEPI`, `PCEPILFE`, `MORTGAGE30US`, `BAA10Y`, `HOUST`, `RSAFS`, `INDPRO`, `UMCSENT`

Base URL: `https://api.stlouisfed.org/fred/series/observations`  
Key params: `series_id`, `api_key`, `file_type=json`, `limit`, `sort_order=desc`

**CoinGecko endpoint map:**

| Endpoint | Notes |
|---|---|
| `/api/v3/coins/{id}` | Detailed coin data: price, market cap, ATH, supply, changes — 5min cache |
| `/api/v3/coins/markets` | Top N coins ranked by market cap — 5min cache |

Without key: ~5–15 req/min. With free demo key (`COINGECKO_API_KEY`): 30 req/min, 10k/month.
API key param: `x_cg_demo_api_key={key}`

---

### `web/app/lib/reportGenerator.ts`

**What it does:**
- `buildStockReport(data: StockReportData): string` — full markdown report with ECharts chart blocks
- `buildComparisonReport(data: ComparisonReportData): string` — comparison tables + charts
- `buildSectorReport(data: SectorReportData): string` — wraps comparison with sector context
- `buildDeepSectorReport(data: DeepSectorReportData): string` — adds dependency analysis, Mermaid diagram, refinement notes
- `saveReport(content, title, dir?): Promise<{filePath, filename}>` — saves `.md` to `{REPORTS_DIR}/{safe-title}-{ISO-timestamp}.md`

**Chart format:** All charts MUST use ` ```chart ``` ` fences with valid ECharts JSON. `applyChartTheme()` normalises theming. Mermaid diagrams use standard ` ```mermaid ``` ` fences.

**Report saved as:** `{safe-title}-{ISO-timestamp}.md`  
**Served via:** `GET /api/reports/{filename}`  
**Deleted via:** `DELETE /api/reports/{filename}`

---

### `web/app/components/ChatInterface.tsx`

**What it does:**
- Single-page React UI: chat input, message history, report preview panel, model selector, sidebar
- Renders `react-markdown` with `remark-gfm` for report output
- Custom `ChartBlock` component renders ECharts from ` ```chart ``` ` fences
- Custom `MermaidBlock` component renders ecosystem diagrams
- **Responsive:** must work on all screen sizes (mobile, tablet, laptop, desktop)
- Sidebar is a sliding drawer on mobile (`lg:static` for desktop)
- Never break the responsive layout

---

## Deep Sector Research — 4-Phase Protocol (with Recursive Refinement)

```typescript
// Phase 1: LLM identifies initial broad candidate list (~2× final count, max NUM_COMPANIES * 2)
const prompt = buildSectorCompaniesPrompt(sector, initialCount);
initialCandidates = await llmFill(prompt); // → string[] of tickers

// Phase 2: Fetch lightweight ecosystem data for all candidates
// overview + news sentiment + peers — uses cache where available
for (const sym of initialCandidates) {
  ecosystemData.push({ symbol, overview, news, peers });
}

// Phase 3: LLM dependency analysis + list refinement — runs DEEP_RESEARCH_DEPTH times.
// Each pass feeds the prior analysis as context so the LLM progressively deepens insights.
let previousPass: DeepSectorPassContext | undefined;
for (let passIndex = 0; passIndex < DEEP_RESEARCH_DEPTH; passIndex++) {
  const depPrompt = buildDeepSectorDependencyPrompt(sector, finalCount, ecosystemData, previousPass);
  // LLM returns JSON: { refinedList, dependencyAnalysis, ecosystemDiagram, refinementNotes }
  // Falls back to initialCandidates if ALL passes fail; if a mid-loop pass fails, stops recursion.
  previousPass = { dependencyAnalysis, ecosystemDiagram, refinementNotes, universe, passIndex };
}

// Phase 4: Full comparison data fetch for refined universe
// Same as generate_comparison_report for the final company list
```

**Important:** Phase 3 runs `DEEP_RESEARCH_DEPTH` times (default 2). The first pass produces the initial refined list; subsequent passes use the prior analysis as context to deepen the ecosystem narrative and further refine the company selection. If a pass fails, recursion stops and the last successful universe is used. Phase 4 always runs exactly once.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` (or `GH_TOKEN`/`COPILOT_GITHUB_TOKEN`) | Yes (unless `LLM_PROVIDER=gemini`) | — | GitHub Models API authentication |
| `GEMINI_TOKEN` | Yes (when `LLM_PROVIDER=gemini` or `hybrid`) | — | Gemini API key. **Must use [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys)** — NOT Google Cloud Console. AI Studio keys include free-tier quota. Free tier (gemini-2.5-flash): 5 RPM / 250K TPM / 20 RPD. **Server env only — never exposed client-side.** |
| `LLM_PROVIDER` | No | `github` | `github` (GitHub Models only), `gemini` (Gemini only), or `hybrid` (GitHub primary, Gemini auto-fallback on 429). Mirrors `STOCK_DATA_PROVIDER` pattern. |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model name. `gemini-2.5-flash` has free-tier quota on AI Studio keys (5 RPM / 20 RPD). **`gemini-2.0-flash` has zero free quota and will always fail.** Auto-falls back to `gemini-2.5-flash-lite` on 429. |
| `ALPHA_VANTAGE_API_KEY` | Yes (unless `STOCK_DATA_PROVIDER=finnhub`) | — | Alpha Vantage free tier: **25 req/day**, 1 req/sec burst limit |
| `FINNHUB_API_KEY` | No | — | Enables Finnhub provider or hybrid fallback. If `STOCK_DATA_PROVIDER=hybrid` but this is not set, silently falls back to AV-only |
| `STOCK_DATA_PROVIDER` | No | `alphavantage` | `alphavantage`, `finnhub`, or `hybrid` |
| `COPILOT_MODEL` | No | `openai/gpt-4.1` | Main reasoning model (GitHub Models name; ignored when `LLM_PROVIDER=gemini`) |
| `FILL_MODEL` | No | `openai/gpt-4.1-mini` | Gap-fill and ticker-resolution model on GitHub Models (separate quota from main model) |
| `COPILOT_FALLBACK_MODEL` | No | same as `COPILOT_MODEL` | Single fallback model if main model hits rate limit (GitHub Models only) |
| `COPILOT_FALLBACK_MODELS` | No | built-in list | Comma-separated ordered fallback model list; overrides `DEFAULT_FALLBACK_MODELS` constant |
| `AUTO_DOWNGRADE_GPT5` | No | `true` | When `true`, `gpt-5` requests on GitHub provider are downgraded to `gpt-4.1` (GPT-5 not available on GitHub Models) |
| `USE_FULL_SYSTEM_PROMPT` | No | `false` | When `true`, sends full verbose `SYSTEM_PROMPT`; default uses shorter `COMPACT_SYSTEM_PROMPT` to conserve tokens |
| `REPORTS_DIR` | No | `/tmp/reports` (Vercel) or `reports/` | Report output directory |
| `STOCK_CACHE_TTL_MS` | No | `604800000` | Cache TTL ms (7 days) |
| `NUM_COMPANIES` | No | `10` | Number of companies in comparison, sector, and deep-sector reports. Optimal: 10; raise to 15 for broader research, lower to 5 for faster/demo runs |
| `DEEP_RESEARCH_DEPTH` | No | `2` | Recursive refinement passes in deep sector Phase 3. Each pass deepens analysis using prior results. Optimal: 2; set to 1 to disable recursion, 3 for most thorough analysis |
| `DEBUG` | No | _(unset)_ | When `true`, reports include "Data Sources" and "Data Coverage (Chart Inputs)" debug sections. Omit or set to `false` in production |
| `ALPHA_VANTAGE_MIN_INTERVAL_MS` | No | `1200` | Min ms between AV requests (1200ms = 0.83 req/s, safely under the 1 req/s burst limit) |
| `FINNHUB_MIN_INTERVAL_MS` | No | `500` | Min ms between Finnhub requests (500ms = 2 req/s theoretical; Finnhub free tier = 60 req/min) |
| `HEALTH_CHECK_SYMBOL` | No | — | If set, health endpoint makes a live API call with this ticker |

---

## Free-Tier API Rate Limits & Circuit Breakers

Understanding the limits of each data source prevents the retry-loop timeout pattern seen when a limit is hit and the code keeps retrying.

### Alpha Vantage (free tier)

| Limit | Value | Notes |
|---|---|---|
| Daily | **25 requests/day** | Hard limit — returns HTTP 200 with `Information` field set |
| Per-second burst | **1 request/second** | Advisory — returns HTTP 200 with `Note` field set |
| Response format | HTTP 200 always | Rate-limit is embedded in the JSON body, not the HTTP status |

**Circuit breaker (`AlphaVantageService.rateLimitedUntilMs`):**
- First call that hits the limit: sets static flag → **lockout for 1 hour** (daily limit) or **65 seconds** (per-second/per-minute)
- All subsequent calls within the same process: **skip throttle + HTTP immediately**, throw `'Unavailable via Alpha Vantage: rate limit active'`
- `HybridStockDataService.withFallback` catches this and routes to Finnhub with **0 ms overhead** instead of wasting 1200 ms per call
- **Impact:** Reduces a 100-call sector report from ~200 s (AV throttle loop) to ~80 s (Finnhub fallback)

**Before circuit breaker (the timeout you saw):**
```
100 calls × (1200ms AV throttle + 200ms HTTP + 800ms Finnhub fallback) = 220 s
+ LLM overhead = ~280 s → hits 300 s Vercel limit
```
**After circuit breaker:**
```
1 call × (1200ms AV + 200ms HTTP + circuit opens)
+ 99 calls × (0ms AV skip + 500ms Finnhub throttle + 300ms response) = 79 s
+ LLM overhead = ~120 s ✅
```

### Finnhub (free tier)

| Limit | Value | Notes |
|---|---|---|
| Per-minute | **60 req/min** | Returns HTTP 429 on breach |
| Default throttle | 500 ms between requests | Set via `FINNHUB_MIN_INTERVAL_MS` |

**Circuit breaker (`FinnhubService.rateLimitedUntilMs`):**
- On HTTP 429: sets static flag → **65-second lockout**
- All subsequent calls skip throttle + HTTP immediately
- Throws `'Unavailable via Finnhub: rate limit active'` → `isRateLimit()` in `safeFetch` matches → `rateLimitHit = true` → remaining fetches in the report are skipped instantly

### Queue-based throttle (both services)

Both `AlphaVantageService` and `FinnhubService` use a **promise-chain throttle queue** instead of a mutable timestamp. The timestamp approach has a race condition: when `Promise.all` fires concurrent calls, they all read the same `lastRequestAt` and all execute simultaneously. The queue approach chains each slot onto the previous one — built synchronously within a single event-loop tick — so concurrent callers are always properly serialised.

### GitHub Copilot / GitHub Models (your subscription)

| Model | Requests/day | RPM | Notes |
|---|---|---|---|
| `gpt-4.1` | ~50 | 10 | Primary — use for reports |
| `gpt-4.1-mini` | much higher | 20 | Gap-fill model (`FILL_MODEL`) |
| `google/gemini-3-flash` | ~50 | — | Fallback in `DEFAULT_FALLBACK_MODELS` |

### Gemini (free AI Studio key)

| Model | RPM | RPD | Notes |
|---|---|---|---|
| `gemini-2.5-flash` | 5 | 20 | Default; best reasoning |
| `gemini-2.5-flash-lite` | 10 | 20 | Auto fallback on 429 |
| `gemini-3.1-flash-lite` | 15 | 500 | Highest free daily quota |

### SEC EDGAR

No API key required. Rate limit: 10 req/s (enforced via `User-Agent` header). `SecEdgarService` applies a 200ms inter-request delay internally.

### FRED Federal Reserve

Free API key. Very generous limits (10,000 req/day, no per-second stated). `FredService` applies a 300ms delay internally.

### CoinGecko

| Mode | Rate limit |
|---|---|
| No key | ~10–15 req/min |
| Free demo key (`COINGECKO_API_KEY`) | 30 req/min, 10,000/month |

---

## Development Setup

```bash
cd web
npm install
cp .env.example .env.local   # fill in GITHUB_TOKEN + ALPHA_VANTAGE_API_KEY
npm run dev                  # http://localhost:3000
```

### Build and Lint

```bash
cd web
npm run build     # Next.js production build — must pass with zero errors
npm run lint      # ESLint — must pass with zero warnings or errors
npx tsc --noEmit  # TypeScript type check — must pass with zero errors
```

### Tests

```bash
# From repo root
npm test   # runs vitest — all tests in src/__tests__/
```

---

## Testing Requirements

**Tests are mandatory.** Every functional change must be accompanied by test updates. Every new feature must have exhaustive tests before the feature is considered done.

**Test files:**
- `src/__tests__/webStockTools.test.ts` — tool dispatch, symbol resolution, gap-fill, error handling, rate-limit behavior
- `src/__tests__/reportGenerator.test.ts` — report building, chart generation, save/load
- `src/__tests__/stockDataService.test.ts` — AV and Finnhub service methods, hybrid fallback, cache

**Coverage requirements:**
- All tool dispatcher `case` branches must have at least one test
- Rate-limit detection and `rateLimitHit` propagation must be tested
- Gap-fill apply/merge logic must be tested with null, partial, and full data scenarios
- Error suppression patterns must be tested
- Deep sector 4-phase flow must have an integration-style test with mocked LLM and API responses

**Before submitting any PR:** run `npm test` from repo root and confirm all tests pass.

---

## Coding Rules — Mandatory for All Agents

1. **Five capabilities only.** Never add a sixth feature. If asked, explain the constraint.

2. **No dead code.** Remove any handler, branch, or function that is not reachable or not used. Every line must serve a purpose.

3. **No hardcoding.** Never write `symbol === 'AAPL'`, `company === 'Microsoft'`, or any domain-specific literal in logic code. All data comes from APIs or the LLM. **Exception:** the Quick Research section of README.md may show example tickers for illustration.

4. **No code duplication.** Extract shared logic into utilities. If the same pattern appears in more than one place, refactor before adding more.

5. **Zero errors and warnings.** `npm run lint`, `npx tsc --noEmit`, and `npm run build` must all pass clean. Fix every error and warning you encounter — including pre-existing ones you did not introduce.

6. **TypeScript strictness.** Use `unknown` for dynamic API responses, not `any`. Use type guards or `asRecord()` helper to access object properties safely. Every `eslint-disable` comment must have an explanation.

7. **Test every change.** Run `npm test` after every change. If a test fails, fix the code or the test (but never delete tests to make CI green).

8. **LLM NEVER fills financial values.** The LLM does not fill numeric financial fields (prices, revenue, margins, ratios, etc.) — ever. These come exclusively from real API data. Fields without real data show N/A. Qualitative fields (moat analysis, dependency narratives) may use LLM judgment based on real data provided in the prompt.

9. **Ticker resolution: ask before assuming.** If the LLM cannot confidently resolve a company name to a ticker, it must ask the user. Never proceed with a guessed ticker.

10. **Report charts must use `chart` fences.** All ECharts output MUST use ` ```chart ... ``` ` fences with valid ECharts JSON. Use `applyChartTheme()` for consistent theming. Never use plain JSON blocks for charts.

11. **Responsive UI.** ChatInterface.tsx must render correctly on all screen sizes. The sidebar is a sliding drawer on mobile. Test at 375px, 768px, and 1280px widths.

12. **Session history management.** `trimHistory()` keeps the last 2 exchanges. Do not raise this limit — it protects against 413 "request too large" errors on Vercel.

13. **Vercel constraints.** Max function duration: 300 seconds. Reports stored in `/tmp/reports` (ephemeral — lost on cold start). Never assume report persistence between requests.

14. **Hybrid mode fallback chain.** In `HybridStockDataService.withFallback()`: catch any AV exception → retry on Finnhub → tag result with `__source: 'Finnhub'`. If both fail, propagate to `safeFetch`. Never silently swallow data.

15. **Update all three docs on every change.** After any functional change, update README.md, AGENT.md, and CHANGELOG.md. Only these three documentation files may exist. Delete any other `.md` files at the root level.

---

## Common Pitfalls

| Pitfall | Correct Behaviour |
|---|---|
| Using `TIME_SERIES_DAILY outputsize=full` | Use `TIME_SERIES_WEEKLY` (≥1y) or `TIME_SERIES_MONTHLY` (max) |
| Calling Finnhub `/financials-reported` | Already handled; throws suppressed plan-limitation error |
| "Company overview: Unable to fetch…" showing in Data Gaps | Error message must match suppression pattern: `/unavailable (in\|via) (Alpha\|Finnhub)/i` |
| AV rate limit hitting mid-report | `safeFetch` detects it and sets `rateLimitHit=true`; remaining fetches skipped |
| LLM returning tool calls as plain text | User must switch to a tool-calling capable model |
| Session history too large (413 Too Large) | `trimHistory()` must be called; max 2 exchanges |
| Missing `User-Agent` on GitHub Models requests | Results in anti-abuse 429. Always include the header. |
| Comparison report with company names, not tickers | `resolveSymbolFromQuery()` handles this; returns error with candidates if ambiguous |
| Finnhub `/quote` returning `{c:0,t:0}` for unknown symbol | Check `data.t === 0` explicitly — it's not an error response |
| Finnhub `/stock/candle` returning `{s:"no_data"}` | Check `data.s !== 'ok'` before reading candle arrays |
| Setting `STOCK_DATA_PROVIDER=hybrid` without `FINNHUB_API_KEY` | `createStockService()` silently falls back to AV-only. Set `FINNHUB_API_KEY` to actually get hybrid coverage. |
| `GEMINI_TOKEN` in client-side code | Never expose Gemini token client-side. It is only read in `web/app/api/chat/route.ts` from `process.env` on the server. |
| Setting `LLM_PROVIDER=hybrid` without any token | `callProvider` throws 503. Set at least one of `GITHUB_TOKEN` or `GEMINI_TOKEN`. |

---

## Report File Naming

Format: `{safe-title}-{ISO-timestamp}.md`  
Example: `nvda-stock-report-2025-01-15T10-30-00-000Z.md`

Served: `GET /api/reports/{filename}`  
Deleted: `DELETE /api/reports/{filename}`

---

## Documentation Rule

**Only three documentation files exist at any time:**
- `README.md` — human-readable project overview with diagrams
- `AGENT.md` — this file: machine/AI protocol, coding rules, technical reference
- `CHANGELOG.md` — all changes recorded chronologically

Any other `.md` files at the root level must be deleted. If a deployment guide or quick-start guide is needed, its content belongs in README.md.
