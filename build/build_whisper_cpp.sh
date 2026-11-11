#!/bin/zsh
# Build the static whisper-cli (whisper.cpp with Metal, shader library embedded) that Reely bundles for the
# whisper.cpp engine. Output: build/bin/whisper-cli. Needs cmake (the venv has one: .venv/bin/pip install cmake).
# Command Line Tools are enough: with GGML_METAL_EMBED_LIBRARY the Metal source is compiled on first launch,
# so no `metal` compiler is required at build time.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/build/vendor/whisper.cpp"
export PATH="$ROOT/.venv/bin:$PATH"
[ -d "$SRC" ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$SRC"
cmake -S "$SRC" -B "$SRC/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_NATIVE=OFF -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_BUILD_EXAMPLES=ON
cmake --build "$SRC/build" --config Release --target whisper-cli -j8
mkdir -p "$ROOT/build/bin"
cp "$SRC/build/bin/whisper-cli" "$ROOT/build/bin/whisper-cli"
echo "built: $ROOT/build/bin/whisper-cli ($(du -h "$ROOT/build/bin/whisper-cli" | cut -f1))"
