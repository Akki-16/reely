"""Download reels with yt-dlp at low quality, naming files <views>_<shortcode>."""
import os
import random
import time
from collections import deque
from pathlib import Path

from .views_fmt import file_stem, video_path, info_path


def _ffmpeg() -> str | None:
    """ffmpeg for merging separate audio/video streams: the one bundled with the app first, then the usual
    system places (the packaged app starts with a bare PATH). None means downloads use the single-file format."""
    import shutil
    if os.environ.get("REELY_FFMPEG") == "none":   # testing: behave like a Mac without ffmpeg
        return None
    try:
        from config import FFMPEG_BIN
        bundled = str(FFMPEG_BIN)
    except Exception:
        bundled = None
    for c in (bundled, shutil.which("ffmpeg"), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):
        if c and Path(c).is_file() and os.access(c, os.X_OK):
            return c
    return None


def _certs():
    try:
        import certifi
        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    except Exception:
        pass


def fmt_speed(bps: float) -> str:
    return f"{bps / 1e6:.1f} MB/s" if bps >= 1e6 else f"{bps / 1e3:.0f} KB/s"


def download_one(url: str, out_dir: Path, quality: str = "low", stats: dict | None = None) -> dict:
    """Fetch one reel in-process with yt-dlp (the packaged app has no `python -m yt_dlp` to shell out to).
    `stats` collects transfer bytes and seconds from yt-dlp's progress hooks (network time only)."""
    import yt_dlp
    _certs()
    ff = _ffmpeg()
    # with ffmpeg: small 360p video + audio streams joined into one mp4; without it: Instagram's ready-made mp4
    # (video and audio together, usually 720p, a few times larger)
    opts = {"quiet": True, "no_warnings": True, "noprogress": True, "format": "bv*+ba/b" if ff else "b", "merge_output_format": "mp4",
            "writeinfojson": True, "outtmpl": str(out_dir / "%(id)s.%(ext)s"), "retries": 3}
    if stats is not None:
        def hook(d):
            if d.get("status") == "finished":
                stats["bytes"] = stats.get("bytes", 0) + (d.get("total_bytes") or d.get("downloaded_bytes") or 0)
                stats["seconds"] = stats.get("seconds", 0) + (d.get("elapsed") or 0)
        opts["progress_hooks"] = [hook]
    if quality == "low":
        opts["format_sort"] = ["res:480", "+size"]
    if ff:
        opts["ffmpeg_location"] = ff
    with yt_dlp.YoutubeDL(opts) as y:
        return y.extract_info(url, download=True) or {}


# Pace levels: seconds of pause between reels. Downloads are anonymous requests from this Mac's IP; Instagram
# answers bursts with rate-limit / login errors that fail everything for a while, so the pace adapts.
PACES = {"fast": (1.0, 2.0), "balanced": (3.0, 7.0), "careful": (6.0, 12.0)}
_ORDER = ["fast", "balanced", "careful"]
_BLOCKED = ("rate-limit", "rate limit", "429", "too many requests", "please wait a few minutes", "login required",
            "login_required", "requested content is not available, rate", "checkpoint")


# A block is waited out this many times (seconds each) before the stage gives up for now. Longer waits do not
# help: once Instagram walls off anonymous requests from an IP it stays that way for hours, so the run moves on
# with what it has and the reels left over stay pending for a later retry.
BLOCK_COOLDOWNS = (60, 180)
BLOCKED_MSG = "Instagram is limiting downloads from this network. Try again in a few hours or on another network."
# Timeouts are the early sign of throttling: this many among the last TIMEOUT_WINDOW reels drops the pace a level.
TIMEOUT_WINDOW = 10
TIMEOUT_LIMIT = 2
# Clean downloads in a row before a slowed-down stage tries one level faster again.
RECOVER_AFTER = 100


def _blocked(err: str) -> bool:
    e = err.lower()
    return any(k in e for k in _BLOCKED)


def _timed_out(err: str) -> bool:
    e = err.lower()
    return "timed out" in e or "timeout" in e


