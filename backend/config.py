"""Paths and defaults for Reely.

Works both from the source tree (dev) and from inside a frozen PyInstaller bundle shipped
within Reely.app. In the bundle, mutable state lives in ~/Library/Application Support/Reely.
"""
import json
import os
import sys
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)
# View-only: the slim backend shipped for Intel Macs. It reads, edits, exports and imports data but never scrapes,
# downloads or transcribes (those libraries are not in it). Set by `reely-backend --view-only`.
VIEW_ONLY = os.environ.get("REELY_VIEW_ONLY") == "1"
VIEW_ONLY_MSG = ("Reely on this Mac is view-only (Intel build): browse, edit, export and import clinics here. "
                 "Scraping, downloading and transcription run on an Apple Silicon Mac.")
if FROZEN:
    _extra = [str(Path.home() / ".local" / "bin"), "/opt/homebrew/bin", "/usr/local/bin"]
    os.environ["PATH"] = ":".join(_extra + [p for p in os.environ.get("PATH", "").split(":") if p and p not in _extra])
APP_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent.parent
# REELY_SUPPORT_DIR lets a second backend (tests, a dev build) run beside the installed app without sharing its
# database, config and model folder.
SUPPORT_DIR = Path(os.environ.get("REELY_SUPPORT_DIR") or (Path.home() / "Library" / "Application Support" / "Reely")).expanduser()
SUPPORT_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_FILE = SUPPORT_DIR / "config.json"


def _load_config() -> dict:
    try:
        return json.loads(CONFIG_FILE.read_text())
    except Exception:
        return {}


def _default_data_root() -> Path:
    env = os.environ.get("REEL_DATA_ROOT")
    if env:
        return Path(env).expanduser()
    cfg = _load_config().get("data_root")
    if cfg:
        return Path(cfg).expanduser()
    legacy = Path.home() / "Documents" / "SahiLabs" / "Extractions" / "ig-reels"
    if legacy.exists():
        return legacy
    return Path.home() / "Documents" / "Reely"


DATA_ROOT = _default_data_root().resolve()
DATA_ROOT.mkdir(parents=True, exist_ok=True)
DB_PATH = (SUPPORT_DIR if FROZEN else APP_DIR) / "reely.sqlite"
BROWSER_PROFILE = DATA_ROOT / ".browser-profile"
FRONTEND_DIST = APP_DIR / "frontend" / "dist"


def save_config(**kv):
    cfg = _load_config(); cfg.update(kv)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=1))


DEFAULTS = {
    "top_n": "100",
    "scrape_max": "0",               # 0 = scroll to the end; otherwise stop after this many (newest-first) tiles
    "whisper_engine": "faster-whisper",  # faster-whisper (CPU, CTranslate2) | whisper.cpp (Metal GPU, GGML models)
    "whisper_model": "medium",
    "video_quality": "low",          # low = 360p stream, best = best available
    "translate": "1",
    "translate_to": "en",            # language code (or a typed language name); English uses Whisper, others use Claude
    "annotation_mode": "cli",        # cli | handoff | none
    "scroll_pause_ms": "1000",
    "download_pause_s": "3,7",       # legacy; downloads now use download_pace
    "download_pace": "fast",         # fast | balanced | careful — starting pace; backs off on Instagram rate limits
    "auto_clear_videos": "0",        # 1 = after a run, delete videos that are transcribed and annotated
}

LANG_NAMES = {"en": "English", "hi": "Hindi", "te": "Telugu", "ta": "Tamil", "kn": "Kannada", "ml": "Malayalam", "mr": "Marathi",
              "gu": "Gujarati", "bn": "Bengali", "pa": "Punjabi", "ur": "Urdu", "or": "Odia", "as": "Assamese", "ne": "Nepali"}


def lang_name(code: str) -> str:
    return LANG_NAMES.get(code, code)


