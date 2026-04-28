# ThatTriathlonLife — Team Dashboard

A private, invite-only race tracking and team coordination platform for ThatTriathlonLife athletes. Built to replace WhatsApp race planning with a purpose-built tool that automatically tracks IRONMAN, 70.3, and triathlon events worldwide.

---

## What It Does

**Home** — Greets each athlete by name and shows who on the team is racing this week, which races they're in, and where in the world they are on an interactive map. Race rows expand to show all entered athletes.

**Races** — A live calendar of upcoming IRONMAN, 70.3, Olympic, Sprint and other triathlon events pulled automatically from global race databases. Filter by organisation and race type, or search by name, location or type. Toggle between All Races and My Races. Click any race to see the course profile (swim/bike/run), teammates entered, race description, and a direct registration link. Enter or withdraw in one tap. Clicking "Discuss This Race" auto-creates a dedicated channel in Messages.

**Calendar** — Full year view of all upcoming races colour-coded by type.

**Team** — Roster of all active team members and their race entries.

**Training** — Team training feed powered by Strava. Activities sync automatically every 2 hours via GitHub Actions and are served instantly from Supabase — no live Strava API calls at page load. Features include a weekly team summary (swim/bike/run totals), weekly leaderboard (score = sessions × 10 + hours × 5), weekly training streaks, peak week callouts, monthly team recap, and per-activity race countdown badges. Athletes can trigger an immediate manual sync with the Refresh button. Responsive two-column layout on desktop, single column on mobile.

**Messages** — Built-in team messaging to replace WhatsApp. Channels include a General channel, topic channels (admin-created), and race-specific threads auto-created when athletes discuss a race. Supports text, image sharing, emoji reactions, Discord-style replies with quoted context, @mentions with a dedicated Mentions view and unread badge, and message editing. Messages are real-time via Supabase subscriptions with optimistic UI for instant feedback.

**Discounts** — Partner discount codes managed by admins in-app. Shows brand logo, discount amount, copy-to-clipboard code button, expiry countdown, and single-use/rolling offer badges. Expired discounts auto-archive. No code deploy needed to add or update discounts.

**Profile** — Upload a profile photo, pick an avatar colour, update your name and WhatsApp number, view your personal race schedule grouped by month with days-to-go countdown, and export your schedule to Google Calendar or Apple Calendar (.ics). Sign out from here.

---

## Navigation

On desktop the app uses a top navigation bar. On mobile it switches to a bottom tab bar: Home, Races, Training, Messages, Discounts, Profile.

---

## Access

Invite-only. Contact your team admin to request access. You'll receive a magic link by email — click it to sign in, no password needed. On first login you'll be asked for your name.

---

## Architecture

```
Frontend (React + Vite)  ←→  Supabase (Auth + PostgreSQL + Storage + Realtime)
        ↕                              ↑
Vercel Serverless Fns          GitHub Actions (daily cron)
  /api/race-details              ├── Race scraper (6am UTC)
  /api/strava/callback           └── Strava sync (every 2 hours)
  /api/strava/refresh
  /api/strava/disconnect
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, React Router |
| Backend / Auth / DB | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| Hosting | Vercel |
| Race Data | triathlon.org API, PTO Race Calendar (scraped) |
| Race Details | Vercel Serverless Function (`/api/race-details`) |
| Training Data | Strava API (synced to Supabase every 2 hours) |
| Geocoding | OpenStreetMap Nominatim |
| Map | OpenStreetMap Embed |
| Scraper Runtime | GitHub Actions (cron) |
| Notifications | Meta WhatsApp Cloud API *(disabled — pending Meta Business approval)* |

---

## Repository Structure

```
/
├── frontend/                       # React + Vite web app
│   ├── api/
│   │   ├── race-details.js         # Course profile from IRONMAN page
│   │   └── strava/
│   │       ├── callback.js         # OAuth callback — exchanges code for tokens
│   │       ├── refresh.js          # Manual sync trigger for one user
│   │       └── disconnect.js       # Remove Strava tokens from profile
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.jsx            # Landing page — this week's races + map
│   │   │   ├── Dashboard.jsx       # Race list with filters, search, My Races toggle
│   │   │   ├── Training.jsx        # Strava training feed + social features
│   │   │   ├── Messaging.jsx       # Team messaging — channels, replies, @mentions
│   │   │   ├── Discounts.jsx       # Partner discounts with admin management
│   │   │   ├── ProfilePage.jsx     # Profile settings + personal race schedule
│   │   │   ├── Login.jsx           # Magic link auth
│   │   │   └── CompleteProfile.jsx # First-login onboarding
│   │   ├── components/
│   │   │   ├── Layout.jsx          # Responsive nav — top bar (desktop) / bottom tabs (mobile)
│   │   │   ├── RaceList.jsx        # Race rows with entry toggle
│   │   │   ├── RaceDetail.jsx      # Bottom sheet — course info, teammates, discuss button
│   │   │   ├── CalendarView.jsx
│   │   │   ├── TeamRoster.jsx
│   │   │   ├── AddRaceModal.jsx
│   │   │   └── InviteModal.jsx
│   │   └── lib/
│   │       └── supabase.js
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── vercel.json
├── backend/
│   ├── scraper.js                  # Race scraper + race channel cleanup
│   ├── strava-sync.js              # Strava activity sync (all athletes)
│   └── package.json
├── supabase/
│   └── schema.sql
├── .github/
│   └── workflows/
│       └── scrape.yml              # Race scraper (6am UTC) + Strava sync (every 2h)
├── .env.example
├── FLUTTER_INTEGRATION.md
└── README.md
```

---

## Local Development Setup

### Prerequisites
- Node.js 20+
- A Supabase project (free at supabase.com)
- A Strava API application (free at strava.com/settings/api)
- Git

### 1. Clone the repo
```bash
git clone https://github.com/ThatTriathlonLife/team-ttl-dashboard
cd team-ttl-dashboard
```

### 2. Set up Supabase
1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in the SQL Editor
3. Enable magic link auth: Authentication → Providers → Email
4. Set Site URL to `http://localhost:5173`
5. Add `http://localhost:5173/**` to Redirect URLs

