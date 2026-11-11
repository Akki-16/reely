"""Run orchestration: one background thread per run, stage status persisted to the runs table."""
import json
import threading
import time
import traceback
from datetime import datetime
from pathlib import Path

import db
from config import DATA_ROOT
from pipeline import annotate, assemble, download, importer, index, insights, scrape, transcribe

STAGES = ["scrape", "download", "transcribe", "translate", "annotate", "insights"]
_threads: dict[int, threading.Thread] = {}
_flags: dict[int, dict] = {}   # run id -> {"stop": bool, "pause": bool, "skip": bool}
_live: dict[int, "Run"] = {}   # run id -> Run, while its thread is alive

# ---------- lanes: runs overlap, but each resource serves one clinic at a time ----------
# instagram: scrape + download (both hit Instagram from this IP; doubling that traffic is the ban risk)
# gpu: transcribe + translate (one Whisper job at a time)     claude: annotate + insights (one CLI job at a time)
LANE_OF = {"scrape": "instagram", "download": "instagram", "transcribe": "gpu", "translate": "gpu", "annotate": "claude", "insights": "claude"}
VERB = {"scrape": "scraping", "download": "downloading", "transcribe": "transcribing", "translate": "translating",
        "annotate": "annotating", "insights": "writing insights"}
LANE_NAME = {"instagram": "Instagram", "gpu": "the speech engine", "claude": "Claude"}
_queue: list[int] = []         # run ids in priority order (reorderable)
_qlock = threading.Lock()


class Lane:
    def __init__(self, name):
        self.name = name; self.holder: int | None = None; self.waiting: set[int] = set(); self.cv = threading.Lock()


_lanes = {n: Lane(n) for n in ("instagram", "gpu", "claude")}


def _prio(run_id: int) -> int:
    with _qlock:
        return _queue.index(run_id) if run_id in _queue else 10 ** 6 + run_id


def _reason(lane: Lane, run_id: int) -> str:
    h = _live.get(lane.holder) if lane.holder else None
    ahead_n = sum(1 for w in lane.waiting if _prio(w) < _prio(run_id))
    if h:
        st = next((k for k in STAGES if h.stages.get(k, {}).get("status") == "running"), None)
        tail = f" · {ahead_n} more ahead" if ahead_n else ""
        return f"Waiting for {h.clinic} to finish {VERB.get(st, 'using ' + LANE_NAME[lane.name])}{tail}"
    ahead = sorted((w for w in lane.waiting if _prio(w) < _prio(run_id)), key=_prio)
    if ahead and ahead[0] in _live:
        return f"Queued behind {_live[ahead[0]].clinic} for {LANE_NAME[lane.name]}"
    return f"Waiting for {LANE_NAME[lane.name]}"


def _acquire(run: "Run", lane_name: str, stage: str):
    lane = _lanes[lane_name]
    with lane.cv:
        lane.waiting.add(run.id)
    last = None
    try:
        while True:
            with lane.cv:
                first = min(lane.waiting, key=_prio)
                if lane.holder is None and first == run.id:
                    lane.holder = run.id
                    run.held.add(lane_name)
                    break
                reason = _reason(lane, run.id)
            if reason != last:
                last = reason
                run.stages[stage] = {**run.stages.get(stage, {}), "status": "waiting", "note": reason}
                first_lane = not any(v.get("status") in ("done", "skipped") for v in run.stages.values())
                run.save(status="queued" if first_lane else "running", stage=stage)
                if first_lane:
                    db.upsert("clinics", {"handle": run.clinic, "status": "queued"}, "handle")
                run.log(f"— {reason}")
            if run.stop_requested():
                raise InterruptedError
            time.sleep(1)
    finally:
        with lane.cv:
            lane.waiting.discard(run.id)
    db.upsert("clinics", {"handle": run.clinic, "status": "running"}, "handle")


def _release(run: "Run", lane_name: str):
    lane = _lanes[lane_name]
    with lane.cv:
        if lane.holder == run.id:
            lane.holder = None
    run.held.discard(lane_name)


def queue_state() -> dict:
    """What each lane is doing and who is waiting, for the queue view."""
    out = {}
    for n, l in _lanes.items():
        with l.cv:
            out[n] = {"holder": l.holder, "waiting": sorted(l.waiting, key=_prio)}
    with _qlock:
        order = [r for r in _queue if r in _live]
    return {"lanes": out, "order": order}


def move(run_id: int, direction: int) -> bool:
    with _qlock:
        live = [r for r in _queue if r in _live]
        if run_id not in live:
            return False
        i = live.index(run_id); j = i + direction
        if j < 0 or j >= len(live):
            return False
        a, b = live[i], live[j]
        ia, ib = _queue.index(a), _queue.index(b)
        _queue[ia], _queue[ib] = b, a
    return True


