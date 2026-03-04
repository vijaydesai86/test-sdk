# AGENT.md — Technical Reference for Copilot Agents & Automated Workflows

> This file is the authoritative technical reference for any AI agent (GitHub Copilot, automated PR bots, etc.) working on this repository. Read this before making any code changes.

---

## 📁 Repository Layout

```
test-sdk/
├── src/                        # CLI application (Node.js / TypeScript)
│   ├── index.ts                # CLI entry point (REPL loop)
│   ├── stockTools.ts           # Tool definitions for CLI
│   ├── stockDataService.ts     # Stock data API client (CLI version)
│   └── reportGenerator.ts     # Report builder (CLI version)
├── web/                        # Next.js 16 web application (primary product)
│   ├── app/
│   │   ├── api/
│   │   │   ├── chat/route.ts   # POST /api/chat  — LLM orchestration + tool routing
│   │   │   ├── reports/[filename]/route.ts  — GET/DELETE report files
│   │   │   ├── providers/      # GET /api/providers — model catalog
│   │   │   ├── health/         # GET /api/health
│   │   │   └── models/         # GET /api/models
│   │   ├── components/
│   │   │   └── ChatInterface.tsx  # Main React UI (chat + sidebar + report modal)
│   │   ├── lib/
│   │   │   ├── stockDataService.ts   # Stock data provider abstraction
│   │   │   ├── stockTools.ts         # Tool definitions + executeTool() dispatcher
│   │   │   └── reportGenerator.ts    # Markdown + ECharts report builders
│   │   ├── globals.css         # Tailwind base + prose/report styles
│   │   ├── layout.tsx          # Root layout (metadata, viewport)
│   │   └── page.tsx            # Root page (renders ChatInterface)
│   ├── public/reports/         # Static sample reports
│   └── package.json
├── AGENT.md                    # ← this file
├── README.md
├── QUICKSTART.md
└── vercel.json
```

---

## 🧠 Core Architecture

### Request Flow

```
User message (browser)
  → POST /api/chat
    → parseReportRequest()   — fast-path for obvious sector/all-caps-ticker reports
    → parseComparisonCompanies()  — detect "compare X and Y" pattern
    → [direct tool dispatch] — for clearly-typed requests (price, news, etc.)
    → [LLM tool-calling loop] — for everything else (GitHub Models / OpenAI proxy)
         ↓ tool calls
       executeTool(name, args, stockService)
         ↓ results fed back to LLM
       repeat until no more tool calls
  → JSON response { response, sessionId, model, report?, stats }
```

### Ticker Resolution Strategy

**Critical rule**: Never pass raw user input (company names) directly to data APIs. Always resolve first.

- **All-caps 1–5 char input** (e.g. `AAPL`): routed directly as a ticker.
- **Company name / mixed case** (e.g. `Apple`, `Microsoft`): falls through to LLM. The LLM calls `search_stock` first, gets the ticker, then calls the report tool with the correct symbol.
- **`resolveSymbolFromQuery(stockService, query)`** (`stockTools.ts`): used inside tool handlers to resolve names → tickers via `searchStock()` + fuzzy scoring. Called by `generate_stock_report` and `generate_comparison_report`.
- **`scoreSearchMatch(query, item)`**: scoring function — exact symbol match = 100 pts, name prefix = 70 pts, name contains = 50 pts, US region/USD = +10 each. Score ≥ 60 needed for non-ambiguous resolution.

### Comparison Report

- Accepts up to **10** company names or tickers.
- Each name resolved independently via `resolveSymbolFromQuery`.
- Ambiguous names return an error listing candidates.

---

## 🛠️ Tool System

### Tool Definitions (`web/app/lib/stockTools.ts`)

All tools defined in `buildToolDefinitions()` and dispatched in `executeTool()`. Key tools:

