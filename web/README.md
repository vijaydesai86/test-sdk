# Stock Information Assistant - Web Interface

A web-based chat interface for the Stock Information Assistant, built with Next.js and GitHub Copilot SDK.

## Features

- 💬 Interactive chat interface
- 📊 Real-time stock information queries
- 🎨 Modern, responsive UI with Tailwind CSS
- 🚀 Optimized for production deployment

## Getting Started

### Prerequisites

1. **GitHub Copilot CLI** installed and authenticated
   ```bash
   npm install -g @github/copilot-cli
   copilot auth login
   ```

2. **Node.js 18+** installed

### Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables (optional):
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local` to add your Alpha Vantage API key if you want real data:
   ```env
   ALPHA_VANTAGE_API_KEY=your_key_here
   USE_REAL_API=true
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
│   │   └── stockTools.ts         # Copilot SDK tools
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Home page
│   └── globals.css               # Global styles
├── public/                       # Static assets
└── package.json
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `USE_REAL_API` | Use real Alpha Vantage API | `false` |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage API key | Uses mock data |

## Usage Examples

Try asking:
- "What is the current price of Apple stock?"
- "Show me Microsoft's EPS and PE ratio"
- "What's the price history for Tesla?"
- "Search for Amazon stock"

## Deployment

See [DEPLOYMENT.md](../DEPLOYMENT.md) in the root directory for detailed deployment instructions.

### Quick Deploy to Vercel

⚠️ **Important Note**: Due to GitHub Copilot CLI requirements, the application works best when run locally or deployed to platforms that support persistent processes. See DEPLOYMENT.md for alternative deployment options.

For local development:
1. Ensure GitHub Copilot CLI is installed and authenticated
2. Run `npm run dev`
3. Access at http://localhost:3000

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **AI Engine**: GitHub Copilot SDK
- **Stock Data**: Alpha Vantage API

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
- [Alpha Vantage API](https://www.alphavantage.co/documentation/)

## License

ISC
