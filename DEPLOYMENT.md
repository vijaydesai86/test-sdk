# Deploying to Vercel

This guide explains how to deploy the Stock Information Assistant web interface to Vercel.

## Prerequisites

1. A GitHub account
2. A Vercel account (sign up at [vercel.com](https://vercel.com))
3. Your code pushed to a GitHub repository

## Deployment Steps

### 1. Push Your Code to GitHub

Make sure all your changes are committed and pushed:

```bash
git add .
git commit -m "Ready for deployment"
git push origin main
```

### 2. Import Project on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **"Add New..."** → **"Project"**
3. Select **"Import Git Repository"**
4. Find and select your `test-sdk` repository

### 3. Configure Build Settings

**Important:** Since the Next.js app is in the `web` subdirectory:

1. In the project settings, expand **"Build and Output Settings"**
2. Set **Root Directory** to: `web`
3. Framework Preset should auto-detect as **Next.js**
4. Leave other settings at default

### 4. Configure Environment Variables (Optional)

If you want to use real stock data instead of mock data:

1. Click **"Environment Variables"**
2. Add the following variables:
   - Key: `USE_REAL_API`, Value: `true`
   - Key: `ALPHA_VANTAGE_API_KEY`, Value: `your_api_key_here`

To get a free API key:
- Visit [Alpha Vantage](https://www.alphavantage.co/support/#api-key)
- Sign up for a free API key
- Free tier: 5 API calls per minute

### 5. Deploy

1. Click **"Deploy"**
2. Wait for the build to complete (usually 1-2 minutes)
3. Once deployed, you'll get a URL like: `https://your-app.vercel.app`

## Post-Deployment

### Test Your Deployment

1. Visit your deployment URL
2. Try asking questions like:
   - "What is the current price of Apple stock?"
   - "Show me Microsoft's EPS and PE ratio"
   - "Search for Tesla stock"

### Set Up Custom Domain (Optional)

1. In your Vercel project, go to **Settings** → **Domains**
2. Add your custom domain
3. Follow the DNS configuration instructions

### Monitor Usage

- Vercel dashboard shows deployment logs and analytics
- Alpha Vantage dashboard shows API usage (if using real API)

## Troubleshooting

### Build Fails

**Error: "Cannot find module"**
- Solution: Make sure all dependencies are in `web/package.json`
- Run `cd web && npm install` locally to verify

**Error: "Root directory not found"**
- Solution: Double-check that Root Directory is set to `web` in project settings

### Runtime Errors

**Error: "Failed to start Copilot client"**
- This error will occur at runtime because Copilot CLI cannot run in Vercel's serverless environment
- See "Alternative Deployment Options" below

### API Rate Limits

**Error: "API rate limit exceeded"**
- Alpha Vantage free tier: 5 calls per minute
- Solution: Upgrade to premium or add rate limiting

## Alternative Deployment Options

### Limitations of Vercel Deployment

GitHub Copilot SDK requires the Copilot CLI to be installed and running, which is **not available** in Vercel's serverless environment. The web interface will build successfully but will fail at runtime when trying to connect to the Copilot CLI.

### Recommended Alternatives:

#### 1. Run Locally
```bash
cd web
npm run dev
```
Access at http://localhost:3000

#### 2. Deploy with Copilot CLI Support

Deploy to a platform that supports persistent processes:

**Railway** (recommended):
- Supports long-running processes
- Can install and run Copilot CLI
- Easy deployment from GitHub

**DigitalOcean App Platform**:
- Supports custom Dockerfiles
- Can include Copilot CLI in container

**AWS EC2 or Google Cloud Compute**:
- Full control over environment
- Install Copilot CLI and run Node.js server

#### 3. Use BYOK (Bring Your Own Key)

Modify the implementation to use BYOK authentication instead of Copilot CLI:
- Configure the SDK to use OpenAI, Anthropic, or Azure OpenAI directly
- No Copilot CLI required
- See [BYOK documentation](https://github.com/github/copilot-sdk/blob/main/docs/auth/byok.md)

## Environment Variables Reference

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `USE_REAL_API` | No | Use real Alpha Vantage API | `false` |
| `ALPHA_VANTAGE_API_KEY` | No | Alpha Vantage API key | Uses mock data |

## Support

For issues:
1. Check the [troubleshooting section](#troubleshooting) above
2. Review Vercel deployment logs
3. Open an issue on GitHub
