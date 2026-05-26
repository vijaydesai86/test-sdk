# Stock Research Assistant

An AI-powered stock research tool built on Next.js and GitHub Models. It produces institutional-quality equity research reports by combining real market data from free-tier financial APIs with LLM reasoning via GitHub Copilot or Gemini.

## What it does

Type a question in plain English and the assistant calls the right data tools, fetches real market data, and generates a structured report as a downloadable Markdown artifact.

Report-style requests are guarded server-side: if the model answers a stock, comparison, theme, or watchlist report request in plain chat without creating an artifact, the server runs the matching report tool instead. This keeps free-form prompts such as `Should I buy Arm?`, `Compare Nvidia, AMD, and Intel`, and `AI infrastructure stocks` on the verified report path.

Reports are also resumable through explicit update prompts. If a prompt includes `update` and names a prior report target, such as `update ARM stock report`, `update comparison report of Nvidia and Arm`, `update research report of AI ecosystem`, or `update watchlist report`, the backend uses the same four report tools in update mode. It locates the latest matching saved report, tries fresh and cached provider data first, then carries forward prior verified checkpoint fields only where this pass cannot replace them. Carried-forward fields are called out in the report notes; if no prior report is found, it falls back to a fresh report and states that in the data-gap notes.

Generated and saved reports can also be improved without writing an update prompt. The browser starts the configured improve passes for a newly generated report and the Saved Reports view exposes the same Improve action for existing reports. Improve reads the selected saved report id, uses that exact report metadata/checkpoint as the update baseline, locks the report universe from saved metadata, runs bounded update passes through the same four report tools, and stops when the configured target is complete or the pass limit is reached. Candidate updates are promoted only when tracked coverage is strictly better and never when critical or overall coverage regresses; discarded candidates are deleted. Original reports are never overwritten; updated versions are marked separately, and only the latest accepted updated version is kept visible for a given original.

**Four report types:**

| Mode | How to ask | What you get |
|---|---|---|
| **Stock report** | `Generate a stock report for NVDA` | Full deep-dive: price, financials, earnings, insider activity, analyst ratings, technicals (RSI, MACD, Bollinger, Stochastic), dividend analysis, DCF valuation, moat analysis, investment thesis |
| **Comparison report** | `Compare NVDA, AMD, INTC` · `Tesla vs Rivian` | Explicit user-given stock comparisons with verified market data, financials, valuation, technicals, and side-by-side decision guidance |
| **Research report** | `Deep research on semiconductors` · `Best dividend stocks` | Comprehensive deep research for sectors, themes, industries, baskets, and open-ended topics. Fetches verified core market data first, then adds ecosystem/dependency synthesis when budget allows |
| **Watchlist daily** | `Generate daily report for my watchlist` | One combined report covering every company in the saved watchlist. Saved ticker symbols are normalized and trusted during the report so provider search hiccups do not reject valid watchlist entries. |

**Transparent decision engine:**

Every report includes a multi-factor decision for each company, powered by a 7-pillar scoring model:

| Pillar | Weight | What it measures |
|---|---|---|
| Profitability | 25% | Gross margin, operating margin, ROE, ROA |
| Valuation | 20% | P/E ratio, analyst target upside |
| Growth | 15% | Revenue growth, EPS growth |
| Momentum | 15% | Price trend over observation period |
| Analyst Consensus | 15% | Weighted buy/hold/sell distribution |
| Insider Activity | 5% | Net insider buying as % of market cap (no fixed $ thresholds) |
| Financial Health | 5% | Debt/equity, current ratio, cash flow |

The decision summary shows the **real data behind each score** so you can see exactly how the Buy/Hold/Sell recommendation was reached. If critical pillars are missing, the engine withholds a buy/add score and waits for verified inputs instead of forcing a decision from one partial signal.

**Additional research tools** (use via natural language questions):

