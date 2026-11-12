"""Server-side authorization: a rule-by-rule port of the previous firestore.rules.

Every read, write and query goes through here. The caller's identity (`ctx.uid`) comes ONLY from
the verified Firebase ID token, never from anything the browser sends. Anything not explicitly
allowed below is denied.
"""
from datetime import timedelta

from store import KINDS, Denied, affected_keys, fetch, keys_present

HOUR_MS = 3600 * 1000


class Ctx:
    def __init__(self, cur, uid, now, batch=None):
        self.cur, self.uid, self.now, self.batch = cur, uid, now, batch or []
        self._cache = {}

    def get(self, kind, *ids):
        key = (kind, ids)
        if key not in self._cache:
            self._cache[key] = fetch(self.cur, KINDS[kind], ids)[0]
        return self._cache[key]

    def forget(self):
        self._cache.clear()

    def exists(self, kind, *ids):
        return self.get(kind, *ids) is not None

    @property
    def now_ms(self):
        return int(self.now.timestamp() * 1000)

    def is_super(self):
        return self.exists("superAdmins", self.uid)

    def after_in_batch(self, kind, ids):
        """Equivalent of Firestore getAfter(): the doc as this same commit will leave it."""
        for op, k, i, data in self.batch:
            if k == kind and i == ids and op in ("set", "update", "create"):
                return data
        return self.get(kind, *ids)


def ms(v):
    return v.get("__ts") if isinstance(v, dict) and "__ts" in v else None


def is_sv(v):
    return isinstance(v, dict) and v.get("__sv") == 1


def only(keys, allowed):
    return set(keys) <= set(allowed)


def _owns_dorm(ctx, code):
    d = ctx.get("dorms", code)
    return bool(d and d.get("ownerUid") == ctx.uid)


def _owns_central(ctx, code):
    d = ctx.get("centralAccess", code)
    return bool(d and d.get("ownerUid") == ctx.uid)


def _mine(ctx, branch_uid):
    if not ctx.is_super():
        return False
    b = ctx.get("branches", branch_uid)
    return bool(b and b.get("requestedBy") == ctx.uid)


def _ok_move(before, after):
    return before == after or (before == "pending" and after in ("approved", "rejected")) \
        or (before == "approved" and after == "revoked")


def _transfer_approved_for(ctx, owner_uid):
    """Account transfer: the old owner may touch the new owner's space once it is approved."""
    inc = ctx.get("incomingTransfer", owner_uid)
    if not inc or inc.get("fromUid") != ctx.uid:
        return False
    t = ctx.get("accountTransfers", inc.get("code") or "-")
    return bool(t and t.get("status") == "approved")


# --------------------------------------------------------------------------- documents
def authorize(ctx, op, kind, ids, before, incoming, after):
    """op: get | create | update | delete.  Raises Denied unless a rule allows it."""
    uid = ctx.uid
    if not uid:
        raise Denied()
    fn = RULES.get(kind)
    if fn is None or not fn(ctx, op, ids, before, incoming, after):
        raise Denied()


def r_user(ctx, op, ids, before, incoming, after):
    owner = ids[0]
    if ctx.uid == owner:
        return True
    return _transfer_approved_for(ctx, owner)   # read or write, only after an approved transfer


def r_dorms(ctx, op, ids, before, incoming, after):
    code = ids[0]
    allowed = ["ownerUid", "dormName", "enabled", "updatedAt"]
    if op == "get":
        return _owns_dorm(ctx, code)
    if op == "create":
        return incoming.get("ownerUid") == ctx.uid and only(keys_present(None, incoming), allowed)
    if op == "update":
        return _owns_dorm(ctx, code) and after.get("ownerUid") == before.get("ownerUid") \
            and only(keys_present(before, after), allowed)
    if op == "delete":
        return _owns_dorm(ctx, code)
    return False


def _viewer_visible(ctx, code):
    d = ctx.get("dorms", code)
    if _owns_dorm(ctx, code):
        return True
    return bool(ctx.exists("dorm_viewers", code, ctx.uid) and d and d.get("enabled") is True)