def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


class Run:
    def __init__(self, run_id: int):
        self.id = run_id
        r = db.one("SELECT * FROM runs WHERE id=?", (run_id,))
        self.clinic = r["clinic"]
        self.settings = json.loads(r["settings"] or "{}")
        self.stages = json.loads(r["stages"] or "{}") or {s: {"status": "queued"} for s in STAGES}
        self.dir: Path = DATA_ROOT / self.clinic
        self.held: set[str] = set()

    def save(self, **fields):
        fields["stages"] = json.dumps(self.stages)
        sets = ", ".join(f"{k}=?" for k in fields)
        with db.tx() as c:
            c.execute(f"UPDATE runs SET {sets} WHERE id=?", [*fields.values(), self.id])

    def log(self, line: str):
        with db.tx() as c:
            c.execute("UPDATE runs SET log = substr(log || ? , -20000) WHERE id=?", (f"[{_now()[11:]}] {line}\n", self.id))

    def stop_requested(self):
        f = _flags.get(self.id, {})
        while f.get("pause") and not f.get("stop"):
            time.sleep(1)
        return bool(f.get("stop"))

    def stage_stop(self):
        """For a stage's loop: true when the user wants the run stopped OR just this stage cut short."""
        return self.stop_requested() or bool(_flags.get(self.id, {}).get("skip"))

    def clear_skip(self):
        f = _flags.get(self.id)
        if f and f.get("skip"):
            f["skip"] = False
            self.log("— stage cut short by user, moving on")

    def progress_for(self, stage):
        t0 = time.time()

        def cb(done, total, note="", extra=None):
            st = self.stages[stage]
            st.update({"status": "running", "done": done, "total": total, "note": note, "seconds": round(time.time() - t0)})
            if extra: st["extra"] = extra
            self.save()
            if note: self.log(f"{stage}: {note}")
        return cb

    def begin(self, stage):
        self.stages[stage] = {**{k: v for k, v in self.stages.get(stage, {}).items() if k != "note"}, "status": "running", "started": _now()}
        self.save(stage=stage, status="running")
        self.log(f"— {stage} started")
        return time.time()

    def end(self, stage, t0, note=""):
        self.stages[stage].update({"status": "done", "seconds": round(time.time() - t0), "note": note or self.stages[stage].get("note", "")})
        self.save()
        self.log(f"— {stage} done in {round(time.time()-t0)}s {note}")

    def skip(self, stage, why):
        self.stages[stage] = {"status": "skipped", "note": why}
        self.save()
        self.log(f"— {stage} skipped: {why}")


