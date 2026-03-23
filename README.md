# 📊 Stock Research Assistant

An AI-powered equity research platform. Ask questions in plain English — the LLM acts as the **final decision-maker**, orchestrating real-time data from multiple APIs, filling any gaps with verified knowledge, and delivering polished research reports.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/vijaydesai86/test-sdk&root-directory=web&env=GITHUB_TOKEN&envDescription=GitHub%20token%20for%20Copilot&envLink=https://github.com/settings/tokens)

> **Zero extra cost.** Uses your existing GitHub Copilot subscription + free API tiers.

---

## What It Does

### 1 · Stock Details
Ask about any stock. Get a complete research report: current price, price history chart, company overview, valuation ratios, financial statements (income, balance sheet, cash flow), EPS trend, analyst ratings, price targets, insider activity, news sentiment, and a composite scorecard.

### 2 · Stock Comparison
Give 2–6 companies. Get a side-by-side comparison across price, valuation, profitability, growth, and quality — with charts and a ranked scorecard.

### 3 · Top Stocks in a Sector
Name any sector or investment theme. The LLM selects the leading publicly-traded companies, fetches data for each, and delivers a ranked sector report.

### 4 · Deep Sector Research
The most powerful mode. Runs in four sequential phases:

```
You: "deep research on AI semiconductors"

Phase 1 ── LLM selects ~2× candidate tickers for the sector
            (e.g. 10 initial candidates for a 5-company final report)
Phase 2 ── Fetch real ecosystem data for every candidate:
            company overview · news sentiment · peer companies
Phase 3 ── LLM analyses supply-chain, customer, and competitive
            relationships from the fetched data; produces a Mermaid
            dependency diagram; refines the list down to the most
            strategically significant companies
Phase 4 ── Full financial comparison data fetched for refined list
         → buildDeepSectorReport() → saveReport()
```

The output includes the dependency analysis text, Mermaid ecosystem diagram, refinement rationale, and a full comparison report for the final company set.

### 5 · General Chat
Any question that doesn't fit the above — macro trends, industry news, "explain P/E ratio", "what is EBITDA" — is answered directly by the LLM using its knowledge.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Interface                                │
│         Web Chat (Next.js + React)          CLI (Node.js)               │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                   POST /api/chat
                           │
┌──────────────────────────▼──────────────────────────────────────────────┐
│                     LLM — Final Boss                                    │
│                  web/app/api/chat/route.ts                              │
│                                                                         │
│  • Parses intent: stock / compare / sector / deep sector / chat         │
│  • Resolves company names → official tickers (asks user if unsure)      │
│  • Decides which tools to call and in what order                        │
│  • Handles rate limits, retries, and model fallback transparently       │
│  • Stitches data from multiple sources into a coherent report           │
│  • Fills any remaining gaps using its own verified knowledge            │
└──────┬───────────────────────────────────────────────┬──────────────────┘
       │ Tool calls                                    │ Gap-fill prompts
       │                                               │
┌──────▼───────────────────┐             ┌─────────────▼──────────────────┐
│   Tool Dispatcher        │             │   LLM Gap-Fill (FILL_MODEL)    │
│   stockTools.ts          │             │                                │
│   33 data & report       │             │   • Ticker resolution          │
│   tools exposed to LLM   │             │   • Sector company selection   │
└──────┬───────────────────┘             │   • Dependency mapping         │
       │                                 │   • Null-field recovery        │
┌──────▼────────────────────────────┐    └────────────────────────────────┘
│         Hybrid Data Layer         │
│         stockDataService.ts       │
│                                   │
│  Alpha Vantage (primary)          │
│  • Fundamentals, financials,      │
│    earnings, price history,       │
│    sector data, movers,           │
│    commodities, forex, macro      │
│  • Free: 25 req/day, 5/min        │
│                    ↓ fallback     │
│  Finnhub (secondary)              │
│  • Quotes, profiles, analyst data │
│    insider trades, news, peers,   │
│    dividends, splits, calendars,  │
│    market status, candles         │
│  • Free: 60 req/min               │
│                    ↓ cache        │
│  7-day JSON cache per ticker      │
│                                   │
│  ── Supplementary Services ──     │
│  SEC EDGAR (no key needed)        │
│  • Recent filings: 8-K, 10-K,    │
│    10-Q, DEF14A + EDGAR links     │
│                                   │
│  FRED Federal Reserve (free key)  │
│  • VIX, S&P 500, yield curve,    │
│    CPI, PCE, unemployment, GDP,   │
│    mortgage rates, credit spreads │
│                                   │
│  CoinGecko (free / free key)      │
│  • Crypto prices, market caps,    │
│    rankings, historical changes   │
└──────┬────────────────────────────┘
       │
