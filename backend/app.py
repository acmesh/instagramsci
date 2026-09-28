"""
Instagramsci — minimal API server (Flask + psycopg2 over plain PostgreSQL).

Bridges the static frontend to your existing Postgres. Authorization is enforced
here in the app (not via row-level security). Auth tokens are signed with
itsdangerous (ships with Flask); passwords hashed with werkzeug (ships with Flask).
External deps: Flask, psycopg2, pyotp, Pillow.

Run (dev):   FLASK_APP=app.py flask run --port 8077
Run (prod):  gunicorn -w 2 -b 127.0.0.1:8077 app:app
Config:      see .env.example  (values read from the environment)
"""
import os, re, uuid, pathlib
from functools import wraps

import psycopg2
import psycopg2.extras
import pyotp
from PIL import Image, ImageOps, UnidentifiedImageError
from flask import Flask, request, jsonify, g, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

PASSWORD_METHOD = "pbkdf2:sha256"   # portable everywhere; avoids scrypt edge cases
TOTP_ISSUER = "Instagramsci"

# ---------------------------------------------------------------- .env loader
# Read backend/.env directly (no shell sourcing). Splitting on the FIRST '='
# keeps key/value DSNs with spaces intact, and surrounding quotes are stripped.
# Values in .env take precedence so a previously-mangled shell export can't win.
def load_env(path):
    try:
        with open(path) as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip()
                if (val[:1], val[-1:]) in (('"', '"'), ("'", "'")):
                    val = val[1:-1]
                if key:
                    os.environ[key] = val
    except FileNotFoundError:
        pass

load_env(pathlib.Path(__file__).parent / ".env")

# ---------------------------------------------------------------- config
DB_DSN       = os.environ.get("DATABASE_URL", "dbname=instagramsci")
SECRET_KEY   = os.environ.get("SECRET_KEY", "change-me-in-production")
UPLOAD_DIR   = os.environ.get("UPLOAD_DIR", str(pathlib.Path(__file__).parent / "uploads"))
TOKEN_MAX_AGE = int(os.environ.get("TOKEN_MAX_AGE", 60 * 60 * 24 * 30))  # 30 days
MAX_UPLOAD   = 8 * 1024 * 1024  # 8 MB (the browser shrinks photos before upload)

# Images are decoded and re-encoded by Pillow; the uploaded bytes are never
# stored as-is. Only these decoded formats are accepted, whatever the filename says.
IMAGE_FORMATS = {"JPEG", "PNG", "GIF", "WEBP"}
POST_IMAGE_MAX = 2048   # longest side, px
AVATAR_MAX     = 512
Image.MAX_IMAGE_PIXELS = 50_000_000   # refuse decompression bombs

# Login / signup throttling (per client IP and per email).
LOGIN_WINDOW_MIN   = 15
LOGIN_MAX_PER_IP   = 20
LOGIN_MAX_PER_MAIL = 10
SIGNUP_MAX_PER_IP_HOUR = 5

# A placeholder or short key lets anyone forge login tokens. Refuse to start.
if SECRET_KEY in ("change-me-in-production", "CHANGE_ME_LONG_RANDOM_STRING") or len(SECRET_KEY) < 32:
    raise RuntimeError("SECRET_KEY is missing or too short. Set a long random value in backend/.env: "
                       "python3 -c \"import secrets; print(secrets.token_urlsafe(48))\"")

pathlib.Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD
# Apache/nginx proxy /api/ to us; trust exactly one X-Forwarded-For hop for the client IP.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)
signer = URLSafeTimedSerializer(SECRET_KEY, salt="igs-auth")

# ---------------------------------------------------------------- db helper
def db():
    if "db" not in g:
        g.db = psycopg2.connect(DB_DSN, cursor_factory=psycopg2.extras.RealDictCursor)
    return g.db

@app.teardown_appcontext
def _close(_exc):
    c = g.pop("db", None)
    if c is not None:
        c.close()

def q(sql, args=(), one=False, commit=False):
    conn = db()
    with conn.cursor() as cur:
        cur.execute(sql, args)
        if commit:
            conn.commit()
        if cur.description is None:
            return None
        rows = cur.fetchall()
        return (rows[0] if rows else None) if one else rows