def r_dorm_public(ctx, op, ids, before, incoming, after):   # vacancy + layout
    code = ids[0]
    if op == "get":
        return _viewer_visible(ctx, code)
    return _owns_dorm(ctx, code)


def _viewer_rule(owner_check, access_kind, secret_kind, blocked_kind, viewer_kind):
    def rule(ctx, op, ids, before, incoming, after):
        code, vid = ids
        if op == "get":
            return ctx.uid == vid or owner_check(ctx, code)
        if op == "create":
            access = ctx.get(access_kind, code)
            secret = ctx.get(secret_kind, code)
            return (ctx.uid == vid and bool(access) and access.get("enabled") is True
                    and not ctx.exists(blocked_kind, code, ctx.uid)
                    and bool(secret) and incoming.get("proof") == secret.get("passwordHash")
                    and incoming.get("proof") is not None
                    and only(keys_present(None, incoming), ["proof", "name", "email", "joinedAt"])
                    and is_sv(incoming.get("joinedAt")))
        if op == "delete":
            return owner_check(ctx, code) or ctx.uid == vid
        return False   # no update rule
    return rule


def r_owner_only_dorm(ctx, op, ids, before, incoming, after):    # blocked + dormSecrets
    return _owns_dorm(ctx, ids[0])


def r_central_blocked(ctx, op, ids, before, incoming, after):
    return _owns_central(ctx, ids[0])


def r_account_transfers(ctx, op, ids, before, incoming, after):
    uid = ctx.uid
    if op == "get":
        return True
    if op == "create":
        exp = ms(incoming.get("expiresAt"))
        return (incoming.get("fromUid") == uid and incoming.get("status") == "open"
                and only(keys_present(None, incoming), ["fromUid", "fromEmail", "purpose", "expiresAt", "status"])
                and exp is not None and exp > ctx.now_ms and exp <= ctx.now_ms + 24 * HOUR_MS)
    if op == "update":
        if before is None:
            return False
        aff = affected_keys(before, after)
        exp = ms(before.get("expiresAt"))
        a = (before.get("status") == "open" and exp is not None and exp > ctx.now_ms
             and uid != before.get("fromUid") and after.get("status") == "requested"
             and after.get("toUid") == uid and only(aff, ["status", "toUid", "toEmail"]))
        b = (before.get("fromUid") == uid and only(aff, ["status"])
             and after.get("status") in ("open", "approved", "rejected", "done"))
        return a or b
    if op == "delete":
        return bool(before and before.get("fromUid") == uid)
    return False


def r_incoming(ctx, op, ids, before, incoming, after):
    to_uid = ids[0]
    if ctx.uid != to_uid:
        return False
    if op in ("get", "delete"):
        return True
    if op in ("create", "update"):
        t = ctx.get("accountTransfers", (after or {}).get("code") or "-")
        return (only(keys_present(before, after), ["code", "fromUid"]) and bool(t)
                and t.get("toUid") == ctx.uid and t.get("fromUid") == after.get("fromUid"))
    return False


def r_super_admins(ctx, op, ids, before, incoming, after):
    if op == "get":
        return ctx.uid == ids[0]
    if op == "create":
        return ctx.uid == ids[0] and only(keys_present(None, incoming), ["email", "createdAt"])
    return False


def r_pairing(ctx, op, ids, before, incoming, after):
    if op == "get":
        return ctx.is_super()
    if op == "create":
        exp = ms(incoming.get("expiresAt"))
        return (incoming.get("ownerUid") == ctx.uid
                and only(keys_present(None, incoming), ["ownerUid", "dormName", "location", "expiresAt"])
                and exp is not None and exp > ctx.now_ms and exp <= ctx.now_ms + 20 * 60 * 1000)
    if op == "delete":
        return ctx.is_super() or bool(before and before.get("ownerUid") == ctx.uid)
    return False


