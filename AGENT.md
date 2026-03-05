# AGENT.md — Stock Research App

This file is the authoritative guide for AI agents (GitHub Copilot, LLMs) working on this codebase. Read it before making any changes.

---

## Project Purpose

An AI-powered stock research web app with exactly **two user-facing functionalities**:

1. **Generate Stock Report** — Comprehensive single-stock equity research report (price, financials, valuation, analyst view, scorecard)
2. **Generate Comparison Report** — Side-by-side multi-company comparison (2–6 companies)

**Any feature outside these two is out of scope and should not be added.**

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS v4 |
| AI Backend | GitHub Models API (via `GITHUB_TOKEN`) or OpenAI-compatible proxy |
| Data | Alpha Vantage REST API (primary), Yahoo Finance fallback |
| Report generation | Custom markdown + ECharts charts (`buildStockReport`, `buildComparisonReport`) |
| Deployment | Vercel (Node.js runtime, 5-minute max duration) |

---

## Architecture

```
web/
  app/
    api/
      chat/route.ts          ← Main AI chat handler (POST). Orchestrates tool calls.
      reports/[filename]/    ← Serve / delete saved .md reports
      providers/route.ts     ← Returns available AI providers + models
      models/route.ts        ← Live GitHub Models catalog fetch
      health/route.ts        ← Connectivity health check
    lib/
      stockDataService.ts    ← StockDataService class; wraps Alpha Vantage + Yahoo Finance
      stockTools.ts          ← Tool definitions exposed to LLM + executeTool() dispatcher
      reportGenerator.ts     ← buildStockReport(), buildComparisonReport(), saveReport()
    components/
      ChatInterface.tsx      ← Single-page React UI (chat + report preview + sidebar)
    page.tsx                 ← Root page (renders ChatInterface)
    layout.tsx               ← HTML shell
```

---

## Key Files & Responsibilities

### `web/app/api/chat/route.ts`
- Parses user message with `parseReportRequest()` and `parseComparisonCompanies()`
- For report/comparison requests: calls `executeTool()` directly (no LLM round-trip needed)
- For general queries: falls back to LLM tool-calling loop (max 30 rounds)
- Manages per-session conversation history (`sessions` Map)
- Handles rate-limit fallback across models (GitHub Models → proxy)

### `web/app/lib/stockTools.ts`
- `buildToolDefinitions()` → returns only the tools the LLM should call:
  - Data tools: `search_stock`, `get_stock_price`, `get_company_overview`, `get_basic_financials`, `get_analyst_ratings`, `get_analyst_recommendations`, `get_price_targets`, `get_news_sentiment`, `get_company_news`, `get_price_history`, `get_earnings_history`, `get_income_statement`, `get_balance_sheet`, `get_cash_flow`, `get_peers`, `get_insider_trading`
  - Report tools: `generate_stock_report`, `generate_comparison_report`
- `executeTool()` → dispatches to `StockDataService` or `reportGenerator` functions
- `generate_stock_report` fetches all data, builds report, saves to `/tmp/reports/` on Vercel
- `generate_comparison_report` resolves company names → symbols, fetches data, builds comparison report

### `web/app/lib/reportGenerator.ts`
- `buildStockReport(data: StockReportData): string` — builds full markdown report with ECharts chart blocks
- `buildComparisonReport(data: ComparisonReportData): string` — builds comparison markdown with charts
- `saveReport(content, title, dir?): Promise<{filePath, filename}>` — saves `.md` to disk
- Report charts use ` ```chart ... ``` ` fences; rendered in the UI by `ChartBlock` component

### `web/app/lib/stockDataService.ts`
- `createStockService(alphaVantageKey?)` → factory that creates a service instance
- Primary: Alpha Vantage REST API (`ALPHA_VANTAGE_API_KEY` env var required)
- Fallback: Yahoo Finance via `yahoo-finance2` (works without API key, but blocked by Yahoo on some cloud IPs)
- **IMPORTANT**: `chart()` in yahoo-finance2 does NOT need crumb auth; `quoteSummary()` DOES and is blocked on Vercel cloud IPs — never call `quoteSummary()` in cloud deployments

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | Yes (or `GH_TOKEN`/`COPILOT_GITHUB_TOKEN`) | GitHub Models API auth |
| `ALPHA_VANTAGE_API_KEY` | Yes (unless `STOCK_DATA_PROVIDER=finnhub`) | Financial data |
| `FINNHUB_API_KEY` | No | Enables Finnhub provider or hybrid fallback |
| `STOCK_DATA_PROVIDER` | No | `alphavantage` (default), `finnhub`, or `hybrid` |
| `OPENAI_API_KEY` | No | Alternative AI provider via proxy |
| `OPENAI_PROXY_BASE_URL` | No | Custom OpenAI-compatible proxy URL |
| `COPILOT_MODEL` | No | Override default model (default: `openai/gpt-4.1`) |
| `REPORTS_DIR` | No | Reports output directory (default: `reports/` or `/tmp/reports` on Vercel) |
| `STOCK_CACHE_TTL_MS` | No | Cache TTL in ms (default: 7 days) |
| `ALPHA_VANTAGE_MIN_INTERVAL_MS` | No | Min ms between AV requests (default: 1200) |
| `FINNHUB_MIN_INTERVAL_MS` | No | Min ms between Finnhub requests (default: 500) |
| `HEALTH_CHECK_SYMBOL` | No | If set, `/api/health` makes a live API call with this ticker to verify connectivity. If unset, health check only verifies the key is configured. |