# ---------------------------------------------------------------- auth utils
# Tokens carry the user's token_version. Bumping it in the DB (password change,
# block, admin action) invalidates every token issued before, on every device.
def make_token(uid, tv):
    return signer.dumps({"uid": uid, "tv": tv})

def read_token(tok):
    try:
        data = signer.loads(tok, max_age=TOKEN_MAX_AGE)
        return data.get("uid"), data.get("tv")
    except (BadSignature, SignatureExpired):
        return None, None

def current_user():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    uid, tv = read_token(auth[7:])
    if not uid:
        return None
    u = q("select id, email, handle, display_name, bio, avatar_url, pronouns, "
          "is_approved, is_admin, is_blocked, totp_enabled, token_version from users where id=%s",
          (uid,), one=True)
    if not u or u["token_version"] != tv:
        return None
    return u

# ---------------------------------------------------------------- throttling
def client_ip():
    return request.remote_addr or "unknown"

def too_many(kind, ip, email=None):
    """True when this IP (or email) has hit the limit for `kind` recently."""
    if kind == "login":
        by_ip = q("select count(*) as n from auth_attempts where kind='login' and ip=%s "
                  "and at > now() - make_interval(mins => %s)", (ip, LOGIN_WINDOW_MIN), one=True)
        if by_ip["n"] >= LOGIN_MAX_PER_IP:
            return True
        if email:
            by_mail = q("select count(*) as n from auth_attempts where kind='login' and email=%s "
                        "and at > now() - make_interval(mins => %s)", (email, LOGIN_WINDOW_MIN), one=True)
            return by_mail["n"] >= LOGIN_MAX_PER_MAIL
        return False
    n = q("select count(*) as n from auth_attempts where kind=%s and ip=%s "
          "and at > now() - interval '1 hour'", (kind, ip), one=True)["n"]
    return n >= SIGNUP_MAX_PER_IP_HOUR

def record_attempt(kind, ip, email=None):
    q("insert into auth_attempts (kind, ip, email) values (%s,%s,%s)", (kind, ip, email), commit=True)
    q("delete from auth_attempts where at < now() - interval '1 day'", commit=True)

# ---------------------------------------------------------------- images
def save_image(fstore, max_side, prefix=""):
    """Decode an uploaded image, fix its rotation, shrink it and re-encode it.

    Re-encoding drops EXIF (including GPS location) and anything smuggled
    alongside the pixels. The stored name is random; the client's filename is
    never used. Returns the public URL, or raises ValueError with a user message.
    """
    try:
        img = Image.open(fstore.stream)
        fmt = img.format
        if fmt not in IMAGE_FORMATS:
            raise ValueError("Unsupported image type. Use JPG, PNG, GIF or WebP.")
        img = ImageOps.exif_transpose(img)
        img.thumbnail((max_side, max_side))
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError):
        raise ValueError("That file isn't a readable image.")
    # Keep transparency as PNG; everything else becomes JPEG (smaller, universal).
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        img, ext, opts = img.convert("RGBA"), "png", {"optimize": True}
    else:
        img, ext, opts = img.convert("RGB"), "jpg", {"quality": 85, "optimize": True, "progressive": True}
    name = f"{prefix}{uuid.uuid4().hex}.{ext}"
    img.save(os.path.join(UPLOAD_DIR, name), **opts)
    return f"/uploads/{name}"

def remove_upload(url):
    """Delete a file we stored, given its /uploads/... URL. Ignores anything else."""
    if not url or not url.startswith("/uploads/"):
        return
    path = os.path.join(UPLOAD_DIR, os.path.basename(url))
    try:
        os.remove(path)
    except FileNotFoundError:
        pass

def require(approved=False, admin=False):
    def deco(fn):
        @wraps(fn)
        def wrap(*a, **k):
            u = current_user()
            if not u:
                return jsonify(error="Not signed in."), 401
            if u.get("is_blocked"):
                return jsonify(error="Your account has been blocked."), 403
            if admin and not u["is_admin"]:
                return jsonify(error="Admins only."), 403
            if approved and not u["is_approved"]:
                return jsonify(error="Account awaiting approval."), 403
            g.user = u
            return fn(*a, **k)
        return wrap
    return deco

