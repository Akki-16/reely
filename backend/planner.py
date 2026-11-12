"""Planned scripts: mine the patterns that work in a speciality, then propose a month of scripts for a client.

Patterns are kept per speciality (they come from the reference accounts, not the client). A plan is a list of
proposed items; ticking items and pressing Generate turns them into queued scripts in the client's room."""
import json
import statistics
import threading
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import claude_cli
import clients
import db
from config import LANG_NAMES

router = APIRouter()
_mining: dict[str, dict] = {}       # speciality -> {"status", "note", "error"}
_lock = threading.Lock()

PAID = ("paid", "sponsor", "celebrity", "collab", "influencer")


def _reels_for(speciality: str | None, limit: int = 260) -> list[dict]:
    """The best organic, annotated reels of a speciality's reference accounts, by like-rate."""
    sql = ("SELECT r.shortcode, r.clinic, r.like_rate, r.views, r.duration, r.language, r.hook_en, r.hook_type, r.format, "
           "r.flag, r.summary FROM reels r LEFT JOIN clinics c ON c.handle=r.clinic "
           "WHERE r.like_rate IS NOT NULL AND COALESCE(r.hook_en,'')!='' ")
    params: list = []
    if speciality:
        sql += "AND c.speciality=? "; params.append(speciality)
    rows = db.rows(sql + "ORDER BY r.like_rate DESC", params)
    rows = [r for r in rows if not any(w in (r.get("flag") or "").lower() for w in PAID)]
    # keep every account in the mix: at most 40% of the sample from one account
    cap = max(20, int(limit * .4)); per: dict[str, int] = {}; out = []
    for r in rows:
        if per.get(r["clinic"], 0) < cap:
            out.append(r); per[r["clinic"]] = per.get(r["clinic"], 0) + 1
        if len(out) >= limit:
            break
    return out


def get_patterns(speciality: str | None) -> list[dict]:
    clients.init()
    r = db.one("SELECT data FROM patterns WHERE speciality=?", (speciality or "",))
    return json.loads(r["data"]) if r and r["data"] else []


def mine(speciality: str | None):
    key = speciality or ""
    with _lock:
        _mining[key] = {"status": "running", "note": "Reading the reels…", "error": None}
    try:
        reels = _reels_for(speciality)
        if len(reels) < 15:
            raise ValueError("Not enough analysed reels in this speciality yet; run a few reference accounts first.")
        lines = [f"{r['shortcode']} | @{r['clinic']} | {r['like_rate']:.2f}% | {r.get('views') or 0} views | {int(r.get('duration') or 0)}s | "
                 f"{r.get('language') or ''} | {r.get('format') or ''} | {r.get('hook_type') or ''} | {r.get('hook_en') or ''} | {(r.get('summary') or '')[:160]}"
                 for r in reels]
        with _lock:
            _mining[key]["note"] = f"Claude is finding patterns in {len(reels)} reels…"
        prompt = f"""You are a content strategist for Indian {speciality or 'healthcare'} clinics. Below are the {len(reels)} best organic
Instagram reels (by like-rate) from several reference accounts in this speciality, one per line:
shortcode | account | like-rate | views | length | language | format | hook type | hook (English) | why it worked

Group them into 6 to 10 repeatable content PATTERNS a clinic could follow (for example "patient question, doctor answers",
"myth vs fact", "family-dialogue skit", "behind the scenes in the lab"). A pattern is a recipe, not a topic: describe the
hook style and the beat structure so a writer can reuse it for any topic. Ignore one-off celebrity or pageant content.

Reply with ONLY a JSON object:
{{"patterns": [{{
  "id": "short-kebab-id",
  "name": "short name",
  "description": "1-2 sentences: what the reel does",
  "hook_style": "how the first 3 seconds work",
  "structure": "beat outline, e.g. hook → reassurance → 3 steps → CTA",
  "length_s": 40,
  "on_camera": "who usually appears",
  "works_because": "why viewers like it",
  "good_for": "kinds of topics it suits",
  "examples": ["up to 8 shortcodes from the list that follow this pattern, best first"]
}}]}}

REELS:
""" + "\n".join(lines)
        res = claude_cli.run(prompt, timeout_s=900)
        data = claude_cli.extract_json(res["text"])
        pats = data.get("patterns") if isinstance(data, dict) else data
        if not pats:
            raise ValueError("Claude did not return any patterns")
        by = {r["shortcode"]: r for r in reels}
        for p in pats:
            ex = [by[c] for c in p.get("examples") or [] if c in by]
            p["examples"] = [r["shortcode"] for r in ex]
            p["example_hooks"] = [r["hook_en"] for r in ex[:3]]
            p["accounts"] = sorted({r["clinic"] for r in ex})
            p["median_like_rate"] = round(statistics.median([r["like_rate"] for r in ex]), 2) if ex else None
            p["count"] = len(ex)
        pats.sort(key=lambda p: -(p.get("median_like_rate") or 0))
        with db.tx() as c:
            c.execute("INSERT INTO patterns(speciality, data, reels, made_at) VALUES(?,?,?,datetime('now')) "
                      "ON CONFLICT(speciality) DO UPDATE SET data=excluded.data, reels=excluded.reels, made_at=excluded.made_at",
                      (key, json.dumps(pats, ensure_ascii=False), len(reels)))
        with _lock:
            _mining[key] = {"status": "done", "note": "", "error": None}
    except Exception as e:
        with _lock:
            _mining[key] = {"status": "failed", "note": "", "error": str(e)[:300]}
        raise


