"""Reel Research API + static frontend."""
import json
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import claude_cli
import db
import jobs
import models_mgr
from config import DATA_ROOT, ENGINES, FRONTEND_DIST, LANG_NAMES, MODEL_NOTES, SPECIALITIES, engine_for_model, model_for_engine, model_info
from pipeline import importer, scrape

app = FastAPI(title="Reely")

# The Tauri shell loads the UI from its own origin and calls this API on localhost.
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from config import VIEW_ONLY, VIEW_ONLY_MSG  # noqa: E402

# Work that needs the scraping browser, yt-dlp or a speech model; refused by the view-only (Intel) build.
_WORK = re.compile(r"^/api/(clinics(/[^/]+/(run|more|retry|refresh|translate))?|queue|reels/[^/]+/translate"
                   r"|models/[^/]+/download|browser/(login|install))$")


@app.middleware("http")
async def _view_only_guard(request, call_next):
    if VIEW_ONLY and request.method == "POST" and _WORK.match(request.url.path):
        return JSONResponse({"detail": VIEW_ONLY_MSG}, status_code=409)
    return await call_next(request)
app.add_middleware(CORSMiddleware,
                   allow_origins=["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:5173"],
                   allow_methods=["*"], allow_headers=["*"])


def _handle(s: str) -> str:
    s = s.strip()
    m = re.search(r"instagram\.com/([A-Za-z0-9_.]+)", s)
    h = (m.group(1) if m else s).lstrip("@").strip("/")
    if not re.fullmatch(r"[A-Za-z0-9_.]{1,40}", h):
        raise HTTPException(400, "That doesn't look like an Instagram handle.")
    return h


@app.on_event("startup")
def _first_run_import():
    """A fresh database (first launch of the bundled app) picks up any clinic folders already on disk."""
    # clinics processed before depth was remembered: record what the index currently holds for them
    try:
        for r in db.rows("SELECT clinic, COUNT(*) n FROM reels GROUP BY clinic"):
            d = DATA_ROOT / r["clinic"]
            if d.is_dir() and r["n"] and not importer.read_meta(d).get("top_n"):
                importer.write_meta(d, top_n=r["n"])
    except Exception as e:
        print("depth backfill skipped:", e)
    # runs left 'running'/'paused' by a previous process have no thread any more
    with db.tx() as c:
        c.execute("UPDATE runs SET status='stopped', finished=datetime('now'), stage=NULL WHERE status IN ('running','paused','queued')")
        c.execute("UPDATE clinics SET status='stopped' WHERE status IN ('running','queued')")
    try:
        if not db.rows("SELECT 1 FROM clinics LIMIT 1"):
            for d in sorted(DATA_ROOT.iterdir()):
                if d.is_dir() and (d / "reels_index.csv").exists():
                    importer.import_clinic(d)
    except Exception as e:
        print("startup import skipped:", e)


# ---------- overview / clinics ----------
@app.get("/api/overview")
def overview():
    clinics = db.rows("SELECT * FROM clinics ORDER BY COALESCE(last_run, created_at) DESC")
    for c in clinics:
        vd = DATA_ROOT / c["handle"] / "videos"
        c["downloaded"] = sum(1 for _ in vd.glob("*.mp4")) if vd.is_dir() else 0
        c["remaining"] = max(0, (c["reels_total"] or 0) - c["downloaded"])
        c["imported"] = importer.read_meta(DATA_ROOT / c["handle"]).get("imported")
        from pipeline import failures as _fl
        c["failed"] = sum(1 for v in _fl.load(DATA_ROOT / c["handle"]).values() if not v.get("ignored"))
        c["missing_videos"] = db.one("SELECT COUNT(*) n FROM reels WHERE clinic=? AND (video_file IS NULL OR video_file='')", (c["handle"],))["n"]
        c["video_job"] = _vid_jobs.get(c["handle"])
        q = db.one("SELECT id, stage, stages FROM runs WHERE clinic=? AND status IN ('queued','running','paused') ORDER BY id DESC LIMIT 1", (c["handle"],))
        c["waiting"] = None
        if q:
            st = json.loads(q["stages"] or "{}")
            w = next((v.get("note") for v in st.values() if v.get("status") == "waiting"), None)
            c["waiting"] = w; c["run_id"] = q["id"]
    videos = sum((f.stat().st_size for f in DATA_ROOT.glob("*/videos/*.mp4")), 0)
    free = shutil.disk_usage(DATA_ROOT).free
    recent = db.rows("SELECT id, clinic, started, finished, status, stage FROM runs ORDER BY id DESC LIMIT 8")
    return {"clinics": clinics, "totals": {"clinics": len(clinics), "reels": sum(c["reels_total"] or 0 for c in clinics),
            "analysed": sum(c["analysed"] or 0 for c in clinics), "video_bytes": videos, "free_bytes": free},
            "recent_runs": recent, "settings": db.get_settings(), "data_root": str(DATA_ROOT), "specialities": all_specialities(), "langs": LANG_NAMES}


def all_specialities() -> list[str]:
    """Built-in list plus anything typed in by the user, in that order."""
    custom = [r["speciality"] for r in db.rows("SELECT DISTINCT speciality FROM clinics WHERE speciality IS NOT NULL AND speciality!='' ORDER BY speciality")]
    return SPECIALITIES + [c for c in custom if c not in SPECIALITIES]


class AddClinic(BaseModel):
    handle: str
    run: bool = True
    settings: dict = {}
    speciality: str | None = None


@app.post("/api/clinics")
def add_clinic(body: AddClinic):
    h = _handle(body.handle)
    data = {"handle": h, "status": "not_run"}
    if body.speciality and body.speciality.strip():
        data["speciality"] = " ".join(body.speciality.split())[:60]
        importer.write_meta(DATA_ROOT / h, speciality=body.speciality)
    db.upsert("clinics", data, "handle")
    run_id = jobs.start(h, body.settings) if body.run else None
    return {"handle": h, "run_id": run_id}


