# Deploying Instagramsci on your Devuan (Linux) server

The site is plain HTML/CSS/JS (no build step) plus a small Python API in
`backend/`. For the database and API setup, follow **SETUP_POSTGRES.md**; this file
covers the files and the web server.

## Layout: only `public/` is web-visible

```
/var/www/instagramsci/
├── public/      index.html, css/, js/, assets/    <- web server document root
└── backend/     app.py, .env, venv/, uploads/     <- never served (uploads/ via an alias)
```

**Never point the document root at the project folder.** `backend/.env` holds the
database password and `SECRET_KEY`, and anyone holding `SECRET_KEY` can sign a
login token for any account, admins included. After every server change:

```bash
curl -s https://instagramsci.example.org/backend/.env | grep -c SECRET_KEY   # must print 0
```

(Checking the status code isn't enough: the single-page fallback answers unknown
paths with `index.html` and a 200, so look at what comes back.)

## 1. Upload the files

From your machine (`excludestuff` keeps secrets, the server's own `config.js`,
uploads, the venv and git metadata out of the upload):

```bash
rsync -av --exclude-from=excludestuff ./ user@yourserver:/var/www/instagramsci/
```

Don't add `--delete` unless you've checked what it would remove: the server has
files that don't exist locally (`backend/.env`, `backend/uploads/`, `backend/venv/`,
`public/js/config.js`).

## Updating an existing server

1. Back up first: `pg_dump` the database and copy `backend/uploads/`.
2. Upload as in step 1.
3. Install new Python dependencies and run any new `backend/migrate_*.sql`
   (each file says what it does; all are safe to run twice).
4. Restart the API: `sudo service instagramsci-api restart`, then check
   `curl -s https://instagramsci.example.org/api/health`.
5. Run the `.env` check above.

### 2026-09 security release (moving to `public/`)

This release moves the static site from the project root into `public/`. On a
server that still serves the project root:

1. Upload, then copy your live frontend config into the new place:
   `cp js/config.js public/js/config.js` (it's excluded from uploads).
2. `backend/venv/bin/pip install -r backend/requirements.txt` (adds Pillow).
3. `psql … -f backend/migrate_security.sql` (session revocation + login throttling).
4. Point the vhost's `DocumentRoot` (Apache) or `root` (nginx) at `…/public`,
   in **both** the port 80 and 443 configs; see `backend/instagramsci.apache.conf`.
5. Restart the API and reload the web server.
6. Delete the old copies from the project root: `index.html`, `css/`, `js/`,
   `assets/`, and `.git/` if it was uploaded.
7. Everyone logs in once more: login tokens now carry a version number, so
   tokens issued before this release stop working.

## 2a. Serve with nginx

```nginx
server {
    listen 80;
    server_name instagramsci.example.org;
    root /var/www/instagramsci/public;
    index index.html;

    # Single-page app: unknown paths fall back to index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Long-cache static assets
    location ~* \.(css|js|svg|jpg|jpeg|png|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public";
    }
}
```

Install/enable on Devuan:
```bash
sudo apt install nginx
sudo cp instagramsci.conf /etc/nginx/sites-available/instagramsci
sudo ln -s /etc/nginx/sites-available/instagramsci /etc/nginx/sites-enabled/
sudo nginx -t && sudo service nginx restart    # Devuan uses sysvinit, not systemd
```

> **MIME note:** modern nginx already serves `.js` as `application/javascript` and `.svg` as `image/svg+xml` (check `/etc/nginx/mime.types`). Correct JS MIME type is what makes ES modules load. If modules fail with a MIME error, confirm that line exists in `mime.types`.

## 2b. Or serve with Apache

```apache
<VirtualHost *:80>
    ServerName instagramsci.example.org
    DocumentRoot /var/www/instagramsci/public
    <Directory /var/www/instagramsci/public>
        Require all granted
        AllowOverride None
    </Directory>
</VirtualHost>
```
```bash
sudo apt install apache2
sudo a2ensite instagramsci
sudo service apache2 restart
```

## 3. HTTPS

Use Let's Encrypt (works without systemd):
```bash
sudo apt install certbot python3-certbot-nginx   # or -apache
sudo certbot --nginx -d instagramsci.example.org
```

## 4. Quick local test before uploading

```bash
cd Instagramsci/public
python3 -m http.server 8000   # open http://localhost:8000 (demo mode: no backend)
```

## Notes & gotchas

- **External assets.** Fonts load from Google Fonts and some demo photos from Unsplash. For a fully self-hosted, offline-capable site, download the fonts into `assets/fonts/` and swap demo images for local files. (Check each font/image license first.)
- **The first post image** is local (`assets/instagramsci.jpg`), so it works with no external dependency.
