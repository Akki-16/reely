"""Move clinics between Macs: export chosen clinics and parts into one .reely file (a zip), import it elsewhere.

Archive layout:
  manifest.json                      what is inside, per clinic
  clinics/<handle>/<top-level files> index, metadata, annotations, sheets (always)
  clinics/<handle>/videos/*.info.json  per-reel metadata: likes, caption, date (always)
  clinics/<handle>/videos/*.mp4      only with "videos"
  clinics/<handle>/transcripts/*.json  only with "transcripts"
  clinics/<handle>/INSIGHTS.md       only with "insights"
  clinics/<handle>/chat.json         only with "chat" (Ask Claude thread)
"""
import json
import re
import shutil
import threading
import time
import zipfile
from datetime import datetime
from pathlib import Path

import db
from config import DATA_ROOT
from pipeline import importer

FORMAT = 1
PARTS = ("videos", "transcripts", "insights", "chat")
_HANDLE = re.compile(r"^[A-Za-z0-9_.]{1,40}$")
_SKIP_TOP = {"download.log", "transcribe.log", ".DS_Store"}

job: dict = {"status": "idle"}
_lock = threading.Lock()


def _valid_handle(h: str) -> bool:
    return bool(_HANDLE.match(h)) and h not in (".", "..")


def _core_files(d: Path) -> list[Path]:
    files = [p for p in d.iterdir() if p.is_file() and p.name not in _SKIP_TOP and p.name != "INSIGHTS.md"]
    vd = d / "videos"
    if vd.is_dir():
        files += sorted(vd.glob("*.info.json"))
    return files


def _part_files(d: Path, part: str) -> list[Path]:
    if part == "videos":
        return sorted((d / "videos").glob("*.mp4")) if (d / "videos").is_dir() else []
    if part == "transcripts":
        return sorted((d / "transcripts").glob("*.json")) if (d / "transcripts").is_dir() else []
    if part == "insights":
        return [d / "INSIGHTS.md"] if (d / "INSIGHTS.md").exists() else []
    return []


def estimate(handles: list[str]) -> dict:
    """Sizes of each part per clinic, so the export sheet can show what each choice costs."""
    out = {}
    for h in handles:
        d = DATA_ROOT / h
        if not _valid_handle(h) or not d.is_dir():
            continue
        size = lambda fs: sum(f.stat().st_size for f in fs)
        chat_n = db.one("SELECT COUNT(*) n FROM chat WHERE clinic=?", (h,))["n"]
        out[h] = {
            "core": size(_core_files(d)),
            "videos": size(_part_files(d, "videos")), "videos_n": len(_part_files(d, "videos")),
            "transcripts": size(_part_files(d, "transcripts")), "transcripts_n": len(_part_files(d, "transcripts")),
            "insights": size(_part_files(d, "insights")),
            "chat": chat_n * 600, "chat_n": chat_n,
        }
    return out


def _busy():
    return job.get("status") == "running"


def _start(kind: str, fn, *args):
    with _lock:
        if _busy():
            raise RuntimeError("another export or import is still running")
        job.clear()
        job.update({"status": "running", "kind": kind, "done": 0, "total": None, "note": "starting…", "started": time.time()})

    def work():
        try:
            res = fn(*args)
            job.update({"status": "done", "result": res, "note": "finished"})
        except Exception as e:
            job.update({"status": "error", "error": str(e).splitlines()[0][:400] if str(e) else type(e).__name__})
    threading.Thread(target=work, daemon=True).start()
    return dict(job)


# ---------- export ----------
CLIENT_PARTS = ("client_files", "ref_videos")


def start_export(handles: list[str], include: dict, clients: list[int] | None = None, ref_mode: str = "reels") -> dict:
    handles = [h for h in dict.fromkeys(handles) if _valid_handle(h) and (DATA_ROOT / h).is_dir()]
    clients = [int(c) for c in dict.fromkeys(clients or [])]
    if not handles and not clients:
        raise ValueError("choose at least one account or client")
    if ref_mode not in ("reels", "none"):
        raise ValueError("ref_mode must be reels or none")
    inc = {p: bool(include.get(p)) for p in (*PARTS, *CLIENT_PARTS)}
    return _start("export", _export, handles, inc, clients, ref_mode)


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")[:40] or "client"