| Tool | How to ask | What you get |
|---|---|---|
| **Technical analysis** | `What are the technical indicators for AAPL?` | RSI(14), MACD(12,26,9), Bollinger Bands, Stochastic, ATR, EMA, SMA, volume analysis |
| **SEC filings** | `Show me recent SEC filings for TSLA` | Recent 10-K, 10-Q, 8-K filings with dates and links to SEC EDGAR |
| **SEC company facts** | `Show official SEC facts for AAPL` | Compact official SEC XBRL fundamentals: revenue, net income, assets, liabilities, cash flow, capex, FCF, shares, EPS |
| **Economic indicators** | `What are the current economic indicators?` | GDP, CPI/inflation, Fed Funds rate, unemployment, Treasury yields, yield curve |
| **Treasury yield curve** | `Show the latest Treasury yield curve` | Official U.S. Treasury daily yield curve and 10Y-2Y / 30Y-3M spreads |
| **BLS macro indicators** | `Show BLS inflation and unemployment data` | Official BLS CPI-U, core CPI, unemployment, payrolls, and hourly earnings |
| **BEA macro indicators** | `Show BEA GDP and spending data` | Official BEA NIPA GDP growth, PCE, investment, trade, government spending, and nominal GDP |
| **EIA energy indicators** | `Show EIA oil, gas, and electricity data` | Official EIA WTI crude, Henry Hub gas, retail electricity prices, and electricity generation |
| **Dividend analysis** | `Analyze dividends for KO` | Yield, payout ratio, FCF coverage, safety score, ex-dividend dates |
| **DCF valuation** | `What's the intrinsic value of MSFT?` | 10-year DCF, WACC, margin of safety, valuation verdict |
| **Market sentiment** | `What's the market sentiment right now?` | Composite Fear & Greed index (0-100) from real market data |
| **Theme news search** | `Find recent semiconductor news` | Recent market/news articles for a company, sector, or investment theme |

---

## Quick start (local development)

**Prerequisites:** Node.js 22.x with npm 10.x, a GitHub token with `models:read` scope or a Gemini API key, at least one stock data API key.

