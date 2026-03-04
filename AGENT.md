# AGENT.md — Architecture Reference for Copilot Agents & Developers

> **Authoritative reference for every agent or developer working in this repository.**
> Read this before touching any code. The architecture has specific opinions — understand them before changing anything.

---

## 🧠 Core Philosophy

> **The LLM is the intelligence. Tools are data sources. The LLM gathers, reasons, fills gaps, and writes every report itself.**

- The LLM decides what data it needs.
- It calls individual, granular data tools to fetch that data.
- It synthesises the raw results using its own reasoning.
- It writes the full markdown report itself.
- It saves the artifact via `save_report(title, content)`.
- After saving, it sends **one sentence** in chat confirming the artifact was saved — it does **not** reproduce the report in chat.

This design maximises report quality while keeping the backend simple (tools are pure data fetchers with no report logic).

---

## 📁 Repository Layout

```
test-sdk/
├── src/                        # CLI application (legacy; uses its own copies of service files)
├── web/                        # Next.js 16 web app (primary product)
│   ├── app/
│   │   ├── api/chat/route.ts   # LLM orchestration + tool routing
│   │   ├── components/ChatInterface.tsx
│   │   └── lib/
│   │       ├── stockDataService.ts   # Data provider abstraction (AV / Finnhub / Hybrid)
│   │       ├── stockTools.ts         # Tool schemas, executeTool(), save_report handler
│   │       └── reportGenerator.ts    # saveReport() only — persists markdown to disk
│   └── package.json
├── AGENT.md                    # ← this file
├── CHANGELOG.md
└── README.md
```

---

## 🔄 Report Workflow

```
User message
  → POST /api/chat (route.ts)
      → selectToolNames(message)   isReport? → REPORT_TOOL_NAMES; else DEFAULT_TOOL_NAMES
      ┌─ LLM tool-calling loop (MAX_TOOL_ROUNDS = 30) ──────────────────────────┐
      │  Round 1: LLM fires ALL data tools for all requested stocks IN PARALLEL  │
      │  Round 2+: LLM makes targeted calls to fill any null / N/A fields        │
      │  Final round: LLM calls save_report(title, markdownItWrote)              │
      └─────────────────────────────────────────────────────────────────────────┘
  → Artifact captured from save_report result
  → Report modal auto-opens in browser
  → Chat response = one-sentence confirmation only
```

### isReport detection

`selectToolNames` sets `isReport = true` when the message contains any of:
`report` · `compare` · `comparison` · `analysis` · `analyses` · `research` · `deep-dive`

---

## 🛠️ Tool System (`web/app/lib/stockTools.ts`)

### Key Functions

| Function | Purpose |
|---|---|
| `buildToolDefinitions()` | Returns all tool schemas (passed to LLM on each request) |
| `getToolDefinitionsByName(names)` | Filters to an allowed subset |
| `executeTool(name, args, service)` | Central dispatcher; routes tool name → handler |

### Individual Data Tools (used in reports)

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
| `search_news` | News search by keyword |
| `search_companies` | Company search by keyword |

### Saving Reports

| Tool | Purpose |
|---|---|
| `save_report` | Accepts `{title, content}` (markdown the LLM wrote), sanitises filename, saves to `REPORTS_DIR`, returns `{filename, content, downloadUrl}` |

### Tools NOT in REPORT_TOOL_NAMES (reserved for future sector analysis)

`get_sector_performance` · `get_stocks_by_sector` · `screen_stocks` · `get_top_gainers_losers`

These tools exist in `stockDataService.ts` and `stockTools.ts` but are intentionally excluded from both `REPORT_TOOL_NAMES` and `DEFAULT_TOOL_NAMES`. They will be re-enabled when sector analysis is added.

---

## 📐 Report Structure

The LLM writes these sections itself from the data it collected. Do not deviate when modifying prompts.

### Single-Stock Report

1. **Snapshot** — price, change%, market cap, sector, industry, 52-week range
2. **Business** — description, business model, peer set
3. **Key Metrics** — PE, EPS, gross/op margin, ROE, revenue growth, FCF yield, net debt/equity
4. **Financials** — income statement 4-quarter table, balance sheet, FCF = OpCF − CapEx = $X
5. **Earnings Trend** — EPS actual vs estimate, beat/miss, last 4 quarters
6. **Analyst View** — buy/hold/sell counts, mean target, upside%
7. **Risks** — macro, competitive, regulatory, company-specific
8. **Scorecard** — Growth / Profitability / Valuation / Momentum + overall verdict

### Comparison Report

