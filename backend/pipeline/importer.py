"""Import a clinic folder (as produced by the pipeline or the manual runs) into the DB."""
import json
import statistics
from pathlib import Path

import db
from config import KNOWN_SPECIALITIES
from .assemble import assemble, stats
from .index import load_index


def read_meta(clinic_dir: Path) -> dict:
    """clinic.json keeps user-set fields (speciality) with the folder, so a rebuilt DB gets them back."""
    p = clinic_dir / "clinic.json"
    try:
        return json.loads(p.read_text()) if p.exists() else {}
    except Exception:
        return {}


def write_meta(clinic_dir: Path, **kv):
    clinic_dir.mkdir(parents=True, exist_ok=True)
    meta = read_meta(clinic_dir); meta.update({k: v for k, v in kv.items() if v is not None})
    (clinic_dir / "clinic.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    return meta


def import_clinic(clinic_dir: Path, top_n: int | None = None, status: str = "done") -> dict:
    handle = clinic_dir.name
    idx = load_index(clinic_dir)
    if not idx:
        return {"handle": handle, "reels": 0}
    # depth: explicit, else what this clinic was last processed to (clinic.json), else the global default
    n = top_n or int(read_meta(clinic_dir).get("top_n") or 0) or int(db.get_settings().get("top_n", 100))
    rows = assemble(clinic_dir, n)
    st = stats(rows)
    vals = [r["views"] for r in idx if r["views"]]
    with db.tx() as c:
        c.execute("DELETE FROM reels WHERE clinic=?", (handle,))
        for r in rows:
            c.execute("""INSERT INTO reels(shortcode,clinic,rank,file_name,url,views,likes,like_rate,outlier,date,duration,language,
                hook_en,hook_type,format,cta,flag,summary,hook_original,caption,transcript,transcript_en,video_file)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                      (r["shortcode"], handle, r["rank"], r["file_name"], r["url"], r["views"], r["likes"], r["like_rate_pct"],
                       r["outlier_x_median"], r["date"], r["duration_s"], r["language"], r["hook_en"], r["hook_type"], r["format"],
                       r["cta"], r["flag"], r["script_summary"], r["hook_spoken_original"], r["caption"], r["transcript_original"],
                       r["transcript_en"], r["video_file"]))
    # analysed: reels with any of video, transcript or annotation (an import can bring the analysis without the videos)
    analysed = sum(1 for r in rows if r["video_file"] or r["transcript_original"] or r["hook_type"])
    # display name: only from a reel this account itself uploaded (collab reels carry the partner's name)
    info = {}
    from .views_fmt import info_path
    for r in rows[:20]:
        ip = info_path(clinic_dir, r["shortcode"])
        if ip:
            i = json.load(open(ip))
            if (i.get("uploader_id") or i.get("channel") or "").lower() == handle.lower():
                info = i; break
    meta = read_meta(clinic_dir)
    prev = db.one("SELECT speciality FROM clinics WHERE handle=?", (handle,)) or {}
    db.upsert("clinics", {
        "handle": handle, "display_name": info.get("uploader") or handle, "followers": None,
        "speciality": meta.get("speciality") or prev.get("speciality") or KNOWN_SPECIALITIES.get(handle),
        "reels_total": len(idx), "analysed": analysed,
        "median_views": statistics.median(vals) if vals else None, "top_views": max(vals) if vals else None,
        "median_like_rate": st["median_like_rate"], "status": status,
        "last_run": db.one("SELECT last_run FROM clinics WHERE handle=?", (handle,)) and
                    db.one("SELECT last_run FROM clinics WHERE handle=?", (handle,))["last_run"],
    }, "handle")
    return {"handle": handle, "reels": len(idx), "analysed": analysed, "stats": st}