class ClinicEdit(BaseModel):
    speciality: str | None = None
    display_name: str | None = None


@app.patch("/api/clinics/{handle}")
def edit_clinic(handle: str, body: ClinicEdit):
    if not db.one("SELECT 1 FROM clinics WHERE handle=?", (handle,)):
        raise HTTPException(404)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if "speciality" in data:
        data["speciality"] = " ".join(data["speciality"].split())[:60] or None
    if data:
        sets = ", ".join(f"{k}=?" for k in data)
        with db.tx() as c:
            c.execute(f"UPDATE clinics SET {sets} WHERE handle=?", [*data.values(), handle])
        if "speciality" in data:
            importer.write_meta(DATA_ROOT / handle, speciality=data["speciality"])
    return db.one("SELECT * FROM clinics WHERE handle=?", (handle,))


def _scope(handle: str, speciality: str | None = None, col: str = "clinic"):
    """WHERE fragment + params selecting one clinic, or every clinic (optionally one speciality)."""
    if handle != ALL:
        return f"{col}=?", [handle]
    if speciality:
        return f"{col} IN (SELECT handle FROM clinics WHERE speciality=?)", [speciality]
    return "1=1", []


@app.delete("/api/clinics/{handle}")
def delete_clinic(handle: str, files: bool = False):
    if jobs.active_for(handle):
        raise HTTPException(409, "stop the running job first")
    with db.tx() as c:
        c.execute("DELETE FROM reels WHERE clinic=?", (handle,))
        c.execute("DELETE FROM runs WHERE clinic=?", (handle,))
        c.execute("DELETE FROM chat WHERE clinic=?", (handle,))
        c.execute("DELETE FROM clinics WHERE handle=?", (handle,))
    if files and handle and (DATA_ROOT / handle).is_dir():
        shutil.rmtree(DATA_ROOT / handle)
    return {"ok": True, "files_deleted": bool(files)}


@app.post("/api/clinics/{handle}/import")
def reimport(handle: str):
    d = DATA_ROOT / handle
    if not d.exists():
        raise HTTPException(404, "no folder for that handle")
    return importer.import_clinic(d)


@app.post("/api/import-all")
def import_all():
    out = []
    for d in sorted(DATA_ROOT.iterdir()):
        if d.is_dir() and (d / "reels_index.csv").exists():
            out.append(importer.import_clinic(d))
    return out


# ---------- runs ----------
class StartRun(BaseModel):
    settings: dict = {}


@app.post("/api/clinics/{handle}/run")
def start_run(handle: str, body: StartRun):
    if jobs.active_for(handle):
        raise HTTPException(409, "a run is already active for this clinic")
    return {"run_id": jobs.start(handle, body.settings)}


class More(BaseModel):
    count: int | None = None      # how many more reels (next by views); None = every remaining one


@app.post("/api/clinics/{handle}/more")
def run_more(handle: str, body: More):
    """Go deeper into a clinic that is already scraped: keep the index, keep what is on disk, and process the next
    reels by views. Downloads, transcripts and annotations that exist are skipped by their stages."""
    from pipeline import index as index_mod
    from pipeline.views_fmt import video_path
    if jobs.active_for(handle):
        raise HTTPException(409, "a run is already active for this clinic")
    d = DATA_ROOT / handle
    rows = index_mod.load_index(d)
    if not rows:
        raise HTTPException(409, "this clinic has not been scraped yet; use Run first")
    if body.count is None:
        depth = len(rows)
    else:
        if body.count < 1: raise HTTPException(400, "count must be at least 1")
        depth, missing = 0, 0
        for i, r in enumerate(rows, 1):
            if not video_path(d, r["shortcode"]):
                missing += 1
            depth = i
            if missing >= body.count:
                break
    return {"run_id": jobs.start(handle, {"reuse_index": "1", "top_n": str(depth)}), "top_n": depth}


# ---------- queue ----------
class QueueBody(BaseModel):
    handles: list[str]
    speciality: str | None = None
    settings: dict = {}


@app.post("/api/queue")
def queue_add(body: QueueBody):
    """Add several clinics at once; each gets a run that waits for its lane (Instagram, speech engine, Claude)."""
    out = []
    for raw in body.handles:
        raw = raw.strip()
        if not raw:
            continue
        try:
            h = _handle(raw)
        except HTTPException:
            out.append({"input": raw, "error": "not an Instagram handle"}); continue
        if jobs.active_for(h):
            out.append({"handle": h, "error": "already queued or running"}); continue
        data = {"handle": h}
        if not db.one("SELECT 1 FROM clinics WHERE handle=?", (h,)):
            data["status"] = "not_run"
        if body.speciality:
            data["speciality"] = " ".join(body.speciality.split())[:60]
            importer.write_meta(DATA_ROOT / h, speciality=data["speciality"])
        db.upsert("clinics", data, "handle")
        out.append({"handle": h, "run_id": jobs.start(h, body.settings)})
    return {"added": out}


@app.get("/api/queue")
def queue_view():
    st = jobs.queue_state()
    runs = db.rows("SELECT id, clinic, status, stage, stages, started FROM runs WHERE status IN ('queued','running','paused') ORDER BY id")
    order = {rid: i for i, rid in enumerate(st["order"])}
    items = []
    for r in sorted(runs, key=lambda r: order.get(r["id"], 10 ** 6 + r["id"])):
        stg = json.loads(r["stages"] or "{}")
        cur = next((k for k in jobs.STAGES if stg.get(k, {}).get("status") in ("running", "waiting")), None)
        s = stg.get(cur, {}) if cur else {}
        items.append({"run_id": r["id"], "clinic": r["clinic"], "status": r["status"], "stage": cur,
                      "lane": jobs.LANE_OF.get(cur), "waiting": s.get("note") if s.get("status") == "waiting" else None,
                      "done": s.get("done"), "total": s.get("total"), "note": s.get("note")})
    lanes = {n: {"holder": next((i["clinic"] for i in items if i["run_id"] == v["holder"]), None), "waiting": len(v["waiting"])}
             for n, v in st["lanes"].items()}
    return {"items": items, "lanes": lanes}


