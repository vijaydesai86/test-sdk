# AGENT.md — Architecture Reference for Copilot Agents & Developers

> **Authoritative reference for every agent or developer working in this repository.**  
> Read this before touching any code. The architecture has specific opinions — understand them before changing anything.

---

## 🧠 Core Philosophy

> **The LLM is the intelligence. Tools are data sources. The LLM gathers, reasons, fills gaps, and writes every report itself.**

This is not a system where a backend function assembles a report from data and hands it to the LLM to narrate. Instead:

- The LLM decides what data it needs.
- It calls individual, granular data tools to fetch that data.
- It synthesises the raw results using its own reasoning.
- It writes the full markdown report itself.
- It saves the artifact via `save_report(title, content)`.

This design maximises report quality (the LLM can reason about gaps, spot inconsistencies, and apply judgment) while keeping the backend simple (tools are pure data fetchers with no report logic).

---

## 📁 Repository Layout

```
test-sdk/
├── src/                        # CLI application
├── web/                        # Next.js 16 web app (primary product)
│   ├── app/
│   │   ├── api/chat/route.ts   # LLM orchestration + tool routing
│   │   ├── components/ChatInterface.tsx
│   │   └── lib/
│   │       ├── stockDataService.ts   # Data provider abstraction (AV / Finnhub / Hybrid)
│   │       ├── stockTools.ts         # Tool schemas, executeTool(), caching helpers
│   │       └── reportGenerator.ts    # Fallback/legacy report builders only
│   └── package.json
├── AGENT.md                    # ← this file
├── README.md
└── QUICKSTART.md
```

---

## 🔄 Report Workflow

The complete flow for a user asking for any equity report:

```
User message
  → POST /api/chat (route.ts)
      → parseReportRequest()       fast-path: sector keywords / all-caps tickers
      → selectToolNames(message)   picks tool set; isReport → REPORT_TOOL_NAMES
      ┌─ LLM tool-calling loop (MAX_TOOL_ROUNDS = 30) ──────────────────────────┐
      │  Round 1: LLM fires ALL data tools for all requested stocks IN PARALLEL  │
      │  Round 2+: LLM makes targeted calls to fill any null / N/A fields        │
      │  Final round: LLM calls save_report(title, markdownItWrote)              │
      └─────────────────────────────────────────────────────────────────────────┘
  → Artifact captured from save_report result → Artifacts panel in UI
```

### Why parallel rounds?

Firing all tools simultaneously (one round per LLM iteration) keeps latency low while respecting the LLM's ability to scan results and decide what follow-up calls are actually needed. The LLM does not guess — it fetches, inspects, then fetches again for any gaps.

---

## 🛠️ Tool System (`web/app/lib/stockTools.ts`)

### Key Functions

| Function | Purpose |
|---|---|
| `buildToolDefinitions()` | Returns all tool schemas (passed to LLM on each request) |
| `getToolDefinitionsByName(names)` | Filters to an allowed subset |
| `executeTool(name, args, service)` | Central dispatcher; routes tool name → handler |
| `cacheToolResult(symbol, key, data)` | Writes fetched data to per-symbol file cache |
| `resolveSymbolFromQuery(service, query)` | Resolves company name → ticker via `search_stock` + scoring |
| `scoreSearchMatch(query, item)` | Scoring: exact symbol = 100, name match = 90/70/50, US/USD bonus |

### Individual Data Tools

These are the tools the LLM calls to gather raw data. Each is a pure data fetcher.

| Tool | Returns |
|---|---|
| `search_stock` | Resolve company name → ticker |
| `get_stock_price` | Current price, change%, volume |
| `get_company_overview` | PE, EPS, margins, sector, industry, description |
| `get_basic_financials` | Detailed ratios and metric series |
| `get_price_history` | OHLCV; range: `1w/1m/3m/6m/1y/3y/5y/max` |
| `get_earnings_history` | Quarterly EPS actual vs estimate, beat/miss |
| `get_income_statement` | Revenue, gross profit, operating income, net income (4-qtr) |
| `get_balance_sheet` | Assets, liabilities, equity, cash, debt |
| `get_cash_flow` | Operating CF, CapEx, FCF |
| `get_analyst_ratings` | Strong Buy/Buy/Hold/Sell/Strong Sell counts |
| `get_analyst_recommendations` | Recommendation trends over time |
| `get_price_targets` | High/low/mean/median analyst price targets |
| `get_peers` | Peer tickers |
| `get_insider_trading` | Recent insider buy/sell transactions |
| `get_news_sentiment` | Headlines + sentiment scores |
| `get_company_news` | Recent news articles |

### Saving Reports

| Tool | Purpose |
|---|---|
| `save_report` | Accepts `{title, content}` (markdown the LLM wrote), sanitises filename, saves to `REPORTS_DIR`, returns `{filename, content, downloadUrl}` |

### Legacy / Fallback Tools

All `generate_*_report` tools (`generate_stock_report`, `generate_comparison_report`, `generate_sector_report`, `generate_peer_report`) have been **removed**. The LLM gathers data using individual tools and writes reports itself, then saves via `save_report`.

---

## 📐 Report Structure

The LLM writes these sections itself from the data it collected. These are the expected structures — do not deviate when adding prompts or modifying the system prompt.

### Single-Stock Report

1. **Snapshot** — price, change%, market cap, sector, industry, 52-week range
2. **Business** — description, business model, peer set
3. **Key Metrics** — PE, EPS, gross/op margin, ROE, revenue growth, FCF yield, net debt/equity
4. **Financials** — income statement 4-quarter table, balance sheet, FCF calculation
5. **Earnings Trend** — EPS actual vs estimate, beat/miss, last 4 quarters
6. **Analyst View** — buy/hold/sell counts, mean target, upside%
7. **Risks** — macro, competitive, regulatory, company-specific
8. **Scorecard** — Growth / Profitability / Valuation / Momentum + overall verdict

