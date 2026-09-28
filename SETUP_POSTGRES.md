# Instagramsci — Setup with your own PostgreSQL (no Supabase)

This is the full path to a live site on your Devuan server using the PostgreSQL
you already have, plus a small Python API. Architecture:

```
Browser ──HTTPS──> nginx ──┬─ /            static site: public/ only (index.html, css, js, assets)
                           ├─ /uploads/    uploaded post images (served by nginx)
                           └─ /api/  ──>    Flask API (gunicorn, 127.0.0.1:8077) ──> PostgreSQL
```

Why an API at all: browsers can't talk to PostgreSQL directly, and someone has to
hash passwords, check approvals, and accept uploads. That's the Flask app in
`backend/`. It's the only moving part beyond Postgres and your web server.

> **Only `public/` may be web-visible.** The web server's document root is
> `…/instagramsci/public`, never the project folder itself. `backend/` holds
> `.env` (database password and `SECRET_KEY`); anyone who can download it can
> log in as any user. Check after every server change:
> `curl -s https://your-site/backend/.env | grep -c SECRET_KEY` must print 0.

---

## 0. Prerequisites

- PostgreSQL running (you have this).
- `python3` (you have this) + `pip` and the `venv` module.
- nginx (from `DEPLOY.md`) as the public web server / reverse proxy.

```bash
sudo apt install python3-venv python3-pip libpq-dev   # libpq-dev only if building psycopg2 from source
```

---

## 1. Create the database and a role

As the postgres superuser:

```bash
sudo -u postgres psql
```
```sql
create role instagramsci with login password 'CHOOSE_A_STRONG_PASSWORD';
create database instagramsci owner instagramsci;
\q
```

## 2. Create the schema

```bash
cd /var/www/instagramsci          # wherever you uploaded the project
psql "postgresql://instagramsci:CHOOSE_A_STRONG_PASSWORD@127.0.0.1:5432/instagramsci" \
  -f backend/schema.sql
```
This creates the tables, the `post_feed` view, indexes, and seeds the theme tags.
(The pinned first post comes later, in §6.)

## 3. Install and configure the API

