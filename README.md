# Reely

Mac app (Tauri shell, Rust) that turns an Instagram handle into an annotated sheet of its
best-performing reels. Everything runs on this machine: Playwright for the Reels grid, yt-dlp for
downloads, Whisper for transcription (faster-whisper on the CPU by default, or whisper.cpp on the
Metal GPU), Claude Code CLI (your subscription) for annotation, insights and the Ask panel.

## Build the app

```bash
build/build.sh             # both backends + universal Reely.app + signed update archive + dmg
build/build.sh --app       # app + dmg only (reuses the backend bundles)
```

Plain `cargo tauri build` fails: updater artifacts need the signing key, which `build.sh` reads from
`~/.tauri/reely.key`. Output lands in `frontend/src-tauri/target/universal-apple-darwin/release/bundle/`
(`Reely_<version>_universal.dmg`).

One universal app serves both chips, with two backends inside:

| Chip | Backend | What it can do |
|---|---|---|
| Apple Silicon | `build/dist/reely-backend` (full, arm64) | everything: scrape, download, transcribe on Metal, annotate |
| Intel | `build/dist-view/reely-backend` (slim, universal2, ~60 MB) | view-only: browse, edit, Ask, export and import |

The shell picks one at launch by CPU (`REELY_VIEW_ONLY=1` forces the slim one for testing). The slim backend
is built from `.venv-view` (python.org universal2 Python; `build/make_view_env.sh` creates it and fuses
pydantic-core, its only compiled dependency, into a universal file) with `build/reely-backend-view.spec`.

The spec also bundles `build/bin/whisper-cli`, a static whisper.cpp build with Metal (shader library embedded).
Rebuild it with `build/build_whisper_cpp.sh` (clones whisper.cpp into `build/vendor/`, needs cmake:
`.venv/bin/pip install cmake`).

## How it runs

Reely.app starts the bundled `reely-backend` on a free localhost port, waits for its `READY` line,
and the UI talks to it over HTTP. Closing the app stops the backend.

- Data (clinic folders, videos, transcripts): `~/Documents/SahiLabs/Extractions/ig-reels/<handle>/`
  if it exists, else `~/Documents/Reely/`. Change with `data_root` in
  `~/Library/Application Support/Reely/config.json`.
- Index database: `~/Library/Application Support/Reely/reely.sqlite` (rebuilt from the folders on import).
- Browser login profile: `<data root>/.browser-profile/`.
- Whisper models: faster-whisper in the Hugging Face cache (`~/.cache/huggingface/hub`); whisper.cpp GGML
  files in `~/Library/Application Support/Reely/models/ggml/`. Both managed from the Models page.

## First-time setup

1. **Browser login** — Models → Scraping browser → Log in. A Chromium window opens on Instagram;
   log in with the secondary account once.
2. **Claude CLI** — `curl -fsSL https://claude.ai/install.sh | bash`, then `claude` once to sign in
   with your subscription. Without it, set Annotation to *Hand-off file* on the Models page.
3. **Whisper models** — Models page. `medium` is the default; `large-v3` for Telugu/Tamil/Kannada.
   Pick the *whisper.cpp · Metal GPU* engine there and download a `ggml-*` model to run transcription on the
   GPU (several times faster on Apple Silicon). The engine follows the default model: `ggml-*` ids are
   whisper.cpp, the rest faster-whisper.

## Layout

```
backend/            FastAPI app + SQLite + pipeline package (scrape, index, download, transcribe,
                    annotate, insights, assemble, importer). serve.py is the sidecar entry point.
frontend/           React + Vite UI (Apple-style). src-tauri/ is the Rust shell.
build/              PyInstaller spec, icon source, compiled backend in build/dist/
launcher.py         Dev-only: run the Python backend + a pywebview window without Tauri.
```

## Dev loop

```bash
cd backend && ../.venv/bin/uvicorn serve:app --reload --port 8765   # or: python serve.py --port 8765
cd frontend && npm run dev                                           # UI on 5173, proxies /api → 8765
cd frontend && REELY_BACKEND_URL=http://127.0.0.1:8765 cargo tauri dev   # shell against the dev backend
```