def _execute(run: Run):
    s = run.settings
    top_n = int(s.get("top_n", 100))
    _live[run.id] = run
    try:
        if s.get("mode") == "refresh":
            return _refresh(run)
        _acquire(run, "instagram", "scrape")
        # 1 scrape (skip if index exists and settings say reuse)
        t0 = run.begin("scrape")
        idx = run.dir / "reels_index.csv"
        fresh = idx.exists() and (time.time() - idx.stat().st_mtime) < 24 * 3600
        if idx.exists() and (s.get("reuse_index") or (fresh and not s.get("rescrape"))):
            run.skip("scrape", "index already exists" if s.get("reuse_index") else "index scraped in the last 24 h")
        else:
            reels = scrape.scrape_grid(run.clinic, int(s.get("scroll_pause_ms", 1000)), max_reels=int(s.get("scrape_max", 0) or 0),
                                       progress=run.progress_for("scrape"), should_stop=run.stage_stop)
            run.clear_skip()
            if not reels:
                raise RuntimeError("no reels collected")
            summary = index.build_index(run.dir, reels)
            run.end("scrape", t0, f"{summary['reels']} reels · median {summary['median_views']:.0f}")
        rows = index.load_index(run.dir)
        top_n = min(top_n, len(rows)) or top_n
        importer.write_meta(run.dir, top_n=top_n)
        db.upsert("clinics", {"handle": run.clinic, "reels_total": len(rows)}, "handle")
        if run.stop_requested(): raise InterruptedError

        # 2 download
        t0 = run.begin("download")
        res = download.download_reels(run.dir, rows[:top_n], s.get("video_quality", "low"), None,
                                      progress=run.progress_for("download"), should_stop=run.stage_stop,
                                      pace=s.get("download_pace", "fast"))
        run.clear_skip()
        run.stages["download"]["extra"] = res
        run.end("download", t0, f"{res['ok']} new · {res['skipped']} existing · {res['failed']} failed")
        _release(run, "instagram")
        if run.stop_requested(): raise InterruptedError

        # 3 transcribe
        _acquire(run, "gpu", "transcribe")
        t0 = run.begin("transcribe")
        res = transcribe.transcribe_all(run.dir, s.get("whisper_model", "medium"), engine=s.get("whisper_engine"),
                                        progress=run.progress_for("transcribe"), should_stop=run.stage_stop)
        run.clear_skip()
        run.end("transcribe", t0, f"{res['done']} transcribed · {res['errors']} errors")
        if run.stop_requested(): raise InterruptedError

        # 4 translate
        t0 = run.begin("translate")
        if str(s.get("translate", "1")) in ("1", "true", "True"):
            res = transcribe.translate_all(run.dir, s.get("whisper_model", "medium"), target=s.get("translate_to", "en"), engine=s.get("whisper_engine"),
                                           progress=run.progress_for("translate"), should_stop=run.stage_stop)
            run.clear_skip()
            run.end("translate", t0, f"{res['done']} translated")
        else:
            run.skip("translate", "off in settings")
        if run.stop_requested(): raise InterruptedError

        _release(run, "gpu")
        # merge before annotation so Claude sees caption + likes
        sheet = assemble.assemble(run.dir, top_n)

        # 5 annotate
        _acquire(run, "claude", "annotate")
        t0 = run.begin("annotate")
        mode = s.get("annotation_mode", "cli")
        if mode == "cli":
            res = annotate.annotate_cli(run.dir, sheet, progress=run.progress_for("annotate"))
            run.end("annotate", t0, f"{res['annotated']} annotated")
        elif mode == "handoff":
            p = annotate.write_handoff(run.dir, sheet)
            run.stages["annotate"] = {"status": "waiting", "note": f"Hand-off written: {p.name}. Annotate in a Claude session, then re-run Import."}
            run.save()
        else:
            run.skip("annotate", "off in settings")
        sheet = assemble.assemble(run.dir, top_n)
        st = assemble.stats(sheet)

        # 6 insights
        t0 = run.begin("insights")
        if mode == "cli" and any(r.get("hook_type") for r in sheet):
            insights.write_insights(run.dir, sheet, st)
            run.end("insights", t0, "INSIGHTS.md written")
        else:
            run.skip("insights", "needs annotations")
        _release(run, "claude")

        if str(db.get_settings().get("auto_clear_videos", "0")) == "1":
            import storage
            r = storage.clear_videos(run.clinic, only_processed=True)
            run.log(f"— auto clean-up: removed {r['removed']} processed videos, freed {r['bytes'] // 1_000_000} MB")
        importer.import_clinic(run.dir, top_n, status="done")
        db.upsert("clinics", {"handle": run.clinic, "last_run": _now(), "status": "done"}, "handle")
        run.save(status="done", finished=_now(), stage=None)
        run.log("run complete")
    except InterruptedError:
        importer.import_clinic(run.dir, top_n, status="stopped")
        run.save(status="stopped", finished=_now())
        run.log("run stopped by user")
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        run.log("ERROR " + err + "\n" + traceback.format_exc()[-1500:])
        for st in run.stages.values():
            if st.get("status") == "running": st["status"] = "failed"
        try:
            importer.import_clinic(run.dir, top_n, status="failed")
        except Exception:
            pass
        db.upsert("clinics", {"handle": run.clinic, "status": "failed"}, "handle")
        run.save(status="failed", finished=_now(), error=err)
    finally:
        for ln in list(run.held):
            _release(run, ln)
        _flags.pop(run.id, None)
        _live.pop(run.id, None)
        with _qlock:
            if run.id in _queue: _queue.remove(run.id)


