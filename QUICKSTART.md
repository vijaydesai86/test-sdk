# 🚀 Quick Start Guide

Get the Stock Information Assistant running in 5 minutes!

## Prerequisites Check

Before you start, make sure you have:

- ✅ Node.js 18 or higher installed (`node --version`)
- ✅ npm installed (`npm --version`)
- ✅ Git installed

## Option 1: Run the CLI (Fastest)

### Step 1: Clone and Setup

```bash
# Clone the repository
git clone https://github.com/vijaydesai86/test-sdk.git
cd test-sdk

# Install dependencies
npm install

# Build the project
npm run build
```

### Step 2: Install GitHub Copilot CLI

```bash
# Install globally
npm install -g @github/copilot-cli

# Authenticate
copilot auth login
```

### Step 3: Run the CLI

```bash
npm run dev
```

That's it! Start asking questions about stocks.

### Example Questions:
```
You: What is the current price of Apple stock?
You: Show me Microsoft's EPS and PE ratio
You: Search for Tesla stock
```

## Option 2: Run the Web Interface

### Step 1: Setup (same as above)

```bash
git clone https://github.com/vijaydesai86/test-sdk.git
cd test-sdk
npm install
```

### Step 2: Install GitHub Copilot CLI

```bash
npm install -g @github/copilot-cli
copilot auth login
```

### Step 3: Start the Web Server

```bash
cd web
npm install
npm run dev
```

### Step 4: Open in Browser

Open http://localhost:3000 in your browser and start chatting!

## Setting Up Stock Data API

All stock data is served from the real Alpha Vantage API — no mock data.

### Step 1: Get API Key

1. Visit https://www.alphavantage.co/support/#api-key
2. Sign up for a free API key (takes 1 minute)

### Step 2: Configure

For CLI:
```bash
# Create .env file in root directory
echo "ALPHA_VANTAGE_API_KEY=your_key_here" > .env
```

For Web:
```bash
# Create .env.local file in web directory
cd web
echo "ALPHA_VANTAGE_API_KEY=your_key_here" > .env.local
```

### Step 3: Restart

Restart the application to use real-time stock data!

## Troubleshooting

### ❌ "Command not found: copilot"

**Solution**: Install the Copilot CLI
```bash
npm install -g @github/copilot-cli
```

### ❌ "Failed to authenticate"

**Solution**: Log in to GitHub Copilot
```bash
copilot auth login
```

### ❌ "You don't have a Copilot subscription"

**Solutions**:
1. Sign up for GitHub Copilot at https://github.com/features/copilot
2. Or use BYOK (Bring Your Own Key) - see [BYOK docs](https://github.com/github/copilot-sdk/blob/main/docs/auth/byok.md)

### ❌ "Port 3000 already in use"

**Solution**: Use a different port
```bash
PORT=3001 npm run dev
```

### ❌ "API rate limit exceeded"

**Solution**: Alpha Vantage free tier has 5 calls/minute
- Wait a minute before making more requests
- Or upgrade to premium plan

## Need Help?

1. Check the full [README.md](README.md) for detailed information
2. See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment options
3. Open an issue on GitHub

## What's Next?

- 📊 Try different stock queries
- 🔧 Customize the tools in `src/stockTools.ts`
- 🎨 Modify the web UI in `web/app/components/ChatInterface.tsx`
- 🚀 Deploy to production (see DEPLOYMENT.md)

Happy stock tracking! 📈
