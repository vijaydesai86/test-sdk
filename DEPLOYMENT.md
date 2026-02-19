# 🚀 Deployment Guide

## Deploy to Vercel (Recommended)

### ✅ Uses Your Existing GitHub Copilot Subscription - No Additional Cost!

You already pay for GitHub Copilot, so you can use it on Vercel **without any additional subscription**.

### Quick Deploy (5 Minutes)

#### Step 1: Create a GitHub Token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Name it: `Vercel Stock App`
4. Select scopes:
   - ✅ `repo` (if using private repos) OR
   - ✅ `public_repo` (for public repos only)
5. Click **"Generate token"**
6. **Copy the token** (starts with `ghp_...`) - you won't see it again!

#### Step 2: Import to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **"Add New Project"**
3. Select your **test-sdk** repository
4. Click **"Import"**

#### Step 3: Configure Project

**IMPORTANT Settings:**

1. **Root Directory**: Set to `web` ⚠️ (Critical!)
2. **Framework Preset**: Next.js (auto-detected) ✅
3. **Build Command**: Leave default
4. **Node.js Version**: 18.x or higher

#### Step 4: Add Environment Variables

Click **"Environment Variables"** and add:

**Required:**
```
Name: GITHUB_TOKEN
Value: ghp_... (paste your token from Step 1)
```

**Optional (for real stock data):**
```
Name: USE_REAL_API
Value: true
```
```
Name: ALPHA_VANTAGE_API_KEY
Value: your_alpha_vantage_key
```

Get a free Alpha Vantage key at: https://www.alphavantage.co/support/#api-key

#### Step 5: Deploy

Click **"Deploy"** and wait 2 minutes. Done! 🚀

### What This Costs You

#### ✅ FREE (Using What You Already Pay For!)

- **GitHub Copilot Subscription**: You already have this! ✅
- **Vercel Hosting**: Free tier (100GB bandwidth/month)
- **Alpha Vantage**: Free tier (5 calls/minute)

**Total Additional Cost: $0/month** 🎉

### How It Works

```
Your Browser
     ↓
Vercel (Next.js App)
     ↓
GitHub Copilot SDK (using GITHUB_TOKEN)
     ↓
GitHub Copilot API (using your subscription!)
     ↓
Stock Tools + Alpha Vantage API (optional)
```

### Testing Your Deployment

1. Visit your deployment URL (e.g., `https://your-app.vercel.app`)
2. Try asking questions like:
   - "What is the current price of Apple stock?"
   - "Show me Microsoft's EPS and PE ratio"
   - "Search for Tesla stock"

### Troubleshooting

#### Error: "GitHub token not configured"
- Make sure you added `GITHUB_TOKEN` environment variable in Vercel
- Verify the token is valid at [github.com/settings/tokens](https://github.com/settings/tokens)
- Redeploy after adding the environment variable

#### Error: "q.resolve is not a function"
- This should be fixed in the latest code
- Make sure you're using the latest version from the repository
- Check that `GITHUB_TOKEN` is properly set

#### Build Fails
- Verify Root Directory is set to `web`
- Check that all dependencies are listed in `web/package.json`
- Review build logs in Vercel dashboard

#### API Rate Limit
- Alpha Vantage free tier: 5 calls/minute
- Wait a minute before making more requests
- Or use mock data: Set `USE_REAL_API=false` or remove the environment variable

### Custom Domain (Optional)

1. In your Vercel project, go to **Settings** → **Domains**
2. Add your custom domain
3. Follow the DNS configuration instructions

### Monitoring

- **Vercel Dashboard**: View deployment logs and analytics
- **Alpha Vantage Dashboard**: Monitor API usage (if using real API)

## Local Development

### Prerequisites

1. **Node.js** 18+ installed
2. **GitHub Copilot CLI** installed and authenticated (for local development only)
   ```bash
   npm install -g @github/copilot-cli
   copilot auth login
   ```

### Setup Web App Locally

```bash
# Clone the repository
git clone https://github.com/vijaydesai86/test-sdk.git
cd test-sdk/web

# Install dependencies
npm install

# Create .env.local file (optional)
echo "ALPHA_VANTAGE_API_KEY=your_key_here" > .env.local
echo "USE_REAL_API=true" >> .env.local

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes (Vercel) | GitHub Personal Access Token to use your Copilot subscription |
| `USE_REAL_API` | No | Set to `true` to use real Alpha Vantage API, `false` for mock data (default) |
| `ALPHA_VANTAGE_API_KEY` | No | Your Alpha Vantage API key (only needed if `USE_REAL_API=true`) |

## Support

For issues and questions:
- Check the [README.md](README.md) for general information
- See [QUICKSTART.md](QUICKSTART.md) for quick setup
- Open an issue on GitHub