def _export(handles: list[str], inc: dict, clients: list[int] | None = None, ref_mode: str = "reels") -> dict:
    import client_transfer
    clients = clients or []
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M")
    if not handles and len(clients) == 1:
        cname = (db.one("SELECT name FROM clients WHERE id=?", (clients[0],)) or {}).get("name") or "client"
        name = f"Reely-{_slug(cname)}-{stamp}.reely"
    else:
        what = [f"{len(handles)}-accounts" if len(handles) != 1 else (handles[0] if handles else "")]
        if clients:
            what.append(f"{len(clients)}-client{'s' if len(clients) > 1 else ''}")
        name = f"Reely-{'-'.join(w for w in what if w)}-{stamp}.reely"
    out_dir = Path.home() / "Downloads"; out_dir.mkdir(exist_ok=True)
    out = out_dir / name
    tmp = out.with_suffix(".partial")
    plan: list[tuple[Path, str]] = []
    manifest = {"format": FORMAT, "app": "Reely", "created": datetime.now().isoformat(timespec="seconds"), "clinics": []}
    for h in handles:
        d = DATA_ROOT / h
        files = _core_files(d)
        for part in ("videos", "transcripts", "insights"):
            if inc[part]:
                files += _part_files(d, part)
        for f in files:
            plan.append((f, f"clinics/{h}/{f.relative_to(d).as_posix()}"))
        c = db.one("SELECT * FROM clinics WHERE handle=?", (h,)) or {}
        meta = importer.read_meta(d)
        manifest["clinics"].append({
            "handle": h, "display_name": c.get("display_name"), "speciality": c.get("speciality") or meta.get("speciality"),
            "top_n": meta.get("top_n"), "reels_total": c.get("reels_total"), "analysed": c.get("analysed"),
            "included": dict(inc),
            "counts": {"videos": len(_part_files(d, "videos")) if inc["videos"] else 0,
                       "transcripts": len(_part_files(d, "transcripts")) if inc["transcripts"] else 0,
                       "chat": db.one("SELECT COUNT(*) n FROM chat WHERE clinic=?", (h,))["n"] if inc["chat"] else 0},
        })
    job.update({"total": len(plan) + len(clients), "note": f"packing {len(plan)} files"})
    try:
        with zipfile.ZipFile(tmp, "w", allowZip64=True) as z:
            if clients:
                manifest.update(client_transfer.pack(z, clients, handles, inc, ref_mode, progress=lambda n: job.update({"note": n})))
            z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1), compress_type=zipfile.ZIP_DEFLATED)
            for h in handles:
                if inc["chat"]:
                    rows = db.rows("SELECT role, text, at FROM chat WHERE clinic=? ORDER BY id", (h,))
                    z.writestr(f"clinics/{h}/chat.json", json.dumps(rows, ensure_ascii=False), compress_type=zipfile.ZIP_DEFLATED)
            for i, (f, arc) in enumerate(plan, 1):
                # videos are already compressed; storing them keeps export fast
                z.write(f, arc, compress_type=zipfile.ZIP_STORED if f.suffix == ".mp4" else zipfile.ZIP_DEFLATED)
                if i % 10 == 0 or i == len(plan):
                    job.update({"done": i, "note": f"{i} of {len(plan)} files"})
        tmp.rename(out)
    finally:
        if tmp.exists():
            tmp.unlink()
    import subprocess
    subprocess.Popen(["open", "-R", str(out)])
    return {"path": str(out), "bytes": out.stat().st_size, "clinics": handles, "clients": [c["name"] for c in manifest.get("clients", [])]}


# ---------- import ----------
def _open(path: str) -> tuple[zipfile.ZipFile, dict]:
    p = Path(path).expanduser()
    if not p.is_file():
        raise FileNotFoundError("file not found")
    try:
        z = zipfile.ZipFile(p)
        manifest = json.loads(z.read("manifest.json"))
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError):
        raise ValueError("this is not a Reely export file")
    if manifest.get("app") != "Reely" or int(manifest.get("format", 0)) > FORMAT:
        raise ValueError("this export was made by a newer or different app")
    return z, manifest


def inspect(path: str) -> dict:
    z, m = _open(path)
    with z:
        names = z.namelist()
        size = sum(i.file_size for i in z.infolist())
    clinics = []
    for c in m.get("clinics", []):
        h = c.get("handle", "")
        if not _valid_handle(h):
            continue
        local = DATA_ROOT / h
        lc = db.one("SELECT reels_total, analysed FROM clinics WHERE handle=?", (h,))
        clinics.append({**c, "exists": local.is_dir() or bool(lc), "local": lc,
                        "files": sum(1 for n in names if n.startswith(f"clinics/{h}/"))})
    import client_transfer
    with zipfile.ZipFile(Path(path).expanduser()) as z2:
        cl = client_transfer.inspect(z2, m)
    return {"created": m.get("created"), "clinics": clinics, "clients": cl, "ref_reels": m.get("ref_reels", 0),
            "bytes": size, "path": str(Path(path).expanduser())}


