"""Clients inside a .reely export: pack them (with their files and the reels their scripts came from) and bring them
back in on another Mac, merging into a client that is already there.

Archive layout (added to transfer.py's):
  clients/<uid>/client.json        the client row, its references, plans and scripts
  clients/<uid>/files/*            uploaded PDFs, images, documents   (with "client_files")
  clients/<uid>/read/*.txt         text Reely read from its websites and files
  refreels/reels.json              reference reels whose account is not in the export
  refreels/videos/*.mp4            their videos                        (with "ref_videos")
  patterns.json                    the speciality patterns the clients' plans used
"""
import json
import re
import shutil
import uuid
from pathlib import Path

import clients as C
import db
from config import DATA_ROOT

_UID = re.compile(r"^[0-9a-f]{8,32}$")
_NAME = re.compile(r"^[^/\\\x00]{1,200}$")


def _uid() -> str:
    return uuid.uuid4().hex[:12]


def ensure_uids(cid: int) -> str:
    """Give the client, its plans and its scripts stable ids, so a later import can tell what it already has."""
    C.init()
    doc = C._load(cid)
    if not doc.get("uid"):
        doc["uid"] = _uid()
        data = {k: doc.get(k) for k in (*C._DOC_KEYS, "uid")}
        with db.tx() as c:
            c.execute("UPDATE clients SET data=? WHERE id=?", (json.dumps(data, ensure_ascii=False), cid))
    with db.tx() as c:
        for r in c.execute("SELECT id, settings FROM plans WHERE client_id=?", (cid,)).fetchall():
            st = json.loads(r[1] or "{}")
            if not st.get("uid"):
                st["uid"] = _uid(); c.execute("UPDATE plans SET settings=? WHERE id=?", (json.dumps(st, ensure_ascii=False), r[0]))
        for r in c.execute("SELECT id, options FROM scripts WHERE client_id=?", (cid,)).fetchall():
            op = json.loads(r[1] or "{}")
            if not op.get("uid"):
                op["uid"] = _uid(); c.execute("UPDATE scripts SET options=? WHERE id=?", (json.dumps(op, ensure_ascii=False), r[0]))
    return doc["uid"]


def _ref_codes(cid: int) -> list[str]:
    rows = db.rows("SELECT shortcode FROM scripts WHERE client_id=? AND shortcode IS NOT NULL "
                   "UNION SELECT shortcode FROM client_refs WHERE client_id=?", (cid, cid))
    return sorted({r["shortcode"] for r in rows if r["shortcode"]})


def _video_path(r: dict) -> Path | None:
    f = r.get("video_file")
    if not f:
        return None
    p = (C.REF_VIDEOS / f) if r.get("imported_ref") else (DATA_ROOT / (r.get("clinic") or "") / "videos" / f)
    return p if p.is_file() else None


def _dir_size(d: Path) -> int:
    return sum(f.stat().st_size for f in d.iterdir() if f.is_file()) if d.is_dir() else 0


def _by_account(reels: list[dict]) -> dict:
    out: dict = {}
    for r in reels:
        a = out.setdefault(r.get("clinic") or "?", {"n": 0, "videos": 0, "videos_n": 0})
        a["n"] += 1
        p = _video_path(r)
        if p:
            a["videos"] += p.stat().st_size; a["videos_n"] += 1
    return out


def estimate(ids: list[int]) -> dict:
    C.init()
    out = {}
    for cid in ids:
        try:
            doc = C._load(cid)
        except Exception:
            continue
        codes = _ref_codes(cid)
        reels = [r for r in (C.reel_row(c) for c in codes) if r]
        vids = [p for p in (_video_path(r) for r in reels) if p]
        n = lambda sql: db.one(sql, (cid,))["n"]
        f = C.folder(cid)
        out[str(cid)] = {
            "name": doc["name"], "speciality": doc.get("speciality"),
            "people": len(doc["people"]), "branches": len(doc["branches"]), "sources": len(doc["sources"]),
            "has_brief": bool(doc["brief"]), "plans": n("SELECT COUNT(*) n FROM plans WHERE client_id=?"),
            "scripts": n("SELECT COUNT(*) n FROM scripts WHERE client_id=?"),
            "core": 20000 + n("SELECT COALESCE(SUM(LENGTH(data)),0) n FROM scripts WHERE client_id=?") + _dir_size(f / "read"),
            "files": _dir_size(f / "files"), "files_n": len(list((f / "files").glob("*"))) if (f / "files").is_dir() else 0,
            "refs_n": len(codes), "ref_accounts": sorted({r.get("clinic") for r in reels if r.get("clinic")}),
            "ref_reels_size": len(codes) * 6000,
            "ref_videos": sum(p.stat().st_size for p in vids), "ref_videos_n": len(vids),
            "ref_by_account": _by_account(reels),
        }
    return out