```bash
git clone https://github.com/vijaydesai86/test-sdk.git
cd test-sdk/web
npm install
cp .env.example .env.local   # fill in your keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment variables

Copy `web/.env.example` to `web/.env.local` and fill in the values. All variables that default to a sensible value are optional.

### LLM providers (at least one required)

The system **automatically uses all configured providers in sequence** — GitHub Models first (exhausting all fallback models), then Gemini. No configuration needed; just set the tokens and everything is used.

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | Recommended | Personal access token from [github.com/settings/tokens](https://github.com/settings/tokens). Requires `models:read` scope. Uses your existing GitHub Copilot subscription at no extra cost. Also accepted: `GH_TOKEN`, `COPILOT_GITHUB_TOKEN`. |
| `GEMINI_TOKEN` | Recommended | API key from [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys). Use AI Studio — not Google Cloud Console — to get free-tier quota automatically. |
| `COPILOT_MODEL` | No | Preferred first GitHub Models ID. Default: `openai/gpt-4.1`. After that the server fans out across the full live GitHub catalog automatically. |
| `GEMINI_MODEL` | No | Preferred first Gemini model ID. Default: `gemini-2.5-flash`. Invalid values are ignored and reset to the safe Gemini ladder automatically. |
| `COPILOT_FALLBACK_MODELS` | No | Optional comma-separated GitHub model IDs to try near the front of the automatic fallback ladder. |
| `FILL_MODEL` | No | Lighter model used for ticker resolution. Default: `openai/gpt-4.1-mini`. |
| `AUTO_DOWNGRADE_GPT5` | No | Set to `false` to disable automatic gpt-5 → gpt-4.1 downgrade. Default: `true`. |

### Stock data providers (at least one required)

The system **automatically uses all configured providers with full fallback** — each API call tries every configured provider until data is returned. No `STOCK_DATA_PROVIDER` selection needed.

| Variable | Required | Description |
|---|---|---|
| `ALPHA_VANTAGE_API_KEY` | Recommended | Free key from [alphavantage.co](https://www.alphavantage.co/support/#api-key). Free tier: 25 req/day, 5 req/min. |
| `FINNHUB_API_KEY` | Recommended | Free key from [finnhub.io](https://finnhub.io). Free tier: 60 req/min. |
| `FINANCIAL_MODELING_PREP_API_KEY` | No | Free key from [financialmodelingprep.com](https://financialmodelingprep.com/developer/docs). Adds financial statements and ratios. |
| `TWELVE_DATA_API_KEY` | No | Free key from [twelvedata.com](https://twelvedata.com/pricing). Adds price history coverage. |
| `EODHD_API_KEY` | No | Optional EODHD key. Used as a low-quota cached fallback for EOD history, fundamentals, statements, and news gaps. |
| `MARKETAUX_API_KEY` | No | Optional Marketaux key. Used first for keyword/theme news and company-news fallback. |
| `OPENFIGI_API_KEY` | No | Optional OpenFIGI key. Used for ticker/identifier mapping fallback during symbol search. |

_Stooq (price history, no key needed) is always included as a final fallback._

### Additional data sources (optional — enable extra research tools)

| Variable | Required | Description |
|---|---|---|
| `FRED_API_KEY` | No | Free key from [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html). Enables the `get_economic_indicators` tool (GDP, CPI, Fed Funds rate, unemployment, Treasury yields, yield curve). |
| `BLS_API_KEY` | No | Optional free BLS registration key. The `get_bls_macro_indicators` tool also works without a key, but registered access has higher quota. |
| `BEA_API_KEY` | No | Free key from [bea.gov](https://apps.bea.gov/API/signup/). Enables `get_bea_macro_indicators` for official NIPA GDP and spending data. |
| `EIA_API_KEY` | No | Free key from [eia.gov](https://www.eia.gov/opendata/register.php). Enables `get_eia_energy_indicators` for official oil, gas, electricity price, and generation data. |
| `SEC_USER_AGENT` | No | Optional SEC User-Agent override for SEC EDGAR/companyfacts calls. Defaults to a generic app identifier. |

_Note: SEC EDGAR filings (`get_sec_filings`), SEC XBRL company facts (`get_sec_company_facts`, `get_sec_financial_statements`), and U.S. Treasury yield curve data (`get_treasury_yield_curve`) require no API key._

### Persistence (optional — filesystem fallback used when not set)

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL. When set with `SUPABASE_SERVICE_ROLE_KEY`, reports and watchlists persist in Supabase; local filesystem report files remain available as artifact fallback. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-side only, never expose to browser). |
| `SUPABASE_ANON_KEY` | Optional deployment parity variable. Current server routes do not require it, but it is safe to keep in Vercel envs if already configured. |

### Tuning (all optional)

| Variable | Default | Description |
|---|---|---|
| `NUM_COMPANIES` | `10` | Companies in comparison and research reports. Range: 2–15. |
| `DEEP_RESEARCH_DEPTH` | `1` | Optional post-core-data ecosystem/refinement passes for research reports. Core market data is fetched before any pass runs. Range: 1–10. |
| `DEEP_RESEARCH_MAX_MS` | `240000` on Vercel, `600000` local | Runtime budget for deep research (ms). Vercel is clamped under the 300 s function limit; local can run longer for completeness. |
| `DATA_FETCH_CONCURRENCY` | `3` | Parallel ticker fetches per report round. Range: 1–4. |
| `VERCEL_EXTENDED_DATA_MAX_COMPANIES` | `3` | On Vercel, reports larger than this preserve the configured company/watchlist universe but prioritize core decision inputs and cached optional data so free-tier providers do not consume the whole 300 s function window. Improve/update passes fill missing fields in later saved versions. Local runs still attempt extended data. |
| `REPORTS_DIR` | `reports` (local) / `/tmp/reports` (Vercel) | Where generated report files are stored. |
| `STOCK_CACHE_TTL_MS` | `604800000` (7 days) | How long fetched data is cached on disk. |
| `REPORT_IMPROVE_DEFAULT_PASSES` | `3` | Backend default number of browser-coordinated improve passes after report generation or when the user clicks Improve report. |
| `REPORT_IMPROVE_MAX_PASSES` | `5` | Backend cap for improve passes. Generated-report and Improve button runs use this server-side value rather than a browser hardcode. |
| `REPORT_IMPROVE_TARGET` | `critical` | Backend improve stop target. `critical` stops when critical tracked fields are complete; `all` waits for all tracked fields. Critical coverage is field-level: price, company identity, market cap, sector/industry, revenue, revenue growth, EPS growth, gross margin, operating margin, ROE/ROA, forward P/E, and price history. Analyst views, PEG, cash-flow detail, statements, insiders, peers, and news are high/optional rather than critical. |
| `REPORT_IMPROVE_MIN_WAIT_MS` | `60000` | Minimum wait between browser-coordinated improve passes while tracked gaps remain. |
| `SEC_COMPANY_FACTS_CACHE_TTL_MS` | `43200000` (12 hours) | In-memory TTL for SEC ticker mapping and companyfacts responses. |
| `TREASURY_RATES_CACHE_TTL_MS` | `43200000` (12 hours) | In-memory TTL for official Treasury yield curve responses. |
| `BEA_CACHE_TTL_MS` | `43200000` (12 hours) | In-memory TTL for BEA NIPA macro responses. |
| `EIA_CACHE_TTL_MS` | `43200000` (12 hours) | In-memory TTL for EIA energy responses. |
| `BLS_MACRO_CACHE_TTL_MS` | `43200000` (12 hours) | In-memory TTL for BLS macro indicator responses. |
| `LLM_REQUEST_TIMEOUT_MS` | `30000` on Vercel, `90000` local | Per-request timeout for main tool-routing LLM calls before trying the next model/provider. |
| `LLM_FILL_REQUEST_TIMEOUT_MS` | `12000` on Vercel, `60000` local | Per-request timeout for optional report-fill LLM calls such as moat, rationale, conclusion, and ecosystem text. |
| `LLM_FILL_TOTAL_BUDGET_MS` | `20000` on Vercel, `120000` local | Total per-request budget for optional report-fill LLM fallback attempts. |
| `LLM_MODEL_COOLDOWN_MS` | `120000` | How long a rate-limited LLM model is skipped before retrying. |
| `STOCK_PROVIDER_COOLDOWN_MS` | `300000` | How long a rate-limited data provider is paused. |
| `ALPHA_VANTAGE_MIN_INTERVAL_MS` | `12000` | Min ms between Alpha Vantage requests. Matches the documented 5 req/min free-tier ceiling. |
| `FINNHUB_MIN_INTERVAL_MS` | `1100` | Min ms between Finnhub requests. Keeps the default under the documented 60 req/min free-tier ceiling. |
| `FMP_MIN_INTERVAL_MS` | `12000` | Min ms between FMP requests. Uses a conservative default for the free-tier minute quota. |
| `TWELVE_DATA_MIN_INTERVAL_MS` | `8000` | Min ms between Twelve Data requests. Keeps the default under the documented 8 req/min free-tier ceiling. |
| `STOOQ_MIN_INTERVAL_MS` | `1000` | Min ms between Stooq requests. Conservative no-key fallback pacing. |
| `EODHD_MIN_INTERVAL_MS` | `12000` | Min ms between EODHD fallback requests. Conservative for low-quota free-tier use. |
| `MARKETAUX_MIN_INTERVAL_MS` | `1500` | Min ms between Marketaux news requests. |
| `OPENFIGI_MIN_INTERVAL_MS` | `3000` | Min ms between OpenFIGI mapping requests. |
| `GITHUB_MODELS_CACHE_TTL_MS` | `900000` (15 min) | Cache TTL for the live GitHub Models catalog so every chat request does not re-fetch the catalog. |
| `DEBUG` | `false` | Set to `true` to show data-source, data-coverage, and accepted improve-history diagnostic sections in reports. |
| `HEALTH_CHECK_SYMBOL` | — | Optional ticker for a live price check in the `/api/health` response. |

---

## Deploying to Vercel

1. Push your fork to GitHub.
2. Create a new Vercel project and import the repository.
3. In Vercel project settings, set **Root Directory** to `web`.
4. Add the environment variables listed above under **Settings → Environment Variables**.
5. Deploy. The build command (`npm run build`) and output directory (`.next`) are pre-configured in `vercel.json`.

**Recommended production environment variables:**

```
GITHUB_TOKEN=your_github_pat
GEMINI_TOKEN=your_gemini_key
ALPHA_VANTAGE_API_KEY=your_av_key
FINNHUB_API_KEY=your_finnhub_key
NUM_COMPANIES=15
DEEP_RESEARCH_DEPTH=1
```

### Supabase setup (optional but recommended for Vercel)

Vercel's filesystem is ephemeral — reports and watchlists written to `/tmp` are lost on each function invocation. To persist them, connect a Supabase project:

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run the migrations in `supabase/migrations/` in order. Migration `006_add_saved_report_run_metadata.sql` adds structured report-run metadata used by update/resume prompts; filesystem fallback writes the same checkpoint as a sidecar metadata file next to the saved Markdown artifact.
3. Copy the project URL and service-role key to Vercel environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).

---

## Repository structure

```
test-sdk/
├── web/                         # Next.js application (Vercel root directory)
│   ├── app/
│   │   ├── api/
│   │   │   ├── chat/            # Main research endpoint (POST, DELETE)
│   │   │   ├── health/          # Provider health check (GET)
│   │   │   ├── models/          # GitHub Models catalog (GET)
│   │   │   ├── providers/       # Internal LLM model inventory (GET)
│   │   │   ├── saved-reports/   # Saved report library (GET, POST)
│   │   │   └── watchlist/       # Watchlist management (GET, PATCH, DELETE)
│   │   ├── components/
│   │   │   └── ChatInterface.tsx  # Full UI: chat, workspace, themes, charts
│   │   └── lib/
│   │       ├── stockTools.ts      # 35 tool definitions, executeTool, report orchestration
│   │       ├── reportIntent.ts    # Free-form report intent guard/fallback classifier
│   │       ├── stockDataService.ts# All data providers + SecEdgarService + FredService
│   │       ├── reportGenerator.ts # Report builders, technical indicators, chart builders
│   │       ├── decisionEngine.ts  # 7-pillar multi-factor decision engine
│   │       ├── investmentTypes.ts # Shared types: DecisionSnapshot, PortfolioProfile, etc.
│   │       ├── dataTrust.ts       # Data freshness tracking (fresh/aging/stale)
│   │       ├── llmProviderConfig.ts# LLM provider/model configuration + safe fallback ladders
│   │       ├── watchlistStore.ts  # Watchlist CRUD (Supabase / filesystem)
│   │       ├── researchMemoryStore.ts # Research session + thesis persistence
│   │       ├── chatToolPolicy.ts  # Tool name allowlist for LLM calls
│   │       └── supabaseClient.ts  # Supabase client singleton
│   └── public/
│       └── reports/             # Static sample reports
├── __tests__/                   # Vitest test suite
├── supabase/
│   └── migrations/              # SQL migration files for saved_reports and watchlists
├── vercel.json                  # Vercel deployment config
├── AGENT.md                     # Operating contract for agents and contributors
└── CHANGELOG.md                 # Release history
```

---

## Running tests

```bash
# From the repo root
npm test
```

Tests live in `__tests__/` and cover tool routing, report generation, and data service behaviour.

---

## Health check

```
GET /api/health
```

Returns the configured provider mode, which API keys are present, and whether the service is ready to handle requests. Pass `HEALTH_CHECK_SYMBOL=AAPL` to include a live price check in the response.
