"""SQL document store.

Maps the app's document paths (users/{uid}/rooms/{id}, dorms/{code}/viewers/{uid}, ...) onto
real PostgreSQL tables. Every table has typed columns for the known fields and an `extra`
JSONB column for anything else, so existing app behaviour is preserved exactly.

This module does storage only. Who may do what lives in rules.py and is checked by commit().
"""
import re
import secrets
import string
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

S, I, F, B, T, J = "s", "i", "f", "b", "t", "j"
_ID_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")
_ALPHABET = string.ascii_letters + string.digits


class Denied(Exception):
    code = "permission-denied"


class Aborted(Exception):
    code = "aborted"


class Invalid(Exception):
    code = "invalid-argument"


def new_id():
    return "".join(secrets.choice(_ALPHABET) for _ in range(20))


def snake(name):
    return re.sub(r"([A-Z])", lambda m: "_" + m.group(1).lower(), name)


class Kind:
    def __init__(self, name, table, keys, fields, overrides=None, children=False):
        self.name, self.table, self.keys, self.children = name, table, keys, children
        overrides = overrides or {}
        self.fields = {}  # camelName -> (column, type)
        for camel, typ in fields.items():
            self.fields[camel] = (overrides.get(camel, snake(camel)), typ)
        self.by_col = {col: (camel, typ) for camel, (col, typ) in self.fields.items()}


def _k(name, table, keys, fields, overrides=None, children=False):
    return Kind(name, table, keys, fields, overrides, children)


_OWNER = ["owner_uid", "id"]
_VIEWER = {"proof": S, "name": S, "email": S, "joinedAt": T}
_BLOCKED = {"name": S, "email": S, "blockedAt": T}
_DIR = {"ownerUid": S, "dormName": S, "location": S, "total": I, "vacant": I, "occupied": I,
        "maleVacant": I, "femaleVacant": I, "studentVacant": I, "revieweeVacant": I,
        "mixedVacant": I, "mixedGroupVacant": I, "acVacant": I, "nonAcVacant": I, "updatedAt": T}

KINDS = {k.name: k for k in [
    _k("rooms", "rooms", _OWNER, {"room": S, "type": S, "gender": S, "ac": J, "demographic": S,
       "tenancyMode": S, "capacity": I, "x": F, "y": F}, children=True),
    _k("shapes", "shapes", _OWNER, {"label": S, "labelRotation": F, "kind": S, "geometry": S,
       "color": S, "x": F, "y": F, "width": F, "height": F}),
    _k("prospects", "prospects", _OWNER, {"name": S, "gender": S, "demographic": S, "checkIn": S,
       "checkOut": S, "notes": S, "reservedBed": J, "desiredBed": J, "checkedIn": B,
       "checkedInAt": T, "checkedOut": B, "checkedOutAt": T, "groupId": S, "groupSize": I}),
    _k("temporary_dorm_clients", "temporary_clients", _OWNER, {"name": S, "gender": S, "start": S,
       "end": S, "notes": S, "roomId": S, "room": S, "slot": S, "status": S, "createdAt": T,
       "checkedOutAt": T, "remindAfter": I, "transferTo": J},
       {"start": "start_date", "end": "end_date", "createdAt": "created_at_client"}),
    _k("tenant_history", "tenant_history", _OWNER, {"tenant": S, "roomId": S, "room": S, "slot": S,
       "start": S, "end": S, "residentType": S, "residentGender": S, "reason": S, "leftAt": T,
       "expireAt": T}, {"start": "start_date", "end": "end_date"}),
    _k("bed_transfers", "bed_transfers", _OWNER, {"tenant": S, "from": J, "to": J,
       "residentType": S, "transferredAt": T}, {"from": "from_loc", "to": "to_loc"}),
    _k("settings", "user_settings", _OWNER, {"code": S, "dormName": S, "enabled": B}),

    _k("accountTransfers", "account_transfers", ["code"], {"fromUid": S, "fromEmail": S,
       "purpose": S, "expiresAt": T, "status": S, "toUid": S, "toEmail": S}),
    _k("incomingTransfer", "incoming_transfers", ["to_uid"], {"code": S, "fromUid": S}),

    _k("dorms", "dorms", ["code"], {"ownerUid": S, "dormName": S, "enabled": B, "updatedAt": T},
       {"updatedAt": "updated_at_client"}),
    _k("dormSecrets", "dorm_secrets", ["code"], {"ownerUid": S, "passwordHash": S}),
    _k("dorm_vacancy", "dorm_vacancy", ["code", "id"], {"room": S, "gender": S, "demographic": S,
       "total": I, "vacant": I, "reserved": I, "x": F, "y": F, "beds": J, "status": S,
       "updatedAt": T}, {"updatedAt": "updated_at_client"}),
    _k("dorm_layout", "dorm_layout", ["code", "id"], {"shapes": J, "updatedAt": T},
       {"updatedAt": "updated_at_client"}),
    _k("dorm_viewers", "dorm_viewers", ["code", "uid"], _VIEWER, {"joinedAt": "joined_at"}),
    _k("dorm_blocked", "dorm_blocked", ["code", "uid"], _BLOCKED),

    _k("superAdmins", "super_admins", ["uid"], {"email": S, "createdAt": T},
       {"createdAt": "created_at_client"}),
    _k("pairing", "pairing", ["code"], {"ownerUid": S, "dormName": S, "location": S, "expiresAt": T}),
    _k("branches", "branches", ["uid"], {"ownerUid": S, "dormName": S, "location": S, "purpose": S,
       "pairingCode": S, "requestedBy": S, "dirStatus": S, "analyticsStatus": S, "createdAt": T,
       "decidedAt": T}, {"createdAt": "created_at_client"}),
    _k("branch_snapshots", "branch_snapshots", ["branch_uid", "id"], {"total": I, "vacant": I,
       "occupied": I, "maleVacant": I, "femaleVacant": I, "studentVacant": I, "revieweeVacant": I,
       "mixedVacant": I, "mixedGroupVacant": I, "acVacant": I, "nonAcVacant": I, "checkouts": J,
       "checkins": J, "capturedAt": T}),
    _k("branch_changes", "branch_changes", ["branch_uid", "id"], {"kind": S, "status": S,
       "dormName": S, "createdAt": T, "decidedAt": T}, {"createdAt": "created_at_client"}),
    _k("directory", "directory_entries", ["uid"], _DIR, {"updatedAt": "updated_at_client"}),
    _k("audit", "audit_log", ["id"], {"actorUid": S, "actorEmail": S, "action": S, "branch": S,
       "detail": S, "at": T, "targetAdmin": S}),

    _k("centralAccess", "central_access", ["code"], {"ownerUid": S, "name": S, "enabled": B,
       "updatedAt": T}, {"updatedAt": "updated_at_client"}),
    _k("central_viewers", "central_viewers", ["code", "uid"], _VIEWER, {"joinedAt": "joined_at"}),
    _k("central_blocked", "central_blocked", ["code", "uid"], _BLOCKED),
    _k("centralOwner", "central_owner", ["uid"], {"code": S}),
    _k("centralSecrets", "central_secrets", ["code"], {"ownerUid": S, "passwordHash": S}),
]}

