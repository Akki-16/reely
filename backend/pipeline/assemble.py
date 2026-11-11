"""Merge index + yt-dlp metadata + transcripts (+ annotations) into the per-clinic sheets."""
import csv
import datetime
import json
import statistics
from pathlib import Path

from .index import load_index
from .views_fmt import file_stem, info_path, transcript_path, video_path

SHEET_COLS = ["rank", "file_name", "shortcode", "url", "views", "likes", "like_rate_pct", "outlier_x_median", "video_file",
              "date", "duration_s", "language", "hook_en", "hook_type", "format", "cta", "flag", "script_summary",
              "hook_spoken_original", "caption_title", "caption", "transcript_original", "transcript_en"]


def _translated(t: dict, target: str) -> str:
    """Text in the chosen target language, whichever path produced it."""
    if not t:
        return ""
    if t.get("language") == target:
        return t.get("text", "")
    if target == "en":
        return t.get("text_en", "") or ""
    return t.get("text_tr", "") if t.get("tr_lang") == target else ""


def assemble(clinic_dir: Path, top_n: int, translate_to: str | None = None) -> list[dict]:
    if translate_to is None:
        try:
            import db
            translate_to = db.get_settings().get("translate_to", "en")
        except Exception:
            translate_to = "en"
    idx = load_index(clinic_dir)[:top_n]
    ann_path = clinic_dir / "annotations.json"
    ann = json.loads(ann_path.read_text()) if ann_path.exists() else {}
    rows = []
    for rank, r in enumerate(idx, 1):
        c = r["shortcode"]
        ip, tp, vp = info_path(clinic_dir, c), transcript_path(clinic_dir, c), video_path(clinic_dir, c)
        i = json.load(open(ip)) if ip else {}
        t = json.load(open(tp)) if tp else {}
        segs = t.get("segments", [])
        hook = " ".join(s["text"] for s in segs if s["start"] < 5) or (segs[0]["text"] if segs else "")
        caption = (i.get("description") or "").strip()
        views = r["views"] or 0
        likes = i.get("like_count") or 0
        a = ann.get(c, {})
        rows.append({
            "rank": rank, "file_name": file_stem(r["views"], c), "shortcode": c, "url": r["url"],
            "views": views, "likes": likes, "like_rate_pct": round(100 * likes / views, 3) if views else None,
            "outlier_x_median": r.get("outlier_x_median"), "video_file": vp.name if vp else "",
            "date": datetime.datetime.fromtimestamp(i["timestamp"]).strftime("%Y-%m-%d") if i.get("timestamp") else "",
            "duration_s": t.get("duration"), "language": t.get("language"),
            "hook_en": a.get("hook_en", ""), "hook_type": a.get("hook_type", ""), "format": a.get("format", ""),
            "cta": a.get("cta", ""), "flag": a.get("flag", "" if not tp else "unannotated"), "script_summary": a.get("summary", ""),
            "hook_spoken_original": hook, "caption_title": caption.split("\n")[0][:150], "caption": caption,
            "transcript_original": t.get("text", ""), "transcript_en": _translated(t, translate_to),
        })
    with open(clinic_dir / "top_reels_data.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=SHEET_COLS); w.writeheader(); w.writerows(rows)
    if ann:
        with open(clinic_dir / f"{clinic_dir.name}_top_annotated.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=SHEET_COLS); w.writeheader(); w.writerows(rows)
    return rows


def stats(rows: list[dict]) -> dict:
    lr = [r["like_rate_pct"] for r in rows if r.get("like_rate_pct") is not None]
    by: dict = {}
    for r in rows:
        if r.get("like_rate_pct") is not None:
            by.setdefault((r.get("flag") or "unannotated").split(";")[0], []).append(r["like_rate_pct"])
    fmt: dict = {}
    for r in rows:
        if r.get("format"):
            fmt[r["format"]] = fmt.get(r["format"], 0) + 1
    ht: dict = {}
    for r in rows:
        if r.get("hook_type"):
            ht[r["hook_type"]] = ht.get(r["hook_type"], 0) + 1
    return {
        "median_like_rate": round(statistics.median(lr), 3) if lr else None,
        "like_rate_by_flag": {k: round(statistics.median(v), 3) for k, v in by.items()},
        "formats": dict(sorted(fmt.items(), key=lambda kv: -kv[1])),
        "hook_types": dict(sorted(ht.items(), key=lambda kv: -kv[1])),
        "top_like_rate": sorted([r for r in rows if r.get("like_rate_pct")], key=lambda r: -r["like_rate_pct"])[:12],
    }
