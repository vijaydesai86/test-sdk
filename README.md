# Stock Research Assistant

An AI-powered stock research tool built on Next.js and GitHub Models. It produces institutional-quality equity research reports by combining real market data from free-tier financial APIs with LLM reasoning via GitHub Copilot or Gemini.

---

## What it does

Type a question in plain English and the assistant calls the right data tools, fetches real market data, and generates a structured report as a downloadable Markdown artifact.

**Four research modes:**

| Mode | How to ask | What you get |
|---|---|---|
| **Stock report** | `Generate a stock report for NVDA` | Full deep-dive: price, financials, earnings, insider activity, analyst ratings, technicals, moat analysis, investment thesis |
| **Comparison report** | `Compare NVDA, AMD, INTC` | Side-by-side tables, charts, moat rankings, and position guidance for 2–15 companies |
| **Deep research** | `Deep research on semiconductors` or `Tesla vs Rivian` | Ecosystem dependency map (Mermaid diagram), sector universe refinement, full comparison body, multi-pass synthesis |
| **Watchlist daily** | `Generate daily report for my watchlist` | One combined report covering every company in the saved watchlist |

---

## Quick start (local development)

**Prerequisites:** Node.js 20+, a GitHub token with `models:read` scope or a Gemini API key, at least one stock data API key.

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

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | Yes (github/hybrid) | Personal access token from [github.com/settings/tokens](https://github.com/settings/tokens). Requires `models:read` scope. Uses your existing GitHub Copilot subscription at no extra cost. Also accepted: `GH_TOKEN`, `COPILOT_GITHUB_TOKEN`. |
| `GEMINI_TOKEN` | Yes (gemini/hybrid) | API key from [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys). Use AI Studio — not Google Cloud Console — to get free-tier quota automatically. |
| `LLM_PROVIDER` | No | `github` (default) · `gemini` · `hybrid`. Hybrid uses GitHub Models as primary and falls back to Gemini on 429. |
| `COPILOT_MODEL` | No | Model ID for GitHub Models. Default: `openai/gpt-4.1`. |
| `GEMINI_MODEL` | No | Gemini model ID. Default: `gemini-2.5-flash`. |
| `COPILOT_FALLBACK_MODELS` | No | Comma-separated fallback model IDs for GitHub provider. |
| `FILL_MODEL` | No | Lighter model used for ticker resolution. Default: `openai/gpt-4.1-mini`. |
| `AUTO_DOWNGRADE_GPT5` | No | Set to `false` to disable automatic gpt-5 → gpt-4.1 downgrade. Default: `true`. |

### Stock data providers (at least one required)

| Variable | Required | Description |
|---|---|---|
| `ALPHA_VANTAGE_API_KEY` | Yes (alphavantage/hybrid/multi) | Free key from [alphavantage.co](https://www.alphavantage.co/support/#api-key). Free tier: 25 req/day, 5 req/min. |
| `FINNHUB_API_KEY` | Yes (finnhub/hybrid/multi) | Free key from [finnhub.io](https://finnhub.io). Free tier: 60 req/min. |
| `FINANCIAL_MODELING_PREP_API_KEY` | No | Free key from [financialmodelingprep.com](https://financialmodelingprep.com/developer/docs). Enables `fmp` and `multi` modes. |
| `TWELVE_DATA_API_KEY` | No | Free key from [twelvedata.com](https://twelvedata.com/pricing). Enables `twelvedata` and `multi` modes. |
| `STOCK_DATA_PROVIDER` | No | `alphavantage` (default) · `finnhub` · `fmp` · `twelvedata` · `stooq` · `hybrid` · `multi`. See provider guide below. |

### Persistence (optional — filesystem fallback used when not set)

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL. When set with `SUPABASE_SERVICE_ROLE_KEY`, reports and watchlists persist in Supabase instead of the local filesystem. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-side only, never expose to browser). |

### Tuning (all optional)

| Variable | Default | Description |
|---|---|---|
| `NUM_COMPANIES` | `10` | Companies in comparison/sector/deep-sector reports. Range: 2–15. |
| `DEEP_RESEARCH_DEPTH` | `2` | Recursive refinement passes in deep sector research. Range: 1–3. |
| `DEEP_RESEARCH_MAX_MS` | `240000` | Runtime budget for deep research (ms). Keep under Vercel's 300 s limit. |
| `DATA_FETCH_CONCURRENCY` | `3` | Parallel ticker fetches per report round. Range: 1–4. |
| `REPORTS_DIR` | `reports` (local) / `/tmp/reports` (Vercel) | Where generated report files are stored. |
| `STOCK_CACHE_TTL_MS` | `604800000` (7 days) | How long fetched data is cached on disk. |
| `LLM_MODEL_COOLDOWN_MS` | `120000` | How long a rate-limited LLM model is skipped before retrying. |
| `STOCK_PROVIDER_COOLDOWN_MS` | `300000` | How long a rate-limited data provider is paused. |
| `ALPHA_VANTAGE_MIN_INTERVAL_MS` | `1200` | Min ms between Alpha Vantage requests. |
| `FINNHUB_MIN_INTERVAL_MS` | `500` | Min ms between Finnhub requests. |
| `FMP_MIN_INTERVAL_MS` | `800` | Min ms between FMP requests. |
| `TWELVE_DATA_MIN_INTERVAL_MS` | `800` | Min ms between Twelve Data requests. |
| `STOOQ_MIN_INTERVAL_MS` | `800` | Min ms between Stooq requests. |
| `DEBUG` | `false` | Set to `true` to show data-source and data-coverage sections in reports. |
| `HEALTH_CHECK_SYMBOL` | — | Optional ticker for a live price check in the `/api/health` response. |

---

## Stock data provider guide

The `STOCK_DATA_PROVIDER` variable selects the data backend. For best coverage with free-tier keys, use `multi`.

| Provider | API key(s) needed | Notes |
|---|---|---|
| `alphavantage` | `ALPHA_VANTAGE_API_KEY` | Default. Good fundamentals, limited free-tier rate. |
| `finnhub` | `FINNHUB_API_KEY` | Good real-time price and news. |
| `fmp` | `FINANCIAL_MODELING_PREP_API_KEY` | Good statements and ratios. |
| `twelvedata` | `TWELVE_DATA_API_KEY` | Good price history. |
| `stooq` | None | Price history only. Always available as a fallback. |
| `hybrid` | `ALPHA_VANTAGE_API_KEY` (+ optional `FINNHUB_API_KEY`) | Alpha Vantage primary; Finnhub fills gaps. |
| `multi` | Any combination | Full fallback chain: AV → Finnhub → FMP → Twelve Data → Stooq. Recommended for production. |

---

## Deploying to Vercel

1. Push your fork to GitHub.
2. Create a new Vercel project and import the repository.
3. In Vercel project settings, set **Root Directory** to `web`.
4. Add the environment variables listed above under **Settings → Environment Variables**.
5. Deploy. The build command (`npm run build`) and output directory (`.next`) are pre-configured in `vercel.json`.

**Recommended production environment variables:**

```
LLM_PROVIDER=hybrid
STOCK_DATA_PROVIDER=multi
NUM_COMPANIES=15
DEEP_RESEARCH_DEPTH=3
```

### Supabase setup (optional but recommended for Vercel)

Vercel's filesystem is ephemeral — reports and watchlists written to `/tmp` are lost on each function invocation. To persist them, connect a Supabase project:

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run the migrations in `supabase/migrations/` in order.
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
│   │   │   ├── providers/       # LLM provider list (GET)
│   │   │   ├── saved-reports/   # Saved report library (GET, POST)
│   │   │   └── watchlist/       # Watchlist management (GET, PATCH, DELETE)
│   │   ├── components/
│   │   │   └── ChatInterface.tsx  # Full UI: chat, workspace, themes, charts
│   │   └── lib/
│   │       ├── stockTools.ts      # Tool definitions, executeTool, report orchestration
│   │       ├── stockDataService.ts# All data provider implementations
│   │       ├── reportGenerator.ts # Report builders, chart builders, saveReport
│   │       ├── llmProviderConfig.ts# LLM provider/model configuration
│   │       ├── watchlistStore.ts  # Watchlist CRUD (Supabase / filesystem)
│   │       └── supabaseClient.ts  # Supabase client singleton
│   └── public/
│       └── reports/             # Static sample reports
├── __tests__/                   # Vitest test suite
├── supabase/
│   └── migrations/              # SQL migration files for saved_reports and watchlists
├── .env.example                 # Root-level env var reference
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