@router.get("/api/patterns")
def patterns(speciality: str | None = None):
    clients.init()
    r = db.one("SELECT * FROM patterns WHERE speciality=?", (speciality or "",))
    with _lock:
        job = dict(_mining.get(speciality or "") or {}) or None
    return {"patterns": json.loads(r["data"]) if r else [], "reels": r["reels"] if r else 0, "made_at": r["made_at"] if r else None,
            "job": job, "available": len(_reels_for(speciality, 1000))}


class MineBody(BaseModel):
    speciality: str | None = None


@router.post("/api/patterns/mine")
def patterns_mine(body: MineBody):
    with _lock:
        if (_mining.get(body.speciality or "") or {}).get("status") == "running":
            raise HTTPException(409, "Already finding patterns for this speciality")
    threading.Thread(target=lambda: _safe(mine, body.speciality), daemon=True).start()
    return {"ok": True}


def _safe(fn, *a):
    try:
        fn(*a)
    except Exception as e:
        print("planner:", e)


# ---------- plans ----------
def _plan_row(r: dict) -> dict:
    out = {**r, "items": json.loads(r["items"] or "[]"), "settings": json.loads(r["settings"] or "{}")}
    sids = [it["script_id"] for it in out["items"] if it.get("script_id")]
    if sids:
        st = {s["id"]: s for s in db.rows(f"SELECT id, status, title FROM scripts WHERE id IN ({','.join('?' * len(sids))})", sids)}
        for it in out["items"]:
            s = st.get(it.get("script_id"))
            if it.get("script_id") and not s:
                it["script_id"] = None
            elif s:
                it["script_status"] = s["status"]; it["script_title"] = s["title"]
    return out


def _set_plan(pid: int, **kv):
    if "items" in kv:
        kv["items"] = json.dumps(kv["items"], ensure_ascii=False)
    sets = ", ".join(f"{k}=?" for k in kv)
    with db.tx() as c:
        c.execute(f"UPDATE plans SET {sets}, updated_at=datetime('now') WHERE id=?", [*kv.values(), pid])


