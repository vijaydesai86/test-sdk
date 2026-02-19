# 📊 Stock Information Assistant

An AI-powered stock information tool built with GitHub Copilot SDK that provides comprehensive US stock market data through both a CLI and web interface.

## Features

- **Real-time Stock Prices**: Get current prices, changes, and volume
- **Price History**: View daily, weekly, or monthly historical data
- **Company Fundamentals**: EPS, PE ratio, PEG ratio, market cap, profit margins
- **Insider Trading**: Track insider transactions (with premium API)
- **Analyst Ratings**: View consensus ratings and target prices
- **Stock Search**: Find stocks by company name or ticker symbol
- **AI-Powered Chat**: Natural language interface powered by GitHub Copilot

## 🚀 Quick Start

### Prerequisites

1. **Node.js** 18+ installed
2. **GitHub Copilot CLI** installed and authenticated
   ```bash
   # Install Copilot CLI
   npm install -g @github/copilot-cli
   
   # Authenticate
   copilot auth login
   ```
3. **GitHub Copilot subscription** (or use BYOK - Bring Your Own Key)

### Installation

```bash
# Clone the repository
git clone https://github.com/vijaydesai86/test-sdk.git
cd test-sdk
```

## 💻 CLI Usage

### Setup

```bash
# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Run the CLI
npm start
```

### CLI Example

```bash
npm run dev
```

Then interact with the assistant:
```
You: What is the current price of Apple stock?
Assistant: [AI response with stock data]

You: Show me the EPS and PE ratio for Microsoft
Assistant: [AI response with fundamental data]
```

## 🌐 Web Interface

### Setup Web App

```bash
cd web

# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Deploy to Vercel

1. **Push to GitHub** (if not already done)
   ```bash
   git add .
   git commit -m "Add stock information assistant"
   git push origin main
   ```

2. **Deploy on Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "Import Project"
   - Select your GitHub repository
   - Set the **Root Directory** to `web`
   - Add environment variables (optional):
     - `USE_REAL_API=false` (or `true` if you have an API key)
     - `ALPHA_VANTAGE_API_KEY=your_key_here` (if using real API)
   - Click "Deploy"

3. **Important Vercel Configuration**:
   - Root Directory: `web`
   - Framework Preset: Next.js
   - Node.js Version: 18.x or higher

## 🔑 API Configuration

By default, the application uses mock data. To use real stock data:

1. Get a free API key from [Alpha Vantage](https://www.alphavantage.co/support/#api-key)

2. Create `.env.local` in the `web` directory:
   ```env
   ALPHA_VANTAGE_API_KEY=your_api_key_here
   USE_REAL_API=true
   ```

3. For CLI, create `.env` in the root directory:
   ```env
   ALPHA_VANTAGE_API_KEY=your_api_key_here
   USE_REAL_API=true
   ```

**Note**: Alpha Vantage free tier has a limit of 5 API calls per minute.

## 🛠️ Architecture

```
User Interface (CLI or Web)
        ↓
GitHub Copilot SDK
        ↓
Custom Stock Tools
        ↓
Stock Data API (Alpha Vantage or Mock)
```

### Components

- **Stock Data Service** (`src/stockDataService.ts`): Handles API calls to stock data providers
- **Stock Tools** (`src/stockTools.ts`): Defines custom tools for Copilot SDK
- **CLI Interface** (`src/index.ts`): Terminal-based chat interface
- **Web API** (`web/app/api/chat/route.ts`): REST API endpoint for web interface
- **Web UI** (`web/app/components/ChatInterface.tsx`): React-based chat interface

## 📚 Available Tools

The AI assistant has access to these tools:

1. **search_stock**: Find stock symbols by company name
2. **get_stock_price**: Get current price and quote data
3. **get_price_history**: Retrieve historical prices
4. **get_company_overview**: Get fundamentals (EPS, PE, margins, etc.)
5. **get_insider_trading**: View insider transactions
6. **get_analyst_ratings**: See analyst consensus and targets

## 🔒 Authentication

The SDK supports multiple authentication methods:

1. **GitHub OAuth** (default): Uses `copilot auth login`
2. **Environment variables**: `COPILOT_GITHUB_TOKEN`
3. **BYOK**: Use your own LLM API keys

See [GitHub Copilot SDK Authentication](https://github.com/github/copilot-sdk/blob/main/docs/auth/index.md) for details.

## 🎯 Example Queries

- "What is Apple's current stock price?"
- "Show me Microsoft's EPS and PE ratio"
- "What's the price history for Tesla over the last month?"
- "Search for Amazon stock"
- "What are analysts saying about Google?"
- "Show me insider trading for NVDA"

## 📦 Tech Stack

- **Frontend**: Next.js 15, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **AI Engine**: GitHub Copilot SDK
- **Stock Data**: Alpha Vantage API
- **Deployment**: Vercel

## 🐛 Troubleshooting

### "Failed to start Copilot client"
- Ensure GitHub Copilot CLI is installed: `npm install -g @github/copilot-cli`
- Check authentication: `copilot auth login`
- Verify Copilot subscription is active

### "API rate limit exceeded"
- Alpha Vantage free tier: 5 calls/minute
- Wait a minute or upgrade to premium
- Use mock data for testing: `USE_REAL_API=false`

### Vercel Deployment Issues
- Ensure Root Directory is set to `web`
- Check environment variables are set correctly
- Verify Node.js version is 18.x or higher

## 📄 License

ISC

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For issues and questions, please open an issue on GitHub.