┌──────▼────────────────────────────┐
│        Report Generator           │
│        reportGenerator.ts         │
│                                   │
│  buildStockReport()               │
│  buildComparisonReport()          │
│  buildSectorReport()              │
│  buildDeepSectorReport()          │
│                                   │
│  ECharts interactive charts       │
│  Mermaid ecosystem diagrams       │
│  saveReport() → .md artifact      │
└───────────────────────────────────┘
```

### Ticker Resolution Flow
```
User: "research on google"
       │
       ▼
Code calls LLM first (buildTickerResolutionPrompt): "google" → GOOGL
(LLM prefers higher-liquidity share class: GOOGL over GOOG)
       │
       ├─ LLM resolved? ──► Use GOOGL directly
       │
       └─ LLM unavailable / no result ──► Fallback: call search_stock API
                                           │
                                           ├─ Clear winner? ──► Use it
                                           │
                                           └─ Ambiguous / no match?
                                               └─ Return error with candidates
                                                  LLM surfaces to user:
                                                  "Did you mean GOOGL or GOOG?"
                                                  User replies → task continues
```

### Data Completeness Flow
```
API fetch for all fields
       │
       ▼
Fields still null/undefined?
       │
       ├─ No ──► Build report
       │
       └─ Yes ──► LLM gap-fill (FILL_MODEL)
                  • Returns only values LLM can verify from training
                  • Returns null for anything uncertain — never fabricates
                  • Merged into data (never overwrites real API values)
                  │
                  ▼
                Build report (N/A only for truly unresolvable fields)
```

---

## Quick Start

### Deploy to Vercel (Recommended)

1. Click the **Deploy** button at the top of this page
2. Set **Root Directory** to `web`
3. Add required environment variables (see table below)
4. Deploy — your app is live at `https://your-app.vercel.app`

### Run Locally — Web

```bash
git clone https://github.com/vijaydesai86/test-sdk.git
cd test-sdk/web
npm install
cp .env.example .env.local   # then fill in the variables below
npm run dev
# Open http://localhost:3000
```

### Run Locally — CLI

