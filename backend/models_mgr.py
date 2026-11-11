"""Speech-to-text model manager.

faster-whisper models live in the Hugging Face cache (snapshot_download); whisper.cpp GGML models are single
ggml-*.bin files fetched from huggingface.co into ~/Library/Application Support/Reely/models/ggml. Both appear in
one listing with installed state, size on disk and download progress.
"""
import shutil
import ssl
import threading
import time
import urllib.request
from pathlib import Path

import certifi

from huggingface_hub import scan_cache_dir, snapshot_download
from huggingface_hub.constants import HF_HUB_CACHE

from config import ENGINES, GGML_DIR, GGML_VAD, WHISPER_CLI, WHISPER_MODELS, model_info

_downloads: dict = {}   # model id -> {"status", "bytes", "total", "error"}


def _dir_size(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


def _repo_dir(repo: str) -> Path:
    return Path(HF_HUB_CACHE) / ("models--" + repo.replace("/", "--"))


def _ggml_path(m: dict) -> Path:
    return GGML_DIR / m["file"]


def list_engines() -> list[dict]:
    return [{**e, "available": e["id"] != "whisper.cpp" or WHISPER_CLI.exists()} for e in ENGINES]


def list_models() -> list[dict]:
    try:
        cache = scan_cache_dir()
        installed = {r.repo_id: r.size_on_disk for r in cache.repos}
    except Exception:
        installed = {}
    out = []
    for m in WHISPER_MODELS:
        d = _downloads.get(m["id"], {})
        if m["engine"] == "whisper.cpp":
            p = _ggml_path(m)
            size = p.stat().st_size if p.exists() else None
        else:
            size = installed.get(m["repo"])
            # scan_cache_dir can miss a model that is mid-download; fall back to dir size
            if size is None and _repo_dir(m["repo"]).exists():
                size = _dir_size(_repo_dir(m["repo"]))
        ok = size is not None and size > m["size_mb"] * 1024 * 1024 * 0.9
        out.append({**m, "installed": bool(ok), "size_on_disk": size or 0,
                    "download": d if d.get("status") in ("running", "error") else None})
    return out


def cache_usage() -> dict:
    try:
        hf = scan_cache_dir().size_on_disk
    except Exception:
        hf = 0
    return {"bytes": hf + _dir_size(GGML_DIR), "path": str(HF_HUB_CACHE), "ggml_path": str(GGML_DIR)}


def _fetch(url: str, dest: Path, state: dict | None = None, timeout: int = 60):
    """Stream `url` to `dest` via a .part file, updating state["bytes"]/["total"] as it goes."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "Reely"})
    # the frozen Python has no system CA store, so trust certifi's bundle explicitly
    ctx = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r, part.open("wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        if state is not None and total:
            state["total"] = total
        got = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk); got += len(chunk)
            if state is not None:
                state["bytes"] = got
    part.replace(dest)


def start_download(model_id: str) -> dict:
    m = model_info(model_id)
    if not m:
        raise ValueError("unknown model")
    if _downloads.get(model_id, {}).get("status") == "running":
        return _downloads[model_id]
    state = _downloads[model_id] = {"status": "running", "bytes": 0, "total": m["size_mb"] * 1024 * 1024, "error": None}

    def work_hf():
        try:
            snapshot_download(m["repo"])
            state["status"] = "done"; state["bytes"] = state["total"]
        except Exception as e:
            state["status"] = "error"; state["error"] = str(e)[:300]

    def poll_hf():
        while state["status"] == "running":
            state["bytes"] = _dir_size(_repo_dir(m["repo"]))
            time.sleep(1)

    def work_ggml():
        try:
            vad = GGML_DIR / GGML_VAD["file"]
            if not vad.exists():
                _fetch(GGML_VAD["url"], vad)
            _fetch(m["url"], _ggml_path(m), state)
            state["status"] = "done"; state["bytes"] = state["total"]
        except Exception as e:
            state["status"] = "error"; state["error"] = str(e)[:300]
            part = _ggml_path(m).with_suffix(".bin.part")
            if part.exists():
                part.unlink()

    if m["engine"] == "whisper.cpp":
        threading.Thread(target=work_ggml, daemon=True).start()
    else:
        threading.Thread(target=work_hf, daemon=True).start()
        threading.Thread(target=poll_hf, daemon=True).start()
    return state


def delete_model(model_id: str) -> dict:
    m = model_info(model_id)
    if not m:
        raise ValueError("unknown model")
    if m["engine"] == "whisper.cpp":
        for p in (_ggml_path(m), _ggml_path(m).with_suffix(".bin.part")):
            if p.exists():
                p.unlink()
    else:
        d = _repo_dir(m["repo"])
        if d.exists():
            shutil.rmtree(d)
    _downloads.pop(model_id, None)
    return {"deleted": True}
