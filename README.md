# 📊 Equity Research Console

An AI-powered institutional-grade stock research tool. Generate deep-dive reports for any stock (by name or ticker), compare up to 10 companies side-by-side, and explore sector themes — all through a conversational interface.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/vijaydesai86/test-sdk&root-directory=web&env=GITHUB_TOKEN,ALPHA_VANTAGE_API_KEY&envDescription=GitHub%20token%20%2B%20Alpha%20Vantage%20key%20for%20real-time%20data&envLink=https://github.com/vijaydesai86/test-sdk/blob/main/QUICKSTART.md)

## ✨ What it does

- **Any stock, any name** — type "Apple", "Nvidia", or "MSFT"; the AI resolves to the correct ticker automatically
- **Single-stock deep dive** — price, KPIs, financials, EPS trends, valuation multiples, analyst ratings, scorecard
- **Multi-company comparison** — up to 10 companies, accepts company names or tickers
- **Sector & theme reports** — AI-curated universe + ranked analysis
- **Peer comparison** — automatic peer discovery with performance chart
- **Responsive UI** — works on laptop, tablet, and mobile

## 🚀 Quick Start

See **[QUICKSTART.md](QUICKSTART.md)** for full setup instructions (5 minutes).

**TL;DR for Vercel:**
1. Click the Deploy button above
2. Set `GITHUB_TOKEN` (your [GitHub PAT](https://github.com/settings/tokens) — uses your Copilot subscription)
3. Set `ALPHA_VANTAGE_API_KEY` (free from [alphavantage.co](https://www.alphavantage.co/support/#api-key))
4. Done!

**TL;DR for local dev:**
```bash
cd web && npm install && cp .env.example .env.local
# edit .env.local with your keys
npm run dev   # http://localhost:3000
```

## 🔑 Required API Keys

| Key | Where to get | Cost |
|---|---|---|
| `GITHUB_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens) | Free (uses your Copilot subscription) |
| `ALPHA_VANTAGE_API_KEY` | [alphavantage.co](https://www.alphavantage.co/support/#api-key) | Free tier (500 calls/day) |

Optional: `FINNHUB_API_KEY` enables analyst ratings, peers, and advanced financials.

## 💬 Example prompts

```
Generate a full stock report for Nvidia
Generate a full stock report for AAPL
Compare Apple, Microsoft, Google, Amazon and Meta
Generate a sector report for AI data center stocks
Compare Tesla and Rivian
What are today's top gainers and losers?
Show me the earnings history for Microsoft
Get the latest news for Alphabet
```

## 🏗️ Architecture

```
Browser (React / Next.js)
    ↓ POST /api/chat
GitHub Models / OpenAI (LLM with tool-calling)
    ↓ tool calls resolved via executeTool()
Stock Data APIs (Alpha Vantage / Finnhub)
    ↓ structured data
Report Generator (Markdown + ECharts)
    ↓ artifact saved
Browser renders report with live charts
```

## 📚 Available Tools (for the AI)

`search_stock` · `get_stock_price` · `get_price_history` · `get_company_overview` · `get_basic_financials` · `get_earnings_history` · `get_income_statement` · `get_balance_sheet` · `get_cash_flow` · `get_analyst_ratings` · `get_price_targets` · `get_peers` · `get_news_sentiment` · `get_company_news` · `search_news` · `get_sector_performance` · `get_stocks_by_sector` · `screen_stocks` · `get_top_gainers_losers` · `generate_stock_report` · `generate_comparison_report` · `generate_sector_report` · `generate_peer_report`

## 📄 Documentation

| File | Contents |
|---|---|
| [QUICKSTART.md](QUICKSTART.md) | Step-by-step setup for local dev and Vercel |
| [AGENT.md](AGENT.md) | Full technical reference for agents and developers |

## 📦 Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Charts**: Apache ECharts 5, Mermaid
- **AI**: GitHub Copilot SDK / GitHub Models API
- **Data**: Alpha Vantage, Finnhub
- **Deployment**: Vercel

## 📄 License

ISC
