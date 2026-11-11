#!/bin/zsh
# Package the built Reely.app into a dmg with an Applications shortcut.
# Tauri's own dmg step trips on this macOS's hdiutil deprecation warning, so we do it directly.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$ROOT/frontend/src-tauri/target/release/bundle"
APP="$BUNDLE/macos/Reely.app"
VER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist")
OUT="$BUNDLE/dmg/Reely_${VER}_aarch64.dmg"
[ -d "$APP" ] || { echo "build the app first: cd frontend && cargo tauri build"; exit 1; }
STAGE=$(mktemp -d)
ditto "$APP" "$STAGE/Reely.app"
ln -s /Applications "$STAGE/Applications"
mkdir -p "$BUNDLE/dmg"; rm -f "$OUT"
hdiutil create -volname "Reely" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null 2>&1 || \
  diskutil image create from "$STAGE" --volumeName Reely --format UDZO "$OUT"
rm -rf "$STAGE"
echo "dmg: $OUT ($(du -h "$OUT" | cut -f1))"
