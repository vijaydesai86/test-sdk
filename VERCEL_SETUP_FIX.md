# 🔧 Fix for Vercel 404 Errors

## Problem
Getting 404 errors for all routes (/, /favicon.ico, etc.) when deploying to Vercel.

## Root Cause
The Next.js application is in the `/web` subdirectory, but Vercel is trying to deploy from the root directory `/`. This causes Vercel to not find any pages, resulting in 404 errors.

## Solution: Set Root Directory in Vercel Dashboard

### Step 1: Delete Current Deployment (if exists)
1. Go to your Vercel dashboard
2. Select your project
3. Go to Settings → General
4. Scroll to "Delete Project" and delete it
5. This will allow you to reconfigure from scratch

### Step 2: Import Project Again
1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Select your repository: `vijaydesai86/test-sdk`
4. Click "Import"

### Step 3: **CRITICAL - Configure Root Directory**

Before clicking Deploy, you MUST configure the Root Directory:

1. Look for **"Root Directory"** setting (it's in the "Build and Output Settings" section)
2. Click the **"Edit"** button next to Root Directory
3. Type: `web`
4. Click **"Save"** or **"Continue"**

**Visual Guide:**
```
Root Directory: [Edit]
└─> Change from: ./
    Change to:   web
```

This tells Vercel that your Next.js app is in the `web` folder, not at the repository root.

### Step 4: Add Environment Variables

Add these environment variables:

**Required:**
```
OPENAI_API_KEY=sk-...your-key...
```

**Optional:**
```
USE_REAL_API=true
ALPHA_VANTAGE_API_KEY=your-key
```

### Step 5: Deploy

Click **"Deploy"** and wait for the build to complete.

## Why This Was Failing Before

The `vercel.json` file in the root had build commands like `cd web && npm run build`, but this doesn't actually tell Vercel WHERE the Next.js app is located. Vercel needs to know the Root Directory so it can:

1. Find the `next.config.ts` file
2. Find the `app/` directory with pages
3. Properly build and serve the Next.js application
4. Set up the correct routing

## Alternative Solution (If You Still Can't Change Root Directory)

If Vercel's UI truly won't let you change the Root Directory, you can:

### Option A: Use Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy with root directory specified
vercel --cwd web
```

### Option B: Contact Vercel Support

If the UI is preventing you from changing the Root Directory, this might be a bug or account limitation. Contact Vercel support.

### Option C: Restructure Repository (NOT RECOMMENDED)

Move everything from `/web` to root:
```bash
# This would require moving files and updating paths
# NOT RECOMMENDED - just fix the Vercel settings instead
```

## Verification

After deploying with the correct Root Directory setting:

1. Your Vercel URL should load the chat interface
2. No more 404 errors for `/`
3. Favicon should load from `/web/app/favicon.ico`
4. The app should work correctly

## Common Misconceptions

❌ **"Adding `cd web` to buildCommand in vercel.json will fix it"**
- This only changes where the build command runs, not where Vercel looks for the app

❌ **"Setting outputDirectory to web/.next will fix it"**
- This tells Vercel where the build output is, but Vercel still needs to know the root directory

✅ **"Setting Root Directory to `web` in Vercel dashboard fixes it"**
- This is the correct solution - it tells Vercel where your Next.js app actually lives

## Need Help?

If you're still having issues:

1. Make sure you deleted the old project and started fresh
2. Double-check the Root Directory is set to `web`
3. Verify your environment variables are correct
4. Check the Vercel build logs for any errors

## Summary

**The Fix:** Set Root Directory to `web` in Vercel dashboard before deploying.

That's it! The vercel.json file has been simplified to `{}` so it doesn't interfere with Vercel's configuration.