def _refresh(run: Run):
    """Refresh stats: re-scrape view counts and re-fetch likes for reels already here. No video, no Whisper, no Claude."""
    s = run.settings
    old = {r["shortcode"]: r for r in index.load_index(run.dir)}
    if not old:
        raise RuntimeError("this clinic has not been scraped yet; use Run first")
    _acquire(run, "instagram", "scrape")
    t0 = run.begin("scrape")
    reels = scrape.scrape_grid(run.clinic, int(s.get("scroll_pause_ms", 1000)), max_reels=0,
                               progress=run.progress_for("scrape"), should_stop=run.stage_stop)
    run.clear_skip()
    if not reels:
        raise RuntimeError("no reels collected")
    merged = dict(reels)
    for code, r in old.items():            # keep reels the scroll did not reach, with their old counts
        merged.setdefault(code, r.get("views_text") or str(r.get("views") or ""))
    _history(run.dir, old, before=True)
    summary = index.build_index(run.dir, merged)
    grew = sum(1 for c, r in old.items() if c in reels and index.parse_views(reels[c]) and r.get("views") and index.parse_views(reels[c]) > r["views"])
    run.end("scrape", t0, f"{summary['reels']} reels · {len(set(reels) - set(old))} new · {grew} with more views")
    if run.stop_requested(): raise InterruptedError
    t0 = run.begin("download")
    from pipeline.views_fmt import info_path
    codes = [c for c in old if info_path(run.dir, c)]
    res = download.refresh_metadata(run.dir, codes, progress=run.progress_for("download"), should_stop=run.stage_stop,
                                    pace=s.get("download_pace", "fast"))
    run.clear_skip()
    run.end("download", t0, f"likes refreshed for {res['done']} reels · {res['failed']} failed")
    _release(run, "instagram")
    for st in ("transcribe", "translate", "annotate", "insights"):
        run.skip(st, "stats refresh only")
    _history(run.dir, {r["shortcode"]: r for r in index.load_index(run.dir)}, before=False)
    importer.import_clinic(run.dir, status="done")
    db.upsert("clinics", {"handle": run.clinic, "last_run": _now(), "status": "done"}, "handle")
    run.save(status="done", finished=_now(), stage=None)
    run.log("stats refresh complete")


def _history(d: Path, rows: dict, before: bool):
    """stats_history.json: {code: [{"at", "views", "likes"}]} so the inspector can show growth between refreshes."""
    from pipeline.views_fmt import info_path
    p = d / "stats_history.json"
    h = json.loads(p.read_text()) if p.exists() else {}
    at = datetime.now().strftime("%Y-%m-%d %H:%M")
    for code, r in rows.items():
        ip = info_path(d, code)
        if not ip:
            continue
        if before and h.get(code):
            continue                       # a baseline already exists
        try:
            likes = json.loads(ip.read_text()).get("like_count")
        except Exception:
            likes = None
        if before:
            at0 = datetime.fromtimestamp(ip.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
            h[code] = [{"at": at0, "views": r.get("views"), "likes": likes}]
        else:
            h.setdefault(code, []).append({"at": at, "views": r.get("views"), "likes": likes})
    p.write_text(json.dumps(h))


def start(clinic: str, settings: dict) -> int:
    from config import VIEW_ONLY, VIEW_ONLY_MSG
    if VIEW_ONLY:
        raise RuntimeError(VIEW_ONLY_MSG)
    base = db.get_settings(); base.update({k: v for k, v in settings.items() if v is not None})
    if settings.get("top_n") is None:
        # a plain re-run never shrinks a clinic that was already processed deeper than the default
        prev = int(importer.read_meta(DATA_ROOT / clinic).get("top_n") or 0)
        base["top_n"] = str(max(int(base.get("top_n", 100)), prev))
    with db.tx() as c:
        cur = c.execute("INSERT INTO runs(clinic, status, settings, stages) VALUES(?,?,?,?)",
                        (clinic, "queued", json.dumps(base), json.dumps({s: {"status": "queued"} for s in STAGES})))
        run_id = cur.lastrowid
    db.upsert("clinics", {"handle": clinic, "status": "queued"}, "handle")
    _flags[run_id] = {"stop": False, "pause": False, "skip": False}
    with _qlock:
        _queue.append(run_id)
    t = threading.Thread(target=_execute, args=(Run(run_id),), daemon=True)
    _threads[run_id] = t
    t.start()
    return run_id


def control(run_id: int, action: str):
    f = _flags.get(run_id)
    if not f:
        return False
    if action == "stop": f["stop"] = True; f["pause"] = False
    elif action == "skip": f["skip"] = True; f["pause"] = False
    elif action == "pause": f["pause"] = True
    elif action == "resume": f["pause"] = False
    with db.tx() as c:
        if action in ("pause", "resume", "skip"):
            cur = db.one("SELECT status FROM runs WHERE id=?", (run_id,))
            if not (cur and cur["status"] == "queued" and action != "pause"):
                c.execute("UPDATE runs SET status=? WHERE id=?", ("paused" if action == "pause" else "running", run_id))
    if action == "stop":
        Run(run_id).log("— stop requested, finishing the current item")
    if action == "skip":
        Run(run_id).log("— skip requested, finishing the current item then moving to the next stage")
    return True


def active_for(clinic: str):
    return db.one("SELECT id FROM runs WHERE clinic=? AND status IN ('running','paused','queued') ORDER BY id DESC LIMIT 1", (clinic,))