### 3. Configure environment variables
```bash
cd frontend
copy .env.example .env.local
```
```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_STRAVA_CLIENT_ID=your-strava-client-id
```

### 4. Run the frontend
```bash
npm install
npm run dev
```

### 5. Make yourself admin
```sql
UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
```

---

## Deployment

### Frontend → Vercel

```bash
cd frontend
vercel --prod
```

Required environment variables in Vercel dashboard:

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_STRAVA_CLIENT_ID` | Strava app Client ID (used in OAuth URL) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (used in serverless functions) |
| `STRAVA_CLIENT_ID` | Strava app Client ID |
| `STRAVA_CLIENT_SECRET` | Strava app Client Secret |

### GitHub Actions

Add these secrets to your repo (Settings → Secrets → Actions):

| Secret | Description |
|--------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `TRIATHLON_API_KEY` | triathlon.org API key |
| `STRAVA_CLIENT_ID` | Strava app Client ID |
| `STRAVA_CLIENT_SECRET` | Strava app Client Secret |
| `WHATSAPP_TOKEN` | Meta system user token *(disabled)* |
| `WHATSAPP_PHONE_ID` | Meta phone number ID *(disabled)* |
| `WHATSAPP_CHANNEL_ID` | WhatsApp channel ID *(disabled)* |

The scraper runs at 6am UTC daily. Strava sync runs every 2 hours. Both can be triggered manually via GitHub → Actions → Run workflow.

---

## Database Schema

| Table | Description |
|-------|-------------|
| `profiles` | Team members — name, email, avatar, role, WhatsApp, Strava tokens |
| `races` | All races — name, type, date, location, coordinates, source, URL |
| `race_entries` | Which athlete is entered in which race |
| `channels` | Messaging channels — general, topic, race threads |
| `messages` | Messages — content, image URL, reply_to, edited_at |
| `message_reactions` | Emoji reactions on messages |
| `message_mentions` | @mention tracking per message |
| `channel_reads` | Last-read timestamps per user per channel |
| `discounts` | Partner discount codes — brand, code, amount, expiry, logo |
| `strava_activities` | Cached Strava activities — synced every 2h, kept for 90 days |
| `notification_log` | WhatsApp notification log |

### Key RLS Note
The `message_mentions` SELECT policy must be:
```sql
CREATE POLICY "Read own mentions" ON message_mentions
  FOR SELECT USING (auth.uid() = mentioned_user_id);
```

### Performance
Unread message count uses a Postgres function for a single round trip:
```sql
CREATE OR REPLACE FUNCTION get_unread_count(p_user_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(
    (SELECT COUNT(*) FROM messages m
     WHERE m.channel_id = c.id
     AND (cr.last_read_at IS NULL OR m.created_at > cr.last_read_at))
  ), 0)::int
  FROM channels c
  LEFT JOIN channel_reads cr ON cr.channel_id = c.id AND cr.athlete_id = p_user_id
$$;
```

---

## Strava Integration

Athletes connect Strava via OAuth from the Training page. Tokens are stored on their profile. The sync script (`backend/strava-sync.js`) runs every 2 hours via GitHub Actions, fetching the last 90 days of activities for all connected athletes and upserting to the `strava_activities` table. Activities older than 90 days are pruned automatically.

The Training page reads directly from Supabase — no live Strava API calls at page load, making it instant. Athletes can trigger a manual refresh from the Training page header.

**Strava App Setup:**
1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Create an app — set Authorization Callback Domain to your Vercel domain
3. Add Client ID and Client Secret to Vercel and GitHub secrets

---

## Race Data Sources

| Source | Coverage | Method |
|--------|----------|--------|
| triathlon.org API | Olympic, Sprint, World Tri Series | API |
| PTO Race Calendar | IRONMAN Full, 70.3 | Web scraping |

Race channels (created when athletes discuss a race) auto-delete 14 days after the race date.

---

## Messaging Architecture

- **Real-time** — Supabase WebSocket subscriptions
- **Optimistic UI** — messages appear at 50% opacity with "Sending..." label, confirmed on DB insert
- **Deduplication** — subscription skips messages already added optimistically
- **Replies** — Discord-style with quoted parent message
- **@mentions** — matched against profile names, stored in `message_mentions`, surfaced in Mentions view with pink badge
- **Edits** — inline edit on hover for own messages, marked with `(edited)` label
- **Race threads** — auto-created on "Discuss This Race", auto-deleted 14 days post-race
- **Unread badge** — calculated via single Postgres RPC call, refreshes every 30s

---

## Roadmap

### Planned
- Race history (past races)
- Leaderboard
- Admin member management
- CSV race import

### Parked
- WhatsApp notifications *(pending Meta Business approval)*
- Mobile app integration *(see FLUTTER_INTEGRATION.md)*

---

## Contributing

Private team project. Open an issue or contact the team admin for bugs and feature requests.

---

*Built for ThatTriathlonLife — Train smart, race hard, finish strong.* 🤘
