# 📊 Equity Research Console

An AI-powered institutional-grade stock research tool. Generate deep-dive reports for any stock (by name or ticker) and compare up to 10 companies side-by-side — all through a conversational interface.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/vijaydesai86/test-sdk&root-directory=web&env=GITHUB_TOKEN,ALPHA_VANTAGE_API_KEY&envDescription=GitHub%20token%20%2B%20Alpha%20Vantage%20key%20for%20real-time%20data&envLink=https://github.com/vijaydesai86/test-sdk/blob/main/README.md)

## ✨ What it does

- **Any stock, any name** — type "Apple", "Nvidia", or "MSFT"; the AI resolves to the correct ticker automatically
- **Single-stock deep dive** — price, KPIs, financials, EPS trends, valuation multiples, analyst ratings, scorecard
- **Multi-company comparison** — up to 10 companies, accepts company names or tickers
- **Reports as artifacts** — every report is saved to the Artifacts panel and opens automatically; the full markdown is downloadable
- **Responsive UI** — works on laptop, tablet, and mobile

## 🚀 Quick Start

### Vercel (recommended)

1. Click the **Deploy** button above
2. Set `GITHUB_TOKEN` — your [GitHub PAT](https://github.com/settings/tokens) (uses your Copilot subscription; no extra scopes needed for a classic PAT)
3. Set `ALPHA_VANTAGE_API_KEY` — free from [alphavantage.co](https://www.alphavantage.co/support/#api-key)
4. Done — your app is live

### Local development

```bash
cd web
npm install
cp ../.env.example .env.local   # then fill in your keys
npm run dev                      # http://localhost:3000
```

## 🔑 Required API Keys

| Key | Where to get | Cost |
|---|---|---|
| `GITHUB_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens) | Free (uses your Copilot subscription) |
| `ALPHA_VANTAGE_API_KEY` | [alphavantage.co](https://www.alphavantage.co/support/#api-key) | Free tier (500 calls/day) |

Optional: `FINNHUB_API_KEY` — free from [finnhub.io](https://finnhub.io). Setting this alongside `ALPHA_VANTAGE_API_KEY` automatically upgrades to the **hybrid** provider which fills gaps from both sources.

## 💬 Example prompts

```
Generate a full stock report for Nvidia
Generate a full stock report for AAPL
Compare Apple, Microsoft, Google, Amazon and Meta
Compare Tesla and Rivian
```

Or use the **Quick Research** buttons in the sidebar to start typing immediately.

## 🏗️ Architecture

```
Browser (React / Next.js)
    ↓ POST /api/chat
GitHub Models / OpenAI (LLM with tool-calling)
    ↓ parallel tool calls resolved via executeTool()
Stock Data APIs (Alpha Vantage / Finnhub)
    ↓ real structured data
LLM gathers, reasons, and writes the full report
    ↓ save_report() persists the artifact
Browser opens report in the Artifacts panel
```

## 📚 LLM-authored reports

The LLM is the intelligence. For every report request it:

1. Calls `search_stock` to resolve company names to tickers
2. Fires **all** data tools for every ticker in a single parallel round
3. Scans results, fills gaps with targeted follow-up calls
4. Writes the full markdown report itself
5. Calls `save_report(title, content)` — which opens the Artifacts panel automatically

No fake or estimated data is ever inserted. If a field is genuinely unavailable after exhausting all tools, it is marked `—`.

## 📄 Available data tools

`search_stock` · `get_stock_price` · `get_price_history` · `get_company_overview` · `get_basic_financials` · `get_earnings_history` · `get_income_statement` · `get_balance_sheet` · `get_cash_flow` · `get_analyst_ratings` · `get_analyst_recommendations` · `get_price_targets` · `get_peers` · `get_insider_trading` · `get_news_sentiment` · `get_company_news` · `search_news` · `search_companies` · `save_report`

## 📦 Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Charts**: Apache ECharts 5, Mermaid
- **AI**: GitHub Models API (GPT-4.1 default, model switcher in UI)
- **Data**: Alpha Vantage, Finnhub
- **Deployment**: Vercel

## 📄 Documentation

| File | Contents |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | Release history and notable changes |
| [AGENT.md](AGENT.md) | Full technical reference for agents and developers |

## 📄 License

ISC
