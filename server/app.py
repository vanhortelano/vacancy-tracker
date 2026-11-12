"""Vacancy Tracker server: serves the pages and the JSON API on top of PostgreSQL.

Run:  DATABASE_URL=postgresql://... FIREBASE_SERVICE_ACCOUNT_JSON='{...}' python app.py
Firebase is used ONLY to verify sign-ins and to hold the generated username/password.
"""
import logging
import os
import sys
from pathlib import Path

import psycopg
from flask import Flask, g, jsonify, request, send_from_directory
from psycopg.rows import dict_row

import accounts
import ai
import engine
from store import Aborted, Denied, Invalid

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))                # brain.py (the assistant) lives in the project root
STATIC_EXT = {".html", ".js", ".css", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".webp", ".woff", ".woff2", ".txt"}
BLOCKED_NAMES = {"seed-data.js"}                 # real tenant data: never served over the web
log = logging.getLogger("vacancy")

HTTP = {Denied: (403, "permission-denied", "You do not have access to that."),
        Aborted: (409, "aborted", "The data changed. Please retry."),
        Invalid: (400, "invalid-argument", "That request was not valid."),
        engine.NotFound: (404, "not-found", "That record was not found."),
        engine.AlreadyExists: (409, "already-exists", "That record already exists.")}


class _Pool:
    """Minimal connection pool (one connection per request)."""
    def __init__(self, url, max_size=10):
        from psycopg_pool import ConnectionPool
        self.pool = ConnectionPool(url, min_size=1, max_size=max_size, open=True, timeout=15,
                                   kwargs={"row_factory": dict_row, "autocommit": True})

    def connection(self):
        return self.pool.connection()


def create_app(database_url=None, verifier=None, fb=None, brain_factory=None, pool=None):
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
    pool = pool or _Pool(database_url or os.environ["DATABASE_URL"])
    if fb is None:
        fb = accounts.FirebaseOps()
    verifier = verifier or fb.verify
    app.extensions["pool"] = pool
    state = {"brain": None}
    limit_auth = accounts.RateLimiter(12, 600)
    limit_ai = accounts.RateLimiter(20, 60)

    def brain():
        if state["brain"] is None:
            state["brain"] = brain_factory() if brain_factory else __import__("brain").Brain()
        return state["brain"]

    @app.after_request
    def headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "no-referrer"
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.errorhandler(accounts.ApiError)
    def api_error(e):
        return jsonify({"error": e.code, "message": e.message}), e.status

    @app.errorhandler(Exception)
    def other_error(e):
        for cls, (status, code, msg) in HTTP.items():
            if isinstance(e, cls):
                return jsonify({"error": code, "message": msg}), status
        if hasattr(e, "code") and isinstance(getattr(e, "code"), int):   # werkzeug HTTPException
            return jsonify({"error": "http", "message": "Request failed."}), e.code
        log.exception("unhandled error")                   # details stay in the server log
        return jsonify({"error": "internal", "message": "Something went wrong. Please try again."}), 500

    def token_claims():
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer ") or len(header) > 4000:
            raise accounts.ApiError(401, "unauthenticated", "Please sign in.")
        try:
            claims = verifier(header[7:])
        except Exception:
            raise accounts.ApiError(401, "unauthenticated", "Your sign-in expired. Please sign in again.")
        if not claims.get("uid"):
            raise accounts.ApiError(401, "unauthenticated", "Please sign in.")
        return claims

    def account_uid(conn):
        """The user id comes ONLY from the verified token, and must belong to a registered account."""
        claims = token_claims()
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM accounts WHERE user_id=%s", (claims["uid"],))
        if not cur.fetchone():
            raise accounts.ApiError(403, "account_required",
                                    "This sign-in is not linked to a Vecancy account yet. Use Create Account first.")
        return claims["uid"]

    def body():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise Invalid("json body required")
        return data

    # ------------------------------------------------------------------ accounts
    @app.post("/api/account/register")
    def register():
        claims = token_claims()
        limit_auth.check(("reg", request.remote_addr))
        data = body()
        with pool.connection() as conn:
            return jsonify(accounts.register(conn, fb, claims, data.get("username"), data.get("password")))

    @app.post("/api/account/lookup")
    def lookup():
        claims = token_claims()
        limit_auth.check(("look", request.remote_addr))
        with pool.connection() as conn:
            return jsonify(accounts.lookup(conn, claims))

    @app.post("/api/account/password")
    def password():
        claims = token_claims()
        limit_auth.check(("pw", request.remote_addr))
        with pool.connection() as conn:
            return jsonify(accounts.change_password(conn, fb, claims, body().get("newPassword")))

    @app.post("/api/account/check-name")
    def check_name():
        """Live 'is this name free?' hint while typing. The real guarantee is the database."""
        token_claims()
        limit_auth.check(("name", request.remote_addr))
        _name, full = accounts.clean_username(body().get("username"))
        with pool.connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM accounts WHERE username_lower=%s", (full.lower(),))
            return jsonify({"username": full, "available": cur.fetchone() is None})

    @app.get("/api/session")
    def session():
        claims = token_claims()
        with pool.connection() as conn:
            return jsonify(accounts.session(conn, claims["uid"]))

    # ------------------------------------------------------------------ data
    @app.post("/api/get")
    def get_doc():
        with pool.connection() as conn:
            return jsonify(engine.get_doc(conn, account_uid(conn), body().get("path")))

    @app.post("/api/query")
    def query():
        data = body()
        with pool.connection() as conn:
            uid = account_uid(conn)
            rows = engine.query(conn, uid, data.get("path"), data.get("where"), data.get("orderBy"), data.get("limit"))
            return jsonify({"docs": rows})

    @app.post("/api/read")
    def read_many():
        data = body()
        with pool.connection() as conn:
            uid = account_uid(conn)
            return jsonify({"results": engine.read_many(conn, uid, data.get("ops"))})

    @app.post("/api/commit")
    def commit():
        data = body()
        with pool.connection() as conn:
            uid = account_uid(conn)
            return jsonify({"ok": engine.commit(conn, uid, data.get("reads") or [], data.get("writes") or [])})

    # ------------------------------------------------------------------ assistant
    @app.post("/api/assistant")
    def assistant():
        with pool.connection() as conn:
            uid = account_uid(conn)
            limit_ai.check(("ai", uid))
            data = body()
            question = str(data.get("question", "")).strip()[:300]
            if not question:
                raise accounts.ApiError(400, "empty", "Ask a question first.")
            cid = data.get("conversationId")
            return jsonify(ai.answer(conn, brain(), uid, question, cid if isinstance(cid, str) else None))

    @app.post("/api/assistant/history")
    def assistant_history():
        with pool.connection() as conn:
            uid = account_uid(conn)
            cid = body().get("conversationId")
            return jsonify({"messages": ai.history(conn, uid, cid) if isinstance(cid, str) else []})

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True})

    # ------------------------------------------------------------------ pages
    @app.get("/")
    def home():
        return send_from_directory(ROOT, "index.html")

    @app.get("/<path:name>")
    def static_file(name):
        p = (ROOT / name).resolve()
        ok = (ROOT in p.parents and p.is_file() and p.suffix.lower() in STATIC_EXT
              and p.name not in BLOCKED_NAMES and p.relative_to(ROOT).parts[0] not in ("server", "legacy")
              and not any(part.startswith(".") for part in p.relative_to(ROOT).parts))
        if not ok:
            return jsonify({"error": "not-found", "message": "Not found."}), 404
        resp = send_from_directory(ROOT, str(p.relative_to(ROOT)))
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    create_app().run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