def propose(pid: int):
    p = db.one("SELECT * FROM plans WHERE id=?", (pid,))
    st = json.loads(p["settings"] or "{}")
    try:
        doc = clients._load(p["client_id"])
        sp = doc.get("speciality")
        if not get_patterns(sp):
            _set_plan(pid, note="Finding the patterns that work in this speciality first…")
            mine(sp)
        pats = get_patterns(sp)
        _set_plan(pid, note=f"Claude is planning {p['count']} scripts…")
        done = db.rows("SELECT title, options FROM scripts WHERE client_id=? AND status!='failed' ORDER BY id DESC LIMIT 60", (p["client_id"],))
        done_titles = [d["title"] for d in done if d["title"]]
        mix = st.get("mix") or {}
        mix_txt = ", ".join(f"{n} in {LANG_NAMES.get(l, l)}" for l, n in mix.items() if n) or "the client's languages"
        people = "\n".join(f"- [{x['id']}] {x['name']} ({x.get('role') or ''}; on camera: {x.get('on_camera') or '?'}){' LEAD' if x.get('lead') else ''}"
                           for x in doc["people"]) or "(none)"
        pat_txt = "\n".join(f"- [{q['id']}] {q['name']} · median like-rate {q.get('median_like_rate')}% over {q.get('count')} reels · "
                            f"{q.get('description')} Good for: {q.get('good_for')}. Usually on camera: {q.get('on_camera')}. "
                            f"Example reels: {', '.join(q.get('examples') or [])}" for q in pats)
        prompt = f"""You plan a month of Instagram reels for an Indian healthcare client of Acro.

{clients._client_head(doc)}

CLIENT BRIEF:
{json.dumps(doc['brief'] or {}, ensure_ascii=False, indent=1)}

PATTERNS THAT WORK IN THIS SPECIALITY (with ids):
{pat_txt}

ALREADY WRITTEN FOR THIS CLIENT (don't repeat these topics):
{chr(10).join('- ' + t for t in done_titles) or '(nothing yet)'}

PLAN EXACTLY {p['count']} REELS for {_month_name(p['month'])}.
- Languages: {mix_txt}.
- People (use their ids):
{people}
- Who can appear: {st.get('cast') or 'any mix of the doctors, staff and actors'}.
{('- Extra instruction: ' + st['note']) if st.get('note') else ''}
- Spread the patterns: no pattern more than 3 times; favour the ones with the best like-rate that suit this client.
- Topics come from the brief: services to push, the questions patients ask, branches, myths, seasonal moments of that month in India.
- If a natural topic would break the brief's "never" list (prices, success rates, before/after…), still include it but set "ok": false and explain in "warn".

Reply with ONLY a JSON object:
{{"items": [{{
  "topic": "the reel's topic in a few words",
  "angle": "1 sentence: what the reel says",
  "pattern_id": "id from the list",
  "language": "te|hi|en|…",
  "person_id": "id of the person whose voice it is, or null",
  "on_camera": "who appears, e.g. Dr. X and a receptionist; actors as the couple",
  "refs": ["1-2 example shortcodes of that pattern to borrow from"],
  "why": "1 line: why this topic and pattern for this client now",
  "ok": true,
  "warn": ""
}}]}}"""
        res = claude_cli.run(prompt, cwd=clients.folder(p["client_id"]), timeout_s=900)
        data = claude_cli.extract_json(res["text"])
        items = data.get("items") if isinstance(data, dict) else data
        if not items:
            raise ValueError("Claude did not return a plan")
        pmap = {q["id"]: q for q in pats}
        for i, it in enumerate(items):
            it["id"] = f"i{i + 1}"
            q = pmap.get(it.get("pattern_id"))
            it["pattern"] = q["name"] if q else it.get("pattern_id")
            it["tick"] = bool(it.get("ok", True))
            if it.get("person_id") not in {x["id"] for x in doc["people"]}:
                it["person_id"] = next((x["id"] for x in doc["people"] if x.get("lead")), None)
        _set_plan(pid, status="ready", items=items, note="", error=None)
    except Exception as e:
        _set_plan(pid, status="failed", error=str(e)[:400], note="")


def _month_name(m: str | None) -> str:
    try:
        y, mo = m.split("-"); return date(int(y), int(mo), 1).strftime("%B %Y")
    except Exception:
        return m or "next month"


class NewPlan(BaseModel):
    month: str
    count: int = 12
    mix: dict[str, int] = {}
    cast: str = ""
    note: str = ""