def start_import(path: str, handles: list[str] | None, mode: str, clients: list[str] | None = None) -> dict:
    if mode not in ("merge", "replace"):
        raise ValueError("mode must be merge or replace")
    _open(path)[0].close()   # validate before starting
    return _start("import", _import, path, handles, mode, clients)


def _safe_rel(name: str, h: str) -> str | None:
    """Relative path inside the clinic folder for an archive member, or None if it is not allowed."""
    pre = f"clinics/{h}/"
    if not name.startswith(pre) or name.endswith("/"):
        return None
    rel = name[len(pre):]
    parts = rel.split("/")
    if any(p in ("", ".", "..") for p in parts) or "\\" in rel or rel.startswith("/"):
        return None
    if len(parts) == 1 or (len(parts) == 2 and parts[0] in ("videos", "transcripts")):
        return rel
    return None


def _import(path: str, handles: list[str] | None, mode: str, clients: list[str] | None = None) -> dict:
    z, m = _open(path)
    report = []
    with z:
        clinics = [c for c in m.get("clinics", []) if _valid_handle(c.get("handle", "")) and (handles is None or c["handle"] in handles)]
        members = {c["handle"]: [n for n in z.namelist() if n.startswith(f"clinics/{c['handle']}/")] for c in clinics}
        total = sum(len(v) for v in members.values())
        job.update({"total": total, "done": 0})
        done = 0
        for c in clinics:
            h = c["handle"]; d = DATA_ROOT / h
            from jobs import active_for
            if active_for(h):
                report.append({"handle": h, "skipped": "a run is active for this clinic"}); continue
            if mode == "replace":
                with db.tx() as cx:
                    for t, col in (("reels", "clinic"), ("runs", "clinic"), ("chat", "clinic")):
                        cx.execute(f"DELETE FROM {t} WHERE {col}=?", (h,))
                if d.is_dir():
                    shutil.rmtree(d)
            d.mkdir(parents=True, exist_ok=True)
            added = kept = 0
            chat_rows = None
            for name in members[h]:
                done += 1
                if done % 10 == 0:
                    job.update({"done": done, "note": f"{h}: {done} of {total} files"})
                rel = _safe_rel(name, h)
                if rel is None:
                    continue
                if rel == "chat.json":
                    chat_rows = json.loads(z.read(name)); continue
                target = d / rel
                if rel == "annotations.json" and target.exists():
                    # merge: entries already here win, the archive fills the rest
                    mine = json.loads(target.read_text() or "{}"); theirs = json.loads(z.read(name) or b"{}")
                    target.write_text(json.dumps({**theirs, **mine}, ensure_ascii=False, indent=1)); added += 1; continue
                if rel == "clinic.json":
                    continue   # rebuilt below from the manifest
                if target.exists():
                    kept += 1; continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(name) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
                added += 1
            # chat thread: only into an empty thread; Claude sessions do not travel, so the next question starts fresh
            if chat_rows and not db.one("SELECT 1 FROM chat WHERE clinic=? LIMIT 1", (h,)):
                with db.tx() as cx:
                    for r in chat_rows:
                        cx.execute("INSERT INTO chat(clinic, role, text, at) VALUES(?,?,?,?)", (h, r.get("role"), r.get("text"), r.get("at")))
            meta = importer.read_meta(d)
            inc = c.get("included") or {}
            importer.write_meta(d, speciality=meta.get("speciality") or c.get("speciality"),
                                top_n=max(int(meta.get("top_n") or 0), int(c.get("top_n") or 0)) or None,
                                imported={"from": Path(path).name, "at": datetime.now().isoformat(timespec="seconds"),
                                          **{p: bool(inc.get(p)) for p in PARTS}})
            if (d / "reels_index.csv").exists():
                importer.import_clinic(d)
            else:
                db.upsert("clinics", {"handle": h, "status": "not_run"}, "handle")
            if c.get("speciality") and not db.one("SELECT speciality FROM clinics WHERE handle=?", (h,)).get("speciality"):
                with db.tx() as cx:
                    cx.execute("UPDATE clinics SET speciality=? WHERE handle=?", (c["speciality"], h))
            report.append({"handle": h, "added": added, "kept": kept})
        job.update({"done": total})
        client_report = []
        if m.get("clients") and (clients is None or clients):
            import client_transfer
            client_report = client_transfer.import_clients(z, m, clients, mode, progress=lambda n: job.update({"note": n}))
    return {"clinics": report, "clients": client_report}