def r_branches(ctx, op, ids, before, incoming, after):
    uid, buid = ctx.uid, ids[0]
    if op == "get":
        return uid == buid or (ctx.is_super() and bool(before) and before.get("requestedBy") == uid)
    if op == "create":
        pair = ctx.get("pairing", incoming.get("pairingCode") or "-")
        pexp = ms(pair.get("expiresAt")) if pair else None
        return (ctx.is_super() and incoming.get("requestedBy") == uid and incoming.get("ownerUid") == buid
                and incoming.get("dirStatus") == "pending" and incoming.get("analyticsStatus") == "pending"
                and only(keys_present(None, incoming), ["ownerUid", "dormName", "location", "purpose",
                         "pairingCode", "requestedBy", "dirStatus", "analyticsStatus", "createdAt"])
                and bool(pair) and pair.get("ownerUid") == buid and pexp is not None and pexp > ctx.now_ms)
    if op == "update":
        if before is None or uid != buid:
            return False
        return (only(affected_keys(before, after), ["dirStatus", "analyticsStatus", "decidedAt"])
                and _ok_move(before.get("dirStatus"), after.get("dirStatus"))
                and _ok_move(before.get("analyticsStatus"), after.get("analyticsStatus")))
    if op == "delete":
        return uid == buid or (ctx.is_super() and bool(before) and before.get("requestedBy") == uid)
    return False


def r_snapshots(ctx, op, ids, before, incoming, after):
    buid = ids[0]
    b = ctx.get("branches", buid)
    approved = bool(b) and b.get("analyticsStatus") == "approved"
    if op == "get":
        return _mine(ctx, buid) and approved
    if op == "create":
        return ctx.uid == buid and approved
    return False


def r_changes(ctx, op, ids, before, incoming, after):
    buid = ids[0]
    if op == "get":
        return ctx.uid == buid or _mine(ctx, buid)
    if op == "create":
        return (ctx.uid == buid and incoming.get("status") == "pending"
                and incoming.get("kind") in ("password", "remove")
                and only(keys_present(None, incoming), ["kind", "status", "dormName", "createdAt"]))
    if op == "update":
        return (_mine(ctx, buid) and bool(before) and before.get("status") == "pending"
                and after.get("status") in ("approved", "rejected")
                and only(affected_keys(before, after), ["status", "decidedAt"]))
    if op == "delete":
        return ctx.uid == buid
    return False


_DIR_KEYS = ["ownerUid", "dormName", "location", "total", "vacant", "occupied", "maleVacant",
             "femaleVacant", "studentVacant", "revieweeVacant", "mixedVacant", "mixedGroupVacant",
             "acVacant", "nonAcVacant", "updatedAt"]


def r_directory(ctx, op, ids, before, incoming, after):
    duid = ids[0]
    if op == "get":
        return True
    if op in ("create", "update"):
        b = ctx.get("branches", duid)
        return (ctx.uid == duid and after.get("ownerUid") == duid and bool(b)
                and b.get("dirStatus") == "approved" and only(keys_present(before, after), _DIR_KEYS))
    if op == "delete":
        return ctx.uid == duid or _mine(ctx, duid)
    return False


def r_audit(ctx, op, ids, before, incoming, after):
    if op == "get":
        return bool(before) and (before.get("targetAdmin") == ctx.uid or before.get("actorUid") == ctx.uid)
    if op == "create":
        return incoming.get("actorUid") == ctx.uid and only(keys_present(None, incoming),
                ["actorUid", "actorEmail", "action", "branch", "detail", "at", "targetAdmin"])
    return False


def r_central_access(ctx, op, ids, before, incoming, after):
    code = ids[0]
    allowed = ["ownerUid", "name", "enabled", "updatedAt"]
    if op == "get":
        return True
    if op == "create":
        if not (ctx.is_super() and incoming.get("ownerUid") == ctx.uid
                and only(keys_present(None, incoming), allowed)):
            return False
        # one server per Super Admin: no pointer yet, and this same commit must create it
        if ctx.exists("centralOwner", ctx.uid):
            return False
        pointer = ctx.after_in_batch("centralOwner", (ctx.uid,))
        return bool(pointer) and pointer.get("code") == code
    if op == "update":
        return (_owns_central(ctx, code) and after.get("ownerUid") == before.get("ownerUid")
                and only(keys_present(before, after), allowed))
    if op == "delete":
        return _owns_central(ctx, code)
    return False


