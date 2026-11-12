#!/bin/zsh
# Create .venv-view: the build environment for the slim universal (Intel + Apple Silicon) view-only backend.
# Uses the python.org universal2 Python and fuses pydantic-core (its only compiled dependency) into a universal file.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3.14
[ -x "$PY" ] || { echo "needs the python.org Python 3.14 (universal2) installer"; exit 1; }
V="$ROOT/.venv-view"
rm -rf "$V"; "$PY" -m venv "$V"
"$V/bin/pip" install -q --upgrade pip
"$V/bin/pip" install -q fastapi uvicorn pydantic certifi pyinstaller yt-dlp
VER=$("$V/bin/python" -c "import pydantic_core; print(pydantic_core.__version__)")
W=$(mktemp -d)
for plat in macosx_11_0_arm64 macosx_10_12_x86_64; do
  "$V/bin/pip" download -q "pydantic_core==$VER" --no-deps --only-binary=:all: --python-version 3.14 --platform $plat -d "$W/$plat"
  (cd "$W/$plat" && unzip -q -o ./*.whl)
done
T=$("$V/bin/python" -c "import pydantic_core._pydantic_core as m; print(m.__file__)")
lipo -create "$(find "$W/macosx_11_0_arm64" -name '*.so')" "$(find "$W/macosx_10_12_x86_64" -name '*.so')" -output "$T.fat"
mv "$T.fat" "$T"; codesign --force -s - "$T" >/dev/null 2>&1
rm -rf "$W"
echo "· .venv-view ready; pydantic-core $VER is $(lipo -archs "$T")"