```bash
git clone https://github.com/vijaydesai86/test-sdk.git
cd test-sdk
npm install
cp .env.example .env         # then fill in ALPHA_VANTAGE_API_KEY
npm run dev
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | Yes (unless `LLM_PROVIDER=gemini`) | — | GitHub Personal Access Token — authenticates GitHub Models API (your Copilot subscription). Get at [github.com/settings/tokens](https://github.com/settings/tokens) |
| `GEMINI_TOKEN` | Yes (when `LLM_PROVIDER=gemini` or `hybrid`) | — | Gemini API key — get a free key at [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys). **Must use AI Studio, not Google Cloud Console.** Free tier (gemini-2.5-flash): 5 RPM / 250K TPM / 20 RPD. **Never commit — set in Vercel env only.** |
| `LLM_PROVIDER` | No | `github` | LLM API provider: `github` (GitHub Models), `gemini` (Gemini API), or `hybrid` (GitHub primary, auto-falls back to Gemini on HTTP 429) |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model name. Default `gemini-2.5-flash` has free-tier quota on AI Studio keys. `gemini-2.0-flash` has **zero** free quota and will always fail. |
| `ALPHA_VANTAGE_API_KEY` | **Yes** | — | Free API key from [alphavantage.co](https://www.alphavantage.co/support/#api-key) — real-time quotes, fundamentals, financials, economic indicators, commodities, forex |
| `FINNHUB_API_KEY` | **Recommended** | — | Free key from [finnhub.io](https://finnhub.io) — enables hybrid fallback, plus dividends, splits, earnings/IPO calendars, market status |
| `FRED_API_KEY` | **Recommended** | — | Free key from [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html) — unlocks `get_market_indicators`: VIX, yield curve, S&P 500, CPI, PCE, unemployment, mortgage rates, credit spreads, consumer sentiment |
| `COINGECKO_API_KEY` | Optional | — | Free demo key from [coingecko.com](https://www.coingecko.com/en/api) — improves crypto rate limits from ~10 req/min to 30 req/min. App works without this key (just slower). |
| `STOCK_DATA_PROVIDER` | **Recommended** | `alphavantage` | `alphavantage`, `finnhub`, or **`hybrid`** — set to `hybrid` to use BOTH AV + Finnhub for maximum data coverage |
| `COPILOT_MODEL` | No | `openai/gpt-4.1` | Main reasoning model (GitHub Models name; ignored when `LLM_PROVIDER=gemini`) |
| `FILL_MODEL` | No | `openai/gpt-4.1-mini` | Lighter model for ticker resolution and gap-fill on GitHub Models (preserves main model quota) |
| `COPILOT_FALLBACK_MODEL` | No | same as main | Fallback model if main hits rate limit (GitHub Models only) |
| `REPORTS_DIR` | No | `/tmp/reports` | Report save directory (Vercel: ephemeral `/tmp`) |
| `STOCK_CACHE_TTL_MS` | No | `604800000` | Cache TTL in milliseconds (default: 7 days) |
| `NUM_COMPANIES` | No | `10` | Companies per comparison/sector/deep-sector report. Optimal: 10; raise to 15 for broader research, lower to 5 for faster runs |
| `DEEP_RESEARCH_DEPTH` | No | `2` | Recursive refinement passes in deep sector research. Each pass deepens analysis using prior results. Optimal: 2; set 1 to disable recursion |
| `ALPHA_VANTAGE_MIN_INTERVAL_MS` | No | `1200` | Minimum ms between Alpha Vantage requests |
| `FINNHUB_MIN_INTERVAL_MS` | No | `500` | Minimum ms between Finnhub requests |
| `HEALTH_CHECK_SYMBOL` | No | — | If set, `/api/health` makes a live API call with this ticker |

---

## Vercel Setup Guide

Based on your existing Vercel environment variables, here's exactly what to do:

### ✅ Already Configured
You have: `ALPHA_VANTAGE_API_KEY`, `FINNHUB_API_KEY`, `GEMINI_TOKEN`, `LLM_PROVIDER`, `NUM_COMPANIES`, `DEEP_RESEARCH_DEPTH`, `SUPABASE_*`, `DEBUG`

### 🔴 Critical — Set This Now
| Variable | Value | Why |
|---|---|---|
| `STOCK_DATA_PROVIDER` | `hybrid` | You have BOTH API keys — this tells the app to use them together. AV is primary, Finnhub fallbacks. Without this, you're only using Alpha Vantage. |

### 🟡 Recommended — Add for Best Reports
| Variable | How to Get | Why |
|---|---|---|
| `FRED_API_KEY` | Free at [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html) (instant signup) | Unlocks `get_market_indicators`: VIX, yield curve + recession signal, S&P 500, CPI, PCE, unemployment, mortgage rates, credit spreads. 18 macro series in one tool. Strictly required for serious macro analysis. |
| `COINGECKO_API_KEY` | Free at [coingecko.com](https://www.coingecko.com/en/api) → "Get API Key" | Improves crypto data rate limits (10→30 req/min). App works without it, just slower. |

### 🟢 Optional — Advanced Tuning
| Variable | Recommended Value | Why |
|---|---|---|
| `LLM_PROVIDER` | `gemini` (if no `GITHUB_TOKEN`) or `hybrid` (if you add `GITHUB_TOKEN`) | You already have `GEMINI_TOKEN` — if not also adding a GitHub token, set to `gemini` to avoid startup errors |
| `GITHUB_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens) | Adds GitHub Models as primary LLM with Gemini as fallback when using `hybrid` LLM mode |
| `NUM_COMPANIES` | `10` (current) or `15` for deeper research | Controls how many companies appear in sector reports |
| `DEEP_RESEARCH_DEPTH` | `2` (current) or `3` for maximum depth | More passes = deeper ecosystem analysis, slower reports |