def pack(z, ids: list[int], handles: list[str], inc: dict, ref_mode: str, progress=None) -> dict:
    """Write the chosen clients into the open zip. Returns the manifest additions."""
    C.init()
    entries, ref_rows, specs = [], {}, set()
    for cid in ids:
        uid = ensure_uids(cid)
        doc = C._load(cid)
        row = db.one("SELECT * FROM clients WHERE id=?", (cid,))
        payload = {
            "uid": uid, "name": row["name"], "data": json.loads(row["data"] or "{}"),
            "brief": json.loads(row["brief"]) if row["brief"] else None, "brief_meta": json.loads(row["brief_meta"] or "{}"),
            "created_at": row["created_at"],
            "refs": db.rows("SELECT shortcode, clinic, note, added FROM client_refs WHERE client_id=?", (cid,)),
            "plans": db.rows("SELECT id, month, count, settings, status, note, error, items, created_at FROM plans WHERE client_id=?", (cid,)),
            "scripts": db.rows("SELECT id, shortcode, person_id, language, status, title, options, data, error, plan_id, created_at, updated_at "
                               "FROM scripts WHERE client_id=?", (cid,)),
        }
        z.writestr(f"clients/{uid}/client.json", json.dumps(payload, ensure_ascii=False), compress_type=8)
        f = C.folder(cid)
        files_n = 0
        for p in f.glob("avatar*"):
            if p.is_file():
                z.write(p, f"clients/{uid}/avatar/{p.name}", compress_type=8)
        for sub in (["files"] if inc.get("client_files") else []) + ["read"]:
            for p in sorted((f / sub).glob("*")):
                if p.is_file():
                    z.write(p, f"clients/{uid}/{sub}/{p.name}", compress_type=8)
                    files_n += sub == "files"
        if doc.get("speciality"):
            specs.add(doc["speciality"])
        if ref_mode != "none":
            for code in _ref_codes(cid):
                r = C.reel_row(code)
                if r and (r.get("clinic") not in handles or r.get("imported_ref")):
                    ref_rows[code] = r
        entries.append({"uid": uid, "name": row["name"], "speciality": doc.get("speciality"), "files_included": bool(inc.get("client_files")),
                        "counts": {"people": len(doc["people"]), "branches": len(doc["branches"]), "sources": len(doc["sources"]),
                                   "files": files_n, "plans": len(payload["plans"]), "scripts": len(payload["scripts"]),
                                   "refs": len(payload["refs"]), "brief": bool(payload["brief"])}})
        if progress: progress(f"packed {row['name']}")
    vids = 0
    if ref_rows:
        clean = [{k: v for k, v in r.items() if k not in ("video_url",)} for r in ref_rows.values()]
        z.writestr("refreels/reels.json", json.dumps(clean, ensure_ascii=False), compress_type=8)
        if inc.get("ref_videos"):
            for r in ref_rows.values():
                p = _video_path(r)
                if p:
                    z.write(p, f"refreels/videos/{p.name}", compress_type=0); vids += 1
    pats = [r for r in db.rows("SELECT speciality, data, reels, made_at FROM patterns") if r["speciality"] in specs]
    if pats:
        z.writestr("patterns.json", json.dumps(pats, ensure_ascii=False), compress_type=8)
    return {"clients": entries, "ref_reels": len(ref_rows), "ref_videos": vids}


# ---------- import ----------
def _local_match(uid: str, name: str) -> dict | None:
    rows = db.rows("SELECT id, name, data FROM clients")
    for r in rows:
        if json.loads(r["data"] or "{}").get("uid") == uid:
            return r
    for r in rows:
        if r["name"].strip().lower() == (name or "").strip().lower():
            return r
    return None


