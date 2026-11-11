"""Per-clinic record of reels a stage could not process, kept in <clinic>/failures.json so it survives restarts.

{"<shortcode>": {"stage": "download"|"transcribe", "error": "...", "at": "...", "tries": 2, "ignored": false}}
"""
import json
import threading
from datetime import datetime
from pathlib import Path

_lock = threading.Lock()


def _p(d: Path) -> Path:
    return d / "failures.json"


def load(d: Path) -> dict:
    try:
        return json.loads(_p(d).read_text()) if _p(d).exists() else {}
    except Exception:
        return {}


def _save(d: Path, data: dict):
    if data:
        _p(d).write_text(json.dumps(data, ensure_ascii=False, indent=1))
    elif _p(d).exists():
        _p(d).unlink()


def record(d: Path, code: str, stage: str, error: str):
    with _lock:
        data = load(d)
        prev = data.get(code, {})
        data[code] = {"stage": stage, "error": " ".join(str(error).split())[:300], "at": datetime.now().isoformat(timespec="seconds"),
                      "tries": int(prev.get("tries", 0)) + 1, "ignored": bool(prev.get("ignored"))}
        _save(d, data)


def clear(d: Path, code: str, stage: str | None = None):
    with _lock:
        data = load(d)
        if code in data and (stage is None or data[code].get("stage") == stage):
            data.pop(code); _save(d, data)


def ignore(d: Path, codes: list[str], value: bool = True):
    with _lock:
        data = load(d)
        for c in codes:
            if c in data:
                data[c]["ignored"] = value
        _save(d, data)


def ignored(d: Path) -> set[str]:
    return {c for c, v in load(d).items() if v.get("ignored")}


def explain(error: str) -> str:
    """A plain reason for the common yt-dlp / Whisper failures."""
    e = error.lower()
    if "rate" in e and "limit" in e or "429" in e or "please wait a few minutes" in e:
        return "Instagram rate limit"
    if "login" in e or "cookies" in e:
        return "Instagram asked for a login"
    if "not available" in e or "removed" in e or "404" in e or "private" in e:
        return "Reel removed or private"
    if "timed out" in e or "timeout" in e or "connection" in e or "network" in e:
        return "Network problem"
    if "no mp4" in e:
        return "Download produced no video"
    if "audio" in e or "decode" in e or "invalid data" in e:
        return "Audio could not be read"
    return "Other error"
