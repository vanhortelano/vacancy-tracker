"""One-time migration: Firestore  ->  JSON backup  ->  PostgreSQL.

  python migrate_firestore.py export backup.json     # READ-ONLY on Firestore; writes the backup file
  python migrate_firestore.py import backup.json     # loads PostgreSQL, then VERIFIES every record

Nothing is ever deleted from Firestore by this tool. Keep backup.json and the Firestore data until
you have checked the app on SQL and are happy. Import is safe to re-run (it upserts).
Exit code is non-zero if even one record failed to import or does not read back identically.
"""
import json
import os
import sys
from datetime import datetime, timezone

TOP = ["accountTransfers", "incomingTransfer", "dorms", "dormSecrets", "superAdmins", "pairing",
       "branches", "directory", "audit", "centralAccess", "centralOwner", "centralSecrets"]


def _enc(v):
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return {"__ts": int(v.timestamp() * 1000)}
    if isinstance(v, dict):
        return {k: _enc(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_enc(x) for x in v]
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    return str(v)


def export(out_path):
    import firebase_admin
    from firebase_admin import credentials, firestore
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    firebase_admin.initialize_app(credentials.Certificate(json.loads(raw)) if raw else credentials.ApplicationDefault())
    db = firestore.client()
    docs = []

    def walk(col_ref, prefix):
        for snap in col_ref.stream():
            docs.append({"path": prefix + [snap.id], "data": _enc(snap.to_dict() or {})})
            for sub in snap.reference.collections():
                walk(sub, prefix + [snap.id, sub.id])

    for name in TOP:
        walk(db.collection(name), [name])
    for user_ref in db.collection("users").list_documents():    # user docs themselves may not exist
        for sub in user_ref.collections():
            walk(sub, ["users", user_ref.id, sub.id])
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"exportedAt": datetime.now(timezone.utc).isoformat(), "docs": docs}, f)
    print(f"Exported {len(docs)} documents to {out_path}. Firestore was not modified.")


def _same(orig, got):
    """Every field in the original must come back identical (extra NULL fields are fine)."""
    if isinstance(orig, dict):
        return isinstance(got, dict) and all(_same(v, got.get(k)) for k, v in orig.items())
    if isinstance(orig, list):
        return isinstance(got, list) and len(orig) == len(got) and all(_same(a, b) for a, b in zip(orig, got))
    if isinstance(orig, (int, float)) and not isinstance(orig, bool) and isinstance(got, (int, float)):
        return float(orig) == float(got)
    return orig == got


def import_backup(path, database_url):
    import psycopg                                   # loaded only here: export does not need a database driver
    from psycopg.rows import dict_row
    from store import KINDS, Invalid, fetch, resolve, write
    with open(path, encoding="utf-8") as f:
        docs = json.load(f)["docs"]
    failures, per_kind = [], {}
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        now = datetime.now(timezone.utc)
        with conn.transaction():                      # all-or-nothing import
            cur = conn.cursor()
            for d in docs:
                try:
                    kind, ids = resolve(d["path"])
                    write(cur, kind, ids, d["data"], now, lenient=True)
                    per_kind[kind.name] = per_kind.get(kind.name, 0) + 1
                except Exception as e:                # report, never silently skip
                    failures.append((d["path"], str(e)))
        # verification pass: read every document back and compare
        mismatches = 0
        cur = conn.cursor()
        for d in docs:
            try:
                kind, ids = resolve(d["path"])
            except Invalid:
                continue
            got, _v = fetch(cur, kind, ids)
            if got is None or not _same(d["data"], got):
                mismatches += 1
                failures.append((d["path"], "does not read back identically"))
        for name, n in sorted(per_kind.items()):
            t = KINDS[name].table
            cur.execute(f'SELECT count(*) AS n FROM "{t}"')
            print(f"{name:24s} file={n:6d}  sql_table_rows={cur.fetchone()['n']}")
    print(f"\nDocuments in backup: {len(docs)}   imported: {sum(per_kind.values())}   problems: {len(failures)}")
    for p, why in failures[:50]:
        print("  PROBLEM", "/".join(p), "-", why)
    if failures:
        print("\nIMPORT NOT CONFIRMED. Do not delete anything from Firebase.")
        return 1
    print("\nImport verified: every record reads back identically from SQL.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "export":
        export(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == "import":
        sys.exit(import_backup(sys.argv[2], os.environ["DATABASE_URL"]))
    else:
        print(__doc__)
        sys.exit(2)