# Clinic specialities the user targets. Stored per clinic in the DB and in <clinic>/clinic.json.
SPECIALITIES = [
    "Dental", "Women's Health & Fertility", "Physiotherapy & Rehab", "Children & Child Development", "Orthopaedics",
    "Multi-speciality", "Eye", "Gastroenterology", "Dermatology", "ENT", "General Medicine", "Mental Health",
    "Ayurveda & Homeopathy", "Neurology",
]
# Clinics indexed before specialities existed
KNOWN_SPECIALITIES = {"clovedentalindia": "Dental"}

# ---------- speech-to-text engines and models ----------
# Two engines share one model table. faster-whisper runs CTranslate2 models from the Hugging Face cache on the CPU;
# whisper.cpp runs GGML models (ggml-*.bin from ggerganov/whisper.cpp) on the GPU through Metal, via the bundled
# whisper-cli binary. A model id decides its engine: ids starting with "ggml-" belong to whisper.cpp.
ENGINES = [
    {"id": "faster-whisper", "name": "faster-whisper", "device": "CPU",
     "desc": "CTranslate2 int8 on the CPU cores. The default; works everywhere."},
    {"id": "whisper.cpp",    "name": "whisper.cpp",    "device": "Metal GPU",
     "desc": "ggml on the Apple GPU through Metal. Several times faster on Apple Silicon; needs ggml-* models."},
]
# Guidance shown on the Settings page (kept here so the UI and the docs say the same thing).
MODEL_NOTES = {
    "families": "Rows without ggml- run on the CPU via faster-whisper (CTranslate2, Hugging Face cache); ggml- rows run on the "
                "Metal GPU via whisper.cpp (ggml files in ~/Library/Application Support/Reely/models/ggml). Same Whisper weights, "
                "same words; only where they run and how fast differs. Picking a model as default switches the engine to match.",
    "measured": "Speeds measured on this Mac (M5, six rgstonehospitals reels, 287 s of audio).",
    "backups": "Backups: if Metal cannot start, whisper.cpp falls back to its own CPU backend; each 30 s window retries at most "
               "twice (temperatures 0.5 and 1.0). There is no automatic switch to faster-whisper, so keep the CPU medium model "
               "installed as insurance and switch the Engine picker by hand if needed. Translation to languages other than "
               "English always goes through the Claude CLI.",
    "cpu_rows": "CPU rows are only used while the faster-whisper engine is selected; once a ggml model is the default they can be deleted.",
}
TRANSLATE_FALLBACKS = {"whisper.cpp": ["ggml-medium", "ggml-medium-q5_0", "ggml-large-v3", "ggml-small"],
                       "faster-whisper": ["medium", "large-v3", "small"]}
