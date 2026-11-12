"""Clients: the clinics and hospitals Acro makes reels for.

A client is one JSON document (people, branches, sources) plus a brief, the reference reels sent to it and the
scripts written for it. Files and the text read from websites live in <support>/clients/<id>/ so a headless Claude
call can Read them (PDFs and images included)."""
import html
import json
import re
import shutil
import subprocess
import threading
import queue
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import claude_cli
import db
from config import LANG_NAMES, SUPPORT_DIR

router = APIRouter()
ROOT = SUPPORT_DIR / "clients"

SCHEMA = """
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, data TEXT DEFAULT '{}', brief TEXT, brief_meta TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS client_refs (
  client_id INTEGER NOT NULL, shortcode TEXT NOT NULL, clinic TEXT, note TEXT DEFAULT '',
  added TEXT DEFAULT (datetime('now')), PRIMARY KEY (client_id, shortcode)
);
CREATE TABLE IF NOT EXISTS scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL, shortcode TEXT, person_id TEXT, language TEXT,
  status TEXT DEFAULT 'generating',   -- generating | draft | review | approved | failed
  title TEXT, options TEXT DEFAULT '{}', data TEXT, error TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS patterns (
  speciality TEXT PRIMARY KEY, data TEXT, reels INTEGER, made_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL, month TEXT, count INTEGER, settings TEXT DEFAULT '{}',
  status TEXT DEFAULT 'proposing',   -- proposing | ready | failed
  note TEXT, error TEXT, items TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
"""

SECTIONS = ["positioning", "people", "services", "branches", "audience", "questions", "voice", "say_never", "cta",
            "posted", "checks", "extra"]
SECTION_TITLES = {"positioning": "Positioning", "people": "The people", "services": "What we're pushing",
                  "branches": "Where", "audience": "Who we're talking to", "questions": "What they ask",
                  "voice": "Voice", "say_never": "Say · never say", "cta": "Every reel ends with",
                  "posted": "Already posted", "checks": "Things to check", "extra": "More"}

_ready = False
_jobs: dict[int, dict] = {}      # client id -> {"kind", "status", "note", "error", "at"}
_jlock = threading.Lock()


_q: "queue.Queue[int]" = queue.Queue()
WORKERS = 2      # scripts written at the same time; a month's batch queues behind these


def _worker():
    while True:
        sid = _q.get()
        try:
            r = db.one("SELECT status FROM scripts WHERE id=?", (sid,))
            if r and r["status"] == "queued":
                with db.tx() as c:
                    c.execute("UPDATE scripts SET status='generating', updated_at=datetime('now') WHERE id=?", (sid,))
                write_script(sid)
        except Exception as e:
            print("script worker:", e)
        finally:
            _q.task_done()


def enqueue(sid: int):
    _q.put(sid)


def init():
    global _ready
    if _ready:
        return
    with db.tx() as c:
        c.executescript(SCHEMA)
        cols = {r[1] for r in c.execute("PRAGMA table_info(scripts)")}
        if "plan_id" not in cols:
            c.execute("ALTER TABLE scripts ADD COLUMN plan_id INTEGER")
        # scripts a previous process was writing or still had queued: start them again
        c.execute("UPDATE scripts SET status='queued' WHERE status IN ('generating','queued')")
        c.execute("UPDATE plans SET status='failed', error='Reely was closed while this plan was being proposed' WHERE status='proposing'")
    ROOT.mkdir(parents=True, exist_ok=True)
    _ready = True
    for _ in range(WORKERS):
        threading.Thread(target=_worker, daemon=True).start()
    for r in db.rows("SELECT id FROM scripts WHERE status='queued' ORDER BY id"):
        enqueue(r["id"])


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _new_id(prefix: str) -> str:
    return prefix + uuid.uuid4().hex[:8]


def folder(cid: int) -> Path:
    p = ROOT / str(cid)
    (p / "files").mkdir(parents=True, exist_ok=True)
    (p / "read").mkdir(parents=True, exist_ok=True)
    return p


def _load(cid: int) -> dict:
    init()
    r = db.one("SELECT * FROM clients WHERE id=?", (cid,))
    if not r:
        raise HTTPException(404, "No such client")
    d = json.loads(r["data"] or "{}")
    for k in ("people", "branches", "sources", "languages"):
        d.setdefault(k, [])
    return {"id": r["id"], "name": r["name"], "created_at": r["created_at"], "updated_at": r["updated_at"], **d,
            "brief": json.loads(r["brief"]) if r["brief"] else None, "brief_meta": json.loads(r["brief_meta"] or "{}")}


_DOC_KEYS = ("speciality", "city", "languages", "color", "people", "branches", "sources")


def _save(cid: int, doc: dict):
    data = {k: doc.get(k) for k in _DOC_KEYS}
    with db.tx() as c:
        c.execute("UPDATE clients SET name=?, data=?, updated_at=datetime('now') WHERE id=?",
                  (doc["name"], json.dumps(data, ensure_ascii=False), cid))


def _save_brief(cid: int, brief: dict | None, meta: dict):
    with db.tx() as c:
        c.execute("UPDATE clients SET brief=?, brief_meta=?, updated_at=datetime('now') WHERE id=?",
                  (json.dumps(brief, ensure_ascii=False) if brief is not None else None, json.dumps(meta, ensure_ascii=False), cid))


def _set_source(cid: int, sid: str, **kv):
    doc = _load(cid)
    for s in doc["sources"]:
        if s["id"] == sid:
            s.update(kv)
    _save(cid, doc)


def _job(cid: int, **kv):
    with _jlock:
        j = _jobs.setdefault(cid, {})
        j.update(kv, at=time.time())


def _busy(cid: int) -> bool:
    with _jlock:
        return _jobs.get(cid, {}).get("status") == "running"


