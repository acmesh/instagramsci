# Instagramsci

A visual social network for socialist, community-driven, inclusive ideas, grounded in a Third Industrial Revolution (Rifkin-style) decentralized economic model. *Instagram + Antonio Gramsci.*

Every post pairs an **image** with an **aphorism** — a sharp, shareable idea. The aphorism is the unit of value, not the influencer.

## Run it

This is a static site, but it uses **JavaScript ES modules**, which browsers block over `file://`. Serve it over HTTP:

```bash
cd Instagramsci
python3 -m http.server 8000
# then open http://localhost:8000
```

(Any static server works — `npx serve`, VS Code Live Server, etc.)

## Structure

```
index.html        Page shell + all views (feed, explore, compose, profile, manifesto)
css/tokens.css    Design tokens — palette sampled from the Gramsci artwork
css/styles.css    Components & layout
js/data.js        Seed content (post shape mirrors the Supabase schema)
js/app.js         Rendering + view switching + reactions
assets/           Brand artwork (instagramsci.jpg)
js/config.js      Backend config — paste your Supabase URL + anon key here
js/supabase.js    Supabase client (loaded from CDN; sets LIVE flag)
js/auth.js        Signup / login / logout + profile (approval, admin)
js/api.js         Feed, posting, reactions, approvals — live OR demo fallback
assets/logo.svg   Logo mark (ochre star / aperture roundel)
supabase/schema.sql  Tables, RLS, triggers, approval RPCs, feed view, storage
supabase/seed.sql    Tags + pinned first post
ARCHITECTURE.md   Site map, data model, build phases, migration path
STYLE_GUIDE.md    Full design system
DEPLOY.md         Self-hosting the site on your Devuan/Linux server (nginx/apache)
SETUP_SUPABASE.md Self-hosting Supabase (Docker) + going live
```

## Backend (Phase 2)

The frontend picks a backend automatically from `js/config.js` (`MODE`):

- **postgres** — your own PostgreSQL + a small Python API (`backend/`). Set
  `API_BASE="/api"`. **Recommended for self-hosting.** Full walkthrough:
  **SETUP_POSTGRES.md**.
- **supabase** — alternative: set the `SUPABASE_*` values. See **SETUP_SUPABASE.md**.
- **demo** — leave config empty: the site runs on local seed data, login/posting
  simulated, so nothing breaks while you set things up.

A browser can't reach PostgreSQL directly, so the Python API (`backend/app.py`,
Flask + psycopg2) sits between them: it handles signup/login, password hashing,
the approval check, image uploads, and reactions. It runs behind nginx alongside
the static files — no Docker, no extra services beyond Postgres.

Access model: reading is open to all; **posting requires an approved account**.
Signup files an application; an admin approves it on the in-app **Member review**
page, which unlocks posting for that member.

## Features (Phase 1)

- Landing gate with logo, wordmark, and entry CTAs
- Light/dark theme toggle (remembers your choice)
- Feed with a pinned first post, Latest/Commons tabs, Resonate/Collect reactions
- Explore by theme, Profile grid, Manifesto
- **Apply to join** flow: reading is open; posting requires a reviewed + approved account
- **Settings** (signed-in): edit avatar, display name, bio, pronouns, email, password
- **Two-factor auth** (TOTP): enable with an authenticator app; logins then require a 6-digit code
- **Reactions** (Resonate / Collect / Amplify): persist per user — your choices stay highlighted across reloads
- **Comments**: Discuss opens a thread under each post; approved members can reply

## The first post

The pinned inaugural post lives in `js/data.js` as `FIRST_POST`. Edit it there.

## License

Copyleft 🄯 2026 acme@dyne.org, Rome

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.  This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details.  You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <http://www.gnu.org/licenses/>.

## Roadmap

- **Phase 1 (now):** static prototype, seed data — done.
- **Phase 2:** Supabase auth + Postgres + Storage; real signups and posting.
- **Phase 3:** decentralized media (Cubbit/IPFS), community governance, Fediverse bridge.

See `ARCHITECTURE.md` for details.