_USER_COLS = {"rooms", "shapes", "prospects", "temporary_dorm_clients", "tenant_history",
              "bed_transfers", "settings"}
_TOP = {"accountTransfers": "accountTransfers", "incomingTransfer": "incomingTransfer",
        "dorms": "dorms", "dormSecrets": "dormSecrets", "superAdmins": "superAdmins",
        "pairing": "pairing", "branches": "branches", "directory": "directory", "audit": "audit",
        "centralAccess": "centralAccess", "centralOwner": "centralOwner",
        "centralSecrets": "centralSecrets"}
_SUB = {("dorms", "vacancy"): "dorm_vacancy", ("dorms", "layout"): "dorm_layout",
        ("dorms", "viewers"): "dorm_viewers", ("dorms", "blocked"): "dorm_blocked",
        ("branches", "snapshots"): "branch_snapshots", ("branches", "changes"): "branch_changes",
        ("centralAccess", "viewers"): "central_viewers",
        ("centralAccess", "blocked"): "central_blocked"}

BED_FIELDS = {"slot": ("slot", S), "tenant": ("tenant", S), "start": ("bed_start", S),
              "end": ("bed_end", S), "reservedFor": ("reserved_for", S),
              "residentType": ("resident_type", S), "residentGender": ("resident_gender", S),
              "temporaryClientId": ("temporary_client_id", S)}


def resolve(path, want_doc=True):
    """path: list of segments -> (kind, ids). ids is the tuple of key values (doc ids included
    when want_doc is True, otherwise only the parent ids of a collection)."""
    if not isinstance(path, (list, tuple)) or not path or len(path) > 4:
        raise Invalid("bad path")
    for seg in path:
        if not isinstance(seg, str) or not _ID_RE.match(seg):
            raise Invalid("bad path segment")
    p = list(path)
    if p[0] == "users":
        if len(p) < 3 or p[2] not in _USER_COLS:
            raise Invalid("unknown collection")
        kind, ids, depth = KINDS[p[2]], (p[1],), 3
    elif len(p) >= 3 and (p[0], p[2]) in _SUB:
        kind, ids, depth = KINDS[_SUB[(p[0], p[2])]], (p[1],), 3
    elif p[0] in _TOP:
        kind, ids, depth = KINDS[_TOP[p[0]]], (), 1
    else:
        raise Invalid("unknown collection")
    if want_doc:
        if len(p) != depth + 1:
            raise Invalid("not a document path")
        return kind, ids + (p[depth],)
    if len(p) != depth:
        raise Invalid("not a collection path")
    return kind, ids


