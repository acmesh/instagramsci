#!/usr/bin/env python3
"""Set or reset a user's password — writes a proper werkzeug hash.

Use this if login fails (e.g. the row was created by hand in SQL, or you're not
sure the stored hash is valid). It guarantees a known-good password hash.

Run from the backend/ dir with the venv active so it picks up DATABASE_URL:
    cd /var/www/instagramsci/backend
    . venv/bin/activate
    python3 set_password.py you@example.org
"""
import sys, getpass
import psycopg2
import app  # reuses app.load_env() (reads ./.env) and app.DB_DSN
from werkzeug.security import generate_password_hash


def main():
    if len(sys.argv) < 2:
        print("usage: python3 set_password.py EMAIL")
        sys.exit(1)
    email = sys.argv[1].strip().lower()

    conn = psycopg2.connect(app.DB_DSN)
    cur = conn.cursor()

    cur.execute("select id, is_admin, is_approved from users where email=%s", (email,))
    row = cur.fetchone()
    if not row:
        print(f"No user with email {email!r}. Known emails:")
        cur.execute("select email from users order by created_at")
        for (e,) in cur.fetchall():
            print("   ", e)
        sys.exit(1)

    pw = getpass.getpass("New password (min 8 chars): ")
    if len(pw) < 8:
        print("Too short.")
        sys.exit(1)

    cur.execute("update users set password_hash=%s where email=%s",
                (generate_password_hash(pw, method="pbkdf2:sha256"), email))
    conn.commit()
    print(f"Password updated for {email} (id={row[0]}, admin={row[1]}, approved={row[2]}).")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
