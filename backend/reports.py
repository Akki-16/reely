"""Speciality reports: one Claude-written comparison across the clinics of a speciality, on demand only.
Saved as <data root>/_reports/<slug>.md."""
import json
import re
import threading
import time
from datetime import datetime

import claude_cli
import db
from config import DATA_ROOT

_DIR = DATA_ROOT / "_reports"
jobs: dict = {}


def slug(spec: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (spec or "all").lower()).strip("-") or "all"


def _clinics(spec: str | None) -> list[dict]:
    q = "SELECT handle, speciality, reels_total, analysed, median_like_rate FROM clinics WHERE analysed>0"
    rows = db.rows(q + (" AND speciality=?" if spec else "") + " ORDER BY handle", (spec,) if spec else ())
    return [r for r in rows if (DATA_ROOT / r["handle"]).is_dir()]


def get(spec: str | None) -> dict:
    p = _DIR / f"{slug(spec)}.md"
    meta_p = _DIR / f"{slug(spec)}.json"
    meta = json.loads(meta_p.read_text()) if meta_p.exists() else {}
    j = jobs.get(slug(spec))
    return {"markdown": p.read_text() if p.exists() else None, "generated": meta.get("generated"), "clinics": meta.get("clinics", []),
            "available": [c["handle"] for c in _clinics(spec)],
            "job": {**j, "elapsed": round(time.time() - j["started"])} if j else None}


def generate(spec: str | None) -> dict:
    key = slug(spec)
    if jobs.get(key, {}).get("status") == "running":
        return jobs[key]
    cl = _clinics(spec)
    if len(cl) < 1:
        raise ValueError("no analysed clinics" + (f" in {spec}" if spec else ""))
    jobs[key] = {"status": "running", "started": time.time(), "error": None}

    def work():
        try:
            from pipeline.assemble import stats
            facts = []
            for c in cl:
                rs = db.rows("SELECT * FROM reels WHERE clinic=?", (c["handle"],))
                st = stats([{**r, "like_rate_pct": r["like_rate"], "script_summary": r["summary"]} for r in rs])
                facts.append({"handle": c["handle"], "reels_scraped": c["reels_total"], "analysed": c["analysed"],
                              "median_like_rate_pct": st["median_like_rate"], "like_rate_by_flag": st["like_rate_by_flag"],
                              "top_formats": dict(list(st["formats"].items())[:8]), "top_hook_types": dict(list(st["hook_types"].items())[:8]),
                              "best_reels": [{k: r.get(k) for k in ("shortcode", "like_rate_pct", "views", "hook_en", "format", "hook_type")}
                                             for r in st["top_like_rate"][:5]]})
            name = spec or "all specialities"
            prompt = (
                f"Write a comparison report in Markdown across these Instagram accounts of {name} clinics: "
                f"{', '.join('@' + c['handle'] for c in cl)}. Each sub-folder here holds one clinic's top_reels_data.csv and INSIGHTS.md; "
                f"read them as needed. Summary numbers per clinic:\n\n{json.dumps(facts, ensure_ascii=False)}\n\n"
                "Sections, concise and concrete:\n"
                "1. Headline: what separates the accounts whose reels earn engagement (like-rate) from those whose views are bought.\n"
                "2. Table: clinic, reels analysed, median like-rate, dominant format, best hook type.\n"
                "3. Formats and hook types that work across the speciality, with the best example reel for each (quote the hook in English).\n"
                "4. What each clinic does that the others do not.\n"
                "5. Ten hooks worth adapting for a small clinic in this speciality, each with the source reel.\n"
                "6. What to avoid.\n"
                "Use like-rate (likes ÷ views), not views, to judge creative. Output only the Markdown.")
            res = claude_cli.run(prompt, cwd=DATA_ROOT, json_out=True, timeout_s=900)
            md = res["text"].strip()
            if md.startswith("```"):
                md = re.sub(r"^```\w*\n|\n```$", "", md)
            _DIR.mkdir(exist_ok=True)
            (_DIR / f"{key}.md").write_text(md)
            (_DIR / f"{key}.json").write_text(json.dumps({"generated": datetime.now().isoformat(timespec="seconds"),
                                                          "clinics": [c["handle"] for c in cl], "speciality": spec}))
            jobs[key].update({"status": "done"})
        except Exception as e:
            jobs[key].update({"status": "error", "error": str(e).splitlines()[0][:300] if str(e) else type(e).__name__})
    threading.Thread(target=work, daemon=True).start()
    return jobs[key]
