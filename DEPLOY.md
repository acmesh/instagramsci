# Deploying Instagramsci on your Devuan (Linux) server

Phase 1 is a **static site** — plain HTML/CSS/JS, no build step, no Node required on the server. You upload the directory as-is and point a web server at it. The only real requirement: serve it over **HTTP(S)**, not `file://`, because the app uses JavaScript ES modules (`<script type="module">`), which browsers block on the filesystem protocol.

## 1. Upload the directory

From your machine, copy the whole folder to the server (keep the structure intact):

```bash
rsync -av --delete ./Instagramsci/ user@yourserver:/var/www/instagramsci/
# or: scp -r ./Instagramsci user@yourserver:/var/www/
```

Required files/folders on the server:
```
index.html  css/  js/  assets/   (the rest — *.md — are docs, optional to upload)
```

## 2a. Serve with nginx

```nginx
server {
    listen 80;
    server_name instagramsci.example.org;
    root /var/www/instagramsci;
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
    DocumentRoot /var/www/instagramsci
    <Directory /var/www/instagramsci>
        Require all granted
        AllowOverride All
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
cd Instagramsci
python3 -m http.server 8000   # open http://localhost:8000
```

## Notes & gotchas

- **No database yet.** Phase 1 has no accounts; the "Apply to join" form is front-end only and currently just shows a confirmation. Wiring it to real, reviewable applications + approval is Phase 2 (see `ARCHITECTURE.md` §6 and the approval flow below).
- **External assets.** Fonts load from Google Fonts and some demo photos from Unsplash. For a fully self-hosted, offline-capable site, download the fonts into `assets/fonts/` and swap demo images for local files. (Check each font/image license first.)
- **The first post image** is local (`assets/instagramsci.jpg`), so it works with no external dependency.
- **Approval workflow (Phase 2 target):** applications write to a `membership_applications` table (status: pending/approved/rejected); an admin view lets you review intentions and approve; approval provisions the Supabase auth account and emails the applicant. Until approved, a user can read but the compose/react/comment actions stay gated.
