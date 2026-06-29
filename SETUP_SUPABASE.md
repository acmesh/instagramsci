# Phase 2 — Self-hosting Supabase on your Devuan server

This wires the site to a real backend: accounts, the approval queue, posting with
image upload, and reactions. The frontend stays **buildless** — the Supabase
client loads from a CDN, so you still just upload the static files.

> **Reality check:** I built and validated the integration code, but it has **not**
> been run against a live database from here. Treat the first run as a test: go
> through signup → approve → post yourself and watch the browser console.

---

## 1. Run Supabase (Docker) on Devuan

Devuan uses sysvinit (no systemd); Docker works fine. Install Docker + compose,
then use the official self-hosting bundle:

```bash
sudo apt install docker.io docker-compose-plugin git
sudo service docker start

git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
```

**Edit `.env` before starting** — at minimum change:
- `POSTGRES_PASSWORD` — a strong password
- `JWT_SECRET` — a 40+ char random string
- `ANON_KEY` and `SERVICE_ROLE_KEY` — generate a matching pair for your `JWT_SECRET`
  (the Supabase docs' "Generate API keys" tool produces them; they're JWTs signed
  with your secret)
- `SITE_URL` — your site's public URL, e.g. `https://instagramsci.example.org`
- `API_EXTERNAL_URL` — where the API gateway is reachable, e.g. `https://api.example.org`

> Verify the exact variable names against the version you cloned — the self-host
> compose file changes over time, so check the official self-hosting guide rather
> than trusting these names blindly.

Start it:
```bash
docker compose up -d
```
The API gateway (Kong) listens on port **8000** by default. Put your reverse proxy
(nginx from `DEPLOY.md`) in front of it for `https://api.example.org`.

## 2. Create the schema

Open Studio (default `http://your-server:8000` → Studio, or `:3000` depending on
your compose) → **SQL Editor**, and run, in order:

1. `supabase/schema.sql`
2. `supabase/seed.sql`  *(tags now; the first post inserts after step 5)*

Or via psql:
```bash
psql "postgresql://postgres:YOUR_PG_PASSWORD@your-server:5432/postgres" -f supabase/schema.sql
psql "postgresql://postgres:YOUR_PG_PASSWORD@your-server:5432/postgres" -f supabase/seed.sql
```

## 3. Point the frontend at your backend

Edit `js/config.js`:
```js
export const SUPABASE_URL = "https://api.example.org";   // your API_EXTERNAL_URL
export const SUPABASE_ANON_KEY = "eyJ...";               // the ANON_KEY from .env
```
The anon key is **public by design** — Row-Level Security (in `schema.sql`) is what
protects the data. Never put the `SERVICE_ROLE_KEY` in frontend files.

## 4. Allow your site's origin (CORS / auth redirect)

In `.env` (or Studio → Authentication → URL config), make sure `SITE_URL` and any
`ADDITIONAL_REDIRECT_URLS` include your real site origin, e.g.
`https://instagramsci.example.org`. Restart: `docker compose up -d`.

## 5. Make yourself admin, then add the first post

1. Open your deployed site → **Apply to join** → sign up with your email/password.
2. In SQL Editor, promote yourself:
   ```sql
   update public.profiles set is_admin = true, is_approved = true
   where handle = '@yourhandle';   -- or use your email via a join to auth.users
   ```
3. Re-run the first-post block in `supabase/seed.sql` (it attributes the pinned
   Gramsci post to the first admin).
4. Reload the site — you'll see **Member review** in the sidebar, and the pinned
   first post in the feed.

## 6. Email on approval (optional, later)

Approval currently flips a flag in-app. To email applicants when approved, add a
Supabase Edge Function or a database webhook on `membership_applications` status
changes, wired to your SMTP. Left out of Phase 2 to avoid mail-server setup.

---

## How the pieces map

| File | Role |
|---|---|
| `js/config.js` | Your URL + anon key (the only thing you edit) |
| `js/supabase.js` | Creates the client from the CDN; `LIVE` flag |
| `js/auth.js` | signup/login/logout + profile (approval/admin) |
| `js/api.js` | feed, createPost (Storage upload), reactions, approve/reject — **live or demo** |
| `js/app.js` | UI: auth state, gating, admin page |
| `supabase/schema.sql` | tables, RLS, triggers, approval RPCs, feed view, storage |
| `supabase/seed.sql` | tags + pinned first post |

**Demo fallback:** with `config.js` empty, `LIVE` is false and the site serves the
local seed data — login/posting are simulated, the admin page shows sample
applications. Fill in `config.js` to go live. Nothing else changes.