class MoveBody(BaseModel):
    direction: int


@app.post("/api/runs/{run_id}/move")
def run_move(run_id: int, body: MoveBody):
    return {"ok": jobs.move(run_id, -1 if body.direction < 0 else 1)}


# ---------- failures ----------
@app.get("/api/clinics/{handle}/failures")
def clinic_failures(handle: str):
    from pipeline import failures as fl
    d = DATA_ROOT / handle
    idx = {r["shortcode"]: r for r in __import__("pipeline.index", fromlist=["load_index"]).load_index(d)}
    out = []
    for code, v in fl.load(d).items():
        r = idx.get(code, {})
        out.append({"shortcode": code, **v, "reason": fl.explain(v.get("error", "")), "views": r.get("views"),
                    "url": r.get("url") or f"https://www.instagram.com/reel/{code}/"})
    out.sort(key=lambda x: (x.get("ignored", False), -(x.get("views") or 0)))
    return out


@app.post("/api/clinics/{handle}/retry")
def clinic_retry(handle: str):
    """Retry failed downloads and transcriptions: a run that reuses the scrape; every stage skips what is done."""
    if jobs.active_for(handle):
        raise HTTPException(409, "a run is already active for this clinic")
    from pipeline import failures as fl
    d = DATA_ROOT / handle
    if not (d / "reels_index.csv").exists():
        raise HTTPException(409, "this clinic has not been scraped yet")
    return {"run_id": jobs.start(handle, {"reuse_index": "1"})}


class CodesBody(BaseModel):
    codes: list[str]
    value: bool = True


@app.post("/api/clinics/{handle}/failures/ignore")
def clinic_failures_ignore(handle: str, body: CodesBody):
    from pipeline import failures as fl
    fl.ignore(DATA_ROOT / handle, body.codes, body.value)
    return {"ok": True}


# ---------- refresh stats ----------
@app.post("/api/clinics/{handle}/refresh")
def clinic_refresh(handle: str):
    if jobs.active_for(handle):
        raise HTTPException(409, "a run is already active for this clinic")
    if not (DATA_ROOT / handle / "reels_index.csv").exists():
        raise HTTPException(409, "this clinic has not been scraped yet")
    return {"run_id": jobs.start(handle, {"mode": "refresh"})}


@app.get("/api/reels/{shortcode}/history")
def reel_history(shortcode: str):
    r = db.one("SELECT clinic FROM reels WHERE shortcode=?", (shortcode,))
    if not r: raise HTTPException(404)
    p = DATA_ROOT / r["clinic"] / "stats_history.json"
    return (json.loads(p.read_text()).get(shortcode, []) if p.exists() else [])


# ---------- storage ----------
@app.get("/api/storage")
def storage_view():
    import storage
    return {"clinics": [storage.usage(c["handle"]) for c in db.rows("SELECT handle FROM clinics ORDER BY handle") if (DATA_ROOT / c["handle"]).is_dir()],
            "auto_clear_videos": db.get_settings().get("auto_clear_videos", "0") == "1"}


class ClearBody(BaseModel):
    what: str   # processed | videos | temp


@app.post("/api/clinics/{handle}/clear")
def clinic_clear(handle: str, body: ClearBody):
    import storage
    if jobs.active_for(handle):
        raise HTTPException(409, "wait for the run on this clinic to finish")
    if body.what == "temp":
        return storage.clear_temp(handle)
    if body.what in ("processed", "videos"):
        return storage.clear_videos(handle, only_processed=body.what == "processed")
    raise HTTPException(400, "what must be processed, videos or temp")


# ---------- hook library ----------
class LibItems(BaseModel):
    items: list[dict] = []
    codes: list[str] = []


@app.get("/api/library")
def library_list():
    import library
    lib = library.load()
    if not lib:
        return []
    marks = ",".join("?" * len(lib))
    rows = {r["shortcode"]: r for r in db.rows(
        f"SELECT r.*, c.speciality FROM reels r LEFT JOIN clinics c ON c.handle=r.clinic WHERE r.shortcode IN ({marks})", list(lib))}
    out = []
    for code, v in lib.items():
        r = rows.get(code) or {"shortcode": code, "clinic": v.get("clinic"), "missing": True}
        out.append({**r, "added": v.get("added"), "lib_note": v.get("note", "")})
    out.sort(key=lambda x: x.get("added") or "", reverse=True)
    return out


@app.post("/api/library")
def library_add(body: LibItems):
    import library
    items = body.items or [{"shortcode": c} for c in body.codes]
    for it in items:
        if not it.get("clinic"):
            r = db.one("SELECT clinic FROM reels WHERE shortcode=?", (it["shortcode"],))
            it["clinic"] = r["clinic"] if r else None
    return {"added": library.add(items)}


@app.post("/api/library/remove")
def library_remove(body: LibItems):
    import library
    return {"removed": library.remove(body.codes)}


class LibNote(BaseModel):
    note: str


@app.put("/api/library/{shortcode}")
def library_note(shortcode: str, body: LibNote):
    import library
    library.note(shortcode, body.note)
    return {"ok": True}