| Tool | Description |
|---|---|
| `search_stock` | Search US stock by name or ticker |
| `get_stock_price` | Current price, change, volume |
| `get_company_overview` | Fundamentals: PE, EPS, margins, sector, description |
| `get_basic_financials` | Detailed ratios and metric series |
| `get_price_history` | OHLCV data; range: `1w/1m/3m/6m/1y/3y/5y/max` |
| `get_earnings_history` | Quarterly EPS with beat/miss |
| `get_income_statement` | Revenue, gross profit, operating income, net income |
| `get_balance_sheet` | Assets, liabilities, equity, cash, debt |
| `get_cash_flow` | Operating CF, CapEx, FCF |
| `get_analyst_ratings` | Strong Buy/Buy/Hold/Sell/Strong Sell counts + target |
| `get_price_targets` | High/low/mean/median analyst targets |
| `get_peers` | Peer tickers for a stock |
| `get_news_sentiment` | News headlines + sentiment scores |
| `get_company_news` | Recent news articles |
| `search_news` | Keyword news search |
| `get_sector_performance` | 11 GICS sectors across 1D/5D/1M/3M/YTD/1Y |
| `get_stocks_by_sector` | Stocks by sector name |
| `screen_stocks` | Advanced screener (sector, industry, market cap) |
| `get_top_gainers_losers` | Today's top movers |
| `generate_stock_report` | Full single-stock research report (markdown artifact) |
| `generate_comparison_report` | Multi-company comparison (2–10 companies) |
| `generate_sector_report` | Sector/theme research report |
| `generate_peer_report` | Peer comparison report |

### Caching

- Per-symbol JSON cache in `CACHE_DIR` (`reports/cache/` local, `/tmp/reports/cache/` on Vercel).
- TTL: `STOCK_CACHE_TTL_MS` env var (default 7 days).
- Cache hit skips API call entirely (critical for rate-limit management on free Alpha Vantage tier).

---

## 📊 Report Generation (`web/app/lib/reportGenerator.ts`)

### Report Types

| Function | Output |
|---|---|
| `buildStockReport(data)` | Full equity research report with charts, KPIs, financials, scorecard |
| `buildSectorReport(data)` | Sector/theme report with company overview, analyst view, rankings |
| `buildPeerReport(data)` | Peer comparison with performance chart |
| `buildComparisonReport(data)` | Side-by-side comparison table + charts for 2–10 companies |
| `saveReport(content, title)` | Writes markdown to `REPORTS_DIR`; returns `{filePath, filename}` |

### Chart Rendering

Charts are embedded as fenced ` ```chart ``` ` blocks containing ECharts JSON options.  
The `ChartBlock` React component in `ChatInterface.tsx` renders them client-side using `echarts.init()`.  
Use `buildChartBlock(option)` to create a chart — it calls `applyChartTheme()` automatically.

**Theme**: Transparent background, indigo-first color palette (`#6366f1`, `#10b981`, `#f59e0b`, …), Inter font, dashed grey gridlines.

### Scorecard (`computeScorecard`)

Five components (0–100 each):
- **Growth** (25%): avg of revenue growth + EPS growth TTM
- **Profitability** (20%): avg of gross margin + operating margin + ROE
- **Valuation** (20%): `100 - (PE/50)*100` — lower PE = higher score
- **Momentum** (15%): `50 + price_change_%` clamped 0–100
- **Moat** (20%): avg of margin stability + pricing power + analyst conviction

---

## 🌐 Data Providers (`web/app/lib/stockDataService.ts`)

### Provider Selection

Set via `STOCK_DATA_PROVIDER` env var:
- `alphavantage` (default): Alpha Vantage REST API
- `finnhub`: Finnhub REST API
- `hybrid`: Alpha Vantage primary, Finnhub fills gaps

### Alpha Vantage Notes

- Free tier: 5 API calls/minute, 500/day.
- `quoteSummary`-equivalent endpoints blocked from cloud IPs (Vercel). Only use endpoints that work from cloud:
  - `TIME_SERIES_DAILY_ADJUSTED` ✅
  - `OVERVIEW` ✅
  - `INCOME_STATEMENT` / `BALANCE_SHEET` / `CASH_FLOW` ✅
  - `EARNINGS` ✅
  - `SYMBOL_SEARCH` ✅
