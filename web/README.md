# Stock Information Assistant - Web Interface

A web-based chat interface for the Stock Information Assistant, built with Next.js and the GitHub Models API.

## Features

- 💬 Interactive chat interface
- 📊 Real-time stock information queries
- 🎨 Modern, responsive UI with Tailwind CSS
- 🚀 Optimized for Vercel deployment

## Getting Started

### Prerequisites

1. **GitHub Personal Access Token** — create one at [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)
2. **Node.js 18+** installed

### Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local` to add your tokens:
   ```env
   GITHUB_TOKEN=ghp_your_token_here
   ALPHA_VANTAGE_API_KEY=your_key_here
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

### Building for Production

```bash
npm run build
npm start
```

## Project Structure

```
web/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts          # API endpoint for chat
│   ├── components/
│   │   └── ChatInterface.tsx     # Main chat UI component
│   ├── lib/
│   │   ├── stockDataService.ts   # Stock API integration
│   │   └── stockTools.ts         # Tool definitions for AI
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Home page
│   └── globals.css               # Global styles
├── public/                       # Static assets
└── package.json
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_TOKEN` | GitHub Personal Access Token (required) | — |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage API key (required for stock data) | — |
| `NUM_COMPANIES` | Companies per comparison/sector/deep-sector report | `10` |
| `DEEP_RESEARCH_DEPTH` | Recursive refinement passes in deep sector research | `2` |

## Usage Examples

Try asking:
- "What is the current price of Apple stock?"
- "Show me Microsoft's EPS and PE ratio"
- "What's the price history for Tesla?"
- "Search for Amazon stock"

## Deployment

See [DEPLOYMENT.md](../DEPLOYMENT.md) in the root directory for detailed deployment instructions.

### Quick Deploy to Vercel

1. Import your repository on [vercel.com](https://vercel.com)
2. Set **Root Directory** to `web`
3. Add environment variables: `GITHUB_TOKEN`, `ALPHA_VANTAGE_API_KEY`
4. Deploy!

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **AI Engine**: GitHub Models API (GPT-4o)
- **Stock Data**: Alpha Vantage API

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [GitHub Models](https://github.com/marketplace/models)
- [Alpha Vantage API](https://www.alphavantage.co/documentation/)

## License

ISC