# --------------------------------------------------------------------------- codec
def _ms(dtv):
    return int(dtv.timestamp() * 1000)


def _to_dt(v):
    if isinstance(v, dict) and "__ts" in v:
        return datetime.fromtimestamp(int(v["__ts"]) / 1000, tz=timezone.utc)
    if v is None:
        return None
    raise Invalid("expected a timestamp")


def _is_sv(v):
    return isinstance(v, dict) and v.get("__sv") == 1


def _py(kind_field_type, v, now):
    """wire value -> database value."""
    typ = kind_field_type
    if v is None:
        return None
    if typ == T:
        return now if _is_sv(v) else _to_dt(v)
    if typ == J:
        return Jsonb(_resolve_sv(v, now))
    if typ == I:
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise Invalid("expected a number")
        return int(v)
    if typ == F:
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise Invalid("expected a number")
        return float(v)
    if typ == B:
        if not isinstance(v, bool):
            raise Invalid("expected true/false")
        return v
    if typ == S:
        if not isinstance(v, str):
            raise Invalid("expected text")
        return v
    raise Invalid("bad type")


def _resolve_sv(v, now):
    if _is_sv(v):
        return {"__ts": _ms(now)}
    if isinstance(v, dict):
        return {k: _resolve_sv(x, now) for k, x in v.items()}
    if isinstance(v, list):
        return [_resolve_sv(x, now) for x in v]
    return v


def _wire(typ, v):
    if v is None:
        return None
    if typ == T:
        return {"__ts": _ms(v)}
    return v


def _q(name):
    return '"' + name + '"'


# --------------------------------------------------------------------------- read
def fetch(cur, kind, ids, lock=False):
    """-> (wire_doc, version) or (None, 0)."""
    where = " AND ".join(f"{_q(c)}=%s" for c in kind.keys)
    cur.execute(f"SELECT * FROM {_q(kind.table)} WHERE {where}" + (" FOR UPDATE" if lock else ""), ids)
    row = cur.fetchone()
    if row is None:
        return None, 0
    doc = _row_to_doc(kind, row)
    if kind.children:
        doc["beds"] = _load_beds(cur, {ids[0]: [ids[1]]}).get((ids[0], ids[1]), [])
    return doc, row["version"]


def _row_to_doc(kind, row):
    doc = dict(row.get("extra") or {})
    for camel, (col, typ) in kind.fields.items():
        val = _wire(typ, row.get(col))
        if val is not None or camel not in doc:   # an odd legacy value kept in `extra` wins over NULL
            doc[camel] = val
    return doc


def _load_beds(cur, owner_rooms):
    """owner_rooms: {owner_uid: [room ids]} -> {(owner, room_id): [bed dicts]}"""
    out = {}
    for owner, room_ids in owner_rooms.items():
        if not room_ids:
            continue
        cur.execute('SELECT * FROM beds WHERE owner_uid=%s AND room_id = ANY(%s) ORDER BY room_id, position',
                    (owner, room_ids))
        for row in cur.fetchall():
            bed = dict(row.get("extra") or {})
            for camel, (col, _t) in BED_FIELDS.items():
                bed[camel] = row.get(col)
            out.setdefault((owner, row["room_id"]), []).append(bed)
    return out