def download_reels(clinic_dir: Path, rows: list[dict], quality: str = "low",
                   pause=None, progress=None, should_stop=lambda: False, pace: str = "balanced", force: bool = False,
                   block_cooldowns=BLOCK_COOLDOWNS) -> dict:
    """Download rows in order. Skips reels already on disk, reels already transcribed (their video may have been
    cleared to save space) and reels the user chose to ignore. `pause` (min, max) overrides adaptive pacing.

    When Instagram blocks downloads and the short cooldowns do not clear it, the stage stops early with
    `blocked: True`; the reels it did not reach are counted in `pending` and are not recorded as failures."""
    from . import failures
    from .views_fmt import transcript_path
    vd = clinic_dir / "videos"; vd.mkdir(exist_ok=True)
    ok = fail = skipped = 0
    fails = []
    tot_bytes = tot_secs = 0.0
    start = pace if pace in PACES else "balanced"
    level = start
    clean_streak = 0
    block_tries = 0                      # cooldowns used since the last successful download
    recent = deque(maxlen=TIMEOUT_WINDOW)  # 1 = that reel timed out
    blocked = False
    pending = 0
    ignored = failures.ignored(clinic_dir)

    def needs(code):
        """True when a run would still fetch this reel."""
        if code in ignored:
            return False
        return not (info_path(clinic_dir, code) and (video_path(clinic_dir, code) or (transcript_path(clinic_dir, code) and not force)))

    def slower():
        nonlocal level, clean_streak
        clean_streak = 0
        if not pause and level != "careful":
            level = _ORDER[_ORDER.index(level) + 1]
            return True
        return False

    def wait_between():
        lo, hi = pause if pause else PACES[level]
        end = time.time() + random.uniform(lo, hi)
        while time.time() < end and not should_stop():
            time.sleep(0.25)

    def extra():
        return {"speed_bps": round(tot_bytes / tot_secs) if tot_secs else 0, "bytes": int(tot_bytes), "pace": level if not pause else "fixed"}

    for i, r in enumerate(rows, 1):
        if should_stop():
            break
        code = r["shortcode"]
        # force: fetch the video even when the reel is already transcribed (an import without videos, or a clean-up)
        if info_path(clinic_dir, code) and (video_path(clinic_dir, code) or (transcript_path(clinic_dir, code) and not force)):
            skipped += 1
            if progress: progress(i, len(rows), f"{code} already {'downloaded' if video_path(clinic_dir, code) else 'transcribed'}", extra())
            continue
        if code in ignored:
            skipped += 1
            if progress: progress(i, len(rows), f"{code} skipped (dismissed failure)", extra())
            continue
        while True:
            try:
                st: dict = {}
                t0 = time.time()
                download_one(r["url"], vd, quality, st)
                b = st.get("bytes", 0)
                s = st.get("seconds") or (time.time() - t0)
                tot_bytes += b; tot_secs += s
                if not (vd / f"{code}.mp4").exists():
                    raise FileNotFoundError("yt-dlp finished but no mp4 was written")
                stem = file_stem(r["views"], code)
                (vd / f"{code}.mp4").rename(vd / f"{stem}.mp4")
                if (vd / f"{code}.info.json").exists():
                    (vd / f"{code}.info.json").rename(vd / f"{stem}.info.json")
                ok += 1
                failures.clear(clinic_dir, code, "download")
                clean_streak += 1
                block_tries = 0
                recent.append(0)
                if not pause and clean_streak >= RECOVER_AFTER and _ORDER.index(level) > _ORDER.index(start):
                    level = _ORDER[_ORDER.index(level) - 1]; clean_streak = 0
                    if progress: progress(i, len(rows), f"{RECOVER_AFTER} clean downloads, speeding back up to {level}", extra())
                if progress: progress(i, len(rows), f"{code} ok ({r.get('views_text','')}) · {fmt_speed(b / s) if s else '—'}", extra())
                break
            except Exception as e:
                err = " ".join(str(e).split())[-300:]
                if _blocked(err):
                    # a block is about this network, not this reel: never recorded as a failure
                    if should_stop():
                        break
                    if block_tries < len(block_cooldowns):
                        cool = block_cooldowns[block_tries]; block_tries += 1
                        slower()
                        if progress: progress(i, len(rows), f"Instagram is limiting downloads · cooling down {cool}s, then {level} pace", extra())
                        end = time.time() + cool
                        while time.time() < end and not should_stop():
                            time.sleep(0.5)
                        if should_stop():
                            break
                        continue
                    blocked = True
                    pending = sum(1 for x in rows[i - 1:] if needs(x["shortcode"]))
                    if progress: progress(i, len(rows), f"Instagram is still blocking downloads · stopping here, {pending} reels left for later", extra())
                    break
                fail += 1
                fails.append({"shortcode": code, "error": err})
                failures.record(clinic_dir, code, "download", err)
                if progress: progress(i, len(rows), f"{code} FAILED: {failures.explain(err)} · {err[-100:]}", extra())
                clean_streak = 0
                recent.append(1 if _timed_out(err) else 0)
                if sum(recent) >= TIMEOUT_LIMIT:
                    n = sum(recent); recent.clear()
                    if slower() and progress:
                        progress(i, len(rows), f"{n} downloads timed out · slowing to {level} pace", extra())
                break
        if blocked:
            break
        if fail >= 5 and ok == 0:
            if progress: progress(i, len(rows), f"stopping: first {fail} downloads all failed · {fails[-1]['error'][-120:]}", extra())
            break
        wait_between()
    return {"ok": ok, "failed": fail, "skipped": skipped, "failures": fails, "blocked": blocked, "pending": pending,
            "speed_bps": round(tot_bytes / tot_secs) if tot_secs else None, "bytes": int(tot_bytes), "pace": level}


