#!/bin/zsh
# Cut a Reely release that installed copies pick up through auto-update.
#
#   build/release.sh 0.3.0 "What changed"            build + sign + latest.json into build/release/v0.3.0/
#   build/release.sh 0.3.0 "What changed" --publish  …and create the GitHub release with gh
#
# Repo: REELY_REPO=owner/name, else build/release.conf, else Akki-16/reely. The repo (or at least its releases)
# must be public: installed apps fetch latest.json without signing in.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$1"; NOTES="${2:-}"; PUBLISH="$3"
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: build/release.sh X.Y.Z \"notes\" [--publish]"; exit 1; }
[ -f "$ROOT/build/release.conf" ] && source "$ROOT/build/release.conf"
REPO="${REELY_REPO:-Akki-16/reely}"
TAG="v$VER"
CONF="$ROOT/frontend/src-tauri/tauri.conf.json"

echo "· version $VER, update feed github.com/$REPO"
python3 - "$ROOT" "$VER" "$REPO" <<'PY'
import json, re, sys
root, ver, repo = sys.argv[1:4]
p = f"{root}/frontend/src-tauri/tauri.conf.json"; c = json.load(open(p))
c["version"] = ver
c["plugins"]["updater"]["endpoints"] = [f"https://github.com/{repo}/releases/latest/download/latest.json"]
json.dump(c, open(p, "w"), indent=2)
p = f"{root}/frontend/src-tauri/Cargo.toml"; s = open(p).read()
open(p, "w").write(re.sub(r'(?m)^version = "[^"]+"', f'version = "{ver}"', s, count=1))
p = f"{root}/frontend/package.json"; c = json.load(open(p)); c["version"] = ver; json.dump(c, open(p, "w"), indent=2)
PY

"$ROOT/build/build.sh"

B="$ROOT/frontend/src-tauri/target/release/bundle"
OUT="$ROOT/build/release/$TAG"; rm -rf "$OUT"; mkdir -p "$OUT"
cp "$B/macos/Reely.app.tar.gz" "$OUT/Reely_${VER}_aarch64.app.tar.gz"
cp "$B/macos/Reely.app.tar.gz.sig" "$OUT/Reely_${VER}_aarch64.app.tar.gz.sig"
cp "$B/dmg/Reely_${VER}_aarch64.dmg" "$OUT/"
python3 - "$OUT" "$VER" "$REPO" "$TAG" "$NOTES" <<'PY'
import json, sys, datetime
out, ver, repo, tag, notes = sys.argv[1:6]
sig = open(f"{out}/Reely_{ver}_aarch64.app.tar.gz.sig").read().strip()
latest = {"version": ver, "notes": notes, "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
          "platforms": {"darwin-aarch64": {"signature": sig,
                        "url": f"https://github.com/{repo}/releases/download/{tag}/Reely_{ver}_aarch64.app.tar.gz"}}}
json.dump(latest, open(f"{out}/latest.json", "w"), indent=2)
PY
echo "· release files in $OUT"; ls -lh "$OUT" | tail -n +2

if [ "$PUBLISH" = "--publish" ]; then
  echo "· publishing $TAG to $REPO"
  gh release create "$TAG" --repo "$REPO" --title "Reely $VER" --notes "${NOTES:-Reely $VER}" \
    "$OUT/latest.json" "$OUT/Reely_${VER}_aarch64.app.tar.gz" "$OUT/Reely_${VER}_aarch64.app.tar.gz.sig" "$OUT/Reely_${VER}_aarch64.dmg"
  echo "· done: installed copies will offer $VER within six hours, or at once via Models › Updates › Check now"
else
  echo "· not published. Publish later with: build/release.sh $VER \"$NOTES\" --publish   (or upload the four files to a $TAG release)"
fi