def r_central_owner(ctx, op, ids, before, incoming, after):
    if op in ("get", "delete"):
        return ctx.uid == ids[0]
    if op == "create":
        return ctx.is_super() and ctx.uid == ids[0] and only(keys_present(None, incoming), ["code"])
    return False


def r_central_secrets(ctx, op, ids, before, incoming, after):
    uid = ctx.uid
    if op == "create":
        return ctx.is_super() and incoming.get("ownerUid") == uid
    if op in ("get", "delete"):
        return bool(before) and before.get("ownerUid") == uid
    if op == "update":
        return bool(before) and before.get("ownerUid") == uid and after.get("ownerUid") == uid
    return False


RULES = {k: r_user for k in ("rooms", "shapes", "prospects", "temporary_dorm_clients",
                              "tenant_history", "bed_transfers", "settings")}
RULES.update({
    "dorms": r_dorms,
    "dorm_vacancy": r_dorm_public, "dorm_layout": r_dorm_public,
    "dorm_viewers": _viewer_rule(_owns_dorm, "dorms", "dormSecrets", "dorm_blocked", "dorm_viewers"),
    "dorm_blocked": r_owner_only_dorm, "dormSecrets": r_owner_only_dorm,
    "accountTransfers": r_account_transfers, "incomingTransfer": r_incoming,
    "superAdmins": r_super_admins, "pairing": r_pairing, "branches": r_branches,
    "branch_snapshots": r_snapshots, "branch_changes": r_changes,
    "directory": r_directory, "audit": r_audit,
    "centralAccess": r_central_access,
    "central_viewers": _viewer_rule(_owns_central, "centralAccess", "centralSecrets",
                                    "central_blocked", "central_viewers"),
    "central_blocked": r_central_blocked, "centralOwner": r_central_owner,
    "centralSecrets": r_central_secrets,
})


# --------------------------------------------------------------------------- queries
def list_access(ctx, kind, parent_ids):
    """Returns the filters the SERVER forces onto a collection query (or raises Denied)."""
    uid = ctx.uid
    if not uid:
        raise Denied()
    if kind in RULES and RULES[kind] is r_user:
        if uid == parent_ids[0] or _transfer_approved_for(ctx, parent_ids[0]):
            return []
        raise Denied()
    if kind in ("dorm_vacancy", "dorm_layout"):
        if _viewer_visible(ctx, parent_ids[0]):
            return []
        raise Denied()
    if kind in ("dorm_viewers", "dorm_blocked"):
        if _owns_dorm(ctx, parent_ids[0]):
            return []
        raise Denied()
    if kind in ("central_viewers", "central_blocked"):
        if _owns_central(ctx, parent_ids[0]):
            return []
        raise Denied()
    if kind == "accountTransfers":
        return [("from_uid", uid)]
    if kind == "incomingTransfer":
        return [("to_uid", uid)]
    if kind == "branches":
        if ctx.is_super():
            return [("requested_by", uid)]
        raise Denied()
    if kind == "branch_snapshots":
        b = ctx.get("branches", parent_ids[0])
        if _mine(ctx, parent_ids[0]) and b and b.get("analyticsStatus") == "approved":
            return []
        raise Denied()
    if kind == "branch_changes":
        if uid == parent_ids[0] or _mine(ctx, parent_ids[0]):
            return []
        raise Denied()
    if kind == "directory":
        return []
    if kind == "audit":
        return [("or", [("target_admin", uid), ("actor_uid", uid)])]
    if kind == "centralAccess":
        if ctx.is_super():
            return [("owner_uid", uid)]
        raise Denied()
    if kind == "centralOwner":
        return [("uid", uid)]
    raise Denied()


def doc_visible_in_list(ctx, kind, doc):
    return True