def refresh_metadata(clinic_dir: Path, codes: list[str], progress=None, should_stop=lambda: False, pace: str = "balanced",
                     block_cooldowns=BLOCK_COOLDOWNS) -> dict:
    """Re-fetch yt-dlp metadata (likes, comments, caption) for reels already here, without downloading video.
    Stops early with `blocked: True` when Instagram blocks requests and the short cooldowns do not clear it."""
    import json as _json
    import yt_dlp
    _certs()
    level = pace if pace in PACES else "balanced"
    done = failed = 0
    block_tries = 0
    blocked = False
    pending = 0
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as y:
        for i, code in enumerate(codes, 1):
            if should_stop():
                break
            ip = info_path(clinic_dir, code)
            if not ip:
                continue
            while True:
                try:
                    info = y.extract_info(f"https://www.instagram.com/reel/{code}/", download=False) or {}
                    old = _json.loads(ip.read_text())
                    for k in ("like_count", "comment_count", "view_count", "play_count", "description", "title"):
                        if info.get(k) is not None:
                            old[k] = info[k]
                    old["_refreshed"] = time.strftime("%Y-%m-%d %H:%M")
                    ip.write_text(_json.dumps(old, ensure_ascii=False))
                    done += 1
                    block_tries = 0
                    if progress: progress(i, len(codes), f"{code} likes {info.get('like_count')}", {"pace": level})
                    break
                except Exception as e:
                    err = " ".join(str(e).split())[-200:]
                    if _blocked(err):
                        if should_stop():
                            break
                        if block_tries < len(block_cooldowns):
                            cool = block_cooldowns[block_tries]; block_tries += 1
                            if level != "careful": level = _ORDER[_ORDER.index(level) + 1]
                            if progress: progress(i, len(codes), f"Instagram is limiting requests · cooling down {cool}s", {"pace": level})
                            end = time.time() + cool
                            while time.time() < end and not should_stop(): time.sleep(0.5)
                            if should_stop():
                                break
                            continue
                        blocked = True
                        pending = len(codes) - i + 1
                        if progress: progress(i, len(codes), f"Instagram is still blocking requests · stopping here, {pending} reels not refreshed", {"pace": level})
                        break
                    failed += 1
                    if progress: progress(i, len(codes), f"{code} not refreshed: {err[-100:]}", {"pace": level})
                    break
            if blocked:
                break
            lo, hi = PACES[level]
            end = time.time() + random.uniform(lo, hi)
            while time.time() < end and not should_stop():
                time.sleep(0.25)
    return {"done": done, "failed": failed, "blocked": blocked, "pending": pending}