def inspect(z, m: dict) -> list[dict]:
    C.init()
    out = []
    for e in m.get("clients") or []:
        if not _UID.match(e.get("uid") or ""):
            continue
        loc = _local_match(e["uid"], e.get("name"))
        local = None
        if loc:
            d = json.loads(loc["data"] or "{}")
            local = {"id": loc["id"], "name": loc["name"], "people": len(d.get("people") or []), "sources": len(d.get("sources") or []),
                     "branches": len(d.get("branches") or []),
                     "brief": bool(db.one("SELECT brief FROM clients WHERE id=?", (loc["id"],))["brief"]),
                     "plans": db.one("SELECT COUNT(*) n FROM plans WHERE client_id=?", (loc["id"],))["n"],
                     "scripts": db.one("SELECT COUNT(*) n FROM scripts WHERE client_id=?", (loc["id"],))["n"]}
        out.append({**e, "exists": bool(loc), "local": local})
    return out


def import_clients(z, m: dict, uids: list[str] | None, mode: str, progress=None) -> list[dict]:
    C.init()
    names = z.namelist()
    # patterns: only for specialities that have none yet
    if "patterns.json" in names:
        for p in json.loads(z.read("patterns.json")):
            if not db.one("SELECT 1 FROM patterns WHERE speciality=?", (p["speciality"],)):
                with db.tx() as c:
                    c.execute("INSERT INTO patterns(speciality, data, reels, made_at) VALUES(?,?,?,?)", (p["speciality"], p["data"], p["reels"], p["made_at"]))
    # reference reels: kept apart from research; skipped when the reel is already in the index
    if "refreels/reels.json" in names:
        C.REF_VIDEOS.mkdir(parents=True, exist_ok=True)
        for r in json.loads(z.read("refreels/reels.json")):
            code = r.get("shortcode")
            if not code or db.one("SELECT 1 FROM reels WHERE shortcode=?", (code,)):
                continue
            vf = r.get("video_file")
            member = f"refreels/videos/{vf}" if vf else None
            have = None
            if member and member in names and _NAME.match(vf) and vf.endswith(".mp4"):
                if not (C.REF_VIDEOS / vf).exists():
                    with z.open(member) as src, open(C.REF_VIDEOS / vf, "wb") as dst:
                        shutil.copyfileobj(src, dst, 1024 * 1024)
                have = vf
            old = db.one("SELECT video_file FROM ref_reels WHERE shortcode=?", (code,))
            with db.tx() as c:
                c.execute("INSERT INTO ref_reels(shortcode, data, video_file) VALUES(?,?,?) ON CONFLICT(shortcode) DO UPDATE SET data=excluded.data, "
                          "video_file=COALESCE(excluded.video_file, ref_reels.video_file)",
                          (code, json.dumps({k: v for k, v in r.items() if k not in ("imported_ref", "video_file")}, ensure_ascii=False), have or (old or {}).get("video_file")))
    report = []
    for e in m.get("clients") or []:
        uid = e.get("uid") or ""
        if not _UID.match(uid) or (uids is not None and uid not in uids):
            continue
        member = f"clients/{uid}/client.json"
        if member not in names:
            continue
        p = json.loads(z.read(member))
        if progress: progress(f"{p['name']}…")
        loc = _local_match(uid, p["name"])
        action = "new"
        if loc and mode == "replace":
            C.delete_client(loc["id"]); loc = None; action = "replaced"
        added = {"people": 0, "branches": 0, "sources": 0, "files": 0, "plans": 0, "scripts": 0}
        kept_scripts = 0
        data = {**p["data"], "uid": uid}
        if not loc:
            with db.tx() as c:
                cur = c.execute("INSERT INTO clients(name, data, brief, brief_meta, created_at) VALUES(?,?,?,?,?)",
                                (p["name"], json.dumps(data, ensure_ascii=False), json.dumps(p["brief"], ensure_ascii=False) if p.get("brief") else None,
                                 json.dumps(p.get("brief_meta") or {}, ensure_ascii=False), p.get("created_at")))
                cid = cur.lastrowid
            for k in added:
                if k in ("people", "branches", "sources"):
                    added[k] = len(data.get(k) or [])
        else:
            cid = loc["id"]; action = "merged"
            mine = json.loads(loc["data"] or "{}")
            for k in ("people", "branches", "sources"):
                have = {x.get("id") for x in mine.get(k) or []}
                new = [x for x in data.get(k) or [] if x.get("id") not in have]
                mine[k] = (mine.get(k) or []) + new
                added[k] = len(new)
            for k in ("speciality", "city", "color", "image"):
                mine[k] = mine.get(k) or data.get(k)
            mine["languages"] = mine.get("languages") or data.get("languages") or []
            mine["uid"] = mine.get("uid") or uid
            brief_row = db.one("SELECT brief FROM clients WHERE id=?", (cid,))
            with db.tx() as c:
                c.execute("UPDATE clients SET data=?, updated_at=datetime('now') WHERE id=?", (json.dumps(mine, ensure_ascii=False), cid))
                if not brief_row["brief"] and p.get("brief"):
                    c.execute("UPDATE clients SET brief=?, brief_meta=? WHERE id=?",
                              (json.dumps(p["brief"], ensure_ascii=False), json.dumps(p.get("brief_meta") or {}, ensure_ascii=False), cid))
        # files and the text read from sources
        f = C.folder(cid)
        for n in names:
            pre = f"clients/{uid}/"
            if not n.startswith(pre) or n.endswith("/"):
                continue
            rest = n[len(pre):].split("/")
            if len(rest) != 2 or rest[0] not in ("files", "read", "avatar") or not _NAME.match(rest[1]) or rest[1] in (".", ".."):
                continue
            if rest[0] == "avatar":
                # the client's picture sits beside its folders; keep one that is already here
                if not rest[1].startswith("avatar") or any(f.glob("avatar*")):
                    continue
                target = f / rest[1]
            else:
                target = f / rest[0] / rest[1]
            if target.exists():
                continue
            with z.open(n) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
            added["files"] += rest[0] == "files"
        # references
        with db.tx() as c:
            for r in p.get("refs") or []:
                c.execute("INSERT OR IGNORE INTO client_refs(client_id, shortcode, clinic, note, added) VALUES(?,?,?,?,?)",
                          (cid, r["shortcode"], r.get("clinic"), r.get("note") or "", r.get("added")))
        # plans, then scripts, matched by their uid
        local_plans = {json.loads(r["settings"] or "{}").get("uid"): r["id"] for r in db.rows("SELECT id, settings FROM plans WHERE client_id=?", (cid,))}
        local_scripts = {json.loads(r["options"] or "{}").get("uid"): r["id"] for r in db.rows("SELECT id, options FROM scripts WHERE client_id=?", (cid,))}
        plan_map, new_plans = {}, []
        for pl in p.get("plans") or []:
            pu = json.loads(pl.get("settings") or "{}").get("uid")
            if pu and pu in local_plans:
                plan_map[pl["id"]] = local_plans[pu]; continue
            with db.tx() as c:
                cur = c.execute("INSERT INTO plans(client_id, month, count, settings, status, note, error, items, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                                (cid, pl["month"], pl["count"], pl["settings"], "failed" if pl["status"] == "proposing" else pl["status"],
                                 pl.get("note"), pl.get("error"), pl.get("items") or "[]", pl.get("created_at")))
                plan_map[pl["id"]] = cur.lastrowid; new_plans.append(cur.lastrowid)
            added["plans"] += 1
        script_map = {}
        for s in p.get("scripts") or []:
            su = json.loads(s.get("options") or "{}").get("uid")
            if su and su in local_scripts:
                script_map[s["id"]] = local_scripts[su]; kept_scripts += 1; continue
            status, err = s["status"], s.get("error")
            if status in ("queued", "generating"):
                status, err = "failed", "This was still being written when it was exported. Try again."
            with db.tx() as c:
                cur = c.execute("INSERT INTO scripts(client_id, shortcode, person_id, language, status, title, options, data, error, plan_id, created_at, updated_at) "
                                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                                (cid, s.get("shortcode"), s.get("person_id"), s.get("language"), status, s.get("title"), s.get("options") or "{}",
                                 s.get("data"), err, plan_map.get(s.get("plan_id")), s.get("created_at"), s.get("updated_at")))
                script_map[s["id"]] = cur.lastrowid
            added["scripts"] += 1
        # a new plan's rows point at its scripts by id; renumber them for this Mac
        for pid in new_plans:
            r = db.one("SELECT items FROM plans WHERE id=?", (pid,))
            items = json.loads(r["items"] or "[]")
            for it in items:
                if it.get("script_id") is not None:
                    it["script_id"] = script_map.get(it["script_id"])
            with db.tx() as c:
                c.execute("UPDATE plans SET items=? WHERE id=?", (json.dumps(items, ensure_ascii=False), pid))
        codes = _ref_codes(cid)
        missing = [x for x in codes if not C.reel_row(x)]
        report.append({"name": p["name"], "id": cid, "action": action, "added": added, "kept_scripts": kept_scripts,
                       "refs": len(codes), "refs_missing": len(missing)})
    return report