### SEC EDGAR
No configuration needed. The `get_recent_filings` tool works immediately — it uses the SEC's public API with no key required.

---

## Example Queries

```
# Stock details + new tools
"Research NVDA — include technical indicators and recent SEC filings"
"Full report on Apple — show dividend history and insider transactions"
"What's Tesla's current PE ratio, RSI, and upcoming earnings date?"

# Market context
"What are current macro conditions? VIX, yield curve, inflation"
"Is the US market currently open? Show me today's biggest movers"
"What are commodity prices — oil, gas, copper?"
"USD to EUR and USD to JPY rates?"

# Crypto
"What's Bitcoin's current price and market stats?"
"Show me the top 10 cryptos by market cap"
"Compare Coinbase stock with BTC performance"

# Comparison
"Compare Microsoft, Google, and Meta"
"AAPL vs MSFT vs AMZN — which has the best margins?"

# Sector top stocks
"Top stocks in cloud computing"
"Best AI software companies to invest in"
"Who are the leaders in renewable energy?"

# Deep sector research
"Deep research on AI semiconductors — top 5"
"Full deep dive on cybersecurity sector"

# General chat
"Explain what free cash flow yield means"
"What's the difference between GAAP and non-GAAP earnings?"
"What macro factors are affecting the semiconductor sector?"
```

---

## Tests

```bash
# From repo root
npm test      # runs full vitest suite (src/__tests__/)
```

CI runs the full test suite on every pull request. All tests must pass before merging.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| Charts | ECharts 5 (interactive), Mermaid (ecosystem diagrams) |
| AI Orchestrator | GitHub Models API (`GITHUB_TOKEN`), Gemini API (`GEMINI_TOKEN`), or hybrid — controlled by `LLM_PROVIDER` |
| Data — Primary | Alpha Vantage REST API (free tier: fundamentals, financials, macro, commodities, forex) |
| Data — Fallback | Finnhub REST API (free tier: quotes, news, analyst data, dividends, splits, calendars) |
| Data — Macro | FRED Federal Reserve API (free key: VIX, yield curve, 18 macro series) |
| Data — Filings | SEC EDGAR (no key: recent 8-K/10-K/10-Q filing list + EDGAR links) |
| Data — Crypto | CoinGecko (free / free key: prices, market cap, rankings) |
| Data — Gap-fill | LLM knowledge (null fields only, never overwrites API data) |
| Report rendering | `react-markdown` + `remark-gfm` in chat UI |
| Deployment | Vercel (Node.js runtime, 5-minute max function duration) |
| CLI | Node.js + `@github/copilot-sdk` |
| Tests | Vitest (`src/__tests__/`) |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Many N/A fields in report | Add `FINNHUB_API_KEY` and set `STOCK_DATA_PROVIDER=hybrid` for wider data coverage |
| "API rate limit" error | Alpha Vantage free tier: 25 req/day. Use hybrid mode or wait until next day; cache prevents re-fetching |
| Vercel deploy fails | Set **Root Directory** to `web` in Vercel project settings |
| Reports missing after reload | Vercel `/tmp` is ephemeral. Download reports immediately after generation |
| "401 Unauthorized" | `GITHUB_TOKEN` expired — regenerate at github.com/settings/tokens; or `GEMINI_TOKEN` invalid — regenerate at aistudio.google.com/api-keys |
| "429 Too Many Requests" (GitHub Models) | App auto-retries with fallback models. Set `LLM_PROVIDER=hybrid` to automatically fall back to Gemini on 429 |
| "429 Too Many Requests" (Gemini) | Check your model: `gemini-2.0-flash` has **zero** free-tier quota and will always fail. The correct default is `gemini-2.5-flash` (5 RPM / 20 RPD). Keys must be created at [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys), not Google Cloud Console. |
| Model returns text instead of tool calls | Select a tool-calling capable model in the model selector dropdown |
| DEP0169 warning in logs | Emitted by a Node.js dependency — informational only, no user impact |

---

## License

ISC
