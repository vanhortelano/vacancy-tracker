"""Read / query / commit entry points. Authorization is applied here, on the server."""
from datetime import datetime, timezone

import rules
from store import (KINDS, Aborted, Denied, Invalid, fetch, list_docs, remove, resolve, write)

MAX_WRITES = 500
MAX_DOC_BYTES = 900_000


class NotFound(Exception):
    code = "not-found"


class AlreadyExists(Exception):
    code = "already-exists"


def _now(cur):
    cur.execute("SELECT transaction_timestamp() AS t")
    return cur.fetchone()["t"]


def get_doc(conn, uid, path):
    with conn.transaction():
        cur = conn.cursor()
        kind, ids = resolve(path)
        ctx = rules.Ctx(cur, uid, _now(cur))
        doc, version = fetch(cur, KINDS[kind.name], ids)
        rules.authorize(ctx, "get", kind.name, ids, doc, None, doc)
        return {"exists": doc is not None, "data": doc, "v": version}


def query(conn, uid, path, where=None, order_by=None, limit=None):
    with conn.transaction():
        cur = conn.cursor()
        kind, parent = resolve(path, want_doc=False)
        ctx = rules.Ctx(cur, uid, _now(cur))
        implicit = rules.list_access(ctx, kind.name, parent)
        rows = list_docs(cur, kind, parent, where, order_by, limit, implicit)
        return [{"id": i, "data": d, "v": v} for i, d, v in rows]


def commit(conn, uid, reads, writes):
    """Atomic: all reads must still be at the version the browser saw (else `aborted`, and the
    browser retries, like a database transaction), then every write is authorized and applied."""
    if not isinstance(reads, list) or not isinstance(writes, list) or len(writes) > MAX_WRITES \
            or len(reads) > MAX_WRITES:
        raise Invalid("bad commit")
    parsed = []
    for w in writes:
        if not isinstance(w, dict) or w.get("op") not in ("set", "update", "create", "delete"):
            raise Invalid("bad write")
        kind, ids = resolve(w.get("path"))
        data = w.get("data")
        if w["op"] != "delete":
            if not isinstance(data, dict):
                raise Invalid("bad data")
            if len(repr(data)) > MAX_DOC_BYTES:
                raise Invalid("document too large")
        parsed.append((w["op"], kind.name, ids, data))
    with conn.transaction():
        cur = conn.cursor()
        now = _now(cur)
        ctx = rules.Ctx(cur, uid, now, batch=parsed)
        # Lock everything this commit touches in a fixed order (no deadlocks), then check versions.
        touched = {}
        for r in reads:
            kind, ids = resolve(r.get("path"))
            touched[(kind.name, ids)] = r.get("v", 0)
        for _op, kn, ids, _d in parsed:
            touched.setdefault((kn, ids), None)
        for (kn, ids) in sorted(touched, key=lambda k: (k[0], k[1])):
            doc, version = fetch(cur, KINDS[kn], ids, lock=True)
            expected = touched[(kn, ids)]
            if expected is not None and expected != version:
                raise Aborted("The data changed. Retrying.")
        ctx.forget()
        results = []
        for op, kn, ids, data in parsed:
            kind = KINDS[kn]
            before, _v = fetch(cur, kind, ids)
            ctx.forget()
            if op == "delete":
                rules.authorize(ctx, "delete", kn, ids, before, None, None)
                remove(cur, kind, ids)
            else:
                if op == "create" and before is not None:
                    raise AlreadyExists("already exists")
                if op == "update" and before is None:
                    raise NotFound("not found")
                eff = "update" if before is not None else "create"
                after = {**before, **data} if op == "update" else dict(data)   # set replaces, update merges
                rules.authorize(ctx, eff, kn, ids, before, data, after)
                write(cur, kind, ids, after, now)
            ctx.forget()
            results.append(True)
        return results


def read_many(conn, uid, ops):
    """Several reads/queries in one round trip (used by the browser's live refresh).
    Each item is authorized on its own; one denied item does not hide the others."""
    if not isinstance(ops, list) or len(ops) > 60:
        raise Invalid("bad read")
    out = []
    for op in ops:
        try:
            if not isinstance(op, dict):
                raise Invalid("bad read")
            if op.get("type") == "get":
                out.append({"ok": True, **get_doc(conn, uid, op.get("path"))})
            elif op.get("type") == "query":
                out.append({"ok": True, "docs": query(conn, uid, op.get("path"), op.get("where"),
                                                      op.get("orderBy"), op.get("limit"))})
            else:
                raise Invalid("bad read")
        except (Denied, Invalid, NotFound) as e:
            out.append({"ok": False, "error": e.code, "message": "You do not have access to that."
                        if isinstance(e, Denied) else "That request was not valid."})
    return out
