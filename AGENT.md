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
| `ALPHA_VANTAGE_API_KEY` | Yes (unless `STOCK_DATA_PROVIDER=yfinance`) | Financial data |
| `STOCK_DATA_PROVIDER` | No | `alphavantage` (default), `yfinance`, or `hybrid` |
| `OPENAI_API_KEY` | No | Alternative AI provider via proxy |
| `OPENAI_PROXY_BASE_URL` | No | Custom OpenAI-compatible proxy URL |
| `COPILOT_MODEL` | No | Override default model (default: `openai/gpt-4.1`) |
| `REPORTS_DIR` | No | Reports output directory (default: `reports/` or `/tmp/reports` on Vercel) |

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

---

## Coding Rules for Agents

1. **Never add features beyond the 2 core functionalities.** If asked to add sector reports, news feeds, screeners, etc. — refuse and explain the constraint.

2. **Always fix lint errors you introduce.** Run `npm run lint` after changes. No `no-explicit-any` violations without an `eslint-disable` comment explaining why.

3. **TypeScript**: Use `unknown` for dynamic API data, not `any`. Use `asRecord(v)` helper in reportGenerator.ts to safely access object properties.

4. **Never call `quoteSummary()` in cloud/Vercel deployments.** Only `chart()` is safe from cloud IPs.

5. **Rate limiting**: Alpha Vantage free tier = 25 calls/day. The cache in `stockTools.ts` stores results in `reports/cache/{SYMBOL}.json`. TTL = 7 days (configurable via `STOCK_CACHE_TTL_MS`).

6. **Report format**: All chart blocks MUST use ` ```chart ` fences with valid ECharts JSON. The `applyChartTheme()` function in reportGenerator.ts normalises the chart theme.

7. **Mobile-first UI**: `ChatInterface.tsx` uses Tailwind. The sidebar is a sliding drawer on mobile (`lg:static`). Do not break the responsive layout.

8. **Session management**: Conversation history is stored in a `sessions` Map (in-memory, reset on serverless function cold start). Max 2 exchanges kept in history to stay within token limits.

9. **Dead code policy**: Do NOT add handlers that bypass the two report tools. All user requests should flow through `generate_stock_report` or `generate_comparison_report`.

10. **Vercel deployment**: The app uses `maxDuration = 300` (5 minutes). Reports are stored in `/tmp/reports` (ephemeral). Never assume reports persist between requests on Vercel.

---

## Common Pitfalls

| Pitfall | Fix |
|---|---|
| Yahoo Finance `quoteSummary()` 401 on Vercel | Use `chart()` only for cloud deployments |
| Alpha Vantage rate limit (25 req/day) | Check cache before fetching; use `safeFetch` wrapper |
| Session history too large (413 Too Large) | `trimHistory()` compacts old exchanges; max 2 kept |
| Model returns tool calls as plain text | User needs to switch to a tool-calling model |
| `generate_comparison_report` with company names | `resolveSymbolFromQuery()` resolves names → tickers |

---

## Report File Naming

Reports are saved as: `{safe-title}-{ISO-timestamp}.md`

Example: `nvda-stock-report-2025-01-15T10-30-00-000Z.md`

Served via: `GET /api/reports/{filename}`
Deleted via: `DELETE /api/reports/{filename}`
