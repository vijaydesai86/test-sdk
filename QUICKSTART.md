# 🚀 Quick Start Guide

Get the Equity Research Console running in 5 minutes.

## Prerequisites

- Node.js 18+ (`node --version`)
- npm (`npm --version`)
- A GitHub Copilot subscription (or bring your own OpenAI key)

---

## Option A: Deploy to Vercel (Recommended)

1. Click the **Deploy** button in [README.md](README.md)
2. Import the repo in Vercel, set **Root Directory** to `web`
3. Add environment variables:
   - `GITHUB_TOKEN` — create at [github.com/settings/tokens](https://github.com/settings/tokens) (classic PAT, no specific scopes needed, or fine-grained with "Models" read permission)
   - `ALPHA_VANTAGE_API_KEY` — free from [alphavantage.co](https://www.alphavantage.co/support/#api-key)
4. Deploy — done!

---

## Option B: Run Locally

### 1 · Clone and install

```bash
git clone https://github.com/vijaydesai86/test-sdk.git
cd test-sdk/web
npm install
```

### 2 · Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```env
GITHUB_TOKEN=your_github_pat_here
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key_here
# Optional for richer data:
# FINNHUB_API_KEY=your_finnhub_key_here
```

### 3 · Start dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Option C: CLI (Node.js REPL)

```bash
# From repo root
npm install
npm run build
npm run dev
```

---

## Example Prompts

```
Generate a full stock report for Apple
Generate a full stock report for NVDA
Compare Apple, Microsoft, Google, Amazon and Meta
Generate a sector report for AI data center stocks
What are today's top gainers and losers?
Show me Tesla vs Rivian comparison
Get the latest news for Nvidia
```

---

## Troubleshooting

| Error | Fix |
|---|---|
| `GitHub Models API authentication failed` | Check `GITHUB_TOKEN` is set and valid |
| `Alpha Vantage API key not configured` | Set `ALPHA_VANTAGE_API_KEY` |
| Rate limit (Alpha Vantage free tier) | Wait 1 minute; free tier allows 5 calls/min |
| Port 3000 in use | `PORT=3001 npm run dev` |
| Report shows no data | Check env vars; try a stock with more data (e.g. AAPL, MSFT) |

---

## What's Next

- See [AGENT.md](AGENT.md) for full technical architecture and extension guide
- Customize tools in `web/app/lib/stockTools.ts`
- Customize the UI in `web/app/components/ChatInterface.tsx`
- Add a Finnhub key for analyst ratings, peers, and richer financial data

Happy researching! 📈
