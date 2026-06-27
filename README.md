# Boyle Bingo

A private, multi-user **prediction bingo** game delivered as an installable PWA.
Each day an admin picks one player to be the **target**; everyone else fills a
bingo card with predictions of what the target will say or do. During a real
event, witnesses raise activities, the present players vote, and predictors who
were there cross them off. A live leaderboard ranks everyone.

Built to be **zero cost, no credit card**: Supabase free tier (Postgres + Auth +
Realtime + Storage + RLS) and GitHub Pages.

## Stack

- **Frontend:** Vite + React + TypeScript, installable PWA (`vite-plugin-pwa`).
- **Backend:** Supabase. All game rules live in Postgres `SECURITY DEFINER`
  functions; the anon key ships in the bundle and **Row-Level Security is the
  security boundary** (the target's client physically cannot read the pool or
  other players' cards).
- **Hosting:** GitHub Pages via Actions; a 2-day keep-alive workflow stops the
  Supabase project pausing.

## Game rules (notable decisions for this group)

- A raise requires **≥2 present non-target witnesses** (the raiser + at least one
  other). There is no lone-witness auto-approve.
- Approval tally **excludes the target** — they can register a "no" but cannot
  veto, and cannot confirm presence claims.
- "I was there too" presence claims are confirmed by a **≥50% vote of the present
  non-target cohort**.
- Merge proposals pass on **more yes than no, min 2 yes**. Lines = rows + columns
  + both diagonals. Free space **off** by default.
- Only activities **after `freeze_at`** count.

See the original spec for the full ruleset.

## Setup

### 1. Supabase project
1. Create a free project. Note the **Project URL** and **anon public key**
   (Settings > API). Also grab the **service_role key** for the one-off admin
   bootstrap below (never commit it).
2. Run the migrations in `supabase/migrations/` in order, via the SQL editor or
   the CLI (`supabase db push`). They create the schema, RLS policies, the rules
   engine, the leaderboard function, the `photos` bucket, realtime publication,
   grants, and the `pg_cron` tick.
3. Enable the **pg_cron** extension (Dashboard > Database > Extensions) before
   running `0008_cron.sql`, or run that file afterwards.
4. Deploy the edge function (creates accounts with the service_role key
   server-side):
   ```
   supabase functions deploy admin-create-user
   supabase secrets set USERNAME_EMAIL_DOMAIN=boylebingo.local
   ```

### 2. First admin (bootstrap)
The in-app account screen needs an admin to exist first:
```
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
node scripts/bootstrap-admin.mjs admin "Admin" "a-strong-password"
```
After this, create all other accounts from the in-app **Accounts** tab.

### 3. Frontend
```
cp .env.example .env.local   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

### 4. Deploy (GitHub Pages)
1. Repo **Settings > Pages**: Source = GitHub Actions.
2. Repo **Settings > Secrets and variables > Actions > Variables**: add
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally
   `VITE_USERNAME_EMAIL_DOMAIN`.
3. Push to `main` — the deploy workflow builds and publishes. The keep-alive
   workflow runs every 2 days automatically.

## How a game runs

1. **Admin** creates a game (target, grid, freeze time, end time, vote window),
   then "Start fill".
2. **Players** add predictions to the shared pool and build their cards.
3. At `freeze_at` cards lock and the **live window** opens.
4. Witnesses **raise** activities; present players **vote**; eligible predictors
   **cross out**. Presence disputes resolve by cohort vote; the admin can strike
   anything.
5. At `ends_at` the leaderboard finalises.

## Project layout

```
supabase/migrations/   schema, RLS, rules engine, leaderboard, storage, cron
supabase/functions/    admin-create-user edge function
scripts/               first-admin bootstrap
src/lib/               supabase client, typed RPC wrappers, auth, realtime hook
src/components/         login, leaderboard, raise/approval/feed widgets
src/pages/             admin / player / target homes; fill & live boards
.github/workflows/     Pages deploy + Supabase keep-alive
```
