"""Turn a scraped {shortcode: views_text} map into reels_index.csv/json + summary.json."""
import csv
import json
import re
import statistics
from pathlib import Path

from .views_fmt import file_stem


def parse_views(t: str):
    t = (t or "").strip().replace(",", "")
    m = re.match(r"^([\d.]+)([kKmM]?)$", t)
    if not m:
        return None
    n = float(m.group(1)); s = m.group(2).lower()
    return int(round(n * (1000 if s == "k" else 1e6 if s == "m" else 1)))


def build_index(clinic_dir: Path, reels: dict[str, str]) -> dict:
    clinic_dir.mkdir(parents=True, exist_ok=True)
    # keep the raw dump in the same format the manual pipeline used
    (clinic_dir / "reels_raw.txt").write_text(
        "\n".join(f"{' '.join(re.findall('.{1,4}', c))}|{t}" for c, t in reels.items()) + "\n")
    rows = []
    for i, (code, t) in enumerate(reels.items()):
        v = parse_views(t)
        rows.append({"rank_on_page": i + 1, "file_name": file_stem(v, code), "shortcode": code,
                     "url": f"https://www.instagram.com/reel/{code}/", "views_text": t, "views": v})
    vals = sorted(r["views"] for r in rows if r["views"] is not None)
    med = statistics.median(vals) if vals else 0
    for r in rows:
        r["outlier_x_median"] = round(r["views"] / med, 2) if (r["views"] and med) else None
    rows.sort(key=lambda r: -(r["views"] or 0))
    with open(clinic_dir / "reels_index.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    (clinic_dir / "reels_index.json").write_text(json.dumps(rows, indent=1))
    summary = {"handle": clinic_dir.name, "reels": len(rows), "with_views": len(vals),
               "median_views": med, "mean_views": round(statistics.mean(vals)) if vals else 0,
               "max_views": vals[-1] if vals else 0, "min_views": vals[0] if vals else 0,
               "gte_100k": sum(v >= 1e5 for v in vals), "gte_1m": sum(v >= 1e6 for v in vals),
               "gte_2x_median": sum(v >= 2 * med for v in vals) if med else 0}
    (clinic_dir / "summary.json").write_text(json.dumps(summary, indent=1))
    return summary


def load_index(clinic_dir: Path) -> list[dict]:
    p = clinic_dir / "reels_index.csv"
    if not p.exists():
        return []
    out = []
    for r in csv.DictReader(open(p)):
        r["views"] = int(r["views"]) if r.get("views") else None
        out.append(r)
    return out