@app.get("/api/hooks")
def hooks(speciality: str | None = None, hook_type: str | None = None, format: str | None = None, clinic: str | None = None,
          min_like_rate: float | None = None, q: str | None = None, limit: int = 300):
    """Best hooks across clinics by like-rate."""
    import library
    where, params = ["r.hook_en IS NOT NULL", "r.hook_en!=''", "r.like_rate IS NOT NULL"], []
    if speciality: where.append("c.speciality=?"); params.append(speciality)
    if hook_type: where.append("r.hook_type=?"); params.append(hook_type)
    if format: where.append("r.format=?"); params.append(format)
    if clinic: where.append("r.clinic=?"); params.append(clinic)
    if min_like_rate is not None: where.append("r.like_rate>=?"); params.append(min_like_rate)
    if q: where.append("(r.hook_en LIKE ? OR r.hook_original LIKE ? OR r.summary LIKE ?)"); params += [f"%{q}%"] * 3
    sql = f"SELECT r.*, c.speciality FROM reels r LEFT JOIN clinics c ON c.handle=r.clinic WHERE {' AND '.join(where)} ORDER BY r.like_rate DESC LIMIT ?"
    rows = db.rows(sql, params + [limit])
    saved = library.load()
    for r in rows:
        r["saved"] = r["shortcode"] in saved
    fw = "c.speciality=?" if speciality else "1=1"; fp = [speciality] if speciality else []
    facets = {k: [x[k] for x in db.rows(f"SELECT DISTINCT r.{k} FROM reels r LEFT JOIN clinics c ON c.handle=r.clinic WHERE {fw} AND r.{k} IS NOT NULL AND r.{k}!='' ORDER BY r.{k}", fp)]
              for k in ("hook_type", "format")}
    return {"hooks": rows, "facets": facets}


def _library_export(fmt_: str):
    rows = library_list()
    if fmt_ == "md":
        lines = ["# Hook library", ""]
        for r in rows:
            lr = f"{r['like_rate']:.2f}%" if r.get("like_rate") is not None else "—"
            lines += [f"## {r.get('hook_en') or r.get('hook_original') or r['shortcode']}",
                      f"@{r.get('clinic')} · {r.get('speciality') or ''} · like-rate {lr} · {r.get('views') or 0:,} views · {r.get('format') or ''} · {r.get('hook_type') or ''}",
                      f"{r.get('url') or ''}", ""]
            if r.get("hook_original") and r.get("hook_original") != r.get("hook_en"): lines += [f"> Spoken: {r['hook_original']}", ""]
            if r.get("summary"): lines += [r["summary"], ""]
            if r.get("lib_note"): lines += [f"**My note:** {r['lib_note']}", ""]
        return "\n".join(lines), "hook_library.md"
    import csv, io
    cols = ["clinic", "speciality", "hook_en", "hook_original", "hook_type", "format", "like_rate", "views", "likes", "cta", "summary", "lib_note", "url", "added"]
    buf = io.StringIO(); w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
    return buf.getvalue(), "hook_library.csv"


