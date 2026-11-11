#!/bin/zsh
# Builds "Reel Research.app" next to this project. The bundle launches launcher.py
# from this folder's venv, so keep the project where it is (or re-run this script after moving).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/Reel Research.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/build/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Reel Research</string>
  <key>CFBundleDisplayName</key><string>Reel Research</string>
  <key>CFBundleIdentifier</key><string>ai.getacro.reelresearch</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>ReelResearch</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
cat > "$APP/Contents/MacOS/ReelResearch" <<LAUNCH
#!/bin/zsh
export PYTHONUNBUFFERED=1
cd "$ROOT"
exec "$ROOT/.venv/bin/python" "$ROOT/launcher.py" "\$@"
LAUNCH
chmod +x "$APP/Contents/MacOS/ReelResearch"
# refresh Finder's icon cache for the bundle
touch "$APP"
echo "built: $APP"