def public_user(u):
    return {
        "id": u.get("id"), "email": u.get("email"), "handle": u.get("handle"),
        "display_name": u.get("display_name"), "bio": u.get("bio"),
        "avatar_url": u.get("avatar_url"), "pronouns": u.get("pronouns"),
        "is_approved": u.get("is_approved"), "is_admin": u.get("is_admin"),
        "is_blocked": bool(u.get("is_blocked")),
        "has_2fa": bool(u.get("totp_enabled")),
    }

EMAIL_RE  = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
HANDLE_RE = re.compile(r"^[a-z0-9._]{2,30}$")

# Used to spend the same hashing time when the email doesn't exist, so response
# timing doesn't reveal which emails have accounts.
_DUMMY_HASH = generate_password_hash("not-a-real-password", method=PASSWORD_METHOD)

# ---------------------------------------------------------------- auth routes
@app.post("/auth/signup")
def signup():
    d = request.get_json(force=True, silent=True) or {}
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""
    handle = (d.get("handle") or "").strip().lstrip("@").lower()
    origin = (d.get("origin") or "").strip()[:200]
    intentions = (d.get("intentions") or "").strip()[:2000]
    ip = client_ip()
    if too_many("signup", ip):
        return jsonify(error="Too many applications from your network. Try again in an hour."), 429
    if not EMAIL_RE.match(email):
        return jsonify(error="Enter a valid email."), 400
    if len(password) < 8:
        return jsonify(error="Password must be at least 8 characters."), 400
    if not HANDLE_RE.match(handle):
        return jsonify(error="Handles are 2-30 characters: letters, numbers, dots and underscores."), 400
    if not intentions:
        return jsonify(error="Tell us your intentions."), 400
    if q("select 1 from users where email=%s or handle=%s", (email, handle), one=True):
        return jsonify(error="That email or handle is already taken."), 409
    record_attempt("signup", ip, email)

    # pbkdf2:sha256 is pure-Python in werkzeug and portable everywhere; avoids any
    # scrypt/OpenSSL edge cases on minimal servers. (Existing scrypt hashes still
    # verify fine — check_password_hash reads the method from the stored hash.)
    user = q("insert into users (email, password_hash, handle, display_name) "
             "values (%s,%s,%s,%s) returning *",
             (email, generate_password_hash(password, method="pbkdf2:sha256"), handle, handle),
             one=True, commit=True)
    q("insert into membership_applications (user_id, handle, email, origin, intentions) "
      "values (%s,%s,%s,%s,%s)",
      (user["id"], handle, email, origin, intentions), commit=True)
    return jsonify(token=make_token(user["id"], user["token_version"]), profile=public_user(user))

@app.post("/auth/login")
def login():
    d = request.get_json(force=True, silent=True) or {}
    email = (d.get("email") or "").strip().lower()
    ip = client_ip()
    if too_many("login", ip, email):
        return jsonify(error=f"Too many attempts. Try again in {LOGIN_WINDOW_MIN} minutes."), 429
    user = q("select * from users where email=%s", (email,), one=True)
    ok = check_password_hash(user["password_hash"] if user else _DUMMY_HASH, d.get("password") or "")
    if not user or not ok:
        record_attempt("login", ip, email)
        return jsonify(error="Wrong email or password."), 401
    if user.get("is_blocked"):
        return jsonify(error="This account has been blocked."), 403
    # Second factor: if 2FA is on, a valid TOTP code is required. We return 200
    # with twofa_required so the client can prompt for the code (not a 401).
    if user.get("totp_enabled"):
        code = (d.get("code") or "").strip().replace(" ", "")
        if not code:
            return jsonify(twofa_required=True)
        if not pyotp.TOTP(user["totp_secret"]).verify(code, valid_window=1):
            record_attempt("login", ip, email)
            return jsonify(twofa_required=True, error="Invalid 2FA code.")
    q("delete from auth_attempts where kind='login' and email=%s", (email,), commit=True)
    return jsonify(token=make_token(user["id"], user["token_version"]), profile=public_user(user))

@app.get("/me")
def me():
    u = current_user()
    return jsonify(profile=public_user(u) if u else None)

# ---------------------------------------------------------------- profile edit
@app.patch("/me")
@require()
def update_me():
    d = request.get_json(force=True, silent=True) or {}
    display_name = (d.get("display_name") or "").strip()[:60] or None
    bio = (d.get("bio") or "").strip()[:500] or None
    pronouns = (d.get("pronouns") or "").strip()[:40] or None
    u = q("update users set display_name=%s, bio=%s, pronouns=%s where id=%s returning *",
          (display_name, bio, pronouns, g.user["id"]), one=True, commit=True)
    return jsonify(profile=public_user(u))

