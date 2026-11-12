"""Dorm Assistant on SQL. Same answers as before; the data it reads and the history, insights
and settings it produces now live in PostgreSQL (ai_* tables). The trained intent model
(brain.py + intents.json) is unchanged."""
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

from store import new_id

LIVE_TAGS = {"live_vacant", "live_overdue", "live_occupancy"}


def parse_date(value):
    if not value:
        return None
    text = str(value)
    try:
        dt = datetime.fromisoformat(text + "T23:59:59") if len(text) == 10 else datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def snapshot(conn, uid):
    cur = conn.cursor()
    cur.execute("""SELECT r.id, r.room, r.tenancy_mode, b.slot, b.tenant, b.bed_end, b.reserved_for, b.temporary_client_id
                   FROM rooms r LEFT JOIN beds b ON b.owner_uid=r.owner_uid AND b.room_id=r.id
                   WHERE r.owner_uid=%s ORDER BY r.room, b.position""", (uid,))
    now = datetime.now(timezone.utc)
    stats = {"rooms": 0, "beds": 0, "vacant": 0, "reserved": 0, "occupied": 0, "overdue": [], "vacant_rooms": {}}
    rooms = {}
    for row in cur.fetchall():
        rooms.setdefault(row["id"], {"name": str(row["room"] or "?"), "whole": row["tenancy_mode"] == "Whole Room", "beds": []})
        if row["slot"] is not None or row["tenant"] is not None:
            rooms[row["id"]]["beds"].append(row)
    for room in rooms.values():
        taken = any(b["tenant"] for b in room["beds"])
        stats["rooms"] += 1
        for bed in room["beds"]:
            stats["beds"] += 1
            if bed["tenant"]:
                end = parse_date(bed["bed_end"])
                if end and end < now:
                    stats["overdue"].append((room["name"], bed["slot"] or "", bed["tenant"], end))
                stats["occupied"] += 1
            elif bed["reserved_for"] or bed["temporary_client_id"]:
                stats["reserved"] += 1
            elif room["whole"] and taken:
                stats["occupied"] += 1
            else:
                stats["vacant"] += 1
                stats["vacant_rooms"][room["name"]] = stats["vacant_rooms"].get(room["name"], 0) + 1
    return stats


def live_answer(tag, stats):
    s = stats
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


def _conversation(conn, uid, conversation_id, first_text):
    cur = conn.cursor()
    if conversation_id:
        cur.execute("SELECT id FROM ai_conversations WHERE id=%s AND owner_uid=%s", (conversation_id, uid))
        if cur.fetchone():           # only ever the caller's own conversation
            return conversation_id
    cid = new_id()
    cur.execute("INSERT INTO ai_conversations (id, owner_uid, title) VALUES (%s,%s,%s)", (cid, uid, first_text[:60]))
    return cid


def answer(conn, brain, uid, question, conversation_id=None):
    """-> dict in the same shape the browser already expects, plus conversationId."""
    tag, conf, text = brain.answer(question)
    scope, stats = "tracker", None
    if tag == "unknown":
        scope = "uncertain"
    elif tag == "offtopic":
        scope = "unrelated"
    elif tag in LIVE_TAGS:
        try:
            stats = snapshot(conn, uid)
            text = live_answer(tag, stats)
        except Exception as error:
            print("live lookup failed:", error)
            text = "I couldn't read your live records just now. Open Room Canvas and use the status filter to see vacant beds."
            stats = None
    with conn.transaction():
        cid = _conversation(conn, uid, conversation_id, question)
        cur = conn.cursor()
        cur.execute("INSERT INTO ai_messages (conversation_id, owner_uid, role, content) VALUES (%s,%s,'user',%s)", (cid, uid, question))
        cur.execute("INSERT INTO ai_messages (conversation_id, owner_uid, role, content, intent, confidence, scope) "
                    "VALUES (%s,%s,'assistant',%s,%s,%s,%s)", (cid, uid, text, tag, round(conf, 3), scope))
        cur.execute("UPDATE ai_conversations SET updated_at=now() WHERE id=%s", (cid,))
        if stats is not None:
            data = {"rooms": stats["rooms"], "beds": stats["beds"], "vacant": stats["vacant"], "reserved": stats["reserved"],
                    "occupied": stats["occupied"], "overdue": len(stats["overdue"])}
            cur.execute("INSERT INTO ai_insights (owner_uid, kind, summary, data, conversation_id) VALUES (%s,%s,%s,%s,%s)",
                        (uid, tag, text, Jsonb(data), cid))
    return {"response": text, "scope": scope, "action": {"type": "none"}, "intent": tag,
            "confidence": round(conf, 3), "conversationId": cid}


def history(conn, uid, conversation_id, limit=100):
    cur = conn.cursor()
    cur.execute("SELECT role, content, intent, scope, created_at FROM ai_messages "
                "WHERE owner_uid=%s AND conversation_id=%s ORDER BY id DESC LIMIT %s", (uid, conversation_id, limit))
    return [{"role": r["role"], "content": r["content"], "intent": r["intent"], "scope": r["scope"],
             "at": r["created_at"].isoformat()} for r in reversed(cur.fetchall())]
