"""Hook library: the swipe file of reels the user saved. Kept as <data root>/library.json so it travels with the data
and survives a rebuilt index. {"<shortcode>": {"clinic": "...", "added": "...", "note": ""}}"""
import json
import threading
from datetime import datetime

from config import DATA_ROOT

_P = DATA_ROOT / "library.json"
_lock = threading.Lock()


def load() -> dict:
    try:
        return json.loads(_P.read_text()) if _P.exists() else {}
    except Exception:
        return {}


def _save(d: dict):
    _P.write_text(json.dumps(d, ensure_ascii=False, indent=1))


def add(items: list[dict]) -> list[str]:
    """items: [{shortcode, clinic}]. Returns the codes that were newly added (so the UI can undo exactly those)."""
    with _lock:
        d = load(); new = []
        for it in items:
            c = it.get("shortcode")
            if c and c not in d:
                d[c] = {"clinic": it.get("clinic"), "added": datetime.now().isoformat(timespec="seconds"), "note": ""}
                new.append(c)
        _save(d)
        return new


def remove(codes: list[str]) -> int:
    with _lock:
        d = load(); n = 0
        for c in codes:
            if d.pop(c, None) is not None:
                n += 1
        _save(d)
        return n


def note(code: str, text: str):
    with _lock:
        d = load()
        if code in d:
            d[code]["note"] = text[:2000]; _save(d)