_GGML_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/"
WHISPER_MODELS = [
    {"id": "tiny",            "repo": "Systran/faster-whisper-tiny",           "size_mb": 75,   "speed": "very fast",            "best_for": "Testing only"},
    {"id": "base",            "repo": "Systran/faster-whisper-base",           "size_mb": 145,  "speed": "very fast",            "best_for": "Testing only"},
    {"id": "small",           "repo": "Systran/faster-whisper-small",          "size_mb": 470,  "speed": "~9x realtime",         "best_for": "English-only accounts, quick passes"},
    {"id": "medium",          "repo": "Systran/faster-whisper-medium",         "size_mb": 1500, "speed": "1.25x realtime measured (230 s)", "best_for": "Hindi + English, the standard; keep installed as the CPU insurance"},
    {"id": "large-v3-turbo",  "repo": "Systran/faster-whisper-large-v3-turbo", "size_mb": 1600, "speed": "~1x realtime",         "best_for": "Better regional languages at medium's speed"},
    {"id": "large-v3",        "repo": "Systran/faster-whisper-large-v3",       "size_mb": 3100, "speed": "~0.5x realtime",       "best_for": "Best Telugu, Tamil, Kannada"},
    # whisper.cpp (GGML) — same OpenAI weights, run on the GPU
    {"id": "ggml-small",               "file": "ggml-small.bin",               "size_mb": 465,  "speed": "~15x realtime on GPU", "best_for": "English-only accounts, quick passes"},
    {"id": "ggml-medium",              "file": "ggml-medium.bin",              "size_mb": 1463, "speed": "1.8x realtime measured (158 s)", "best_for": "Same words as CPU medium; Hindi makes it retry a lot, so only 1.45x faster"},
    {"id": "ggml-medium-q5_0",         "file": "ggml-medium-q5_0.bin",         "size_mb": 514,  "speed": "~2x realtime on GPU",  "best_for": "medium quality in a third of the space"},
    {"id": "ggml-large-v3-turbo",      "file": "ggml-large-v3-turbo.bin",      "size_mb": 1549, "speed": "5.7x realtime measured (50 s)", "best_for": "Recommended on Metal: Hindi + regional languages, 4.6x faster than CPU medium"},
    {"id": "ggml-large-v3-turbo-q5_0", "file": "ggml-large-v3-turbo-q5_0.bin", "size_mb": 547,  "speed": "~6x realtime on GPU",  "best_for": "large-v3-turbo quality in a third of the space"},
    {"id": "ggml-large-v3",            "file": "ggml-large-v3.bin",            "size_mb": 2952, "speed": "~2x realtime on GPU",  "best_for": "Best Telugu, Tamil, Kannada",
     "note": "Does transcription and English translation itself; about 3x slower than turbo, 3.1 GB."},
]
for _m in WHISPER_MODELS:
    if _m["id"].startswith("ggml-"):
        _m["engine"] = "whisper.cpp"; _m["url"] = _GGML_BASE + _m["file"]; _m["repo"] = "ggerganov/whisper.cpp"
    else:
        _m["engine"] = "faster-whisper"
    if "turbo" in _m["id"]:
        # turbo answers the translate task in the source language; transcribe.translation_model() reroutes English
        _m["translate_fallbacks"] = TRANSLATE_FALLBACKS[_m["engine"]]
        _m["note"] = ("English translation is routed to " + ", ".join(_m["translate_fallbacks"][:-1]) + " or " + _m["translate_fallbacks"][-1]
                      + " (first installed) because turbo answers the translate task in the source language.")
# Silero VAD for whisper.cpp (the faster-whisper path has VAD built in). Fetched with the first GGML model.
GGML_VAD = {"file": "ggml-silero-v5.1.2.bin", "size_mb": 1,
            "url": "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin"}
GGML_DIR = SUPPORT_DIR / "models" / "ggml"
# whisper-cli: static build of whisper.cpp with Metal (see build/build_whisper_cpp.sh). Inside the PyInstaller
# bundle it sits in _internal/bin; in the source tree in build/bin.
WHISPER_CLI = (Path(getattr(sys, "_MEIPASS", APP_DIR)) / "bin" / "whisper-cli") if FROZEN else (APP_DIR / "build" / "bin" / "whisper-cli")


def model_info(model_id: str) -> dict | None:
    return next((m for m in WHISPER_MODELS if m["id"] == model_id), None)


def engine_for_model(model_id: str) -> str:
    return "whisper.cpp" if str(model_id).startswith("ggml-") else "faster-whisper"


def model_for_engine(engine: str, model_id: str) -> str:
    """The equivalent of `model_id` in `engine`'s family: medium <-> ggml-medium. Unknown pairs fall back to medium."""
    if engine_for_model(model_id) == engine:
        return model_id
    base = model_id[5:] if model_id.startswith("ggml-") else model_id
    want = base if engine == "faster-whisper" else "ggml-" + base
    if model_info(want):
        return want
    if engine == "whisper.cpp" and base.endswith("-q5_0") and model_info("ggml-" + base[:-5]):
        return "ggml-" + base[:-5]
    if engine == "faster-whisper" and base.endswith("-q5_0") and model_info(base[:-5]):
        return base[:-5]
    return "medium" if engine == "faster-whisper" else "ggml-medium"