# ---------- reading websites ----------
class _Text(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head", "iframe"}

    def __init__(self):
        super().__init__()
        self.out, self.links, self.title, self._skip, self._in_title = [], [], "", 0, False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP: self._skip += 1
        if tag == "title": self._in_title = True
        if tag == "a":
            href = dict(attrs).get("href")
            if href: self.links.append(href)
        if tag in ("p", "div", "li", "br", "h1", "h2", "h3", "h4", "tr", "section"): self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip: self._skip -= 1
        if tag == "title": self._in_title = False

    def handle_data(self, data):
        if self._in_title: self.title += data
        elif not self._skip: self.out.append(data)

    def text(self):
        t = html.unescape("".join(self.out))
        t = re.sub(r"[ \t\r\f\v]+", " ", t)
        return re.sub(r"\n\s*\n+", "\n\n", t).strip()


_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
_GOOD = re.compile(r"about|doctor|team|service|treatment|speciali|contact|branch|location|faq|ivf|fertility|care|center|centre|why", re.I)
_BAD = re.compile(r"\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|css|js)(\?|$)|wp-json|/feed|/tag/|/category/|login|cart|privacy|terms|#", re.I)


def _ssl_context():
    import ssl
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _fetch(u: str, timeout=20) -> tuple[str, str, list[str]]:
    req = urllib.request.Request(u, headers={"User-Agent": _UA, "Accept-Language": "en-IN,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as r:
        ctype = r.headers.get("Content-Type", "")
        raw = r.read(3_000_000)
        final = r.geturl()
    if "html" not in ctype and not raw.lstrip()[:20].lower().startswith((b"<!doctype", b"<html")):
        return final, "", []
    p = _Text()
    p.feed(raw.decode("utf-8", "replace"))
    links = [urllib.parse.urljoin(final, h) for h in p.links]
    return final, (p.title.strip() + "\n\n" + p.text()).strip(), links


def _norm_url(u: str) -> str:
    u = u.strip()
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    return u


def read_site(start: str, max_pages: int = 12, max_chars: int = 60000) -> tuple[str, int]:
    """Read a site's home page and its most useful same-site pages. Returns (text, pages read)."""
    start = _norm_url(start)
    host = urllib.parse.urlparse(start).netloc.replace("www.", "")
    seen, queue, parts, total = set(), [start], [], 0
    while queue and len(seen) < max_pages and total < max_chars:
        u = queue.pop(0).split("#")[0].rstrip("/")
        if u in seen:
            continue
        seen.add(u)
        try:
            final, text, links = _fetch(u)
        except Exception:
            continue
        if text:
            chunk = f"=== {final}\n{text[:12000]}\n"
            parts.append(chunk); total += len(chunk)
        same = []
        for l in links:
            pu = urllib.parse.urlparse(l)
            if pu.scheme in ("http", "https") and pu.netloc.replace("www.", "") == host and not _BAD.search(l):
                l = l.split("#")[0].rstrip("/")
                if l not in seen and l not in queue and l not in same:
                    same.append(l)
        same.sort(key=lambda l: 0 if _GOOD.search(urllib.parse.urlparse(l).path) else 1)
        queue += same[:30]
    return "".join(parts)[:max_chars], len(parts)


def _ig_handle(v: str) -> str | None:
    m = re.search(r"instagram\.com/([A-Za-z0-9_.]+)", v or "")
    h = (m.group(1) if m else (v or "")).strip().lstrip("@").strip("/")
    return h if re.fullmatch(r"[A-Za-z0-9_.]{1,40}", h or "") else None


def _instagram_baseline(handle: str) -> tuple[str, str] | None:
    c = db.one("SELECT * FROM clinics WHERE handle=?", (handle,))
    if not c:
        return None
    reels = db.rows("SELECT hook_en, format, like_rate, views, summary FROM reels WHERE clinic=? ORDER BY like_rate DESC LIMIT 25", (handle,))
    lines = [f"Instagram @{handle}: {c.get('reels_total') or 0} reels scraped, median like-rate "
             f"{(c.get('median_like_rate') or 0):.2f}%, median views {int(c.get('median_views') or 0)}.", "Their best reels by like-rate:"]
    for r in reels:
        lines.append(f"- {r.get('like_rate') or 0:.2f}% · {r.get('views') or 0} views · {r.get('format') or ''} · {r.get('hook_en') or ''} — {r.get('summary') or ''}")
    lr = c.get("median_like_rate")
    return "\n".join(lines), f"in Reely · {lr:.2f}% median like-rate" if lr is not None else "in Reely"


def read_sources(cid: int, only: str | None = None, force: bool = False):
    """Fetch every link source that has not been read yet (or just `only`). Updates each source's status."""
    doc = _load(cid)
    f = folder(cid)
    for s in doc["sources"]:
        if only and s["id"] != only:
            continue
        if s.get("kind") not in ("website", "social", "listing", "custom") or not (s.get("value") or "").strip():
            continue
        if s.get("read_at") and not force and not only:
            continue
        v = s["value"].strip()
        out = f / "read" / f"{s['id']}.txt"
        _job(cid, note=f"Reading {s.get('label') or v}…")
        try:
            if "instagram.com" in v or (s.get("kind") == "social" and v.startswith("@")):
                h = _ig_handle(v)
                base = _instagram_baseline(h) if h else None
                if base:
                    out.write_text(base[0]); _set_source(cid, s["id"], status="ok", detail=base[1], read_at=_now())
                else:
                    _set_source(cid, s["id"], status="todo", read_at=_now(),
                                detail="not scraped · add it as a reference account to read its reels")
                continue
            if s.get("kind") == "website":
                text, n = read_site(v)
            else:
                final, text, _ = _fetch(_norm_url(v)); n = 1 if text else 0
            if len(text) < 400:
                _set_source(cid, s["id"], status="warn", read_at=_now(),
                            detail="couldn't read this page · paste the useful parts as a note")
                continue
            out.write_text(text)
            _set_source(cid, s["id"], status="ok", read_at=_now(), detail=f"read · {n} page{'s' if n != 1 else ''}")
        except Exception as e:
            _set_source(cid, s["id"], status="warn", read_at=_now(), detail=f"couldn't open · {str(e)[:80]}")


# ---------- Claude prompts ----------
def _people_text(doc: dict) -> str:
    out = []
    for p in doc["people"]:
        br = ", ".join(b["name"] for b in doc["branches"] if b["id"] in (p.get("branches") or []))
        out.append(f"- [{p['id']}] {p.get('name')} — {p.get('role') or ''}{' · LEAD FACE' if p.get('lead') else ''} · speaks "
                   f"{', '.join(p.get('languages') or []) or '?'} · on camera: {p.get('on_camera') or '?'}"
                   f"{' · branches: ' + br if br else ''}{' · ' + p['note'] if p.get('note') else ''}")
    return "\n".join(out) or "(none added yet)"


def _branches_text(doc: dict) -> str:
    return "\n".join(f"- {b.get('name')}{' (main)' if b.get('main') else ''} · {b.get('area') or ''} · services: "
                     f"{b.get('services') or '?'} · call to action: {b.get('cta') or '?'}"
                     f"{' · Maps: ' + b['maps'] if b.get('maps') else ''}" for b in doc["branches"]) or "(none added yet)"


def _sources_text(cid: int, doc: dict) -> tuple[str, int]:
    f = folder(cid)
    lines, n = [], 0
    for s in doc["sources"]:
        kind, label, v = s.get("kind"), s.get("label") or s.get("kind"), (s.get("value") or "").strip()
        owner = next((p["name"] for p in doc["people"] if p["id"] == s.get("person_id")), None) or \
            next((b["name"] for b in doc["branches"] if b["id"] == s.get("branch_id")), None)
        tag = f" (belongs to {owner})" if owner else ""
        if kind == "note":
            lines.append(f"## NOTE: {label}{tag}\n{v}\n"); n += 1
        elif kind == "file":
            p = f / "files" / v
            if p.exists():
                lines.append(f"## FILE: {label}{tag} → Read the file `files/{v}`"); n += 1
        else:
            rp = f / "read" / f"{s['id']}.txt"
            if rp.exists():
                lines.append(f"## {kind.upper()}: {label}{tag} — {v} → Read `read/{s['id']}.txt`"); n += 1
            elif v:
                lines.append(f"## {kind.upper()}: {label}{tag} — {v} (could not be read; use only the name)")
    for b in doc["branches"]:
        if b.get("reviews"):
            lines.append(f"## REVIEWS pasted for branch {b['name']}\n{b['reviews']}\n"); n += 1
    return "\n".join(lines) or "(no sources yet)", n


def _client_head(doc: dict) -> str:
    langs = ", ".join(LANG_NAMES.get(l, l) for l in doc.get("languages") or []) or "?"
    return (f"Client: {doc['name']} · speciality: {doc.get('speciality') or '?'} · city: {doc.get('city') or '?'} · "
            f"reel languages: {langs}\n\nPEOPLE (use these ids):\n{_people_text(doc)}\n\nBRANCHES:\n{_branches_text(doc)}")


BRIEF_SHAPE = """{
 "positioning": "one sentence: what this clinic stands for, in plain words a patient would use",
 "people": [{"id": "<person id from PEOPLE>", "summary": "1-2 lines: role, what topics they own, how they come across on camera"}],
 "services": [{"text": "service to push, most important first", "src": "web|PDF|note|Maps|Instagram"}],
 "branches": [{"name": "<branch name>", "note": "1 line: what this branch is known for / what reviews say", "src": "..."}],
 "audience": {"text": "3-4 sentences: who the patients are, what they fear, who decides", "src": ["..."]},
 "questions": [{"q": "a question patients really ask, in their words", "src": "front desk|reviews|Instagram comments|web|PDF"}],
 "voice": {"clinical": 0-100 (0 = warm, 100 = clinical), "technical": 0-100 (0 = simple), "energy": 0-100 (0 = calm),
           "mix": [{"lang": "te", "pct": 70}, {"lang": "en", "pct": 30}], "note": "1 line, e.g. medical terms stay in English"},
 "say": ["phrases or habits that fit this clinic"],
 "never": ["things the clinic must never say or show"],
 "cta": {"text": "how every reel ends", "note": "branch-specific variations, if any"},
 "posted": "1-2 lines on what they already post on Instagram and how it performs",
 "checks": ["facts that disagree between sources, or that you could not confirm"],
 "extra": []
}"""

RULES = """Rules: use only facts from the sources; where something is unknown write "[to confirm]" rather than guessing.
Keep Indian medical-advertising norms in mind (NMC professional conduct): no guaranteed outcomes or success-rate claims,
no before/after, no patient identity without consent, no fee or discount promotion, no running down other doctors.
Put those in "never" unless the sources say something stricter."""


def draft_brief(cid: int):
    doc = _load(cid)
    meta = doc["brief_meta"] or {}
    _job(cid, kind="brief", status="running", note="Reading sources…", error=None)
    try:
        read_sources(cid)
        doc = _load(cid)
        src, n = _sources_text(cid, doc)
        _job(cid, note=f"Claude is writing the brief from {n} source{'s' if n != 1 else ''}…")
        prompt = f"""You are writing a one-page content brief for an Indian healthcare client of Acro, a marketing team that
turns proven Instagram reels into scripts for clinics. Every reel script for this client will be written from this brief.

{_client_head(doc)}

SOURCES (read every file named below with the Read tool before writing):
{src}

{RULES}

Reply with ONLY a JSON object of exactly this shape:
{BRIEF_SHAPE}"""
        res = claude_cli.run(prompt, cwd=folder(cid), timeout_s=900)
        brief = claude_cli.extract_json(res["text"])
        if not isinstance(brief, dict):
            raise ValueError("Claude did not return a brief")
        meta.update(drafted_at=_now(), sources=n, edited=[], version=int(meta.get("version") or 0) + 1, locked=False)
        meta.setdefault("history", []).insert(0, {"at": _now(), "what": f"Claude drafted from {n} sources"})
        _save_brief(cid, brief, meta)
        _job(cid, status="done", note="Brief drafted")
    except Exception as e:
        _job(cid, status="failed", error=str(e)[:400], note="")


def redraft_section(cid: int, section: str, ask: str = ""):
    doc = _load(cid)
    brief, meta = doc["brief"] or {}, doc["brief_meta"] or {}
    _job(cid, kind="section", section=section, status="running", note=f"Redrafting {SECTION_TITLES.get(section, section)}…", error=None)
    try:
        src, n = _sources_text(cid, doc)
        keys = ["say", "never"] if section == "say_never" else [section]
        prompt = f"""You are revising one section of a content brief for an Indian healthcare client.

{_client_head(doc)}

SOURCES (Read the files named if you need them):
{src}

CURRENT BRIEF:
{json.dumps(brief, ensure_ascii=False, indent=1)}

Rewrite only the key(s) {keys}. {('Instruction from the editor: ' + ask) if ask else 'Make it sharper and more specific to this client.'}
The shape of each key is as in:
{BRIEF_SHAPE}

{RULES}

Reply with ONLY a JSON object containing just those key(s)."""
        res = claude_cli.run(prompt, cwd=folder(cid), timeout_s=600)
        part = claude_cli.extract_json(res["text"])
        doc = _load(cid)
        brief = doc["brief"] or {}
        for k in keys:
            if k in part:
                brief[k] = part[k]
        meta = doc["brief_meta"] or {}
        meta["edited"] = [e for e in meta.get("edited", []) if e != section]
        meta.setdefault("history", []).insert(0, {"at": _now(), "what": f"Claude redrafted {SECTION_TITLES.get(section, section)}"})
        _save_brief(cid, brief, meta)
        _job(cid, status="done", note="")
    except Exception as e:
        _job(cid, status="failed", error=str(e)[:400], note="")


SCRIPT_SHAPE = """{
 "title": "short working title",
 "topic": "what the reel is about, 1 line",
 "borrowed": "what this script takes from the reference reel (structure, hook pattern, emotional beat) and what it changes",
 "duration_s": 45,
 "on_camera": ["names of who appears"],
 "hooks": [{"line": "...", "romanised": "...", "english": "...", "why": "why this hook works, 1 line"}],
 "beats": [{"t": "0-3s", "who": "name or role", "line": "...", "romanised": "...", "english": "...", "visual": "what we see / on-screen text"}],
 "caption": "Instagram caption in the reel language, with line breaks",
 "hashtags": ["..."],
 "cta": "the closing call to action",
 "claims": [{"claim": "every medical or factual claim in the script", "check": "what the doctor should confirm"}],
 "compliance": [{"ok": true, "note": "NMC / advertising check, one item per rule that applies"}],
 "notes": "shooting notes for the team: location, props, b-roll",
 "pattern": "the name of the pattern this follows, if any"
}"""


def _lang_rule(lang: str) -> str:
    if lang == "en":
        return "Write in English. Leave \"romanised\" and \"english\" as empty strings."
    name = LANG_NAMES.get(lang, lang)
    return (f"Write every spoken line in natural, spoken {name} in its own script (the way people in the client's city "
            f"really talk; English medical terms are fine). Fill \"romanised\" with the same line in Latin letters "
            f"and \"english\" with a faithful English gloss.")


CLOSENESS = {
    "close": "Stay close: same idea and structure as the reference, rewritten for this client, its people and its patients.",
    "structure": "Keep the reference's structure and hook pattern, but pick the topic from this client's brief (services, patient questions).",
    "loose": "Use the reference only as inspiration for the hook and pacing; everything else comes from the brief.",
}


def write_script(sid: int):
    s = db.one("SELECT * FROM scripts WHERE id=?", (sid,))
    if not s:
        return
    try:
        opts = json.loads(s["options"] or "{}")
        doc = _load(s["client_id"])
        ref = db.one("SELECT r.*, c.speciality FROM reels r LEFT JOIN clinics c ON c.handle=r.clinic WHERE r.shortcode=?", (s["shortcode"],)) if s["shortcode"] else None
        person = next((p for p in doc["people"] if p["id"] == s["person_id"]), None)
        cast = opts.get("cast") or ""
        ref_txt = "(none: write from the brief and the topic)"
        pat = opts.get("pattern")
        pat_txt = ""
        if pat:
            pat_txt = (f"\nPATTERN TO FOLLOW (mined from the best reels in this speciality):\n{pat.get('name')}: {pat.get('description') or ''}\n"
                       f"Hook style: {pat.get('hook_style') or ''}\nStructure: {pat.get('structure') or ''}\nTypical length: {pat.get('length_s') or '?'}s\n")
        elif not ref:
            # a topic with no reference: offer the speciality's patterns and let Claude pick the closest one
            import planner
            pats = planner.get_patterns(doc.get("speciality"))
            if pats:
                pat_txt = "\nPATTERNS THAT WORK IN THIS SPECIALITY (pick the one that suits the topic best and follow it; say which in \"pattern\"):\n" + \
                    "\n".join(f"- {p['name']}: {p.get('description') or ''} Hook style: {p.get('hook_style') or ''} Structure: {p.get('structure') or ''} "
                              f"(median like-rate {p.get('median_like_rate') or '?'}%)" + "".join(f"\n    example hook: {h}" for h in (p.get('example_hooks') or [])[:2])
                              for p in pats) + "\n"
        if ref:
            ref_txt = (f"@{ref['clinic']} · {ref.get('like_rate') or 0:.2f}% like-rate · {ref.get('views') or 0} views · "
                       f"{ref.get('duration') or '?'}s · format {ref.get('format') or '?'} · hook type {ref.get('hook_type') or '?'}\n"
                       f"Hook (spoken): {ref.get('hook_original') or ''}\nHook (English): {ref.get('hook_en') or ''}\n"
                       f"Why it worked: {ref.get('summary') or ''}\nCaption: {(ref.get('caption') or '')[:600]}\n"
                       f"Transcript: {(ref.get('transcript') or '')[:3500]}\nTranscript (English): {(ref.get('transcript_en') or '')[:3500]}")
        prompt = f"""You write Instagram reel scripts for Indian clinics. The doctor will review this script, so every medical
statement must be accurate and listed under "claims".

{_client_head(doc)}

CLIENT BRIEF:
{json.dumps(doc['brief'] or {}, ensure_ascii=False, indent=1)}

REFERENCE REEL (a proven reel from another account in this speciality):
{ref_txt}
{pat_txt}
WRITE ONE SCRIPT
- Speaking for: {person['name'] + ' (' + (person.get('role') or '') + ')' if person else 'the clinic'}{'; on camera: ' + person.get('on_camera') if person and person.get('on_camera') else ''}
- Who appears: {cast or 'whoever suits the script, from the people above (actors are fine for skits)'}
- How close to the reference: {CLOSENESS.get(opts.get('closeness') or 'structure')}
- {_lang_rule(s['language'] or 'en')}
- Give exactly 3 hook options; the beats start after the hook.
- Match the reference's length unless the topic needs less.{(chr(10) + '- Topic: ' + opts['topic']) if opts.get('topic') else ''}{(chr(10) + '- Extra instruction: ' + opts['note']) if opts.get('note') else ''}

{RULES}

Reply with ONLY a JSON object of this shape:
{SCRIPT_SHAPE}"""
        res = claude_cli.run(prompt, cwd=folder(s["client_id"]), timeout_s=900)
        data = claude_cli.extract_json(res["text"])
        if not isinstance(data, dict) or not data.get("beats"):
            raise ValueError("Claude did not return a script")
        data["hook_pick"] = 0
        data["checked"] = []
        if pat and not data.get("pattern"):
            data["pattern"] = pat.get("name")
        with db.tx() as c:
            c.execute("UPDATE scripts SET status='draft', title=?, data=?, error=NULL, updated_at=datetime('now') WHERE id=?",
                      (data.get("title") or "Untitled script", json.dumps(data, ensure_ascii=False), sid))
    except Exception as e:
        with db.tx() as c:
            c.execute("UPDATE scripts SET status='failed', error=?, updated_at=datetime('now') WHERE id=?", (str(e)[:400], sid))


# ---------- PDF ----------
_CSS = """
@page { size: A4; margin: 16mm 15mm; }
body { font-family: -apple-system, 'Helvetica Neue', 'Kohinoor Telugu', 'Telugu Sangam MN', 'Kohinoor Devanagari', sans-serif; color: #1d1d1f; font-size: 11pt; line-height: 1.5; }
.eyebrow { font-size: 8pt; font-weight: 700; letter-spacing: .09em; color: #6e5aa8; text-transform: uppercase; }
h1 { font-size: 24pt; margin: 4px 0 6px; letter-spacing: -.02em; }
.lede { font-family: Georgia, 'New York', serif; font-size: 14pt; color: #3a3a3c; margin: 0 0 14px; }
h2 { font-size: 8.5pt; font-weight: 700; letter-spacing: .09em; color: #6e5aa8; text-transform: uppercase; margin: 18px 0 6px; }
.muted { color: #6e6e73; } .small { font-size: 9pt; }
table { width: 100%; border-collapse: collapse; } td, th { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid #e5e5ea; }
th { font-size: 8pt; color: #6e6e73; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
.rom { color: #6e6e73; font-size: 9.5pt; } .en { color: #3a3a3c; font-size: 9.5pt; font-style: italic; }
.cards { display: flex; gap: 8px; } .card { flex: 1; border: 1px solid #e5e5ea; border-radius: 8px; padding: 8px 10px; }
.lead { border-color: #b9a6f0; background: #f6f3fe; }
.two { display: flex; gap: 24px; } .two > div { flex: 1; }
.cta { background: #1d1d1f; color: #fff; border-radius: 8px; padding: 10px 14px; margin-top: 16px; }
.hook { border-left: 3px solid #5b2bd9; padding: 4px 10px; margin: 6px 0; } .pick { background: #f6f3fe; }
ul { margin: 4px 0; padding-left: 18px; } li { margin: 2px 0; }
.ok { color: #1e8e3e; } .no { color: #d70015; } .check { color: #8a6100; }
.sign { margin-top: 24px; border-top: 1px solid #c7c7cc; padding-top: 8px; display: flex; gap: 40px; font-size: 9pt; color: #6e6e73; }
"""


def _e(s) -> str:
    return html.escape(str(s or ""))


def brief_html(doc: dict) -> str:
    b = doc["brief"] or {}
    m = doc["brief_meta"] or {}
    pmap = {p["id"]: p for p in doc["people"]}
    people = "".join(
        f"<div class='card{' lead' if pmap.get(x.get('id'), {}).get('lead') else ''}'><b>{_e(pmap.get(x.get('id'), {}).get('name') or x.get('id'))}</b>"
        f"{' <span class=small style=color:#5b2bd9>★ LEAD FACE</span>' if pmap.get(x.get('id'), {}).get('lead') else ''}"
        f"<div class='small muted'>{_e(pmap.get(x.get('id'), {}).get('role'))}</div><div class=small>{_e(x.get('summary'))}</div></div>"
        for x in b.get("people") or [])
    v = b.get("voice") or {}
    mix = " · ".join(f"{LANG_NAMES.get(x.get('lang'), x.get('lang'))} {x.get('pct')}%" for x in v.get("mix") or [])
    a = b.get("audience") or {}
    cta = b.get("cta") or {}
    return f"""<!doctype html><html><head><meta charset=utf-8><style>{_CSS}</style></head><body>
<div class=eyebrow>Client brief · {_e(doc.get('speciality'))} · version {_e(m.get('version') or 1)}</div>
<h1>{_e(doc['name'])}</h1><p class=lede>{_e(b.get('positioning'))}</p>
{'<h2>The people</h2><div class=cards>' + people + '</div>' if people else ''}
<div class=two><div><h2>What we're pushing</h2><ol>{''.join(f"<li>{_e(x.get('text') if isinstance(x, dict) else x)}</li>" for x in b.get('services') or [])}</ol></div>
<div><h2>Where</h2>{''.join(f"<p><b>{_e(x.get('name'))}</b><br><span class='small muted'>{_e(x.get('note'))}</span></p>" for x in b.get('branches') or [])}</div></div>
<h2>Who we're talking to</h2><p>{_e(a.get('text') if isinstance(a, dict) else a)}</p>
<h2>What they ask</h2><ul>{''.join(f"<li>“{_e(x.get('q') if isinstance(x, dict) else x)}”</li>" for x in b.get('questions') or [])}</ul>
<div class=two><div><h2>Voice</h2><p class=small>{'Warm' if (v.get('clinical') or 0) < 50 else 'Clinical'} · {'simple' if (v.get('technical') or 0) < 50 else 'technical'} · {'calm' if (v.get('energy') or 0) < 50 else 'energetic'}<br>{_e(mix)}<br>{_e(v.get('note'))}</p></div>
<div><h2>Say · never say</h2><ul>{''.join(f"<li class=ok>✓ <span style=color:#1d1d1f>{_e(x)}</span></li>" for x in b.get('say') or [])}{''.join(f"<li class=no>✕ <span style=color:#1d1d1f>{_e(x)}</span></li>" for x in b.get('never') or [])}</ul></div></div>
{'<h2>Already posted</h2><p>' + _e(b.get('posted')) + '</p>' if b.get('posted') else ''}
{''.join(f"<h2>{_e(x.get('title'))}</h2><p>{_e(x.get('body'))}</p>" for x in b.get('extra') or [])}
<div class=cta><span class=eyebrow style=color:#c4b5fd>Every reel ends with</span><br><b>{_e(cta.get('text') if isinstance(cta, dict) else cta)}</b><br><span class=small style=opacity:.7>{_e(cta.get('note') if isinstance(cta, dict) else '')}</span></div>
</body></html>"""


def script_html(doc: dict, s: dict) -> str:
    d = json.loads(s["data"] or "{}")
    person = next((p for p in doc["people"] if p["id"] == s["person_id"]), None)
    pick = d.get("hook_pick") or 0
    hooks = "".join(
        f"<div class='hook{' pick' if i == pick else ''}'><b>{'★ ' if i == pick else ''}{_e(h.get('line'))}</b>"
        f"{'<div class=rom>' + _e(h.get('romanised')) + '</div>' if h.get('romanised') else ''}"
        f"{'<div class=en>' + _e(h.get('english')) + '</div>' if h.get('english') and h.get('english') != h.get('line') else ''}</div>"
        for i, h in sorted(enumerate(d.get("hooks") or []), key=lambda x: x[0] != pick))
    beats = "".join(
        f"<tr><td class='small muted' style='white-space:nowrap'>{_e(b.get('t'))}</td><td class=small>{_e(b.get('who'))}</td>"
        f"<td>{_e(b.get('line'))}{'<div class=rom>' + _e(b.get('romanised')) + '</div>' if b.get('romanised') else ''}"
        f"{'<div class=en>' + _e(b.get('english')) + '</div>' if b.get('english') and b.get('english') != b.get('line') else ''}</td>"
        f"<td class='small muted'>{_e(b.get('visual'))}</td></tr>" for b in d.get("beats") or [])
    claims = "".join(f"<tr><td style='width:18px'>☐</td><td>{_e(c.get('claim'))}<div class='small muted'>{_e(c.get('check'))}</div></td></tr>" for c in d.get("claims") or [])
    comp = "".join(f"<li class={'ok' if c.get('ok') else 'check'}>{'✓' if c.get('ok') else '!'} <span style=color:#1d1d1f>{_e(c.get('note'))}</span></li>" for c in d.get("compliance") or [])
    lang = LANG_NAMES.get(s["language"], s["language"] or "")
    return f"""<!doctype html><html><head><meta charset=utf-8><style>{_CSS}</style></head><body>
<div class=eyebrow>Reel script for review · {_e(doc['name'])}</div>
<h1>{_e(d.get('title') or s.get('title'))}</h1>
<p class=muted>{_e(lang)} · about {_e(d.get('duration_s'))}s · {_e(person['name'] if person else '')}{' · on camera: ' + _e(', '.join(d.get('on_camera') or [])) if d.get('on_camera') else ''}</p>
<p>{_e(d.get('topic'))}</p>
<h2>Hook · chosen first, then the alternatives</h2>{hooks}
<h2>Script</h2><table><tr><th>Time</th><th>Who</th><th>Line</th><th>On screen</th></tr>{beats}</table>
<h2>Claims for the doctor to confirm</h2><table>{claims}</table>
{'<h2>Advertising check</h2><ul>' + comp + '</ul>' if comp else ''}
<h2>Caption</h2><p style='white-space:pre-wrap'>{_e(d.get('caption'))}</p><p class='small muted'>{_e(' '.join(d.get('hashtags') or []))}</p>
<div class=cta><span class=eyebrow style=color:#c4b5fd>Ends with</span><br><b>{_e(d.get('cta'))}</b></div>
<div class=sign><span>Reviewed by ____________________</span><span>Date __________</span><span>☐ Approved ☐ Changes needed</span></div>
</body></html>"""


def _safe_name(s: str) -> str:
    s = re.sub(r'[/\\:*?"<>|\x00-\x1f]+', " ", s or "")
    return re.sub(r"\s+", " ", s).strip(" .")[:80] or "Reely"


def save_pdf(html_text: str, name: str) -> dict:
    """Render to ~/Downloads/<name>.pdf with the scraping browser; without it, save the HTML and open it to print."""
    dl = Path.home() / "Downloads"
    dl.mkdir(exist_ok=True)
    base = _safe_name(name)
    try:
        from playwright.sync_api import sync_playwright
        out = dl / f"{base}.pdf"
        i = 2
        while out.exists():
            out = dl / f"{base} {i}.pdf"; i += 1
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True)
            pg = b.new_page()
            pg.set_content(html_text, wait_until="load")
            pg.pdf(path=str(out), format="A4", print_background=True, margin={"top": "16mm", "bottom": "16mm", "left": "15mm", "right": "15mm"})
            b.close()
        subprocess.Popen(["open", "-R", str(out)])
        return {"path": str(out), "pdf": True}
    except Exception as e:
        out = dl / f"{base}.html"
        out.write_text(html_text)
        subprocess.Popen(["open", str(out)])
        return {"path": str(out), "pdf": False, "note": f"Saved as a web page; print it to PDF from the browser ({str(e)[:80]})"}


# ---------- API ----------
class NewClient(BaseModel):
    name: str
    speciality: str | None = None
    city: str | None = None
    languages: list[str] = []


class ClientDoc(BaseModel):
    name: str | None = None
    speciality: str | None = None
    city: str | None = None
    languages: list[str] | None = None
    color: str | None = None
    people: list[dict] | None = None
    branches: list[dict] | None = None
    sources: list[dict] | None = None


COLORS = ["#F59E0B", "#0284C7", "#7C3AED", "#16A34A", "#DB2777", "#0D9488", "#EA580C", "#4F46E5"]


def _summary(r: dict) -> dict:
    d = json.loads(r["data"] or "{}")
    lead = next((p for p in d.get("people") or [] if p.get("lead")), None)
    counts = db.one("SELECT (SELECT COUNT(*) FROM client_refs WHERE client_id=?) refs, "
                    "(SELECT COUNT(*) FROM scripts WHERE client_id=? AND status!='failed') scripts, "
                    "(SELECT COUNT(*) FROM scripts WHERE client_id=? AND status IN ('generating','queued')) writing, "
                    "(SELECT COUNT(*) FROM scripts WHERE client_id=? AND status='review') review", (r["id"],) * 4)
    meta = json.loads(r["brief_meta"] or "{}")
    return {"id": r["id"], "name": r["name"], "speciality": d.get("speciality"), "city": d.get("city"),
            "languages": d.get("languages") or [], "color": d.get("color"), "lead": lead["name"] if lead else None,
            "people": len(d.get("people") or []), "branches": len(d.get("branches") or []),
            "has_brief": bool(r["brief"]), "brief_locked": bool(meta.get("locked")), "updated_at": r["updated_at"], **counts}


@router.get("/api/clients")
def list_clients():
    init()
    return [_summary(r) for r in db.rows("SELECT * FROM clients ORDER BY updated_at DESC")]


@router.post("/api/clients")
def create_client(body: NewClient):
    init()
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Give the client a name")
    n = db.one("SELECT COUNT(*) n FROM clients")["n"]
    data = {"speciality": body.speciality, "city": body.city, "languages": body.languages, "color": COLORS[n % len(COLORS)],
            "people": [], "branches": [], "sources": []}
    with db.tx() as c:
        cur = c.execute("INSERT INTO clients(name, data) VALUES(?,?)", (name, json.dumps(data)))
        cid = cur.lastrowid
    folder(cid)
    return _load(cid)


@router.get("/api/clients/{cid}")
def get_client(cid: int):
    d = _load(cid)
    with _jlock:
        d["job"] = dict(_jobs.get(cid) or {}) or None
    return d


@router.patch("/api/clients/{cid}")
def edit_client(cid: int, body: ClientDoc):
    doc = _load(cid)
    patch = body.model_dump(exclude_none=True)
    if "name" in patch and not patch["name"].strip():
        raise HTTPException(400, "The name can't be empty")
    for k in ("people", "branches", "sources"):
        for it in patch.get(k) or []:
            it.setdefault("id", _new_id(k[0]))
    if "people" in patch:
        leads = [p for p in patch["people"] if p.get("lead")]
        if len(leads) > 1:
            for p in leads[1:]: p["lead"] = False
    if "sources" in patch:
        # a changed link has to be read again
        old = {s["id"]: s for s in doc["sources"]}
        for s in patch["sources"]:
            o = old.get(s["id"])
            if o and (o.get("value") or "") != (s.get("value") or "") and s.get("kind") != "file":
                s.pop("read_at", None); s.pop("status", None); s.pop("detail", None)
                (folder(cid) / "read" / f"{s['id']}.txt").unlink(missing_ok=True)
        gone = set(old) - {s["id"] for s in patch["sources"]}
        for sid in gone:
            o = old[sid]
            (folder(cid) / "read" / f"{sid}.txt").unlink(missing_ok=True)
            if o.get("kind") == "file" and o.get("value"):
                (folder(cid) / "files" / o["value"]).unlink(missing_ok=True)
    doc.update(patch)
    _save(cid, doc)
    return get_client(cid)


@router.delete("/api/clients/{cid}")
def delete_client(cid: int):
    _load(cid)
    with db.tx() as c:
        c.execute("DELETE FROM clients WHERE id=?", (cid,))
        c.execute("DELETE FROM client_refs WHERE client_id=?", (cid,))
        c.execute("DELETE FROM scripts WHERE client_id=?", (cid,))
        c.execute("DELETE FROM plans WHERE client_id=?", (cid,))
    shutil.rmtree(ROOT / str(cid), ignore_errors=True)
    return {"ok": True}


class FilesBody(BaseModel):
    paths: list[str]
    person_id: str | None = None
    branch_id: str | None = None


@router.post("/api/clients/{cid}/files")
def add_files(cid: int, body: FilesBody):
    doc = _load(cid)
    dest = folder(cid) / "files"
    added = []
    for p in body.paths:
        src = Path(p).expanduser()
        if not src.is_file():
            continue
        name, i = src.name, 2
        while (dest / name).exists():
            name = f"{src.stem} {i}{src.suffix}"; i += 1
        shutil.copy2(src, dest / name)
        s = {"id": _new_id("s"), "kind": "file", "label": src.stem, "value": name, "size": (dest / name).stat().st_size,
             "person_id": body.person_id, "branch_id": body.branch_id, "status": "ok", "detail": src.suffix.lstrip('.').upper()}
        doc["sources"].append(s); added.append(s)
    if not added:
        raise HTTPException(400, "None of those files could be found")
    _save(cid, doc)
    return get_client(cid)


class ReadBody(BaseModel):
    source_id: str | None = None


@router.post("/api/clients/{cid}/read")
def read_now(cid: int, body: ReadBody):
    _load(cid)
    if _busy(cid):
        raise HTTPException(409, "Reely is already working on this client")

    def go():
        _job(cid, kind="read", status="running", note="Reading…", error=None)
        try:
            read_sources(cid, only=body.source_id, force=True)
            _job(cid, status="done", note="")
        except Exception as e:
            _job(cid, status="failed", error=str(e)[:300])
    threading.Thread(target=go, daemon=True).start()
    return {"ok": True}


@router.post("/api/clients/{cid}/brief/draft")
def brief_draft(cid: int):
    doc = _load(cid)
    if (doc["brief_meta"] or {}).get("locked"):
        raise HTTPException(409, "The brief is locked. Unlock it to redraft.")
    if _busy(cid):
        raise HTTPException(409, "Reely is already working on this client")
    if not doc["sources"] and not doc["people"]:
        raise HTTPException(400, "Add a website, a person, a file or a note first so Claude has something to read.")
    _job(cid, kind="brief", status="running", note="Starting…", error=None)
    threading.Thread(target=draft_brief, args=(cid,), daemon=True).start()
    return {"ok": True}


class RedraftBody(BaseModel):
    section: str
    ask: str = ""


@router.post("/api/clients/{cid}/brief/redraft")
def brief_redraft(cid: int, body: RedraftBody):
    doc = _load(cid)
    if body.section not in SECTIONS:
        raise HTTPException(400, "Unknown section")
    if (doc["brief_meta"] or {}).get("locked"):
        raise HTTPException(409, "The brief is locked. Unlock it to redraft.")
    if _busy(cid):
        raise HTTPException(409, "Reely is already working on this client")
    _job(cid, kind="section", section=body.section, status="running", note="Starting…", error=None)
    threading.Thread(target=redraft_section, args=(cid, body.section, body.ask), daemon=True).start()
    return {"ok": True}


class BriefBody(BaseModel):
    brief: dict | None = None
    section: str | None = None      # the section the user just edited, for the "edited by you" marks
    locked: bool | None = None


@router.put("/api/clients/{cid}/brief")
def brief_save(cid: int, body: BriefBody):
    doc = _load(cid)
    meta = doc["brief_meta"] or {}
    brief = doc["brief"]
    if body.locked is not None:
        meta["locked"] = body.locked
        meta.setdefault("history", []).insert(0, {"at": _now(), "what": "You locked the brief" if body.locked else "You unlocked the brief"})
    if body.brief is not None:
        if meta.get("locked"):
            raise HTTPException(409, "The brief is locked. Unlock it to edit.")
        brief = body.brief
        if body.section:
            meta["edited"] = sorted(set(meta.get("edited", [])) | {body.section})
            meta.setdefault("history", []).insert(0, {"at": _now(), "what": f"You edited {SECTION_TITLES.get(body.section, body.section)}"})
        meta.setdefault("version", 1)
    meta["history"] = (meta.get("history") or [])[:40]
    _save_brief(cid, brief, meta)
    return get_client(cid)


@router.post("/api/clients/{cid}/brief/pdf")
def brief_pdf(cid: int):
    doc = _load(cid)
    if not doc["brief"]:
        raise HTTPException(400, "Draft the brief first")
    return save_pdf(brief_html(doc), f"{doc['name']} brief")


# references
class CodesBody(BaseModel):
    codes: list[str]


@router.get("/api/clients/{cid}/refs")
def refs(cid: int):
    _load(cid)
    rows = db.rows("SELECT cr.shortcode, cr.clinic AS ref_clinic, cr.note, cr.added, r.*, c.speciality FROM client_refs cr "
                   "LEFT JOIN reels r ON r.shortcode=cr.shortcode LEFT JOIN clinics c ON c.handle=r.clinic "
                   "WHERE cr.client_id=? ORDER BY cr.added DESC", (cid,))
    counts = {r["shortcode"]: r["n"] for r in db.rows("SELECT shortcode, COUNT(*) n FROM scripts WHERE client_id=? AND status!='failed' GROUP BY shortcode", (cid,))}
    for r in rows:
        r["shortcode"] = r.get("shortcode") or r.get("ref_clinic")
        r["clinic"] = r.get("clinic") or r.get("ref_clinic")
        r["scripts"] = counts.get(r["shortcode"], 0)
    return rows


@router.post("/api/clients/{cid}/refs")
def refs_add(cid: int, body: CodesBody):
    _load(cid)
    added = []
    with db.tx() as c:
        for code in [x for x in body.codes if x]:
            r = c.execute("SELECT clinic FROM reels WHERE shortcode=?", (code,)).fetchone()
            cur = c.execute("INSERT OR IGNORE INTO client_refs(client_id, shortcode, clinic) VALUES(?,?,?)", (cid, code, r[0] if r else None))
            if cur.rowcount:
                added.append(code)
        c.execute("UPDATE clients SET updated_at=datetime('now') WHERE id=?", (cid,))
    return {"added": added}


@router.post("/api/clients/{cid}/refs/remove")
def refs_remove(cid: int, body: CodesBody):
    with db.tx() as c:
        for code in body.codes:
            c.execute("DELETE FROM client_refs WHERE client_id=? AND shortcode=?", (cid, code))
    return {"ok": True}


@router.post("/api/send-to/check")
def send_check(body: CodesBody):
    """For the Send to menu: how many of these reels each client already has."""
    init()
    if not body.codes:
        return {}
    marks = ",".join("?" * len(body.codes))
    return {str(r["client_id"]): r["n"] for r in db.rows(
        f"SELECT client_id, COUNT(*) n FROM client_refs WHERE shortcode IN ({marks}) GROUP BY client_id", body.codes)}


# scripts
class NewScript(BaseModel):
    topic: str = ""
    shortcode: str | None = None
    person_id: str | None = None
    language: str = "en"
    closeness: str = "structure"
    cast: str = ""
    note: str = ""


def _script_row(s: dict) -> dict:
    d = json.loads(s["data"]) if s.get("data") else None
    return {**{k: v for k, v in s.items() if k not in ("data", "options")}, "data": d, "options": json.loads(s.get("options") or "{}")}


@router.get("/api/clients/{cid}/scripts")
def scripts(cid: int):
    _load(cid)
    out = []
    for s in db.rows("SELECT s.*, r.hook_en ref_hook, r.clinic ref_clinic, r.like_rate ref_like_rate FROM scripts s "
                     "LEFT JOIN reels r ON r.shortcode=s.shortcode WHERE s.client_id=? ORDER BY s.created_at DESC, s.id DESC", (cid,)):
        row = _script_row(s)
        d = row.pop("data") or {}
        hooks = d.get("hooks") or []
        h = hooks[d.get("hook_pick") or 0] if hooks else {}
        row.update(hook=h.get("english") or h.get("line"), duration_s=d.get("duration_s"), pattern=d.get("pattern") or (row["options"].get("pattern") or {}).get("name"))
        out.append(row)
    return out


@router.post("/api/clients/{cid}/scripts")
def script_new(cid: int, body: NewScript):
    doc = _load(cid)
    if not doc["brief"]:
        raise HTTPException(400, "Draft this client's brief first; every script is written from it.")
    opts = {"closeness": body.closeness, "cast": body.cast, "note": body.note, "topic": body.topic}
    person = body.person_id or next((p["id"] for p in doc["people"] if p.get("lead")), None)
    with db.tx() as c:
        cur = c.execute("INSERT INTO scripts(client_id, shortcode, person_id, language, options, title, status) VALUES(?,?,?,?,?,?,'queued')",
                        (cid, body.shortcode, person, body.language, json.dumps(opts), body.topic[:80] or "Writing…"))
        sid = cur.lastrowid
        c.execute("UPDATE clients SET updated_at=datetime('now') WHERE id=?", (cid,))
    enqueue(sid)
    return {"id": sid}


@router.get("/api/scripts/{sid}")
def script_get(sid: int):
    init()
    s = db.one("SELECT * FROM scripts WHERE id=?", (sid,))
    if not s:
        raise HTTPException(404)
    return _script_row(s)


class ScriptEdit(BaseModel):
    data: dict | None = None
    status: str | None = None
    title: str | None = None


@router.patch("/api/scripts/{sid}")
def script_edit(sid: int, body: ScriptEdit):
    s = script_get(sid)
    if body.status and body.status not in ("draft", "review", "approved"):
        raise HTTPException(400, "Unknown status")
    data = body.data if body.data is not None else s["data"]
    title = body.title or (data or {}).get("title") or s["title"]
    with db.tx() as c:
        c.execute("UPDATE scripts SET data=?, status=?, title=?, updated_at=datetime('now') WHERE id=?",
                  (json.dumps(data, ensure_ascii=False) if data is not None else None, body.status or s["status"], title, sid))
    return script_get(sid)


@router.post("/api/scripts/{sid}/retry")
def script_retry(sid: int):
    s = script_get(sid)
    if s["status"] in ("generating", "queued"):
        raise HTTPException(409, "Still writing")
    with db.tx() as c:
        c.execute("UPDATE scripts SET status='queued', error=NULL WHERE id=?", (sid,))
    enqueue(sid)
    return {"ok": True}


@router.delete("/api/scripts/{sid}")
def script_delete(sid: int):
    with db.tx() as c:
        c.execute("DELETE FROM scripts WHERE id=?", (sid,))
    return {"ok": True}


@router.post("/api/scripts/{sid}/pdf")
def script_pdf(sid: int):
    s = db.one("SELECT * FROM scripts WHERE id=?", (sid,))
    if not s or not s["data"]:
        raise HTTPException(400, "This script isn't ready yet")
    doc = _load(s["client_id"])
    return save_pdf(script_html(doc, s), f"{doc['name']} - {s['title'] or 'script'}")