1. **Data Sources** — per-company table showing provider for each data type
2. **Snapshot** — Company | Price | Day Change | Market Cap | Sector | Industry | 52W Range
3. **Scale & Profitability** — Revenue TTM, Gross Margin, Operating Margin, ROE
4. **Growth & Momentum** — Revenue Growth TTM, EPS Growth TTM, 1y Price Change
5. **Valuation** — P/E, Forward P/E, PEG, Price/Sales, Price/Book
6. **Balance Sheet & Cash** — Cash, Total Debt, Net Debt, Free Cash Flow
7. **Analyst View** — Mean Target, Upside%, SB/B/H/S/SS ratings
8. **Analyst Picks** — Highest upside + strongest consensus bullets
9. **Data Coverage** — ✅/❌ table showing chart input availability
10. **Price Performance (Indexed)** — ECharts line chart, all series start at 100
11. **Valuation vs Growth** — ECharts scatter: x=Rev Growth%, y=P/E, size=market cap
12. **Margin Comparison** — ECharts grouped bar: Gross Margin% and Op Margin% per company
13. **Indicative Allocation** — Composite score + normalized weight + rationale + disclaimer

---

## 🌐 Data Layer (`web/app/lib/stockDataService.ts`)

### Three Providers

| Provider | Class | When used |
|---|---|---|
| Alpha Vantage | `AlphaVantageService` | `STOCK_DATA_PROVIDER=alphavantage` (default) |
| Finnhub | `FinnhubService` | `STOCK_DATA_PROVIDER=finnhub` |
| Hybrid | `HybridStockDataService` | `STOCK_DATA_PROVIDER=hybrid` **or** both AV + Finnhub keys present (auto-upgrade) |

### Hybrid Merge Logic

`HybridStockDataService` merges AV + Finnhub field-by-field: AV wins on any non-null, non-`"N/A"` value; Finnhub fills the rest.

### Caching

- **Location**: `/tmp/reports/cache/` (Vercel) or `reports/cache/` (local)
- **TTL**: `STOCK_CACHE_TTL_MS` (default: 7 days)

---

## 🗺️ Route Architecture (`web/app/api/chat/route.ts`)

### Tool Set Selection

```
selectToolNames(message)
  → isReport? (keywords: report/compare/comparison/analysis/analyses/research/deep-dive)
      Yes → REPORT_TOOL_NAMES   (all individual data tools + save_report)
      No  → DEFAULT_TOOL_NAMES  (quick-query subset, no save_report)
```

### LLM Tool-Calling Loop

- `MAX_TOOL_ROUNDS = 30`
- All tool calls in a single LLM round execute **in parallel**
- Report artifacts are captured from `save_report` result → auto-open in browser
- Loop exits when the LLM returns no further tool calls

---

## ⚠️ Critical Rules — What NOT To Do

| Rule | Reason |
|---|---|
| **Never pass raw company names to data APIs** | APIs require exact tickers — always resolve via `search_stock` first |
| **Never invent, estimate, or guess data** | Mark field `—` only after exhausting all relevant tools |
| **Never reproduce the report in the chat response** | After `save_report`, one-sentence confirmation only |
| **Never add report-building logic to tool handlers** | The LLM writes reports; tools are pure data fetchers |

---

## 🔑 Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | ✅ | — | PAT with GitHub Models read permission |
| `ALPHA_VANTAGE_API_KEY` | ✅ (AV/hybrid) | — | Free tier from alphavantage.co |
| `FINNHUB_API_KEY` | ✅ (Finnhub/hybrid) | — | Free tier from finnhub.io; setting alongside AV auto-enables hybrid |
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
```

---

## 🧩 Extending the System

### Adding a new data tool

1. Add the tool schema to `buildToolDefinitions()` in `stockTools.ts`.
2. Add a `case 'tool_name':` handler in `executeTool()`.
3. Implement the data method in `stockDataService.ts` for all three providers.
4. Add the tool name to `REPORT_TOOL_NAMES` in `route.ts`.

### Adding sector analysis (planned)

Re-enable `get_sector_performance`, `get_stocks_by_sector`, `screen_stocks`, `get_top_gainers_losers` by adding them back to `REPORT_TOOL_NAMES` and `DEFAULT_TOOL_NAMES`, add Quick Research entries, and extend the system prompt with sector-report structure.

### Adding a new provider

1. Create a class implementing `StockDataService` in `stockDataService.ts`.
2. Add a branch to the provider factory at the bottom of the file.
3. Update the `STOCK_DATA_PROVIDER` env-var documentation.

---

## ⚡ Deployment (Vercel)

- **Root directory**: `web`
- **Framework**: Next.js (auto-detected)
- **Function timeout**: 300 s (`maxDuration = 300` in chat route)
- **Reports**: written to `/tmp/reports/` (ephemeral; download links valid within the same instance lifetime)