---

## Free-Tier API Reference (CRITICAL — read before modifying data fetching)

### Alpha Vantage Free Tier
**Limits:** 25 requests/day, 5 requests/minute (per API key).

| Endpoint | Free | Notes |
|---|---|---|
| `GLOBAL_QUOTE` | ✅ | Real-time quote |
| `OVERVIEW` | ✅ | Fundamentals, analyst ratings, margins |
| `EARNINGS` | ✅ | Quarterly & annual EPS history |
| `INCOME_STATEMENT` | ✅ | Quarterly & annual P&L |
| `BALANCE_SHEET` | ✅ | Quarterly & annual balance sheet |
| `CASH_FLOW` | ✅ | Quarterly & annual cash flow |
| `TIME_SERIES_DAILY` `outputsize=compact` | ✅ | Last 100 trading days |
| `TIME_SERIES_DAILY` `outputsize=full` | ❌ **PREMIUM** | Do NOT use — causes "premium feature" error |
| `TIME_SERIES_WEEKLY` | ✅ | Full history, weekly candles. No `outputsize` param. |
| `TIME_SERIES_MONTHLY` | ✅ | Full history, monthly candles. No `outputsize` param. |
| `SYMBOL_SEARCH` | ✅ | Ticker search |
| `SECTOR` | ✅ | Sector performance |
| `TOP_GAINERS_LOSERS` | ✅ | Market movers |
| `INSIDER_TRANSACTIONS` | ❌ **PREMIUM** | Returns premium-feature error; already wrapped in try/catch |
| `NEWS_SENTIMENT` | ❌ **PREMIUM** | Alpha Intelligence™; throws suppressed "Alpha-only mode" error |

**Price history ranges → AV endpoint mapping:**
- `1w`, `1m`, `3m`, `6m` → `TIME_SERIES_DAILY` + `outputsize=compact` (100 data points ≈ 5 months)
- `1y`, `3y`, `5y`, `weekly` → `TIME_SERIES_WEEKLY` (free, no `outputsize` param)
- `max`, `all`, `monthly` → `TIME_SERIES_MONTHLY` (free, no `outputsize` param)

### Finnhub Free Tier
**Limits:** 60 requests/minute, ~30,000/month.

| Endpoint | Free | Notes |
|---|---|---|
| `/quote` | ✅ | Real-time quote |
| `/stock/candle` | ✅ | Historical OHLCV |
| `/stock/profile2` | ✅ | Company profile; may return `{}` if symbol unknown |
| `/stock/metric` | ✅ | Key financial metrics (basic set) |
| `/stock/recommendation` | ✅ | Analyst recommendations |
| `/stock/price-target` | ✅ | Analyst price targets |
| `/stock/earnings` | ✅ | EPS history |
| `/stock/peers` | ✅ | Peer ticker list |
| `/stock/insider-transactions` | ✅ | Insider trades (limited history) |
| `/company-news` | ✅ | Company news articles |
| `/news-sentiment` | ✅ | Basic news sentiment |
| `/search` | ✅ | Symbol/company search |
| `/financials-reported` | ❌ **PREMIUM** | Returns 403; caught and thrown as "Unavailable via Finnhub" |

**Error handling rules:**
- HTTP 401/403 from Finnhub → thrown as `"Unavailable via Finnhub (plan limitation: …)"` → suppressed by `safeFetch`
- HTTP 429 from Finnhub → thrown as `"Finnhub rate limit exceeded (429)"` → triggers `rateLimitHit = true`
- Empty `{}` profile from `/stock/profile2` → thrown as `"Unavailable via Finnhub: company profile not found"` → suppressed

### Error suppression in `safeFetch` (stockTools.ts)
Errors matching these patterns are silently suppressed (not shown in Data Gaps):
- `/unavailable (in|via) (Alpha|Finnhub)/i` — plan/data limitations
- `message.includes('Alpha-only mode')` — AV-only mode doesn't support some endpoints