@app.post("/me/avatar")
@require()
def update_avatar():
    f = request.files.get("avatar")
    if not f or not f.filename:
        return jsonify(error="No image provided."), 400
    try:
        url = save_image(f, AVATAR_MAX, prefix="avatar-")
    except ValueError as e:
        return jsonify(error=str(e)), 400
    old = g.user.get("avatar_url")
    u = q("update users set avatar_url=%s where id=%s returning *",
          (url, g.user["id"]), one=True, commit=True)
    remove_upload(old)
    return jsonify(profile=public_user(u))

@app.post("/me/email")
@require()
def change_email():
    d = request.get_json(force=True, silent=True) or {}
    new_email = (d.get("email") or "").strip().lower()
    if not EMAIL_RE.match(new_email):
        return jsonify(error="Enter a valid email."), 400
    row = q("select password_hash from users where id=%s", (g.user["id"],), one=True)
    if not check_password_hash(row["password_hash"], d.get("password") or ""):
        return jsonify(error="Current password is wrong."), 403
    if q("select 1 from users where email=%s and id<>%s", (new_email, g.user["id"]), one=True):
        return jsonify(error="That email is already in use."), 409
    u = q("update users set email=%s where id=%s returning *",
          (new_email, g.user["id"]), one=True, commit=True)
    return jsonify(profile=public_user(u))

@app.post("/me/password")
@require()
def change_password():
    d = request.get_json(force=True, silent=True) or {}
    row = q("select password_hash from users where id=%s", (g.user["id"],), one=True)
    if not check_password_hash(row["password_hash"], d.get("current_password") or ""):
        return jsonify(error="Current password is wrong."), 403
    new = d.get("new_password") or ""
    if len(new) < 8:
        return jsonify(error="New password must be at least 8 characters."), 400
    # Bumping token_version logs out every other device; this one gets a fresh token.
    u = q("update users set password_hash=%s, token_version=token_version+1 where id=%s "
          "returning id, token_version",
          (generate_password_hash(new, method=PASSWORD_METHOD), g.user["id"]), one=True, commit=True)
    return jsonify(ok=True, token=make_token(u["id"], u["token_version"]))

# ---------------------------------------------------------------- 2FA (TOTP)
@app.post("/me/2fa/setup")
@require()
def twofa_setup():
    row = q("select totp_enabled from users where id=%s", (g.user["id"],), one=True)
    if row["totp_enabled"]:
        return jsonify(error="2FA is already enabled."), 400
    secret = pyotp.random_base32()
    q("update users set totp_pending=%s where id=%s", (secret, g.user["id"]), commit=True)
    uri = pyotp.TOTP(secret).provisioning_uri(name=g.user["email"], issuer_name=TOTP_ISSUER)
    return jsonify(secret=secret, otpauth_uri=uri)

@app.post("/me/2fa/enable")
@require()
def twofa_enable():
    d = request.get_json(force=True, silent=True) or {}
    code = (d.get("code") or "").strip().replace(" ", "")
    row = q("select totp_pending from users where id=%s", (g.user["id"],), one=True)
    if not row["totp_pending"]:
        return jsonify(error="Start setup first."), 400
    if not pyotp.TOTP(row["totp_pending"]).verify(code, valid_window=1):
        return jsonify(error="That code didn't match. Try the current one."), 400
    q("update users set totp_secret=totp_pending, totp_pending=null, totp_enabled=true "
      "where id=%s", (g.user["id"],), commit=True)
    return jsonify(ok=True, has_2fa=True)

@app.post("/me/2fa/disable")
@require()
def twofa_disable():
    d = request.get_json(force=True, silent=True) or {}
    row = q("select password_hash from users where id=%s", (g.user["id"],), one=True)
    if not check_password_hash(row["password_hash"], d.get("password") or ""):
        return jsonify(error="Current password is wrong."), 403
    q("update users set totp_secret=null, totp_pending=null, totp_enabled=false "
      "where id=%s", (g.user["id"],), commit=True)
    return jsonify(ok=True, has_2fa=False)

