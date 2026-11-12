"""Account management: Create Account, Update Account (recover username / change password).

Firebase Authentication holds ONLY the generated login (username@vecancy.tracker + a Firebase-
managed password hash). The person's original Google / verified email never leaves this server
and is never returned to anyone but proof of it. The original Google PASSWORD is never seen:
identity is proven with a Google sign-in or an emailed sign-in link, and Firebase hands us a
signed token saying "this email is verified".
"""
import re
import time
from collections import defaultdict, deque

import psycopg

DOMAIN = "@vecancy.tracker"
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,29}$")
FRESH_SECONDS = 300          # the identity proof must be recent


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def clean_username(raw):
    """'  Maria.Cruz@vecancy.tracker ' / 'Maria.Cruz' -> ('maria.cruz', 'maria.cruz@vecancy.tracker')."""
    name = str(raw or "").strip().lower()
    if name.endswith(DOMAIN):
        name = name[: -len(DOMAIN)]
    if not _NAME_RE.match(name) or ".." in name:
        raise ApiError(400, "bad_username",
                       "Use 3–30 characters: letters, numbers, dot, dash or underscore. Start with a letter or number.")
    return name, name + DOMAIN


def check_password(pw):
    if not isinstance(pw, str) or len(pw) < 8 or len(pw) > 128:
        raise ApiError(400, "weak_password", "Use a password of 8 to 128 characters.")


class RateLimiter:
    """Small in-memory limiter (per server process)."""
    def __init__(self, limit, window):
        self.limit, self.window, self.hits = limit, window, defaultdict(deque)

    def check(self, key):
        now, q = time.time(), self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise ApiError(429, "too_many", "Too many attempts. Wait a few minutes and try again.")
        q.append(now)


def proof_identity(claims):
    """Validate the token that proves control of the original Google account / email."""
    email = (claims.get("email") or "").strip()
    if not email or claims.get("email_verified") is not True:
        raise ApiError(403, "email_not_verified", "Verify your Google account or email first.")
    if email.lower().endswith(DOMAIN):
        raise ApiError(400, "wrong_identity", "Use your original Google account or email here, not your Vecancy username.")
    if time.time() - int(claims.get("auth_time", 0)) > FRESH_SECONDS:
        raise ApiError(401, "reauth", "Please verify again; that sign-in is too old.")
    provider = (claims.get("firebase") or {}).get("sign_in_provider") or "unknown"
    return email, provider


def register(conn, fb, claims, username, password):
    email, provider = proof_identity(claims)
    uid = claims["uid"]
    name, full = clean_username(username)
    check_password(password)
    with conn.transaction():
        cur = conn.cursor()
        cur.execute("SELECT username FROM accounts WHERE user_id=%s OR original_email_lower=%s",
                    (uid, email.lower()))
        if cur.fetchone():
            raise ApiError(409, "email_has_account",
                           "This email already has an account. Use Update Account to see your username or change your password.")
        try:
            cur.execute(
                "INSERT INTO accounts (user_id, username, username_lower, original_email, original_email_lower, "
                "verified_via, display_name) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (uid, full, full.lower(), email, email.lower(), provider, claims.get("name")))
        except psycopg.errors.UniqueViolation as e:
            if (e.diag.constraint_name or "") == "accounts_username_lower_key":
                raise ApiError(409, "name_taken", "This name was taken. Please choose another.") from e
            raise ApiError(409, "email_has_account",
                           "This email already has an account. Use Update Account to see your username or change your password.") from e
        try:
            fb.finalize_account(uid, full, password, claims.get("name"))
        except fb.EmailExists as e:
            raise ApiError(409, "name_taken", "This name was taken. Please choose another.") from e
        except Exception as e:  # nothing is created if Firebase refuses
            raise ApiError(502, "auth_unavailable", "Could not create the account right now. Try again.") from e
    return {"username": full}


def _account_for(conn, email):
    cur = conn.cursor()
    cur.execute("SELECT user_id, username FROM accounts WHERE original_email_lower=%s", (email.lower(),))
    return cur.fetchone()


def lookup(conn, claims):
    email, _ = proof_identity(claims)
    row = _account_for(conn, email)
    if not row:
        raise ApiError(404, "no_account", "No account was found for that email. Use Create Account.")
    return {"username": row["username"]}


def change_password(conn, fb, claims, new_password):
    email, _ = proof_identity(claims)
    check_password(new_password)
    row = _account_for(conn, email)
    if not row:
        raise ApiError(404, "no_account", "No account was found for that email. Use Create Account.")
    try:
        fb.set_password(row["user_id"], new_password)
    except Exception as e:
        raise ApiError(502, "auth_unavailable", "Could not change the password right now. Try again.") from e
    with conn.transaction():
        conn.cursor().execute("UPDATE accounts SET password_changed_at=now() WHERE user_id=%s", (row["user_id"],))
    if claims["uid"] != row["user_id"]:       # the throw-away identity used only to prove the email
        try:
            fb.delete_user(claims["uid"])
        except Exception:
            pass
    return {"username": row["username"]}


def session(conn, uid):
    with conn.transaction():
        cur = conn.cursor()
        cur.execute("UPDATE accounts SET last_login_at=now() WHERE user_id=%s RETURNING username, display_name", (uid,))
        row = cur.fetchone()
        if not row:
            raise ApiError(403, "account_required",
                           "This sign-in is not linked to a Vecancy account yet. Use Create Account first.")
        cur.execute("SELECT 1 FROM super_admins WHERE uid=%s", (uid,))
        return {"uid": uid, "username": row["username"], "displayName": row["display_name"],
                "roles": {"superAdmin": cur.fetchone() is not None}}


# --------------------------------------------------------------------------- Firebase
class FirebaseOps:
    """The only place the server talks to Firebase Admin. Credentials come from the server's
    environment (never the browser)."""
    class EmailExists(Exception):
        pass

    def __init__(self, service_account_json=None):
        import json
        import os
        import firebase_admin
        from firebase_admin import auth, credentials
        self._auth = auth
        if not firebase_admin._apps:
            raw = service_account_json or os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
            cred = credentials.Certificate(json.loads(raw)) if raw else credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred)

    def verify(self, token):
        return self._auth.verify_id_token(token, check_revoked=True)

    def finalize_account(self, uid, email, password, display_name):
        a = self._auth
        user = a.get_user(uid)
        linked = [p.provider_id for p in user.provider_data if p.provider_id == "google.com"]
        kwargs = dict(email=email, password=password, email_verified=True)
        if display_name:
            kwargs["display_name"] = display_name
        if linked:
            kwargs["providers_to_delete"] = linked      # the Google login can no longer be used here
        try:
            a.update_user(uid, **kwargs)
        except a.EmailAlreadyExistsError as e:
            raise self.EmailExists() from e
        a.revoke_refresh_tokens(uid)                    # end the temporary verification session

    def set_password(self, uid, password):
        self._auth.update_user(uid, password=password)
        self._auth.revoke_refresh_tokens(uid)           # sign out everywhere else

    def delete_user(self, uid):
        self._auth.delete_user(uid)
