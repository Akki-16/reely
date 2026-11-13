#!/bin/zsh
# Build Reely.app (+ signed updater archive) and the dmg, without changing the version.
#   build/build.sh            backend bundle + app + dmg
#   build/build.sh --app      app + dmg only (backend unchanged)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="$HOME/.tauri/reely.key"
[ -f "$KEY" ] || { echo "missing $KEY (update signing key); see README › Releases"; exit 1; }
export PATH="$HOME/.cargo/bin:$PATH"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
mkdir -p "$ROOT/build/work"
if [ "$1" != "--app" ]; then
  echo "· backend bundle (Apple Silicon, full)"
  "$ROOT/.venv/bin/pyinstaller" "$ROOT/build/reely-backend.spec" --noconfirm --distpath "$ROOT/build/dist" --workpath "$ROOT/build/work" > "$ROOT/build/work/pyinstaller.log" 2>&1
fi
if [ "$1" != "--app" ] || [ ! -x "$ROOT/build/dist-view/reely-backend/reely-backend" ]; then
  echo "· backend bundle (universal, view-only for Intel)"
  [ -x "$ROOT/.venv-view/bin/pyinstaller" ] || "$ROOT/build/make_view_env.sh"
  "$ROOT/.venv-view/bin/pyinstaller" "$ROOT/build/reely-backend-view.spec" --noconfirm --distpath "$ROOT/build/dist-view" --workpath "$ROOT/build/work-view" > "$ROOT/build/work/pyinstaller-view.log" 2>&1
fi
# Sign the two backends under stable names before Tauri packs them, so the signed copies are what the updater archive
# holds. Tauri then signs the whole app ad-hoc as ai.getacro.reely (bundle.macOS.signingIdentity "-"): with a sealed,
# named signature macOS remembers the Documents-folder answer instead of asking on every launch.
codesign --force -s - --identifier ai.getacro.reely.backend "$ROOT/build/dist/reely-backend/reely-backend"
codesign --force -s - --identifier ai.getacro.reely.backend-view "$ROOT/build/dist-view/reely-backend/reely-backend"
rustup target list --installed | grep -q x86_64-apple-darwin || rustup target add x86_64-apple-darwin
echo "· app (universal: Apple Silicon + Intel)"
( cd "$ROOT/frontend" && cargo tauri build --target universal-apple-darwin > "$ROOT/build/work/tauri.log" 2>&1 ) || { tail -30 "$ROOT/build/work/tauri.log"; exit 1; }
"$ROOT/build/make_dmg.sh"