@router.get("/api/clients/{cid}/plans")
def plans(cid: int):
    clients._load(cid)
    return [_plan_row(r) for r in db.rows("SELECT * FROM plans WHERE client_id=? ORDER BY id DESC", (cid,))]


@router.post("/api/clients/{cid}/plans")
def plan_new(cid: int, body: NewPlan):
    doc = clients._load(cid)
    if not doc["brief"]:
        raise HTTPException(400, "Draft this client's brief first; the plan is built from it.")
    if not 1 <= body.count <= 60:
        raise HTTPException(400, "Plan between 1 and 60 scripts")
    if db.one("SELECT 1 FROM plans WHERE client_id=? AND status='proposing'", (cid,)):
        raise HTTPException(409, "A plan is already being proposed for this client")
    with db.tx() as c:
        cur = c.execute("INSERT INTO plans(client_id, month, count, settings, note) VALUES(?,?,?,?,?)",
                        (cid, body.month, body.count, json.dumps({"mix": body.mix, "cast": body.cast, "note": body.note}), "Starting…"))
        pid = cur.lastrowid
    threading.Thread(target=propose, args=(pid,), daemon=True).start()
    return _plan_row(db.one("SELECT * FROM plans WHERE id=?", (pid,)))


class PlanEdit(BaseModel):
    items: list[dict]


@router.patch("/api/plans/{pid}")
def plan_edit(pid: int, body: PlanEdit):
    if not db.one("SELECT 1 FROM plans WHERE id=?", (pid,)):
        raise HTTPException(404)
    _set_plan(pid, items=body.items)
    return _plan_row(db.one("SELECT * FROM plans WHERE id=?", (pid,)))


@router.post("/api/plans/{pid}/retry")
def plan_retry(pid: int):
    p = db.one("SELECT * FROM plans WHERE id=?", (pid,))
    if not p:
        raise HTTPException(404)
    _set_plan(pid, status="proposing", error=None, note="Starting…")
    threading.Thread(target=propose, args=(pid,), daemon=True).start()
    return {"ok": True}


@router.delete("/api/plans/{pid}")
def plan_delete(pid: int):
    with db.tx() as c:
        c.execute("DELETE FROM plans WHERE id=?", (pid,))
        c.execute("UPDATE scripts SET plan_id=NULL WHERE plan_id=?", (pid,))
    return {"ok": True}


@router.post("/api/plans/{pid}/generate")
def plan_generate(pid: int):
    p = db.one("SELECT * FROM plans WHERE id=?", (pid,))
    if not p or p["status"] != "ready":
        raise HTTPException(400, "This plan isn't ready")
    doc = clients._load(p["client_id"])
    pats = {q["id"]: q for q in get_patterns(doc.get("speciality"))}
    items = json.loads(p["items"] or "[]")
    made = []
    for it in items:
        if not it.get("tick") or it.get("script_id"):
            continue
        q = pats.get(it.get("pattern_id")) or {}
        refs = [r for r in it.get("refs") or [] if db.one("SELECT 1 FROM reels WHERE shortcode=?", (r,))] or (q.get("examples") or [])[:1]
        opts = {"closeness": "structure", "topic": f"{it.get('topic')}: {it.get('angle') or ''}".strip(": "), "cast": it.get("on_camera") or "",
                "note": "", "pattern": {k: q.get(k) for k in ("id", "name", "description", "hook_style", "structure", "length_s")} if q else None,
                "plan_item": it["id"]}
        with db.tx() as c:
            cur = c.execute("INSERT INTO scripts(client_id, shortcode, person_id, language, options, title, status, plan_id) VALUES(?,?,?,?,?,?,'queued',?)",
                            (p["client_id"], refs[0] if refs else None, it.get("person_id"), it.get("language") or "en",
                             json.dumps(opts, ensure_ascii=False), (it.get("topic") or "Writing…")[:80], pid))
            it["script_id"] = cur.lastrowid
        made.append(it["script_id"])
    _set_plan(pid, items=items)
    for sid in made:
        clients.enqueue(sid)
    return {"queued": len(made)}