def list_docs(cur, kind, parent_ids, where=None, order_by=None, limit=None, implicit=None):
    """Returns [(id, wire_doc, version)].  implicit = [(column, value)] filters the SERVER adds
    for authorization; they are always applied and cannot be removed by the client."""
    clauses, params = [], []
    for col, val in zip(kind.keys, parent_ids):
        clauses.append(f"{_q(col)}=%s")
        params.append(val)
    for col, val in (implicit or []):
        if col == "or":   # [(column, value), ...] any of
            clauses.append("(" + " OR ".join(f"{_q(c)}=%s" for c, _v in val) + ")")
            params.extend(v for _c, v in val)
        else:
            clauses.append(f"{_q(col)}=%s")
            params.append(val)
    ops = {"==": "=", "<": "<", "<=": "<=", ">": ">", ">=": ">=", "!=": "<>"}
    for item in (where or []):
        field, op, val = item
        if field not in kind.fields or op not in ops:
            raise Invalid("bad query")
        col, typ = kind.fields[field]
        clauses.append(f"{_q(col)} {ops[op]} %s")
        params.append(_py(typ, val, datetime.now(timezone.utc)))
    sql = f"SELECT * FROM {_q(kind.table)}"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    orders = []
    for field, direction in (order_by or []):
        if field not in kind.fields or direction not in ("asc", "desc"):
            raise Invalid("bad order")
        col, typ = kind.fields[field]
        collate = ' COLLATE "C"' if typ == S else ""   # byte order, like the previous database
        orders.append(f"{_q(col)}{collate} {direction.upper()}")
    orders.append(f"{_q(kind.keys[-1])} ASC")
    sql += " ORDER BY " + ", ".join(orders)
    sql += " LIMIT %s"
    params.append(min(int(limit or 5000), 5000))
    cur.execute(sql, params)
    rows = cur.fetchall()
    beds = {}
    if kind.children and rows:
        owner_rooms = {}
        for r in rows:
            owner_rooms.setdefault(r["owner_uid"], []).append(r["id"])
        beds = _load_beds(cur, owner_rooms)
    out = []
    for r in rows:
        d = _row_to_doc(kind, r)
        if kind.children:
            d["beds"] = beds.get((r["owner_uid"], r["id"]), [])
        out.append((r[kind.keys[-1]], d, r["version"]))
    return out


# --------------------------------------------------------------------------- write
def write(cur, kind, ids, wire_doc, now, lenient=False):
    """Replace the whole document (callers merge for update). Version is bumped.
    lenient=True (used only by the one-time import) keeps a value that does not fit its typed
    column in `extra` instead of failing, so no legacy data is ever dropped."""
    values, extra = {}, {}
    beds = None
    for k, v in wire_doc.items():
        if kind.children and k == "beds":
            beds = v
            continue
        if k in kind.fields:
            col, typ = kind.fields[k]
            try:
                values[col] = _py(typ, v, now)
            except Invalid:
                if not lenient:
                    raise
                extra[k] = _resolve_sv(v, now)
        elif not k.startswith("__"):
            extra[k] = _resolve_sv(v, now)
    for camel, (col, typ) in kind.fields.items():
        values.setdefault(col, None)
    if kind.children:
        if beds is not None and not isinstance(beds, list):
            raise Invalid("beds must be a list")
        if beds is not None and len(beds) > 200:
            raise Invalid("too many beds")
    cols = list(values) + ["extra"]
    vals = list(values.values()) + [Jsonb(extra)]
    key_cols = list(kind.keys)
    all_cols = key_cols + cols
    ph = ", ".join(["%s"] * len(all_cols))
    updates = ", ".join(f"{_q(c)}=EXCLUDED.{_q(c)}" for c in cols)
    cur.execute(
        f"INSERT INTO {_q(kind.table)} ({', '.join(_q(c) for c in all_cols)}) VALUES ({ph}) "
        f"ON CONFLICT ({', '.join(_q(c) for c in key_cols)}) DO UPDATE SET {updates}, "
        f"version={_q(kind.table)}.version+1, updated_at=now()",
        list(ids) + vals)
    if kind.children and beds is not None:
        owner, room_id = ids
        cur.execute("DELETE FROM beds WHERE owner_uid=%s AND room_id=%s", (owner, room_id))
        for pos, bed in enumerate(beds):
            if not isinstance(bed, dict):
                raise Invalid("bad bed")
            bv, bextra = {}, {}
            for k, v in bed.items():
                if k in BED_FIELDS:
                    bv[BED_FIELDS[k][0]] = _py(BED_FIELDS[k][1], v, now)
                else:
                    bextra[k] = _resolve_sv(v, now)
            bcols = ["owner_uid", "room_id", "position"] + list(bv) + ["extra"]
            cur.execute(
                f"INSERT INTO beds ({', '.join(_q(c) for c in bcols)}) VALUES ({', '.join(['%s'] * len(bcols))})",
                [owner, room_id, pos] + list(bv.values()) + [Jsonb(bextra)])


def remove(cur, kind, ids):
    where = " AND ".join(f"{_q(c)}=%s" for c in kind.keys)
    cur.execute(f"DELETE FROM {_q(kind.table)} WHERE {where}", ids)


# --------------------------------------------------------------------------- change helpers
def keys_present(before, incoming):
    ks = set(incoming or {})
    ks |= {k for k, v in (before or {}).items() if v is not None}
    return ks


def affected_keys(before, after):
    b, a = before or {}, after or {}
    return {k for k in set(a) | set(b) if a.get(k) != b.get(k)}
