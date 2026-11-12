"""
Dorm Assistant: Firebase HTTPS function behind  /api/assistant  (see firebase.json).

- Verifies the caller's Firebase ID token.
- Uses the trained intent classifier (brain.py + intents.json) to explain the website.
- For 'live' questions (vacant beds, overdue, occupancy) it READS the signed-in user's own rooms.
- It never writes data and never proposes actions.
"""
import random
import time
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import auth, firestore
from firebase_functions import https_fn, options

from brain import Brain, LIVE_TAGS

firebase_admin.initialize_app()

_brain = None
_hits = {}  # uid -> [timestamps] for a simple rate limit
MAX_PER_MINUTE = 20


def get_brain():
    global _brain
    if _brain is None:
        _brain = Brain()
    return _brain


def reply(response, scope="tracker", tag="", conf=0.0, status=200):
    body = {"response": response, "scope": scope, "action": {"type": "none"},
            "intent": tag, "confidence": round(conf, 3)}
    return https_fn.Response(__import__("json").dumps(body), status=status, mimetype="application/json")


def fail(message, status):
    return https_fn.Response(__import__("json").dumps({"error": message}), status=status, mimetype="application/json")


def rate_limited(uid):
    now = time.time()
    recent = [t for t in _hits.get(uid, []) if now - t < 60]
    recent.append(now)
    _hits[uid] = recent
    return len(recent) > MAX_PER_MINUTE


# ---------------------------- live (read-only) answers ----------------------------

def parse_date(value):
    if not value:
        return None
    text = str(value)
    try:
        if len(text) == 10:
            dt = datetime.fromisoformat(text + "T23:59:59")
        else:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def snapshot(uid):
    docs = firestore.client().collection("users").document(uid).collection("rooms").stream()
    now = datetime.now(timezone.utc)
    stats = {"rooms": 0, "beds": 0, "vacant": 0, "reserved": 0, "occupied": 0, "overdue": [], "vacant_rooms": {}}
    for doc in docs:
        room = doc.to_dict() or {}
        beds = room.get("beds") or []
        name = str(room.get("room", "?"))
        whole = room.get("tenancyMode") == "Whole Room"
        room_taken = any(b.get("tenant") for b in beds)
        stats["rooms"] += 1
        for bed in beds:
            stats["beds"] += 1
            tenant = bed.get("tenant")
            if tenant:
                end = parse_date(bed.get("end"))
                if end and end < now:
                    stats["overdue"].append((name, bed.get("slot", ""), tenant, end))
                stats["occupied"] += 1
            elif bed.get("reservedFor") or bed.get("temporaryClientId"):
                stats["reserved"] += 1
            elif whole and room_taken:
                stats["occupied"] += 1
            else:
                stats["vacant"] += 1
                stats["vacant_rooms"][name] = stats["vacant_rooms"].get(name, 0) + 1
    return stats


def live_answer(tag, uid):
    s = snapshot(uid)
    if s["beds"] == 0:
        return "You don't have any rooms yet. Press + Add room on Room Canvas to create your first one."
    if tag == "live_vacant":
        if not s["vacant"]:
            return f"There are no vacant beds right now. All {s['beds']} beds are occupied or reserved."
        rooms = sorted(s["vacant_rooms"].items(), key=lambda kv: (-kv[1], kv[0]))
        shown = ", ".join(f"Room {n} ({c})" for n, c in rooms[:8])
        more = f" and {len(rooms) - 8} more" if len(rooms) > 8 else ""
        return (f"You have {s['vacant']} vacant bed{'s' if s['vacant'] != 1 else ''} across {len(rooms)} room"
                f"{'s' if len(rooms) != 1 else ''} (out of {s['beds']} beds): {shown}{more}. "
                f"{s['reserved']} more are reserved.")
    if tag == "live_overdue":
        if not s["overdue"]:
            return "No one is past their checkout date right now."
        s["overdue"].sort(key=lambda x: x[3])
        lines = "; ".join(f"{t} (Room {r}, {b})" for r, b, t, _ in s["overdue"][:6])
        more = f" and {len(s['overdue']) - 6} more" if len(s["overdue"]) > 6 else ""
        return (f"{len(s['overdue'])} tenant{'s are' if len(s['overdue']) != 1 else ' is'} past checkout: {lines}{more}. "
                "Open the Checkout Reminders tab to extend their stay or check them out.")
    pct = round(s["occupied"] / s["beds"] * 100)
    return (f"You have {s['rooms']} rooms and {s['beds']} beds. {s['occupied']} are occupied ({pct}%), "
            f"{s['vacant']} are vacant and {s['reserved']} are reserved or held for temporary guests.")


# ---------------------------- endpoint ----------------------------

@https_fn.on_request(region="us-central1", memory=options.MemoryOption.MB_512, timeout_sec=60)
def assistant(req: https_fn.Request) -> https_fn.Response:
    if req.method != "POST":
        return fail("Use POST.", 405)
    header = req.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return fail("Please sign in to use the assistant.", 401)
    try:
        uid = auth.verify_id_token(header[7:])["uid"]
    except Exception:
        return fail("Your sign-in expired. Please sign in again.", 401)
    if rate_limited(uid):
        return fail("You're sending messages too fast. Wait a moment and try again.", 429)

    payload = req.get_json(silent=True) or {}
    question = str(payload.get("question", "")).strip()[:300]
    if not question:
        return fail("Ask a question first.", 400)

    tag, conf, text = get_brain().answer(question)
    if tag == "unknown":
        return reply(text, "uncertain", tag, conf)
    if tag == "offtopic":
        return reply(text, "unrelated", tag, conf)
    if tag in LIVE_TAGS:
        try:
            return reply(live_answer(tag, uid), "tracker", tag, conf)
        except Exception as error:  # never leave the user without an answer
            print("live lookup failed:", error)
            return reply("I couldn't read your live records just now. Open Room Canvas and use the status filter to see vacant beds.", "tracker", tag, conf)
    return reply(text, "tracker", tag, conf)