# ---------------------------------------------------------------- feed / posts
@app.get("/feed")
def feed():
    rows = q("select * from post_feed order by pinned desc, created_at desc limit 100")
    # attach the signed-in user's own reactions so the UI can show saved state
    u = current_user()
    if u and rows:
        ids = [r["id"] for r in rows]
        mine = q("select post_id, kind from reactions where user_id=%s and post_id = any(%s)",
                 (u["id"], ids))
        mymap = {}
        for m in mine:
            mymap.setdefault(m["post_id"], []).append(m["kind"])
        for r in rows:
            r["my_kinds"] = mymap.get(r["id"], [])
    else:
        for r in rows:
            r["my_kinds"] = []
    return jsonify(posts=rows)

# ---------------------------------------------------------------- comments
@app.get("/posts/<int:post_id>/comments")
def list_comments(post_id):
    rows = q("select c.id, c.body, c.created_at, u.handle, u.display_name, u.avatar_url "
             "from comments c join users u on u.id = c.author_id "
             "where c.post_id=%s order by c.created_at asc", (post_id,))
    return jsonify(comments=rows)

@app.post("/posts/<int:post_id>/comments")
@require(approved=True)
def add_comment(post_id):
    d = request.get_json(force=True, silent=True) or {}
    body = (d.get("body") or "").strip()
    if not body:
        return jsonify(error="Write something first."), 400
    if len(body) > 2000:
        return jsonify(error="Comment is too long (2000 chars max)."), 400
    c = q("insert into comments (post_id, author_id, body) values (%s,%s,%s) "
          "returning id, body, created_at", (post_id, g.user["id"], body), one=True, commit=True)
    c["handle"] = g.user["handle"]
    c["display_name"] = g.user.get("display_name")
    c["avatar_url"] = g.user.get("avatar_url")
    return jsonify(comment=c)

@app.post("/posts")
@require(approved=True)
def create_post():
    aphorism = (request.form.get("aphorism") or "").strip()
    alt_text = (request.form.get("alt_text") or "").strip()
    attribution = (request.form.get("attribution") or "").strip() or None
    caption = (request.form.get("caption") or "").strip()[:2000] or None
    # "#Commons", "commons", "Commons," all mean the tag with slug "commons".
    slugs = sorted({t.strip("#").lower() for t in re.split(r"[\s,]+", request.form.get("tags") or "")
                    if t.strip("#")})
    f = request.files.get("image")
    has_image = bool(f and f.filename)
    if not aphorism:
        return jsonify(error="Write your aphorism first."), 400
    if len(aphorism) > 280:
        return jsonify(error="Aphorism must be 280 characters or fewer."), 400
    if has_image and not alt_text:
        return jsonify(error="Describe the image in the alt text field."), 400

    image_url = None
    if has_image:
        try:
            image_url = save_image(f, POST_IMAGE_MAX)
        except ValueError as e:
            return jsonify(error=str(e)), 400

    post = q("insert into posts (author_id, image_url, aphorism, alt_text, attribution, caption) "
             "values (%s,%s,%s,%s,%s,%s) returning id",
             (g.user["id"], image_url, aphorism, alt_text if has_image else "", attribution, caption),
             one=True, commit=True)
    if slugs:
        q("insert into post_tags (post_id, tag_id) "
          "select %s, id from tags where slug = any(%s) on conflict do nothing",
          (post["id"], slugs), commit=True)
    return jsonify(id=post["id"])

@app.delete("/posts/<int:post_id>")
@require()
def delete_post(post_id):
    p = q("select author_id, image_url from posts where id=%s", (post_id,), one=True)
    if not p:
        return jsonify(error="That post doesn't exist."), 404
    if p["author_id"] != g.user["id"] and not g.user["is_admin"]:
        return jsonify(error="You can only delete your own posts."), 403
    q("delete from posts where id=%s", (post_id,), commit=True)
    remove_upload(p["image_url"])
    return jsonify(ok=True)

@app.post("/posts/<int:post_id>/react")
@require(approved=True)
def react(post_id):
    d = request.get_json(force=True, silent=True) or {}
    kind = d.get("kind")
    if kind not in ("resonate", "collect", "amplify"):
        return jsonify(error="Unknown reaction."), 400
    existing = q("select 1 from reactions where post_id=%s and user_id=%s and kind=%s",
                 (post_id, g.user["id"], kind), one=True)
    if existing:
        q("delete from reactions where post_id=%s and user_id=%s and kind=%s",
          (post_id, g.user["id"], kind), commit=True)
        return jsonify(on=False)
    q("insert into reactions (post_id, user_id, kind) values (%s,%s,%s)",
      (post_id, g.user["id"], kind), commit=True)
    return jsonify(on=True)

