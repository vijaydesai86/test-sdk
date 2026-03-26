# AGENT.md
This file is the operating contract for anyone changing this repo.
## Scope
The product has exactly three user-facing report modes:
- individual stock report
- comparison report
- deep research
General chat can still exist, but it is not a separate report mode and must not grow into a parallel product surface.
## Non-Negotiable Rules
1. Never fabricate financial data.
Statement rows, prices, ratios, insider activity, and analyst data must come from real provider responses or direct arithmetic on real provider fields. If the field is unavailable, keep it unavailable.
2. Never reintroduce synthetic statement fallbacks.
Do not create fake balance sheet, cash flow, income statement, or EPS history rows from descriptions, heuristics, or LLM output.
3. Keep natural language easy for users.
Users should be able to type `google vs microsoft` or `deep research on tesla`. Entity resolution can use the LLM, but real provider verification is still required before market-data fetches.
4. Deep research stays one mode.
Deep research may internally branch into:
- deep stock
- deep comparison
- deep sector/theme research
But the UI and product surface should still expose a single deep-research concept.
5. Optimize for free-tier operations.
Assume Vercel free tier, free provider quotas, and rate-limited model access. Prefer bounded fan-out, caching, reuse, and graceful partial-data handling over brute force.
6. Provider truth beats LLM confidence.
The LLM can explain, route, and synthesize. It must not silently replace unavailable provider data with model memory.
7. Keep common report plumbing common.
New report types should reuse shared data-fetching, timing, valuation, conclusion, and persistence helpers. Avoid copy-pasted report pipelines.
8. Only three top-level markdown docs are allowed.
`README.md`, `AGENT.md`, and `CHANGELOG.md` are the only markdown documents that should remain committed in the repo root. Remove stale markdown artifacts and duplicate docs.
## Current Architecture
- `web/app/api/chat/route.ts`: parses requests, chooses provider/model strategies, and routes report generation
- `web/app/lib/stockTools.ts`: tool dispatch, symbol resolution, report orchestration, cache helpers
- `web/app/lib/stockDataService.ts`: Alpha Vantage, Finnhub, FMP, Twelve Data, Stooq, `hybrid`, and `multi` data services
- `web/app/lib/reportGenerator.ts`: report builders for stock, comparison, sector body reuse, and deep-research wrappers
- `web/app/components/ChatInterface.tsx`: user-facing controls and report UX
## Preferred Runtime Defaults
- `STOCK_DATA_PROVIDER=multi`
- `LLM_PROVIDER=hybrid`
Why:
- `multi` gives the best chance of returning real data across free-tier gaps
- `hybrid` gives the best chance of continuing through GitHub/Gemini rate-limit pressure
## Change Checklist
Before merging any change, verify these questions:
- Does this keep report data truthful?
- Does this preserve the three report modes?
- Does this keep the user input flow simple?
- Does this reduce or at least not worsen rate-limit pressure?
- Does this avoid duplicating report logic that should be shared?
- Does this keep docs aligned with the current code?
## Reporting Guidance
When improving reports, prefer additions that come from real data and help users decide faster:
- clearer statement coverage using the most complete real report available
- timing signals derived from price history such as RSI and moving-average trend
- insider, ownership, short-interest, analyst, and catalyst summaries when providers expose them
- alternatives only when they come from real peer/company research, not generic LLM brainstorming
## Anti-Patterns
Do not do these:
- add a fourth report mode for sectors
- hardcode provider-specific fake defaults
- let missing fields look populated when they are not
- optimize by skipping verification on entity resolution
- add documentation sprawl back into the repo
