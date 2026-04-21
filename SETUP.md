# TriTeam Dashboard — Setup Guide

A private, invite-only Ironman & 70.3 race tracking dashboard for your team.

---

## Architecture Overview

```
Frontend (React/Vite)  ←→  Supabase (Auth + DB)
                                ↑
                         Node.js Scraper
                         (cron job, daily)
                                ↑
                    Meta WhatsApp Cloud API
                    (race weekend alerts)
```

---

## Step 1 — Supabase Setup (Database + Auth)

1. Create a free account at [supabase.com](https://supabase.com)
2. Create a new project (choose a region close to your team)
3. Go to **SQL Editor** and paste the contents of `supabase/schema.sql` — run it
4. Go to **Authentication → Settings**:
   - Enable **Email** provider
   - Enable **Magic Link** (disable password-based login for cleaner UX)
   - Set Site URL to your deployed frontend URL (e.g. `https://triteam.vercel.app`)
5. Go to **Project Settings → API** and copy:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_KEY` (backend only!)
6. After signing up with your own email, run this in SQL Editor to make yourself admin:
   ```sql
   UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
   ```

---

## Step 2 — Frontend Setup

```bash
cd frontend
npm install
cp ../.env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

The frontend is a single-page React app. It uses:
- `@supabase/supabase-js` for auth and data
- `react-map-gl` + Mapbox for the race map
- No framework (Vite + vanilla React)

### Deploying to Vercel (recommended)
```bash
npm install -g vercel
vercel --prod
# Add environment variables in Vercel dashboard
```

---

## Step 3 — Backend Scraper Setup

```bash
cd backend
npm install
cp ../.env.example .env
# Fill in all SUPABASE and WHATSAPP_* variables
node scraper.js   # Test it manually first
```

### Setting up the daily cron job

**Option A — Vercel Cron (easiest)**
Add to `vercel.json`:
```json
{
  "crons": [{ "path": "/api/scrape", "schedule": "0 6 * * *" }]
}
```

**Option B — Linux crontab**
```bash
crontab -e
# Add this line (runs at 6am daily):
0 6 * * * cd /path/to/triteam/backend && node scraper.js >> /var/log/triteam.log 2>&1
```

**Option C — GitHub Actions (free)**
Create `.github/workflows/scrape.yml`:
```yaml
name: Daily Race Scraper
on:
  schedule:
    - cron: '0 6 * * *'
jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with: { node-version: '20' }
      - run: cd backend && npm install && node scraper.js
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          WHATSAPP_TOKEN: ${{ secrets.WHATSAPP_TOKEN }}
          WHATSAPP_PHONE_ID: ${{ secrets.WHATSAPP_PHONE_ID }}
          WHATSAPP_CHANNEL_ID: ${{ secrets.WHATSAPP_CHANNEL_ID }}
```

---

## Step 4 — WhatsApp Notifications via Meta Cloud API

1. Go to [developers.facebook.com](https://developers.facebook.com) → Create App → choose **Business** type
2. Add the **WhatsApp** product to your app
3. Under WhatsApp → Getting Started, you'll see a temporary test number — use it immediately for testing, no approval needed
4. Go to WhatsApp → API Setup and copy:
   - **Phone Number ID** → `WHATSAPP_PHONE_ID`
   - **Temporary access token** (or create a permanent System User token) → `WHATSAPP_TOKEN`
5. Create a WhatsApp **Channel** in the WhatsApp app for your team to follow — copy its ID → `WHATSAPP_CHANNEL_ID`
6. For production: add your real phone number under WhatsApp → Phone Numbers (Meta approval takes a few hours)

**When notifications fire:**
- Every Thursday and Friday, the scraper checks for races on the upcoming Saturday/Sunday
- If any team members have entered those races, a message is posted to your WhatsApp channel
- No per-message fees — Meta's free tier covers 1,000 conversations/month

---

## Step 5 — Inviting Team Members

As admin, you can invite members from the Team tab in the dashboard:
1. Click **Invite Member**
2. Enter their name and email
3. They receive a magic link — click it, no password needed
4. They're added to the team and can enter races

---

## Step 6 — Mapbox (Optional — for the Race Map)

1. Create a free account at [mapbox.com](https://mapbox.com)
2. Copy your public token to `VITE_MAPBOX_TOKEN` in `.env`
3. The map view will show all race locations as pins, with your entries highlighted

---

## Cost Estimate (All Free Tiers)

| Service | Free Tier |
|---------|-----------|
| Supabase | 500MB DB, 50MB file storage, 50k MAUs |
| Vercel | Unlimited hobby deploys |
| Meta WhatsApp Cloud API | 1,000 conversations/month free |
| Mapbox | 50,000 map loads/month |
| GitHub Actions | 2,000 minutes/month |

For a team of hundreds, you'll stay on free tiers indefinitely.

---

## Project Structure

```
triteam/
├── frontend/          # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Calendar.jsx
│   │   │   ├── Map.jsx
│   │   │   └── Team.jsx
│   │   ├── components/
│   │   │   ├── RaceCard.jsx
│   │   │   ├── MemberCard.jsx
│   │   │   └── AddRaceModal.jsx
│   │   └── lib/
│   │       └── supabase.js
│   └── vite.config.js
├── backend/           # Node.js scraper + notifier
│   ├── scraper.js
│   └── package.json
├── supabase/
│   └── schema.sql
├── .env.example
└── SETUP.md
```
