# ✅ Vercel Deployment - Step by Step

## Yes, It Will Just Work on Vercel! 🎉

This app is now **fully compatible with Vercel**. No local setup needed!

## Quick Deploy (5 Minutes)

### Step 1: Import to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **"Add New Project"**
3. Select your **test-sdk** repository
4. Click **"Import"**

### Step 2: Configure Project Settings

**IMPORTANT:** Set these before deploying:

1. **Root Directory**: Set to `web` (this is crucial!)
2. **Framework Preset**: Should auto-detect as "Next.js" ✅
3. **Build Command**: Leave as default (`npm run build`)
4. **Output Directory**: Leave as default (`.next`)

### Step 3: Add Environment Variables

Click **"Environment Variables"** and add:

**REQUIRED:**
```
Name: OPENAI_API_KEY
Value: sk-... (your OpenAI API key)
```

**OPTIONAL (for real stock data):**
```
Name: USE_REAL_API
Value: true
```
```
Name: ALPHA_VANTAGE_API_KEY
Value: your_alpha_vantage_key
```

### Step 4: Deploy

Click **"Deploy"** and wait 1-2 minutes. That's it! 🚀

## Getting API Keys

### OpenAI API Key (REQUIRED)

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Sign up or log in
3. Click **"Create new secret key"**
4. Copy the key (starts with `sk-...`)
5. Add to Vercel environment variables

**Cost:** Pay-as-you-go (very affordable for personal use)
- GPT-4 Turbo: ~$0.01 per request
- $5 credit for new accounts

### Alpha Vantage API Key (OPTIONAL)

1. Go to [alphavantage.co/support/#api-key](https://www.alphavantage.co/support/#api-key)
2. Enter your email
3. Get free API key instantly
4. Add to Vercel if you want real stock data

**Free tier:** 5 API calls per minute (enough for testing)

## What Happens After Deploy

1. ✅ Vercel builds your app automatically
2. ✅ You get a live URL: `https://your-app.vercel.app`
3. ✅ AI chat works immediately (using OpenAI)
4. ✅ Mock stock data works by default
5. ✅ Real stock data works if you added Alpha Vantage key

## Testing Your Deployment

1. Open your Vercel URL
2. Try these questions:
   - "What is the current price of Apple stock?"
   - "Show me Microsoft's EPS and PE ratio"
   - "Search for Tesla stock"

## Common Issues & Solutions

### ❌ "OpenAI API key not configured"

**Solution:** 
1. Go to your Vercel project dashboard
2. Settings → Environment Variables
3. Add `OPENAI_API_KEY` with your key
4. Redeploy (Deployments tab → click the three dots → Redeploy)

### ❌ Build fails with "Root directory not found"

**Solution:**
1. Project Settings → General
2. Set Root Directory to `web`
3. Save and redeploy

### ❌ "Rate limit exceeded" errors

**Solution:**
- OpenAI: Check your usage at platform.openai.com
- Alpha Vantage: Free tier has 5 calls/min, wait or upgrade

### ❌ Getting mock data when you want real data

**Solution:**
1. Add `USE_REAL_API=true` environment variable
2. Add your Alpha Vantage key
3. Redeploy

## How to Redeploy After Changes

1. Push changes to GitHub:
   ```bash
   git add .
   git commit -m "Your changes"
   git push
   ```

2. Vercel auto-deploys! 🎉

Or manually redeploy:
1. Go to your project on Vercel
2. Deployments tab
3. Click "..." → "Redeploy"

## Environment Variables Summary

| Variable | Required? | Where to Get |
|----------|-----------|--------------|
| `OPENAI_API_KEY` | ✅ YES | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `USE_REAL_API` | ❌ No | Set to `true` or `false` |
| `ALPHA_VANTAGE_API_KEY` | ❌ No | [alphavantage.co](https://www.alphavantage.co/support/#api-key) |

## Why This Works on Vercel

- ✅ Uses OpenAI API directly (no CLI needed)
- ✅ Serverless-compatible architecture
- ✅ No background processes required
- ✅ Pure Next.js API routes
- ✅ Stateless function calls

## Cost Estimate

**For personal use (100 questions/day):**
- OpenAI GPT-4 Turbo: ~$3-5/month
- Alpha Vantage: Free (or $50/month for premium)
- Vercel: Free (hobby plan)

**Total: $3-5/month** for full functionality

## Need Help?

1. Check the [troubleshooting section](#common-issues--solutions) above
2. View deployment logs in Vercel dashboard
3. Open an issue on GitHub

## What About Local Development?

The CLI version still uses GitHub Copilot SDK and requires:
- GitHub Copilot subscription
- Copilot CLI installed locally

But **for Vercel deployment, you don't need any of that!** Just OpenAI API key.

---

**Ready to deploy?** Just follow the steps above and you'll have a live stock assistant in minutes! 🚀
