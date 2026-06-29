"""
Instagramsci — minimal API server (Flask + psycopg2 over plain PostgreSQL).

Bridges the static frontend to your existing Postgres. Authorization is enforced
here in the app (not via row-level security). Auth tokens are signed with
itsdangerous (ships with Flask); passwords hashed with werkzeug (ships with Flask).
Only external deps: Flask, psycopg2.

Run (dev):   FLASK_APP=app.py flask run --port 8077
Run (prod):  gunicorn -w 2 -b 127.0.0.1:8077 app:app
Config:      see .env.example  (values read from the environment)
"""
import os, re, time, pathlib
from functools import wraps

import psycopg2
import psycopg2.extras
import pyotp
from flask import Flask, request, jsonify, g, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
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
ALLOWED_EXT  = {"png", "jpg", "jpeg", "gif", "webp"}
MAX_UPLOAD   = 8 * 1024 * 1024  # 8 MB

pathlib.Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD
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
def make_token(uid):
    return signer.dumps({"uid": uid})

def read_token(tok):
    try:
        data = signer.loads(tok, max_age=TOKEN_MAX_AGE)
        return data.get("uid")
    except (BadSignature, SignatureExpired):
        return None

def current_user():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    uid = read_token(auth[7:])
    if not uid:
        return None
    return q("select id, email, handle, display_name, bio, avatar_url, pronouns, "
             "is_approved, is_admin, is_blocked, totp_enabled from users where id=%s",
             (uid,), one=True)

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

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# ---------------------------------------------------------------- auth routes
@app.post("/auth/signup")
def signup():
    d = request.get_json(force=True, silent=True) or {}
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""
    handle = (d.get("handle") or "").strip().lstrip("@")
    origin = (d.get("origin") or "").strip()
    intentions = (d.get("intentions") or "").strip()
    if not EMAIL_RE.match(email):
        return jsonify(error="Enter a valid email."), 400
    if len(password) < 8:
        return jsonify(error="Password must be at least 8 characters."), 400
    if not handle:
        return jsonify(error="Choose a handle."), 400
    if not intentions:
        return jsonify(error="Tell us your intentions."), 400
    if q("select 1 from users where email=%s or handle=%s", (email, handle), one=True):
        return jsonify(error="That email or handle is already taken."), 409

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
    return jsonify(token=make_token(user["id"]), profile=public_user(user))

@app.post("/auth/login")
def login():
    d = request.get_json(force=True, silent=True) or {}
    email = (d.get("email") or "").strip().lower()
    user = q("select * from users where email=%s", (email,), one=True)
    if not user or not check_password_hash(user["password_hash"], d.get("password") or ""):
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
            return jsonify(twofa_required=True, error="Invalid 2FA code.")
    return jsonify(token=make_token(user["id"]), profile=public_user(user))

@app.get("/me")
def me():
    u = current_user()
    return jsonify(profile=public_user(u) if u else None)

# ---------------------------------------------------------------- profile edit
@app.patch("/me")
@require()
def update_me():
    d = request.get_json(force=True, silent=True) or {}
    display_name = (d.get("display_name") or "").strip() or None
    bio = (d.get("bio") or "").strip() or None
    pronouns = (d.get("pronouns") or "").strip() or None
    u = q("update users set display_name=%s, bio=%s, pronouns=%s where id=%s returning *",
          (display_name, bio, pronouns, g.user["id"]), one=True, commit=True)
    return jsonify(profile=public_user(u))

@app.post("/me/avatar")
@require()
def update_avatar():
    f = request.files.get("avatar")
    if not f or not f.filename:
        return jsonify(error="No image provided."), 400
    ext = f.filename.rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify(error="Unsupported image type."), 400
    name = f"avatar-{g.user['id']}-{int(time.time())}-{secure_filename(f.filename)}"
    f.save(os.path.join(UPLOAD_DIR, name))
    u = q("update users set avatar_url=%s where id=%s returning *",
          (f"/uploads/{name}", g.user["id"]), one=True, commit=True)
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
    q("update users set password_hash=%s where id=%s",
      (generate_password_hash(new, method=PASSWORD_METHOD), g.user["id"]), commit=True)
    return jsonify(ok=True)

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
    caption = (request.form.get("caption") or "").strip() or None
    tags = [t.strip() for t in (request.form.get("tags") or "").split() if t.strip()]
    if not aphorism or not alt_text:
        return jsonify(error="Aphorism and alt text are required."), 400
    if len(aphorism) > 280:
        return jsonify(error="Aphorism must be 280 characters or fewer."), 400

    image_url = None
    f = request.files.get("image")
    if f and f.filename:
        ext = f.filename.rsplit(".", 1)[-1].lower()
        if ext not in ALLOWED_EXT:
            return jsonify(error="Unsupported image type."), 400
        name = f"{g.user['id']}-{int(time.time())}-{secure_filename(f.filename)}"
        f.save(os.path.join(UPLOAD_DIR, name))
        image_url = f"/uploads/{name}"

    post = q("insert into posts (author_id, image_url, aphorism, alt_text, attribution, caption) "
             "values (%s,%s,%s,%s,%s,%s) returning id",
             (g.user["id"], image_url, aphorism, alt_text, attribution, caption),
             one=True, commit=True)
    if tags:
        q("insert into post_tags (post_id, tag_id) "
          "select %s, id from tags where label = any(%s) on conflict do nothing",
          (post["id"], tags), commit=True)
    return jsonify(id=post["id"])

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
    q("update users set is_blocked = true where id=%s", (uid,), commit=True)
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
    # FK cascades remove the user's posts, reactions, comments, follows, application.
    q("delete from users where id=%s", (uid,), commit=True)
    return jsonify(ok=True)

# ---------------------------------------------------------------- uploaded files
# In production, let nginx serve /uploads/ directly (see SETUP_POSTGRES.md).
# This route is a dev-mode fallback.
@app.get("/uploads/<path:name>")
def uploads(name):
    return send_from_directory(UPLOAD_DIR, name)

@app.get("/health")
def health():
    out = {"ok": True, "upload_dir": UPLOAD_DIR,
           "upload_writable": os.access(UPLOAD_DIR, os.W_OK)}
    try:
        q("select 1", one=True)
        out["db"] = True
    except Exception as e:
        out["ok"] = False
        out["db"] = False
        out["error"] = str(e)
    if not out["upload_writable"]:
        out["ok"] = False
        out.setdefault("error", f"UPLOAD_DIR not writable by the API user: {UPLOAD_DIR}")
    return jsonify(out), (200 if out["ok"] else 500)

if __name__ == "__main__":
    app.run(port=int(os.environ.get("PORT", 8077)), debug=True)
