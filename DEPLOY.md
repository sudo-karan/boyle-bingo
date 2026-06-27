# Deploying Boyle Bingo — detailed runbook

Everything here is free tier and needs no credit card. End-to-end this takes
~30–45 minutes the first time. Order matters; do the sections in sequence.

You'll need:
- a [GitHub](https://github.com) account (the repo is already at `sudo-karan/boyle-bingo`)
- a [Supabase](https://supabase.com) account (sign in with GitHub)
- [Node.js 18+](https://nodejs.org) and [Git](https://git-scm.com) locally
- the [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase`) — optional but recommended for the edge function

---

## 1. Create the Supabase project

1. Supabase dashboard → **New project**. Pick the **Free** plan, a name, a strong
   database password (save it), and the region closest to your group.
2. Wait for it to finish provisioning (~2 min).
3. Go to **Project Settings → API** and copy three things:
   - **Project URL** → this is `VITE_SUPABASE_URL`
   - **anon / public** key → `VITE_SUPABASE_ANON_KEY` (safe to ship)
   - **service_role** key → keep this secret; used only by the local scripts and
     the edge function. **Never commit it or put it in the frontend.**

---

## 2. Run the database migrations

The SQL in `supabase/migrations/` builds the schema, the RLS policies (your
security boundary), the rules engine, the leaderboard, the storage bucket,
realtime, grants, and the cron tick.

**Option A — SQL editor (simplest):** Open **SQL Editor** in the dashboard. Run
each file in `supabase/migrations/` **in numeric order** (`0001` → `0008`),
pasting and executing one at a time.

> Before running `0008_cron.sql`, enable the extension: **Database → Extensions
> → search "pg_cron" → enable**. If you skip cron entirely, phase transitions
> still happen whenever any logged-in user opens the app (the client nudges
> `tick_games`), so cron is a nice-to-have, not required.

**Option B — Supabase CLI:**
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### Verify the migrations
In the SQL editor, run the end-to-end test — it exercises the whole rule set and
rolls back, leaving no data:
```
supabase/tests/rules_test.sql
```
If it finishes with `ALL TESTS PASSED`, the engine is wired correctly. A failure
aborts with a `FAIL: ...` message naming the rule that broke.

---

## 3. Create the `photos` storage bucket

`0005_storage_realtime.sql` already creates the `photos` bucket and its policies.
Confirm under **Storage** that a public `photos` bucket exists. If not, create it
manually (name `photos`, public) and re-run that migration.

---

## 4. Deploy the account-creation edge function

The in-app **Accounts** screen calls this function, which verifies the caller is
an admin and then creates the account with the service_role key **server-side**.

```bash
supabase functions deploy admin-create-user
supabase secrets set USERNAME_EMAIL_DOMAIN=boylebingo.local
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
into edge functions automatically — you don't set those yourself.

> No CLI? You can also create the function in the dashboard under **Edge
> Functions → Create a function**, name it `admin-create-user`, and paste the
> contents of `supabase/functions/admin-create-user/index.ts`.

---

## 5. Create the first admin (bootstrap)

The Accounts screen needs an admin to already exist, so create the first one
directly with the service_role key:

```bash
git clone https://github.com/sudo-karan/boyle-bingo && cd boyle-bingo
npm install

SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ...service_role... \
node scripts/bootstrap-admin.mjs admin "Admin" "a-strong-password"
```

To load the whole roster at once instead of typing each in-app, write a
`roster.json` (see `scripts/seed-roster.mjs` header) and run:
```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-roster.mjs roster.json
```

---

## 6. Configure GitHub for deployment

1. In the repo: **Settings → Pages → Build and deployment → Source = GitHub
   Actions**.
2. **Settings → Secrets and variables → Actions → Variables** tab → **New
   repository variable**, add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
   - `VITE_USERNAME_EMAIL_DOMAIN` = `boylebingo.local` (optional; must match step 4)

   These are **Variables**, not Secrets — they're public values baked into the
   client, and RLS is what protects the data.

---

## 7. Deploy the frontend

Push to `main` (the merge already did this) or trigger manually:

- **Actions → Deploy to GitHub Pages → Run workflow**, or push any commit to
  `main`.
- When it finishes, the site is at `https://sudo-karan.github.io/boyle-bingo/`.
  (The build sets the correct `/boyle-bingo/` base path automatically.)

The **Supabase keep-alive** workflow runs every 2 days on its own to stop the
project pausing. You can also run it manually once from the Actions tab to
confirm it gets a healthy response.

---

## 8. First run-through

1. Open the site, install it (browser menu → *Add to Home Screen*).
2. Sign in as the admin → **Accounts** tab → create the players (and the person
   who'll be the target).
3. **Setup** tab → create a game: pick the target, grid size, a **freeze time** a
   few minutes out, an **end time**, and the vote window → **Create game** →
   **Start fill**.
4. Have players sign in, add predictions, and build cards before freeze.
5. At freeze the live window opens — raise activities, vote, cross out.

### Smoke-test the security model yourself
Before a real game, sign in as the **target** during fill and confirm you see
only "You are the target. Beware." — no pool, no cards. That proves RLS is doing
its job (the test in step 2 checks this too).

---

## Local development

```bash
cp .env.example .env.local      # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev                      # http://localhost:5173
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Login always fails | Username maps to `<username>@<domain>`; the domain in the app (`VITE_USERNAME_EMAIL_DOMAIN`) must match the one used when the account was created (`USERNAME_EMAIL_DOMAIN`). |
| "admin only" on the Accounts screen | The signed-in user isn't an admin. Bootstrap one (step 5). |
| Account creation fails with a network/CORS error | The `admin-create-user` function isn't deployed, or its secrets aren't set (step 4). |
| Target can see the pool | RLS/migrations didn't apply — re-run `0002_rls.sql` and the rules test. |
| Game never freezes/ends | Enable `pg_cron` (step 2) or just have someone open the app — the client nudges transitions. |
| Blank page / 404 on deep link | Confirm Pages source is **GitHub Actions** and the build used the `/boyle-bingo/` base (the workflow sets it). |
| Supabase project paused | Open the dashboard to resume, then check the keep-alive workflow is enabled. |
