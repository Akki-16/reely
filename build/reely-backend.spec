# PyInstaller spec for the Reely backend sidecar (one-folder build).
# Build:  .venv/bin/pyinstaller build/reely-backend.spec --noconfirm
# Output: dist/reely-backend/reely-backend  (+ _internal/)
import os
from PyInstaller.utils.hooks import collect_all, collect_submodules, collect_data_files

block_cipher = None
datas, binaries, hiddenimports = [], [], []

# whisper.cpp engine: static whisper-cli built by build/build_whisper_cpp.sh (GGML_METAL=1 with the Metal shader
# library embedded, so no .metal/.metallib resources are needed). Lands in _internal/bin/, where config.WHISPER_CLI
# looks for it.
_wcli = os.path.join(SPECPATH, "bin", "whisper-cli")
if not os.path.exists(_wcli):
    raise SystemExit("build/bin/whisper-cli missing — run build/build_whisper_cpp.sh first")
binaries += [(_wcli, "bin")]
# remux-only universal ffmpeg (build/build_ffmpeg.sh), when built, so downloads do not depend on Homebrew
_ff = os.path.join(SPECPATH, "bin", "ffmpeg")
if os.path.exists(_ff):
    binaries += [(_ff, "bin")]

for pkg in ("faster_whisper", "ctranslate2", "av", "onnxruntime", "tokenizers", "huggingface_hub", "playwright", "certifi"):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hiddenimports += h

# yt-dlp loads extractors lazily; make sure they are all present
hiddenimports += collect_submodules("yt_dlp")
datas += collect_data_files("yt_dlp")

hiddenimports += [
    "uvicorn.logging", "uvicorn.loops", "uvicorn.loops.auto", "uvicorn.protocols", "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto", "uvicorn.protocols.http.h11_impl", "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto", "uvicorn.lifespan", "uvicorn.lifespan.on", "uvicorn.lifespan.off",
    "transfer", "storage", "library", "reports", "pipeline", "pipeline.failures", "pipeline.scrape", "pipeline.index", "pipeline.download", "pipeline.transcribe",
    "pipeline.assemble", "pipeline.annotate", "pipeline.insights", "pipeline.importer", "pipeline.views_fmt",
    "claude_cli", "models_mgr", "jobs", "db", "config",
]

a = Analysis(
    ["../backend/serve.py"],
    pathex=["../backend"],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "PIL", "pywebview", "webview", "fitz", "pymupdf", "PyInstaller"],
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="reely-backend",
    debug=False,
    strip=False,
    upx=False,
    console=True,
    target_arch=None,
)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, strip=False, upx=False, name="reely-backend")
