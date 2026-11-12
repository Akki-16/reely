# PyInstaller spec for the view-only Reely backend: a universal2 (Intel + Apple Silicon) one-folder build with only the
# web server, database and file code. No scraping browser, yt-dlp or speech models, so it stays small and needs no
# Intel builds of the heavy ML libraries. Reely.app starts it on Intel Macs with --view-only.
#
# Build env: .venv-view (python.org universal2 Python) with fastapi, uvicorn, pydantic, certifi, pyinstaller, and
# pydantic-core's .so fused to universal2 (build/make_view_env.sh does all of this).
# Build:  .venv-view/bin/pyinstaller build/reely-backend-view.spec --noconfirm --distpath build/dist-view --workpath build/work-view
import os
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

block_cipher = None
datas, binaries, hiddenimports = [], [], []
d, b, h = collect_all("certifi")
datas += d; binaries += b; hiddenimports += h

# yt-dlp (pure Python) so Intel Macs can download the videos of imported reels; its extractors load lazily
hiddenimports += collect_submodules("yt_dlp")
datas += collect_data_files("yt_dlp")
# remux-only universal ffmpeg from build/build_ffmpeg.sh, when built; without it downloads use the single-file format
_ff = os.path.join(SPECPATH, "bin", "ffmpeg")
if os.path.exists(_ff):
    binaries += [(_ff, "bin")]

hiddenimports += [
    "uvicorn.logging", "uvicorn.loops", "uvicorn.loops.auto", "uvicorn.loops.asyncio", "uvicorn.protocols", "uvicorn.protocols.http",
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
    excludes=["tkinter", "matplotlib", "PIL", "numpy", "faster_whisper", "ctranslate2", "av", "onnxruntime", "tokenizers",
              "huggingface_hub", "playwright", "uvloop", "httptools", "watchfiles", "websockets", "PyInstaller", "delocate"],
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
    target_arch="universal2",
)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, strip=False, upx=False, name="reely-backend")