### Comparison Report

1. **Snapshot Table** — name, ticker, price, change%, market cap, sector
2. **Key Metrics Table** — PE, EPS, gross margin, op margin, ROE, revenue growth
3. **Balance & Cash Table** — total assets, debt, cash, FCF
4. **Analyst View** — mean target, upside%, buy/hold/sell per company
5. **Verdict** — winner per category + overall pick with rationale

---

## 🌐 Data Layer (`web/app/lib/stockDataService.ts`)

### Three Providers

| Provider | Class | When used |
|---|---|---|
| Alpha Vantage | `AlphaVantageService` | `STOCK_DATA_PROVIDER=alphavantage` (default) |
| Finnhub | `FinnhubService` | `STOCK_DATA_PROVIDER=finnhub` |
| Hybrid | `HybridStockDataService` | `STOCK_DATA_PROVIDER=hybrid` **or** `FINNHUB_API_KEY` set alongside AV key (auto-upgrade) |

### Auto-Upgrade to Hybrid

If both `ALPHA_VANTAGE_API_KEY` and `FINNHUB_API_KEY` are present, the service automatically uses `HybridStockDataService` regardless of `STOCK_DATA_PROVIDER`. This ensures the best data coverage without manual configuration.

### Hybrid Merge Logic

`HybridStockDataService.getCompanyOverview` and `getBasicFinancials` merge results from both providers **field-by-field**:

- Primary provider (Alpha Vantage) wins on any non-null, non-`"N/A"` value.
- Secondary provider (Finnhub) fills any field the primary returned null or `"N/A"` for.
- This applies recursively to nested metric sub-objects.

### Caching

- **Location**: `/tmp/reports/cache/` (Vercel) or `reports/cache/` (local)
- **Key**: per-symbol JSON file via `loadSymbolCache` / `saveSymbolCache`
- **TTL**: `STOCK_CACHE_TTL_MS` (default: 7 days)
- **Written by**: all individual tool handlers via `cacheToolResult(symbol, key, data)` — so pre-fetched data is immediately available to any subsequent call in the same request or later requests

---

## 🗺️ Route Architecture (`web/app/api/chat/route.ts`)

### Tool Set Selection

```
selectToolNames(message)
  → isReport? (keywords: report/compare/comparison/analysis/analyses)
      Yes → REPORT_TOOL_NAMES   (all individual data tools + save_report)
      No  → DEFAULT_TOOL_NAMES  (11 tools for quick queries)
```

### LLM Tool-Calling Loop

- `MAX_TOOL_ROUNDS = 30`
- All tool calls returned in a single LLM round are executed **in parallel**
- Report artifacts are captured from any tool returning `{filename, content, downloadUrl}`
- Loop exits when the LLM returns no further tool calls

---

## ⚠️ Critical Rules — What NOT To Do

These constraints exist for correctness and data integrity. Violating them produces broken or hallucinated reports.

| Rule | Reason |
|---|---|
| **Never pass raw company names to data APIs** | APIs require exact tickers — always resolve via `search_stock` first |
| **Never invent, estimate, or guess data** | If a field is unavailable after exhausting relevant tools, mark it genuinely unavailable — do not fabricate values |
| **Never mark a field N/A without trying all relevant tools first** | Multiple tools may cover the same field; exhaust them before giving up |

---

## 🔑 Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | ✅ | — | PAT with GitHub Models read permission |
| `ALPHA_VANTAGE_API_KEY` | ✅ (AV/hybrid) | — | Free tier from alphavantage.co |
| `FINNHUB_API_KEY` | ✅ (Finnhub/hybrid) | — | Free tier from finnhub.io; setting this alongside AV auto-enables hybrid |
| `STOCK_DATA_PROVIDER` | No | `alphavantage` | `alphavantage` / `finnhub` / `hybrid` |
| `COPILOT_MODEL` | No | `openai/gpt-4.1` | LLM model for report generation |
| `REPORTS_DIR` | No | `/tmp/reports` | Output directory for saved reports |
| `STOCK_CACHE_TTL_MS` | No | `604800000` (7 days) | Per-symbol cache TTL in milliseconds |

---

## 🏗️ Build Commands

```bash
# Web app (primary product)
cd web && npm install
npm run dev        # http://localhost:3000
npm run build      # Production build
npm run lint       # ESLint

# CLI (optional)
cd src && npm install && npm run build
```

---

## 🧩 Extending the System

### Adding a new data tool

1. Add the tool schema to `buildToolDefinitions()` in `stockTools.ts`.
2. Add a `case 'tool_name':` handler in `executeTool()` — call `cacheToolResult()` before returning.
3. Implement the data method in `stockDataService.ts` for all three providers (or add a sensible fallback).
4. Add the tool name to `REPORT_TOOL_NAMES` in `route.ts`.
5. **Do not add report-building logic to the handler** — the LLM does that.

### Adding a new provider

1. Create a class implementing the `StockDataService` interface in `stockDataService.ts`.
2. Add a branch to the provider factory at the bottom of the file.
3. Update the `STOCK_DATA_PROVIDER` env var documentation.

### Modifying report structure

Update the system prompt in `route.ts` (or the prompt injected before the LLM loop) to reflect the new expected sections. The LLM generates the content — there is no template to update in `reportGenerator.ts` for user-facing reports.

---

## ⚡ Deployment (Vercel)

- **Root directory**: `web`
- **Framework**: Next.js (auto-detected)
- **Function timeout**: 300 s (`maxDuration = 300` in chat route — required for multi-round tool loops)
- **Reports**: written to `/tmp/reports/` (ephemeral; download links valid within the same instance lifetime)