@app.get("/api/library/export")
def library_export(fmt: str = "csv"):
    from fastapi.responses import Response
    text, name = _library_export(fmt)
    return Response(text, media_type="text/markdown" if fmt == "md" else "text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.post("/api/library/export")
def library_export_save(fmt: str = "csv"):
    text, name = _library_export(fmt)
    out = Path.home() / "Downloads"; out.mkdir(exist_ok=True)
    p = out / name; i = 2
    while p.exists():
        p = out / f"{name.rsplit('.', 1)[0]}_{i}.{name.rsplit('.', 1)[1]}"; i += 1
    p.write_text(text)
    subprocess.Popen(["open", "-R", str(p)])
    return {"path": str(p)}


# ---------- speciality reports ----------
class ReportBody(BaseModel):
    speciality: str | None = None


@app.get("/api/reports")
def report_get(speciality: str | None = None):
    import reports
    return reports.get(speciality or None)


@app.post("/api/reports")
def report_generate(body: ReportBody):
    import reports
    try:
        return reports.generate(body.speciality or None)
    except ValueError as e:
        raise HTTPException(409, str(e))


# ---------- export / import between Macs ----------
class ExportBody(BaseModel):
    handles: list[str]
    include: dict = {}


class ImportBody(BaseModel):
    path: str
    handles: list[str] | None = None
    mode: str = "merge"


@app.get("/api/transfer/estimate")
def transfer_estimate(handles: str = ""):
    import transfer
    return transfer.estimate([h for h in handles.split(",") if h])


@app.post("/api/transfer/export")
def transfer_export(body: ExportBody):
    import transfer
    try:
        return transfer.start_export(body.handles, body.include)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(409, str(e))


@app.post("/api/transfer/inspect")
def transfer_inspect(body: ImportBody):
    import transfer
    try:
        return transfer.inspect(body.path)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/transfer/import")
def transfer_import(body: ImportBody):
    import transfer
    try:
        return transfer.start_import(body.path, body.handles, body.mode)
    except (ValueError, RuntimeError, FileNotFoundError) as e:
        raise HTTPException(409, str(e))


@app.get("/api/transfer/job")
def transfer_job():
    import transfer
    return transfer.job


@app.get("/api/runs")
def list_runs(limit: int = 20):
    rs = db.rows("SELECT id, clinic, started, finished, status, stage, stages, error FROM runs ORDER BY id DESC LIMIT ?", (limit,))
    for r in rs: r["stages"] = json.loads(r["stages"] or "{}")
    return rs


@app.get("/api/runs/{run_id}")
def get_run(run_id: int):
    r = db.one("SELECT * FROM runs WHERE id=?", (run_id,))
    if not r: raise HTTPException(404)
    r["stages"] = json.loads(r["stages"] or "{}"); r["settings"] = json.loads(r["settings"] or "{}")
    r["log"] = (r["log"] or "")[-6000:]
    return r


@app.post("/api/runs/{run_id}/{action}")
def run_action(run_id: int, action: str):
    if action not in ("pause", "resume", "stop", "skip"): raise HTTPException(400)
    return {"ok": jobs.control(run_id, action)}


# ---------- reels ----------
ALL = "_all"   # pseudo-handle: every clinic


@app.get("/api/clinics/{handle}/reels")
def reels(handle: str, sort: str = "like_rate", min_like_rate: float | None = None, format: str | None = None,
          hook_type: str | None = None, language: str | None = None, flag: str | None = None, q: str | None = None,
          speciality: str | None = None, limit: int = 2000):
    sw, sp = _scope(handle, speciality)
    where, params = [sw], list(sp)
    if min_like_rate is not None: where.append("like_rate >= ?"); params.append(min_like_rate)
    if format: where.append("format=?"); params.append(format)
    if hook_type: where.append("hook_type=?"); params.append(hook_type)
    if language: where.append("language=?"); params.append(language)
    if flag: where.append("flag LIKE ?"); params.append(flag + "%")
    if q: where.append("(hook_en LIKE ? OR transcript LIKE ? OR transcript_en LIKE ? OR caption LIKE ?)"); params += [f"%{q}%"] * 4
    order = {"like_rate": "like_rate DESC NULLS LAST", "views": "views DESC", "date": "date DESC", "duration": "duration DESC", "rank": "rank ASC"}.get(sort, "like_rate DESC")
    params.append(limit)
    rs = db.rows(f"SELECT r.*, c.speciality FROM reels r LEFT JOIN clinics c ON c.handle=r.clinic WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ?", params)
    scope = sw
    facets = {k: [r[k] for r in db.rows(f"SELECT DISTINCT {k} FROM reels WHERE {scope} AND {k} IS NOT NULL AND {k}!='' ORDER BY {k}", sp)]
              for k in ("format", "hook_type", "language")}
    facets["flag"] = sorted({(r["flag"] or "").split(";")[0] for r in db.rows(f"SELECT flag FROM reels WHERE {scope}", sp) if r["flag"]})
    return {"reels": rs, "facets": facets, "total": db.one(f"SELECT COUNT(*) n FROM reels WHERE {scope}", sp)["n"]}


class ReelEdit(BaseModel):
    hook_en: str | None = None
    hook_type: str | None = None
    format: str | None = None
    cta: str | None = None
    flag: str | None = None
    summary: str | None = None


@app.patch("/api/reels/{shortcode}")
def edit_reel(shortcode: str, body: ReelEdit):
    r = db.one("SELECT * FROM reels WHERE shortcode=?", (shortcode,))
    if not r: raise HTTPException(404)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if data:
        sets = ", ".join(f"{k}=?" for k in data)
        with db.tx() as c:
            c.execute(f"UPDATE reels SET {sets}, edited=1 WHERE shortcode=?", [*data.values(), shortcode])
        # write back to annotations.json so the sheet and future imports keep the edit
        p = DATA_ROOT / r["clinic"] / "annotations.json"
        ann = json.loads(p.read_text()) if p.exists() else {}
        cur = ann.get(shortcode, {})
        cur.update({("summary" if k == "summary" else k): v for k, v in data.items()})
        ann[shortcode] = cur
        p.write_text(json.dumps(ann, ensure_ascii=False, indent=1))
    return db.one("SELECT * FROM reels WHERE shortcode=?", (shortcode,))


@app.get("/api/reels/{shortcode}")
def reel_one(shortcode: str):
    r = db.one("SELECT r.*, c.speciality FROM reels r LEFT JOIN clinics c ON c.handle=r.clinic WHERE r.shortcode=?", (shortcode,))
    if not r: raise HTTPException(404)
    return r


_dl_jobs: dict = {}


@app.post("/api/reels/{shortcode}/download")
def reel_download(shortcode: str):
    """Fetch one reel's video, e.g. one left out of an import, without starting a run."""
    from pipeline import download, index as index_mod
    from pipeline.views_fmt import video_path
    r = db.one("SELECT clinic FROM reels WHERE shortcode=?", (shortcode,))
    if not r: raise HTTPException(404)
    if _dl_jobs.get(shortcode, {}).get("status") == "running":
        return _dl_jobs[shortcode]
    d = DATA_ROOT / r["clinic"]
    row = next((x for x in index_mod.load_index(d) if x["shortcode"] == shortcode), None)
    if not row: raise HTTPException(409, "reel is not in this clinic's index")
    state = _dl_jobs[shortcode] = {"status": "running", "error": None}

    def work():
        try:
            res = download.download_reels(d, [row], db.get_settings().get("video_quality", "low"), pause=(0, 0), force=True)
            vp = video_path(d, shortcode)
            if not vp:
                raise RuntimeError((res.get("failures") or [{}])[0].get("error") or "download failed")
            with db.tx() as c:
                c.execute("UPDATE reels SET video_file=? WHERE shortcode=?", (vp.name, shortcode))
            state["status"] = "done"
        except Exception as e:
            state.update({"status": "error", "error": str(e).splitlines()[0][:300]})
    threading.Thread(target=work, daemon=True).start()
    return state


# ---------- download videos only (no run): imported clinics, Intel view-only Macs ----------
_vid_jobs: dict = {}


class VideosBody(BaseModel):
    count: int | None = None    # how many of the missing videos (best like-rate first); None = all


@app.post("/api/clinics/{handle}/videos")
def clinic_videos(handle: str, body: VideosBody):
    """Fetch videos for analysed reels that have none on this Mac, without scraping, transcribing or annotating.
    Reels keep their imported transcripts and analysis; the video slots in beside them."""
    from pipeline import download, index as index_mod
    from pipeline.views_fmt import video_path
    if jobs.active_for(handle):
        raise HTTPException(409, "a run is active for this clinic")
    if _vid_jobs.get(handle, {}).get("status") == "running":
        return _vid_jobs[handle]
    d = DATA_ROOT / handle
    missing = db.rows("SELECT shortcode FROM reels WHERE clinic=? AND (video_file IS NULL OR video_file='') "
                      "ORDER BY like_rate DESC NULLS LAST", (handle,))
    idx = {r["shortcode"]: r for r in index_mod.load_index(d)}
    todo = [idx[m["shortcode"]] for m in missing if m["shortcode"] in idx]
    if body.count:
        todo = todo[: max(1, body.count)]
    if not todo:
        raise HTTPException(409, "every analysed reel already has its video")
    st = db.get_settings()
    state = _vid_jobs[handle] = {"status": "running", "done": 0, "total": len(todo), "note": "starting…", "ok": 0, "failed": 0, "stop": False}

    def prog(i, n, note="", extra=None):
        state.update({"done": i, "total": n, "note": note})

    def work():
        try:
            res = download.download_reels(d, todo, st.get("video_quality", "low"), progress=prog, force=True,
                                          should_stop=lambda: state.get("stop"), pace=st.get("download_pace", "fast"))
            with db.tx() as c:
                for r in todo:
                    vp = video_path(d, r["shortcode"])
                    if vp:
                        c.execute("UPDATE reels SET video_file=? WHERE shortcode=?", (vp.name, r["shortcode"]))
            state.update({"status": "stopped" if state.get("stop") else "done", "ok": res["ok"], "failed": res["failed"],
                          "note": f"{res['ok']} downloaded" + (f" · {res['failed']} failed" if res["failed"] else "")})
        except Exception as e:
            state.update({"status": "error", "note": str(e).splitlines()[0][:300] if str(e) else type(e).__name__})
    threading.Thread(target=work, daemon=True).start()
    return state


@app.get("/api/clinics/{handle}/videos")
def clinic_videos_status(handle: str):
    return _vid_jobs.get(handle) or {"status": "idle"}


@app.post("/api/clinics/{handle}/videos/stop")
def clinic_videos_stop(handle: str):
    j = _vid_jobs.get(handle)
    if j and j.get("status") == "running":
        j["stop"] = True
    return j or {"status": "idle"}


@app.get("/api/reels/{shortcode}/download")
def reel_download_status(shortcode: str):
    return _dl_jobs.get(shortcode) or {"status": "idle"}


@app.get("/api/reels/{shortcode}/transcript")
def reel_transcript(shortcode: str):
    """Segments and every translation stored for one reel, for the inspector."""
    from pipeline.views_fmt import transcript_path
    r = db.one("SELECT clinic, language FROM reels WHERE shortcode=?", (shortcode,))
    if not r: raise HTTPException(404)
    tp = transcript_path(DATA_ROOT / r["clinic"], shortcode)
    if not tp:
        imp = importer.read_meta(DATA_ROOT / r["clinic"]).get("imported") or {}
        return {"language": r["language"], "segments": [], "segments_en": [], "text": "", "translations": {},
                "missing": "not_imported" if imp and not imp.get("transcripts") else "none"}
    d = json.loads(tp.read_text())
    tr = dict(d.get("translations") or {})
    if d.get("text_en"): tr.setdefault("en", d["text_en"])
    if d.get("text_tr") and d.get("tr_lang"): tr.setdefault(d["tr_lang"], d["text_tr"])
    return {"language": d.get("language"), "segments": d.get("segments", []), "segments_en": d.get("segments_en", []),
            "text": d.get("text", ""), "translations": tr, "job": _reel_jobs.get(shortcode)}


_reel_jobs: dict = {}


class TranslateOne(BaseModel):
    to: str


@app.post("/api/reels/{shortcode}/translate")
def reel_translate(shortcode: str, body: TranslateOne):
    """Translate one reel into any language; English runs the speech engine's translate task, others go to Claude."""
    r = db.one("SELECT clinic FROM reels WHERE shortcode=?", (shortcode,))
    if not r: raise HTTPException(404)
    if _reel_jobs.get(shortcode, {}).get("status") == "running":
        return _reel_jobs[shortcode]
    to = " ".join(body.to.split())[:40]
    if not to: raise HTTPException(400, "language required")
    from pipeline import transcribe
    st = db.get_settings()
    state = _reel_jobs[shortcode] = {"status": "running", "to": to, "error": None}

    def work():
        try:
            transcribe.translate_one(DATA_ROOT / r["clinic"], shortcode, to, st.get("whisper_model", "medium"), st.get("whisper_engine"))
            if to == st.get("translate_to", "en"):
                importer.import_clinic(DATA_ROOT / r["clinic"])
            state["status"] = "done"
        except Exception as e:
            state.update({"status": "error", "error": str(e).splitlines()[0][:300]})
    threading.Thread(target=work, daemon=True).start()
    return state


@app.get("/api/video/{handle}/{file}")
def video(handle: str, file: str):
    p = DATA_ROOT / handle / "videos" / file
    if not p.exists() or p.suffix != ".mp4": raise HTTPException(404)
    return FileResponse(p, media_type="video/mp4")


@app.get("/api/clinics/{handle}/insights")
def get_insights(handle: str, speciality: str | None = None):
    """One clinic, or `_all` (optionally narrowed to a speciality) aggregated across clinics."""
    sw, sp = _scope(handle, speciality)
    rs = db.rows(f"SELECT * FROM reels WHERE {sw}", sp)
    from pipeline.assemble import stats
    st = stats([{**r, "like_rate_pct": r["like_rate"], "script_summary": r["summary"]} for r in rs])
    st["clinics"] = sorted({r["clinic"] for r in rs})
    md = None
    if handle != ALL:
        d = DATA_ROOT / handle
        md = (d / "INSIGHTS.md").read_text() if (d / "INSIGHTS.md").exists() else None
    return {"stats": st, "markdown": md}


EXPORT_COLS = ["clinic", "speciality", "rank", "file_name", "shortcode", "url", "views", "likes", "like_rate", "outlier", "date", "duration", "language",
               "hook_en", "hook_type", "format", "cta", "flag", "summary", "hook_original", "caption", "transcript", "transcript_en", "video_file"]


def _export(handle: str, cols: str | None, speciality: str | None):
    """CSV straight from the database so hand edits are included. `cols` = comma list to pick/order columns."""
    import csv, io
    sw, sp = _scope(handle, speciality, col="r.clinic")
    rs = db.rows(f"SELECT r.*, c.speciality FROM reels r LEFT JOIN clinics c ON c.handle=r.clinic WHERE {sw} ORDER BY r.clinic, r.rank", sp)
    columns = [c for c in (cols.split(",") if cols else EXPORT_COLS) if c in EXPORT_COLS] or EXPORT_COLS
    buf = io.StringIO(); w = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore"); w.writeheader(); w.writerows(rs)
    base = handle if handle != ALL else (re.sub(r"[^A-Za-z0-9]+", "_", speciality).strip("_").lower() + "_clinics" if speciality else "all_clinics")
    return buf.getvalue(), base + "_reels.csv", len(rs)


@app.get("/api/clinics/{handle}/export.csv")
def export_csv(handle: str, cols: str | None = None, speciality: str | None = None):
    from fastapi.responses import StreamingResponse
    text, name, _ = _export(handle, cols, speciality)
    return StreamingResponse(iter([text]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.post("/api/clinics/{handle}/export")
def export_save(handle: str, cols: str | None = None, speciality: str | None = None):
    """The desktop shell cannot download; save to ~/Downloads and reveal the file in Finder."""
    text, name, n = _export(handle, cols, speciality)
    out_dir = Path.home() / "Downloads"
    out_dir.mkdir(exist_ok=True)
    p = out_dir / name
    i = 2
    while p.exists():
        p = out_dir / f"{name[:-4]}_{i}.csv"; i += 1
    p.write_text(text)
    subprocess.Popen(["open", "-R", str(p)])
    return {"path": str(p), "rows": n}


# ---------- translate missing ----------
_translate_jobs: dict = {}


@app.post("/api/clinics/{handle}/translate")
def translate_missing(handle: str):
    """Whisper-translate every non-English reel that has no English text yet, then re-import."""
    if _translate_jobs.get(handle, {}).get("status") == "running":
        return _translate_jobs[handle]
    from pipeline import transcribe
    d = DATA_ROOT / handle
    state = _translate_jobs[handle] = {"status": "running", "done": 0, "total": None, "note": "loading model…"}

    def progress(done, total, note=""):
        state.update({"done": done, "total": total, "note": note})

    def work():
        try:
            st = db.get_settings()
            res = transcribe.translate_all(d, st.get("whisper_model", "medium"), progress=progress, target=st.get("translate_to", "en"), engine=st.get("whisper_engine"))
            importer.import_clinic(d)
            state.update({"status": "done", "note": f"{res['done']} translated"})
        except Exception as e:
            state.update({"status": "error", "note": str(e)[:300]})
    threading.Thread(target=work, daemon=True).start()
    return state


@app.get("/api/clinics/{handle}/translate/status")
def translate_status(handle: str):
    target = db.get_settings().get("translate_to", "en")
    missing = db.one("SELECT COUNT(*) n FROM reels WHERE clinic=? AND language IS NOT NULL AND language!=? AND (transcript_en IS NULL OR transcript_en='') AND transcript!=''", (handle, target))["n"]
    return {"missing": missing, "job": _translate_jobs.get(handle), "target": target}


# ---------- ask claude ----------
class Ask(BaseModel):
    question: str


@app.get("/api/clinics/{handle}/chat")
def chat_history(handle: str):
    return db.rows("SELECT role, text, at FROM chat WHERE clinic=? ORDER BY id", (handle,))


@app.delete("/api/clinics/{handle}/chat")
def chat_clear(handle: str):
    """Forget the thread; the next question starts a fresh Claude session."""
    if _ask_jobs.get(handle, {}).get("status") == "running":
        raise HTTPException(409, "wait for the current answer first")
    with db.tx() as c:
        c.execute("DELETE FROM chat WHERE clinic=?", (handle,))
    _ask_jobs.pop(handle, None)
    return {"ok": True}


@app.post("/api/clinics/{handle}/ask")
def ask(handle: str, body: Ask):
    if handle == ALL:
        d = DATA_ROOT
        handles = [r["handle"] for r in db.rows("SELECT handle FROM clinics WHERE analysed>0 ORDER BY handle")]
        intro = (f"You are helping research Instagram reels for healthcare clinics. Each sub-folder here is one clinic's data "
                 f"({', '.join('@' + h for h in handles)}): top_reels_data.csv (one row per reel with hook, format, flag, like-rate, transcript) "
                 f"and INSIGHTS.md. Compare across clinics where useful. ")
    else:
        d = DATA_ROOT / handle
        c = db.one("SELECT speciality FROM clinics WHERE handle=?", (handle,)) or {}
        kind = (c.get("speciality") or "healthcare").lower()
        intro = (f"You are helping research Instagram reels for {kind} clinics. The folder contains @{handle}'s data: "
                 f"top_reels_data.csv (one row per reel with hook, format, flag, like-rate, transcript) and INSIGHTS.md. ")
    if _ask_jobs.get(handle, {}).get("status") == "running":
        raise HTTPException(409, "Claude is still answering the previous question")
    last = db.one("SELECT session_id FROM chat WHERE clinic=? AND session_id IS NOT NULL ORDER BY id DESC LIMIT 1", (handle,))
    sid = last["session_id"] if last else None
    prompt = body.question if sid else intro + f"Read what you need, then answer concisely.\n\nQuestion: {body.question}"
    with db.tx() as c:
        c.execute("INSERT INTO chat(clinic, role, text) VALUES(?,?,?)", (handle, "user", body.question))
    # Claude can take a minute or more reading the files, longer than the webview keeps a request open, so answer via a job
    state = _ask_jobs[handle] = {"status": "running", "question": body.question, "started": time.time(), "answer": None, "error": None}

    def work():
        try:
            res = claude_cli.run(prompt, cwd=d, session_id=sid, json_out=True, timeout_s=600)
            with db.tx() as c:
                c.execute("INSERT INTO chat(clinic, role, text, session_id) VALUES(?,?,?,?)", (handle, "assistant", res["text"], res["session_id"]))
            state.update({"status": "done", "answer": res["text"]})
        except Exception as e:
            msg = str(e).splitlines()[0][:400] if str(e).strip() else type(e).__name__
            with db.tx() as c:
                c.execute("INSERT INTO chat(clinic, role, text) VALUES(?,?,?)", (handle, "assistant", "Error: " + msg))
            state.update({"status": "error", "error": msg})
    threading.Thread(target=work, daemon=True).start()
    return state


_ask_jobs: dict = {}


@app.get("/api/clinics/{handle}/ask/status")
def ask_status(handle: str):
    j = _ask_jobs.get(handle)
    return {**j, "elapsed": round(time.time() - j["started"])} if j else {"status": "idle"}


# ---------- models / tools ----------
@app.get("/api/models")
def models():
    st = db.get_settings()
    return {"models": models_mgr.list_models(), "cache": models_mgr.cache_usage(), "engines": models_mgr.list_engines(),
            "notes": MODEL_NOTES, "default": st.get("whisper_model"), "engine": st.get("whisper_engine", "faster-whisper")}


@app.post("/api/models/{model_id}/download")
def model_download(model_id: str):
    return models_mgr.start_download(model_id)


@app.delete("/api/models/{model_id}")
def model_delete(model_id: str):
    return models_mgr.delete_model(model_id)


@app.get("/api/tools")
def tools():
    return {"view_only": VIEW_ONLY, "claude": claude_cli.status(),
            "browser": {"profile": str(scrape.BROWSER_PROFILE), "exists": scrape.BROWSER_PROFILE.exists(),
                        "installed": scrape.browsers_installed(), "browsers_path": str(scrape.BROWSERS_PATH)},
            "data_root": str(DATA_ROOT), "free_bytes": shutil.disk_usage(DATA_ROOT).free}


@app.get("/api/browser/status")
def browser_status():
    if not scrape.browsers_installed():
        return {"logged_in": False, "installed": False, "error": "Chromium is not installed yet. Use Install browser in Settings."}
    try:
        return {**scrape.session_status(), "installed": True}
    except Exception as e:
        return {"logged_in": False, "installed": True, "error": str(e).splitlines()[0][:300]}


_login_thread: dict = {}
_install_thread: dict = {}


@app.post("/api/browser/login")
def browser_login():
    if _login_thread.get("t") and _login_thread["t"].is_alive():
        return {"started": False, "reason": "login window already open"}
    if not scrape.browsers_installed():
        raise HTTPException(409, "Chromium is not installed yet. Click Install browser first.")
    _login_thread["result"] = None

    def work():
        try:
            _login_thread["result"] = scrape.login_window()
        except Exception as e:
            _login_thread["result"] = {"logged_in": False, "error": str(e).splitlines()[0][:400]}
    t = threading.Thread(target=work, daemon=True); _login_thread["t"] = t; t.start()
    return {"started": True}


@app.post("/api/browser/install")
def browser_install():
    if _install_thread.get("t") and _install_thread["t"].is_alive():
        return {"started": False, "status": "running"}
    _install_thread["result"] = None

    def work():
        try:
            _install_thread["result"] = scrape.install_browsers()
        except Exception as e:
            _install_thread["result"] = {"ok": False, "log": str(e)[:500]}
    t = threading.Thread(target=work, daemon=True); _install_thread["t"] = t; t.start()
    return {"started": True, "status": "running"}


@app.get("/api/browser/install/status")
def browser_install_status():
    t = _install_thread.get("t")
    return {"running": bool(t and t.is_alive()), "result": _install_thread.get("result"), "installed": scrape.browsers_installed()}


@app.get("/api/browser/login/result")
def browser_login_result():
    t = _login_thread.get("t")
    return {"open": bool(t and t.is_alive()), "result": _login_thread.get("result")}


@app.post("/api/browser/logout")
def browser_logout():
    return scrape.logout()


class Settings(BaseModel):
    values: dict


@app.get("/api/settings")
def settings():
    return db.get_settings()


@app.put("/api/settings")
def put_settings(body: Settings):
    before = db.get_settings()
    # the engine and the default model travel together: ggml-* models are whisper.cpp, the rest faster-whisper
    if "whisper_model" in body.values:
        if not model_info(body.values["whisper_model"]):
            raise HTTPException(400, f"unknown model {body.values['whisper_model']!r}")
        body.values["whisper_engine"] = engine_for_model(body.values["whisper_model"])
    elif "whisper_engine" in body.values:
        if body.values["whisper_engine"] not in {e["id"] for e in ENGINES}:
            raise HTTPException(400, f"unknown engine {body.values['whisper_engine']!r}")
        body.values["whisper_model"] = model_for_engine(body.values["whisper_engine"], before.get("whisper_model", "medium"))
    for k, v in body.values.items():
        db.set_setting(k, v)
    if body.values.get("translate_to") and body.values["translate_to"] != before.get("translate_to"):
        # the translated-text column follows the target language, so rebuild the index from the folders
        for d in sorted(DATA_ROOT.iterdir()):
            if d.is_dir() and (d / "reels_index.csv").exists():
                try: importer.import_clinic(d)
                except Exception as e: print("reimport", d.name, e)
    return db.get_settings()


@app.post("/api/reveal")
def reveal(path: str = ""):
    p = (DATA_ROOT / path) if path else DATA_ROOT
    subprocess.Popen(["open", "-R" if p.is_file() else "", str(p)] if p.is_file() else ["open", str(p)])
    return {"ok": True}


# ---------- static frontend ----------
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        f = FRONTEND_DIST / full_path
        if full_path and f.exists() and f.is_file():
            return FileResponse(f)
        return FileResponse(FRONTEND_DIST / "index.html")
