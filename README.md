# Stock Research Assistant
A free-tier-aware equity research app that turns natural-language requests into real-data reports. The system is built around three report modes, a composite stock-data provider chain, and LLM orchestration that must never invent missing financial data.
## Core Rules
- Real data only. If providers do not return a value, the report must show that gap instead of guessing.
- No synthetic balance sheet, cash flow, income statement, or EPS history rows.
- Natural language is allowed for inputs, but entity resolution must still be verified against real provider search/results.
- Free-tier limits matter. The app is tuned for Vercel free tier plus rate-limited provider and model quotas.
- Deep research is a single mode that can target one company, an explicit comparison set, or a sector/theme. It is not a separate fourth report family.
## Report Modes
### 1. Individual Stock Report
Use for one company or ticker.
What it includes today:
- price, price history, overview, valuation, margins, scorecard
- recent income statement, balance sheet, and cash flow rows from real providers only
- insider/ownership data when providers expose it
- analyst targets, recommendation trend, news/catalyst summary
- timing layer: RSI, moving-average trend, range position, and a data-driven buy/hold/wait/sell stance
- provider-derived peer list as alternative stocks to research
### 2. Comparison Report
Use for an explicit company set such as `visa vs mastercard`.
What it includes today:
- side-by-side snapshot, scale, growth, valuation, balance sheet/cash, analyst, moat, and allocation views
- timing/action table for each company using real price history and current fundamentals
- ownership/positioning table using available provider fields
- reused directly by deep comparison and deep sector research bodies
### 3. Deep Research
Use for deeper work such as:
- `deep research on tesla`
- `deep research on visa vs mastercard`
- `deep research on semiconductors`
Deep research routes into one of three internal shapes while staying one user-facing mode:
- deep single-company research
- deep explicit-company comparison
- deep sector/theme research with candidate selection, refinement, and ecosystem narrative
## LLM and Data Responsibilities
### LLM
- parses the request and chooses the right report path
- resolves natural-language entities into likely tickers
- verifies them against provider search and asks for clarification when confidence is low
- orchestrates report generation and model fallbacks
- generates narrative layers such as moat commentary and deep-research synthesis
- must not use training data as hidden financial truth when provider data is missing
### Stock data layer
The stock-data service supports these runtime modes:
- `alphavantage`
- `finnhub`
- `fmp`
- `twelvedata`
- `stooq`
- `hybrid`
- `multi`
Recommended production default:
- `STOCK_DATA_PROVIDER=multi`
- `LLM_PROVIDER=hybrid`
Current `multi` order:
- Alpha Vantage -> Finnhub -> Financial Modeling Prep -> Twelve Data -> Stooq
Current `hybrid` LLM behavior:
- GitHub Models first
- fallback across configured GitHub models
- then Gemini fallback chain when GitHub rate-limits or the selected provider mode requires it
## Free-Tier Safety
The app clamps several environment-driven knobs to avoid accidental fan-out:
- `NUM_COMPANIES`: 2..15
- `DEEP_RESEARCH_DEPTH`: 1..3
- `DEEP_RESEARCH_MAX_MS`: 60000..270000
- `DATA_FETCH_CONCURRENCY`: 1..4
This is intentional. A bad env value should not be able to explode provider usage, Vercel runtime, or model quota consumption.
## Important Environment Variables
Required or commonly used:
- `GITHUB_TOKEN`
- `GEMINI_TOKEN`
- `LLM_PROVIDER`
- `ALPHA_VANTAGE_API_KEY`
- `FINNHUB_API_KEY`
- `FINANCIAL_MODELING_PREP_API_KEY`
- `TWELVE_DATA_API_KEY`
- `STOCK_DATA_PROVIDER`
- `DATA_FETCH_CONCURRENCY`
- `NUM_COMPANIES`
- `DEEP_RESEARCH_DEPTH`
- `DEEP_RESEARCH_MAX_MS`
- `REPORTS_DIR`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `HEALTH_CHECK_SYMBOL`
For the current deployment assumptions, `STOCK_DATA_PROVIDER=multi` and `LLM_PROVIDER=hybrid` are the intended defaults.
## Repo Map
- `web/app/api/chat/route.ts`: request parsing, LLM execution, provider/model strategy, report routing
- `web/app/lib/stockTools.ts`: tool dispatch, symbol resolution, report assembly orchestration
- `web/app/lib/stockDataService.ts`: provider clients and fallback chains
- `web/app/lib/reportGenerator.ts`: markdown report builders and charts
- `web/app/components/ChatInterface.tsx`: chat UI and report controls
- `AGENT.md`: contributor and agent rules
- `CHANGELOG.md`: notable project changes
## Example Queries
- `research microsoft`
- `compare visa and mastercard`
- `deep research on semiconductors`
- `deep research on tesla`
- `deep research on visa vs mastercard`
## Documentation Rule
Only these top-level markdown docs should exist in the repo:
- `README.md`
- `AGENT.md`
- `CHANGELOG.md`
Generated report artifacts should not be committed as markdown documentation.