```bash
cd /var/www/instagramsci/backend
python3 -m venv venv
. venv/bin/activate
pip install -r requirements.txt          # Flask, psycopg2-binary, gunicorn

cp .env.example .env
```
Edit `.env` (use the URL form — it can't be mangled by spaces):
```ini
DATABASE_URL=postgresql://instagramsci:CHOOSE_A_STRONG_PASSWORD@127.0.0.1:5432/instagramsci
SECRET_KEY=PASTE_OUTPUT_OF: python3 -c "import secrets;print(secrets.token_urlsafe(48))"
UPLOAD_DIR=/var/www/instagramsci/backend/uploads
PORT=8077
```
> If your password contains `@ : /` etc., URL-encode it in the URL form (e.g. `@`→`%40`),
> or use the quoted key/value form shown in `.env.example`.

Quick test (dev server) — **do not `source` the .env; the app reads it itself**:
```bash
python3 app.py            # serves http://127.0.0.1:8077, auto-loads ./.env
curl http://127.0.0.1:8077/health     # -> {"ok": true}
```
If `/health` returns `{"ok": false, "error": "..."}`, the message is the Postgres
connection error — usually a wrong password/host/db in `DATABASE_URL`, or Postgres
not accepting the connection. `Ctrl-C` when satisfied.

## 4. Run the API as a service (Devuan / sysvinit)

Production uses gunicorn. A ready init script is provided at
`backend/instagramsci-api.init` — it runs as `www-data`, `--chdir`s into the
backend dir, and **logs gunicorn's output to `/var/log/instagramsci-api.log`** so
startup failures are visible (the plain `--background` form hides them).

**First, set ownership** so the service user can read config and write uploads:

```bash
# project readable/executable by www-data (dirs 755 is enough)
sudo chown www-data /var/www/instagramsci/backend/.env       # contains DB creds
sudo chmod 640      /var/www/instagramsci/backend/.env
sudo chown -R www-data:www-data /var/www/instagramsci/backend/uploads
```

> The `venv` must be runnable by `www-data` (readable + executable). If you created
> it as another user under a 755 path, that's fine. If it lives in a private home
> dir, recreate it under the project, e.g. `/var/www/instagramsci/backend/venv`.

**Debug first (recommended):** before wiring the service, run gunicorn exactly as
the service will — in the foreground, as `www-data` — so any error prints directly:

```bash
sudo -u www-data /var/www/instagramsci/backend/venv/bin/gunicorn \
  --no-control-socket -w 2 -b 127.0.0.1:8077 \
  --chdir /var/www/instagramsci/backend app:app
```
Fix whatever it reports (see the table below), then `Ctrl-C`.

> `--no-control-socket` matters: gunicorn 23+ otherwise tries to open a control
> socket under the service user's home (`$HOME/.gunicorn`). `www-data`'s home is
> `/var/www`, which it can't write, so startup fails with
> `Control server error: [Errno 13] Permission denied: '/var/www/.gunicorn'`.
> The provided init script already passes this flag.

**Install the service:**
```bash
sudo cp /var/www/instagramsci/backend/instagramsci-api.init /etc/init.d/instagramsci-api
sudo chmod +x /etc/init.d/instagramsci-api
sudo update-rc.d instagramsci-api defaults
sudo service instagramsci-api start
sudo service instagramsci-api status      # "running (pid …)" or points you to the log
curl http://127.0.0.1:8077/health         # -> {"ok": true}
```
If `status` says NOT running: `sudo tail -n 40 /var/log/instagramsci-api.log`.

### Why a sysvinit service "doesn't start" — and the fix

| Symptom in the log / foreground run | Cause | Fix |
|---|---|---|
| `gunicorn: not found` / `No such file` | venv path wrong, or gunicorn not installed in it | `ls backend/venv/bin/gunicorn`; re-run `pip install -r requirements.txt` inside the venv |
| `Permission denied` on venv/python | venv not executable by `www-data` | recreate venv under the project, or fix perms |
| `ModuleNotFoundError: app` | not chdir'd into `backend/` | the provided script uses `--chdir` — make sure `DIR` matches your path |
| `Control server error: ... Permission denied: '/var/www/.gunicorn'` | gunicorn 23+ control socket tries to write under www-data's home `/var/www` | pass `--no-control-socket` (the init script does) |
| `[Errno 98] Address already in use` | a stray `python3 app.py`/gunicorn still on 8077 | `sudo fuser -k 8077/tcp` then start |
| `psycopg2 ... could not connect` / DSN error | `.env` unreadable by `www-data`, so it fell back to defaults | `chown www-data .env` (above); confirm `DATABASE_URL` |
| Nothing in log, exits instantly | `.env` unreadable or `DIR` wrong | run the foreground debug command above to see the real error |

## 5. nginx: serve the site, proxy the API, serve uploads

Extend the server block from `DEPLOY.md`:

```nginx
server {
    listen 80;
    server_name instagramsci.example.org;
    root /var/www/instagramsci/public;     # public/ only, never the project root
    index index.html;

    location / { try_files $uri $uri/ /index.html; }

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # API → Flask/gunicorn
    location /api/ {
        proxy_pass http://127.0.0.1:8077/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        client_max_body_size 8m;          # matches the API's upload limit
    }

    # Uploaded images
    location /uploads/ {
        alias /var/www/instagramsci/backend/uploads/;
        expires 30d;
        add_header X-Content-Type-Options nosniff always;
    }
}
```
```bash
sudo nginx -t && sudo service nginx restart
```
Because the API is same-origin (`/api/`), there's **no CORS to configure**. Add
HTTPS with certbot as in `DEPLOY.md`.

### 5b. nginx alternative: Apache2

Prefer Apache? A ready vhost is at `backend/instagramsci.apache.conf`. It does the
same three jobs (static site, proxy `/api/`, serve `/uploads/`, SPA fallback).

```bash
sudo a2enmod proxy proxy_http headers rewrite          # required modules
sudo cp /var/www/instagramsci/backend/instagramsci.apache.conf \
        /etc/apache2/sites-available/instagramsci.conf
sudo a2ensite instagramsci
sudo a2dissite 000-default            # optional
sudo apache2ctl configtest            # expect: Syntax OK
sudo service apache2 restart          # Devuan: sysvinit, not systemd
```

Key points in that file:
- `DocumentRoot …/public` serves only the static site; a `Require all denied`
  block keeps `backend/` unreachable even if the root is ever pointed one level up.
- `ProxyPass /api/ http://127.0.0.1:8077/` sends API calls to gunicorn; everything
  else is served from disk. `proxy` + `proxy_http` modules are required.
- `Alias /uploads/ …/backend/uploads/` serves uploaded images directly, with
  `SetHandler none` so nothing there can run as a script. (The API also
  re-encodes every image and gives it a random name.)
- A `mod_rewrite` block falls back to `index.html` for client-side routes, while
  excluding `/api/`, `/uploads/`, and real files — `rewrite` module required.
- `LimitRequestBody 8388608` matches the API's 8 MB upload cap.

HTTPS with Apache:
```bash
sudo apt install certbot python3-certbot-apache
sudo certbot --apache -d instagramsci.example.org
```
Same-origin still applies, so no CORS. Run **either** nginx **or** Apache on port
80/443 — not both.

## 6. Point the frontend at the API, create your admin, add the first post

1. Edit `public/js/config.js`:
   ```js
   export const API_BASE = "/api";   // that's all — leave the SUPABASE_* lines empty
   ```
2. Open your site → **Apply to join** → sign up (email, password, handle, intentions).
3. Promote yourself to admin:
   ```bash
   psql "postgresql://instagramsci:...@127.0.0.1/instagramsci" \
     -c "update users set is_admin=true, is_approved=true where handle='yourhandle';"
   ```
   (Use your handle **without** the leading `@` — the API stores it stripped.)
4. Add the pinned first post:
   ```bash
   psql "postgresql://instagramsci:...@127.0.0.1/instagramsci" -f backend/seed_first_post.sql
   ```
5. Reload — you'll see **Member review** in the sidebar and the pinned Gramsci post
   in the feed. New signups now appear in Member review for you to approve.

---

## Profile editing & two-factor auth (2FA)

Signed-in members get a **Settings** page (sidebar) to change their avatar,
display name, bio, pronouns, email, and password, and to turn on **TOTP 2FA** —
scan the QR with an authenticator app (Aegis, Google Authenticator, 1Password…);
logins then require a 6-digit code. Disabling 2FA asks for the account password.

If your database/backend predate these features, upgrade an existing install:

```bash
# 1) add the 2FA columns to the existing DB
psql "postgresql://instagramsci:PASSWORD@127.0.0.1:5432/instagramsci" -f backend/migrate_2fa.sql
# 1b) update the feed view for Amplify + comment counts (supersedes migrate_amplify.sql)
psql "postgresql://instagramsci:PASSWORD@127.0.0.1:5432/instagramsci" -f backend/migrate_comments.sql
# 1c) add the is_blocked column for member management
psql "postgresql://instagramsci:PASSWORD@127.0.0.1:5432/instagramsci" -f backend/migrate_block.sql
# 2) install the new dependency (pyotp) and restart the API
cd /var/www/instagramsci/backend && . venv/bin/activate && pip install -r requirements.txt
sudo service instagramsci-api restart
```
After updating, also re-upload the static frontend (the `public/` folder).
(Fresh installs need nothing extra — `schema.sql` already includes the columns and
`requirements.txt` includes `pyotp`.) The QR code is rendered in the browser from a
small library loaded on demand, so no server-side QR dependency is needed.

## Daily flow

- Someone signs up → a row lands in `membership_applications` (status `pending`)
  and their account is created but **unapproved** (they can read, not post).
- You open **Member review**, read their intentions, click **Approve** → posting
  unlocks for them.
- **Members** (admin sidebar) lists everyone approved. **Block** suspends an
  account — they can't log in or post, but their content stays; **Unblock**
  restores it. **Delete** removes the account and all its posts/comments (FK
  cascade). You can't block or delete your own admin account.
- Approved members post (image upload → `backend/uploads/`, served at `/uploads/`).

## Backups

```bash
pg_dump -U instagramsci instagramsci > instagramsci-$(date +%F).sql
# uploaded images live in backend/uploads/ — back that folder up too.
```

## Login fails even though signup worked

Signup *creates* a password hash; login *verifies* it. If signup worked but login
returns "Wrong email or password", inspect the stored row:

```sql
select id, email, left(password_hash,14) AS method, length(password_hash) AS len,
       is_approved, is_admin
from users where email = lower('YOUR_EMAIL');
```
- **0 rows** → the email doesn't match (case/typo), or the account was created in
  demo mode and never reached Postgres. Sign up again through the site (with
  `API_BASE="/api"` set).
- **`method` is `scrypt:32768:` or `pbkdf2:sha256`** → real hash; the password just
  doesn't match (stray space, autofill, different case). Reset it (below).
- **`method` looks like your plaintext password** (not `scrypt:`/`pbkdf2:`) → the
  row was created/edited directly in SQL, so there's no real hash. Reset it:

```bash
cd /var/www/instagramsci/backend
. venv/bin/activate
python3 set_password.py you@example.org      # prompts for a new password
```
This writes a proper hash; login will then work. (New signups use `pbkdf2:sha256`,
which is portable everywhere; older `scrypt` hashes still verify fine.)

> Tip: whether login returned **401** (wrong email/password — hash mismatch) or
> **500** (server error) is in `/var/log/instagramsci-api.log`. A 401 means the
> account/password didn't match; a 500 means something threw — paste that line.

## Troubleshooting

- **`ERROR: relation "users" does not exist`** in psql → you're connected to the
  wrong database (e.g. `sudo -u postgres psql` opens the default `postgres` DB, not
  your app's). The API uses the database at the end of its `DATABASE_URL`
  (`…/instagramsci`). Connect to that one and retry:
  `psql "postgresql://instagramsci:PASSWORD@127.0.0.1:5432/instagramsci" -c "\dt"`,
  or inside psql run `\c instagramsci` first. Check where you are with
  `select current_database();` and list databases with `\l`.
- **Avatar/post image upload fails with `PermissionError: [Errno 13]` on
  `…/uploads/…`** → the API user (`www-data`) can't write to `UPLOAD_DIR`. Make the
  three things agree: `UPLOAD_DIR` in `.env`, the directory's owner, and the web
  server's `/uploads/` alias must all point at the **same** path, owned by the API
  user. Using the backend's own folder:
  ```bash
  D=/var/www/instagramsci/backend/uploads   # <-- your backend uploads path
  sudo mkdir -p "$D" && sudo chown -R www-data:www-data "$D" && sudo chmod 775 "$D"
  # set UPLOAD_DIR=$D in backend/.env, and point the web server /uploads/ alias at $D
  sudo service instagramsci-api restart
  ```
  Watch for a path mismatch: if `.env`'s `UPLOAD_DIR` points to a different directory
  than where the app actually lives, fix `UPLOAD_DIR` to the real path.
  Verify with `curl http://127.0.0.1:8077/health` — it now reports `upload_dir` and
  `upload_writable`.
- **`/api/health` returns 500** → check the JSON it returns: `db:false` means a
  database/`DATABASE_URL` problem; `upload_writable:false` means the uploads
  permission issue above.
- **Login works but posting 403** → the account isn't approved yet (expected) — or
  you forgot to approve it in Member review.
- **Images don't appear** → confirm nginx `/uploads/` alias path matches `UPLOAD_DIR`,
  and that the API user can write to `backend/uploads/`.
- **401 on every authed call** → token/`SECRET_KEY` mismatch; don't change
  `SECRET_KEY` after users log in (it invalidates issued tokens).

---

### File map (Phase 2, Postgres path)

| File | Role |
|---|---|
| `backend/app.py` | The API (Flask + psycopg2) |
| `backend/schema.sql` | Tables, feed view, tag seed (plain Postgres) |
| `backend/seed_first_post.sql` | The pinned first post |
| `backend/requirements.txt` | Flask, psycopg2-binary, gunicorn |
| `backend/.env.example` | Backend configuration template |
| `public/js/config.js` | Set `API_BASE="/api"` to go live |
| `js/rest.js` | Frontend REST client (token in localStorage) |
| `js/auth.js`, `js/api.js` | Mode-aware (postgres / supabase / demo) |

> The Supabase path (`SETUP_SUPABASE.md`, `supabase/`) is still here as an
> alternative. Pick one backend in `js/config.js`; `API_BASE` wins if both are set.
