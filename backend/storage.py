"""Disk use per clinic and clean-up. Clearing videos keeps everything learned from them (info.json metadata,
transcripts, annotations); a single video can be fetched again from the reel card."""
from pathlib import Path

import db
from config import DATA_ROOT
from pipeline import annotate as _ann  # noqa: F401  (keeps PyInstaller aware of the package)
from pipeline.views_fmt import shortcode_from_stem, transcript_path

_TEMP = ("*.part", "*.ytdl", "*.temp.*", "*.wav", "*.part-Frag*")


def _sz(fs) -> int:
    return sum(f.stat().st_size for f in fs if f.exists())


def _annotated(d: Path) -> set[str]:
    import json
    p = d / "annotations.json"
    try:
        return {k for k, v in json.loads(p.read_text()).items() if v.get("hook_type") or v.get("summary")} if p.exists() else set()
    except Exception:
        return set()


def usage(handle: str) -> dict:
    d = DATA_ROOT / handle
    vd = d / "videos"
    mp4 = sorted(vd.glob("*.mp4")) if vd.is_dir() else []
    ann = _annotated(d)
    processed = [f for f in mp4 if transcript_path(d, shortcode_from_stem(f.stem)) and shortcode_from_stem(f.stem) in ann]
    temp = [f for pat in _TEMP for f in vd.glob(pat)] if vd.is_dir() else []
    tr = sorted((d / "transcripts").glob("*.json")) if (d / "transcripts").is_dir() else []
    return {"handle": handle, "videos_bytes": _sz(mp4), "videos_n": len(mp4),
            "processed_bytes": _sz(processed), "processed_n": len(processed),
            "transcripts_bytes": _sz(tr), "temp_bytes": _sz(temp), "temp_n": len(temp)}


def clear_videos(handle: str, only_processed: bool = True) -> dict:
    d = DATA_ROOT / handle
    vd = d / "videos"
    if not vd.is_dir():
        return {"removed": 0, "bytes": 0}
    ann = _annotated(d)
    removed = freed = 0
    for f in vd.glob("*.mp4"):
        code = shortcode_from_stem(f.stem)
        if only_processed and not (transcript_path(d, code) and code in ann):
            continue
        freed += f.stat().st_size; f.unlink(); removed += 1
        with db.tx() as c:
            c.execute("UPDATE reels SET video_file='' WHERE shortcode=?", (code,))
    return {"removed": removed, "bytes": freed}


def clear_temp(handle: str) -> dict:
    vd = DATA_ROOT / handle / "videos"
    fs = [f for pat in _TEMP for f in vd.glob(pat)] if vd.is_dir() else []
    freed = _sz(fs)
    for f in fs:
        f.unlink()
    return {"removed": len(fs), "bytes": freed}