# ---------------------------------------------------------------- admin
@app.get("/admin/applications")
@require(admin=True)
def list_apps():
    rows = q("select id, handle, email, origin, intentions, created_at "
             "from membership_applications where status='pending' order by created_at asc")
    return jsonify(applications=rows)

@app.post("/admin/applications/<int:app_id>/approve")
@require(admin=True)
def approve(app_id):
    row = q("update membership_applications set status='approved', reviewed_by=%s, "
            "reviewed_at=now() where id=%s returning user_id",
            (g.user["id"], app_id), one=True, commit=True)
    if row:
        q("update users set is_approved=true where id=%s", (row["user_id"],), commit=True)
    return jsonify(ok=True)

@app.post("/admin/applications/<int:app_id>/reject")
@require(admin=True)
def reject(app_id):
    row = q("update membership_applications set status='rejected', reviewed_by=%s, "
            "reviewed_at=now() where id=%s returning user_id",
            (g.user["id"], app_id), one=True, commit=True)
    if row:
        q("update users set is_approved=false where id=%s", (row["user_id"],), commit=True)
    return jsonify(ok=True)

# ---------------------------------------------------------------- admin: members
@app.get("/admin/users")
@require(admin=True)
def list_users():
    # Members = anyone approved or blocked (i.e. not just a pending applicant).
    rows = q("select id, handle, email, is_approved, is_admin, is_blocked, created_at "
             "from users where is_approved = true or is_blocked = true "
             "order by is_admin desc, handle asc")
    return jsonify(users=rows, me=g.user["id"])

@app.post("/admin/users/<int:uid>/block")
@require(admin=True)
def block_user(uid):
    if uid == g.user["id"]:
        return jsonify(error="You can't block your own account."), 400
    q("update users set is_blocked = true, token_version = token_version + 1 where id=%s",
      (uid,), commit=True)
    return jsonify(ok=True)

@app.post("/admin/users/<int:uid>/unblock")
@require(admin=True)
def unblock_user(uid):
    q("update users set is_blocked = false where id=%s", (uid,), commit=True)
    return jsonify(ok=True)

@app.delete("/admin/users/<int:uid>")
@require(admin=True)
def delete_user(uid):
    if uid == g.user["id"]:
        return jsonify(error="You can't delete your own account."), 400
    files = q("select image_url as url from posts where author_id=%s and image_url is not null "
              "union select avatar_url from users where id=%s and avatar_url is not null", (uid, uid))
    # reviewed_by doesn't cascade: clear it, or deleting an admin who reviewed anyone fails.
    q("update membership_applications set reviewed_by=null where reviewed_by=%s", (uid,), commit=True)
    # FK cascades remove the user's posts, reactions, comments, follows, application.
    q("delete from users where id=%s", (uid,), commit=True)
    for f in files:
        remove_upload(f["url"])
    return jsonify(ok=True)

# ---------------------------------------------------------------- uploaded files
# In production, let nginx serve /uploads/ directly (see SETUP_POSTGRES.md).
# This route is a dev-mode fallback.
@app.get("/uploads/<path:name>")
def uploads(name):
    return send_from_directory(UPLOAD_DIR, name)

@app.errorhandler(413)
def too_large(_e):
    return jsonify(error=f"That file is too large (max {MAX_UPLOAD // (1024 * 1024)} MB)."), 413

# Public endpoint: reports status only. Details (paths, DB errors) go to the log.
@app.get("/health")
def health():
    out = {"ok": True, "upload_writable": os.access(UPLOAD_DIR, os.W_OK)}
    try:
        q("select 1", one=True)
        out["db"] = True
    except Exception as e:
        app.logger.error("health: database check failed: %s", e)
        out["ok"] = False
        out["db"] = False
    if not out["upload_writable"]:
        app.logger.error("health: UPLOAD_DIR not writable by the API user: %s", UPLOAD_DIR)
        out["ok"] = False
    return jsonify(out), (200 if out["ok"] else 500)

if __name__ == "__main__":
    app.run(port=int(os.environ.get("PORT", 8077)), debug=True)
