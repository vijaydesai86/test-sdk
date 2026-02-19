# 🔧 Fix for Vercel 404 Errors

## Problem
Getting 404 errors for all routes (/, /favicon.ico, etc.) when deploying to Vercel.

## Root Cause
The Next.js application is in the `/web` subdirectory, but Vercel is trying to deploy from the root directory `/`. This causes Vercel to not find any pages, resulting in 404 errors.

## Solution 1: Set Root Directory in Vercel Dashboard (RECOMMENDED)

### Step 1: Delete Current Deployment
1. Go to your Vercel dashboard
2. Select your project
3. Go to Settings → General
4. Scroll down and click "Delete Project"
5. Confirm deletion

### Step 2: Import Project Again
1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Select your repository: `vijaydesai86/test-sdk`
4. Click "Import"

### Step 3: **CRITICAL - Configure Root Directory**

**Before clicking Deploy:**

1. In the "Configure Project" screen, find **"Root Directory"**
2. Click the **"Edit"** button (NOT "Override")
3. You should see a file browser or text field
4. Select or type: `web`
5. Click "Continue"

**Where to find it:**
- It's in the "Build and Output Settings" section
- Usually between "Framework Preset" and "Build Command"
- If you don't see it, click "Edit" next to "Build and Output Settings"

### Step 4: Add Environment Variables

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

Click **"Deploy"** and wait for the build to complete. This should fix all 404 errors!

---

## Solution 2: Use vercel.json Configuration (IF Solution 1 Doesn't Work)

If you truly cannot change the Root Directory in the Vercel UI, the `vercel.json` file in this repository has been configured to work around this limitation.

### What's in the vercel.json:

```json
{
  "buildCommand": "cd web && npm install && npm run build",
  "outputDirectory": "web/.next",
  "installCommand": "cd web && npm install"
}
```

This tells Vercel:
- Change to the `web/` directory and install dependencies
- Build the Next.js app from the `web/` directory
- Look for the build output in `web/.next`

### To deploy with this configuration:

1. Make sure the latest code is pushed to GitHub
2. In Vercel, delete the old project if it exists
3. Import the project again
4. **Do NOT change the Root Directory** - leave it as default `/`
5. Add your environment variables
6. Click "Deploy"

Vercel should now:
- ✅ Detect it as a Next.js project
- ✅ Build it correctly
- ✅ Serve all routes properly
- ✅ No more 404 errors

---

## Solution 3: Use Vercel CLI (Alternative Method)

If the dashboard isn't working:

```bash
# Install Vercel CLI
npm install -g vercel

# Navigate to your repository
cd /path/to/test-sdk

# Login to Vercel
vercel login

# Deploy with web as root directory
cd web
vercel

# Or deploy from root with specific config
cd ..
vercel --cwd web
```

---

## Why Were You Getting 404 Errors?

When Vercel deployed with Root Directory set to `/` (the repository root):

1. ❌ Vercel looked for Next.js app at `/` (root)
2. ❌ But the app is actually at `/web`
3. ❌ Vercel couldn't find `app/page.tsx` or any routes
4. ❌ Result: 404 errors for all routes

With the fix:

1. ✅ Vercel looks for Next.js app at `/web` (via Root Directory OR vercel.json)
2. ✅ Vercel finds `web/app/page.tsx` and all routes
3. ✅ Builds and deploys correctly
4. ✅ Result: Your app works!

---

## Troubleshooting

### "I still don't see the Root Directory option"

**Try this:**
1. Make sure you're on the "Configure Project" screen (right after clicking "Import")
2. Look for "Build and Output Settings" section
3. Click "Edit" or "Override" button
4. The Root Directory field should appear

**If it's still not there:**
- Your account might have a different Vercel UI version
- Use Solution 2 (vercel.json) or Solution 3 (Vercel CLI)

### "Build succeeds but I still get 404s"

This usually means:
1. The `outputDirectory` is wrong, OR
2. Vercel isn't detecting it as a Next.js app

**Fix:**
- Make sure `vercel.json` has the correct `outputDirectory`: `web/.next`
- Try deploying again with a fresh build (delete and re-import project)

### "The Edit button is grayed out"

This can happen if:
- There's a conflicting `vercel.json` (but we've fixed that!)
- The project was imported with git integration issues

**Fix:**
- Delete the project completely
- Make sure your GitHub repository connection is working
- Import again

### "Build fails with 'cannot find package.json'"

This means Vercel is looking in the wrong directory.

**Fix:**
- Make sure `vercel.json` has: `"installCommand": "npm --prefix web install"`
- This tells npm to install from the `web/` directory

---

## Verification Checklist

After deploying, verify these work:

- [ ] Opening your Vercel URL loads the chat interface
- [ ] No 404 error for the root route `/`
- [ ] Favicon loads (check browser dev tools)
- [ ] You can type messages in the chat
- [ ] AI responses work (requires OPENAI_API_KEY)

---

## Quick Reference

**✅ Best Solution:** Set Root Directory to `web` in Vercel dashboard

**🔄 Backup Solution:** Use the configured `vercel.json` file (already set up)

**🛠️ Alternative:** Use Vercel CLI: `vercel --cwd web`

---

## Still Having Issues?

1. **Check Vercel build logs:**
   - Go to your project on Vercel
   - Click on the failed deployment
   - Read the build logs for specific errors

2. **Verify your environment variables:**
   - `OPENAI_API_KEY` must be set
   - Make sure there are no typos

3. **Check that web/package.json has correct dependencies:**
   - Should include `next`, `react`, `react-dom`

4. **Try the nuclear option:**
   - Delete the Vercel project completely
   - Delete any `.vercel` folder in your local repo
   - Push latest changes to GitHub
   - Import to Vercel as a brand new project
   - Set Root Directory to `web` (or use vercel.json)

---

## Summary

**The Fix:** Set Root Directory to `web` in Vercel dashboard, OR use the configured `vercel.json` file.

Both methods tell Vercel where your Next.js app actually lives, fixing the 404 errors.
