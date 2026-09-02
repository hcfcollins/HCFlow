# Hall Collins Real Estate Group — Transaction Dashboard

A mobile-first PWA for tracking transactions, commission close-outs, and team workflow.
See `BUILD_SPEC.md` for full context on every decision behind this app.

## What's already built

- Real Supabase Postgres schema with Row Level Security (`supabase/schema.sql`) — brokers see
  everything, agents see only their own deals, commission data is broker-only at the database level
- Google Sign-In auth flow (`src/lib/useAuth.js`)
- Live data layer for transactions, agents, attorneys, commission data, and close-outs
  (`src/lib/transactions.js`)
- The confirmed commission calculation logic (`src/lib/commissionCalc.js`)
- A basic working dashboard (login → transaction list → stage/notes editing)

## What's NOT built yet (see BUILD_SPEC.md for the full list)

This is a working foundation, not the finished app. Still to build: the full detail view with
documents/activity tabs, the Under Contract form, the close-out calculator UI, attorney
autocomplete, agent management screen, social post generator, dual-agency linking UI, and the
Dropbox automation. A fuller-featured (but disconnected from any real backend) UI reference
exists in `hall_collins_dashboard.jsx` if you have it from earlier planning — use it for
component/style reference when building out the rest of this real app with Claude Code.

---

## Getting this onto GitHub

1. **Create a new empty repository on GitHub** (github.com → New repository). Do NOT initialize
   it with a README, .gitignore, or license — this project already has those.
2. **On your computer**, unzip this project folder, then open a terminal inside it and run:

   ```bash
   git init
   git add .
   git commit -m "Initial commit: schema, auth, and basic dashboard"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
   git push -u origin main
   ```

   Replace the URL with the one GitHub shows you after creating the repo.

## Setting up Supabase

1. Go to [supabase.com](https://supabase.com), create a free account, and create a new project.
2. Once it's ready, go to **SQL Editor → New Query**, paste in the entire contents of
   `supabase/schema.sql`, and run it. This creates every table and access rule.
3. Go to **Settings → API** and copy your **Project URL** and **anon public key**.
4. In your project folder, copy `.env.example` to `.env` and paste those two values in.

## Setting up Google Sign-In

1. In Supabase: **Authentication → Providers → Google** — you'll need a Google OAuth Client ID
   and Secret.
2. Get those from [Google Cloud Console](https://console.cloud.google.com):
   - Create a project (or use an existing one)
   - **APIs & Services → OAuth consent screen** — set it up for your organization
   - **APIs & Services → Credentials → Create Credentials → OAuth Client ID** (type: Web application)
   - Add the redirect URI Supabase shows you on its Google provider setup page
3. Paste the Client ID and Secret into Supabase's Google provider settings and save.

## Running it locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Deploying it live

The easiest path is **Vercel**:

1. Push this repo to GitHub (above).
2. Go to [vercel.com](https://vercel.com), sign in with GitHub, click "New Project," and select
   this repo.
3. Vercel will auto-detect it's a Vite app. Before deploying, add your two environment variables
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) under Project Settings → Environment Variables.
4. Deploy. You'll get a live URL immediately, and every future `git push` auto-redeploys.

Once deployed, add the Vercel URL as an authorized redirect URI back in both Supabase's Google
provider settings and your Google Cloud OAuth credentials.

## Installing as a PWA on your phone

Once deployed, open the live URL in Safari (iOS) or Chrome (Android) and use "Add to Home
Screen" — it'll behave like an installed app from then on.
