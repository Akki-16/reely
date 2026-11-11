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
if [ "$1" != "--app" ]; then
  echo "· backend bundle"
  "$ROOT/.venv/bin/pyinstaller" "$ROOT/build/reely-backend.spec" --noconfirm --distpath "$ROOT/build/dist" --workpath "$ROOT/build/work" > "$ROOT/build/work/pyinstaller.log" 2>&1
fi
echo "· app"
( cd "$ROOT/frontend" && cargo tauri build > "$ROOT/build/work/tauri.log" 2>&1 ) || { tail -30 "$ROOT/build/work/tauri.log"; exit 1; }
"$ROOT/build/make_dmg.sh"