All other errors are shown in the report's `## ⚠️ Data Gaps` section.

Rate-limit detection (`isRateLimit`):
- `message.includes('frequency')` — AV per-minute limit
- `message.includes('Thank you for using Alpha Vantage')` — AV daily limit or premium feature error
- `/rate limit|too many requests/i` — generic rate-limit

When `isRateLimit` triggers, `rateLimitHit = true` and all remaining fetches are skipped to conserve the 25-call/day budget.

---

## Development

```bash
cd web
npm install
cp .env.example .env.local   # fill in GITHUB_TOKEN + ALPHA_VANTAGE_API_KEY
npm run dev                  # starts on http://localhost:3000
```

### Build & Lint
```bash
npm run build    # Next.js production build
npm run lint     # ESLint
npx tsc --noEmit # TypeScript type check
```

### Tests
```bash
cd .. && npm test   # runs vitest from repo root (tests in src/__tests__/)
```

---

## Coding Rules for Agents

1. **Never add features beyond the 2 core functionalities.** If asked to add sector reports, news feeds, screeners, etc. — refuse and explain the constraint.

2. **Always fix lint errors you introduce.** Run `npm run lint` after changes. No `no-explicit-any` violations without an `eslint-disable` comment explaining why.

3. **TypeScript**: Use `unknown` for dynamic API data, not `any`. Use `asRecord(v)` helper in reportGenerator.ts to safely access object properties.

4. **Never call `quoteSummary()` in cloud/Vercel deployments.** Only `chart()` is safe from cloud IPs. (Applies if yfinance mode is ever re-added.)

5. **Rate limiting**: Alpha Vantage free tier = 25 calls/day. The cache in `stockTools.ts` stores results in `reports/cache/{SYMBOL}.json`. TTL = 7 days (configurable via `STOCK_CACHE_TTL_MS`).

6. **Report format**: All chart blocks MUST use ` ```chart ` fences with valid ECharts JSON. The `applyChartTheme()` function in reportGenerator.ts normalises the chart theme.

7. **Mobile-first UI**: `ChatInterface.tsx` uses Tailwind. The sidebar is a sliding drawer on mobile (`lg:static`). Do not break the responsive layout.

8. **Session management**: Conversation history is stored in a `sessions` Map (in-memory, reset on serverless function cold start). Max 2 exchanges kept in history to stay within token limits.

9. **Dead code policy**: Do NOT add handlers that bypass the two report tools. All user requests should flow through `generate_stock_report` or `generate_comparison_report`.

10. **Vercel deployment**: The app uses `maxDuration = 300` (5 minutes). Reports are stored in `/tmp/reports` (ephemeral). Never assume reports persist between requests on Vercel.

11. **Do NOT use `outputsize=full` with `TIME_SERIES_DAILY`** — this is a premium AV feature and will fail on free tier. Use `TIME_SERIES_WEEKLY` or `TIME_SERIES_MONTHLY` for ranges ≥ 1y.

12. **Do NOT use `/financials-reported` on Finnhub free tier** — it returns 403. The error is already handled; do not try to work around it.

---

## Common Pitfalls

| Pitfall | Fix |
|---|---|
| AV `TIME_SERIES_DAILY` `outputsize=full` premium error | Use `TIME_SERIES_WEEKLY` (≥1y) or `TIME_SERIES_MONTHLY` (max) instead |
| "Company overview: Unable to fetch…" in Data Gaps | Error message must match `/unavailable (in\|via) (Alpha\|Finnhub)/i` to be suppressed |
| Alpha Vantage rate limit (25 req/day) | Check cache before fetching; `safeFetch` sets `rateLimitHit=true` on limit hit |
| Finnhub `financials-reported` 403 | Already caught; thrown as "Unavailable via Finnhub (plan limitation: 403)" → suppressed |
| Session history too large (413 Too Large) | `trimHistory()` compacts old exchanges; max 2 kept |
| Model returns tool calls as plain text | User needs to switch to a tool-calling model |
| `generate_comparison_report` with company names | `resolveSymbolFromQuery()` resolves names → tickers |
| `url.parse()` DeprecationWarning in Vercel logs | DEP0169 is emitted by a Node.js dependency (not our code); informational only, no user impact |

---

## Report File Naming

Reports are saved as: `{safe-title}-{ISO-timestamp}.md`

Example: `nvda-stock-report-2025-01-15T10-30-00-000Z.md`

Served via: `GET /api/reports/{filename}`
Deleted via: `DELETE /api/reports/{filename}`