- Rate limit detected by: `"Thank you for using Alpha Vantage"` in response body.

### Finnhub Notes

- `getPeers`, `getAnalystRecommendations`, `getBasicFinancials`, `getPriceTargets` use Finnhub when key present.
- `chart()` endpoint does not require crumb auth — safe from cloud IPs.

---

## 🖥️ Frontend (`web/app/components/ChatInterface.tsx`)

### Responsive Layout

| Breakpoint | Layout |
|---|---|
| Mobile (`< lg`) | Single column; sidebar is a slide-in drawer triggered by hamburger icon |
| Desktop (`≥ lg`) | Two-column: 256px sidebar + main chat area |
| Modal (report preview) | Full-screen sheet on mobile, centred dialog on tablet/desktop |

### Key State

| State | Purpose |
|---|---|
| `messages` | Conversation history |
| `sessionId` | Server-side session key for multi-turn context |
| `savedReports` | Artifacts list (filename + content + downloadUrl) |
| `reportPreview` | Content of currently-open report modal |
| `sidebarOpen` | Mobile drawer toggle |

### Auto-resize textarea

The message input auto-expands up to 128px (8 lines) then scrolls. Reset on send.

---

## 🔑 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | Yes (GitHub provider) | PAT with Models read permission |
| `ALPHA_VANTAGE_API_KEY` | Yes (alphavantage/hybrid) | Free from alphavantage.co |
| `FINNHUB_API_KEY` | Yes (finnhub/hybrid) | Free from finnhub.io |
| `OPENAI_API_KEY` | No | For openai-proxy provider |
| `STOCK_DATA_PROVIDER` | No | `alphavantage` (default) / `finnhub` / `hybrid` |
| `COPILOT_MODEL` | No | Default LLM model (default: `openai/gpt-4.1`) |
| `COPILOT_FALLBACK_MODEL` | No | Fallback if primary fails |
| `REPORTS_DIR` | No | Report output directory (auto-set for Vercel) |
| `STOCK_CACHE_TTL_MS` | No | Cache TTL in ms (default: 7 days) |
| `MAX_TOOL_ROUNDS` | No | Max LLM tool-call rounds per request (default: 30) |

---

## 🏗️ Build & Dev

```bash
# Web app
cd web
npm install
npm run dev          # http://localhost:3000
npm run build        # production build (Next.js)
npm run lint         # ESLint

# CLI (optional)
cd ..
npm install
npm run build        # tsc
npm run dev          # REPL
```

---

## ⚡ Vercel Deployment

- **Root directory**: `web`
- **Framework**: Next.js (auto-detected)
- **Function timeout**: 300s (`maxDuration = 300` in chat route)
- **Runtime**: `nodejs`
- Reports written to `/tmp/reports/` (ephemeral — lost on cold start; download links work within the same instance lifetime)

---

## 🔒 Security Notes

- No user input is passed directly to stock API calls — always goes through `resolveSymbolFromQuery` or LLM tool-calling.
- Session data stored in server-side in-memory `Map` (cleared on cold start). No PII persisted.
- GitHub token used only for GitHub Models API calls; never exposed to the client.
- CORS: Next.js default (same-origin only for API routes).

---

## 🧩 Extending the System

### Adding a new data tool

1. Add tool definition object to `buildToolDefinitions()` in `stockTools.ts`.
2. Add a `case 'tool_name':` handler in `executeTool()`.
3. Add the tool name to `REPORT_TOOL_NAMES` or `DEFAULT_TOOL_NAMES` in `route.ts` as appropriate.
4. Implement the data method in `stockDataService.ts`.

### Adding a new report type

1. Define the data interface in `reportGenerator.ts`.
2. Implement `buildXxxReport(data)` function.
3. Add a tool entry (e.g. `generate_xxx_report`) that calls `buildXxxReport` and `saveReport`.
4. Add to `REPORT_TOOL_NAMES` in `route.ts`.

### Changing the chart palette

Edit `applyChartTheme()` in `reportGenerator.ts` — the `color` array is the ECharts series color list.
