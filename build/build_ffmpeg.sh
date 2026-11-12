#!/bin/zsh
# Build the small ffmpeg that Reely bundles for yt-dlp: remux only (joins Instagram's separate video and audio
# streams with -c copy), no encoders or decoders, no network. Universal (arm64 + x86_64) so the Intel view-only
# build can download videos too. Output: build/bin/ffmpeg. Source: the official ffmpeg.org release tarball.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER=7.1.1
SRC="$ROOT/build/vendor/ffmpeg-$VER"
mkdir -p "$ROOT/build/vendor" "$ROOT/build/bin"
if [ ! -d "$SRC" ]; then
  curl -fsSL "https://ffmpeg.org/releases/ffmpeg-$VER.tar.xz" -o "$ROOT/build/vendor/ffmpeg-$VER.tar.xz"
  tar -xJf "$ROOT/build/vendor/ffmpeg-$VER.tar.xz" -C "$ROOT/build/vendor"
fi

COMMON=(--disable-everything --disable-autodetect --disable-doc --disable-debug --disable-network
  --disable-ffplay --disable-ffprobe --enable-ffmpeg --enable-small --enable-static --disable-shared
  --enable-protocol=file --enable-protocol=pipe
  --enable-demuxer=mov --enable-demuxer=matroska --enable-demuxer=aac
  --enable-muxer=mp4 --enable-muxer=mov --enable-muxer=ipod --enable-muxer=matroska --enable-muxer=webm
  --enable-parser=h264 --enable-parser=hevc --enable-parser=aac --enable-parser=vp9 --enable-parser=av1
  --enable-bsf=aac_adtstoasc --enable-bsf=vp9_superframe --enable-bsf=h264_mp4toannexb
  --enable-filter=null --enable-filter=anull --enable-filter=buffer --enable-filter=buffersink
  --enable-filter=abuffer --enable-filter=abuffersink --enable-filter=format --enable-filter=aformat
  --enable-filter=copy --enable-filter=acopy
  --extra-cflags=-mmacosx-version-min=13.0 --extra-ldflags=-mmacosx-version-min=13.0)

build_arch() {
  local arch=$1 dir="$SRC/build-$1"
  rm -rf "$dir"; mkdir -p "$dir"; cd "$dir"
  if [ "$arch" = "x86_64" ]; then
    "$SRC/configure" "${COMMON[@]}" --enable-cross-compile --arch=x86_64 --target-os=darwin \
      --cc="clang -arch x86_64" --extra-ldflags="-arch x86_64 -mmacosx-version-min=13.0" --disable-x86asm > configure.log
  else
    "$SRC/configure" "${COMMON[@]}" --arch=aarch64 --cc="clang -arch arm64" > configure.log
  fi
  make -j8 ffmpeg > make.log 2>&1 || { tail -30 make.log; exit 1; }
}

build_arch arm64
build_arch x86_64
lipo -create "$SRC/build-arm64/ffmpeg" "$SRC/build-x86_64/ffmpeg" -output "$ROOT/build/bin/ffmpeg"
codesign --force -s - "$ROOT/build/bin/ffmpeg" >/dev/null 2>&1 || true
echo "built: $ROOT/build/bin/ffmpeg ($(du -h "$ROOT/build/bin/ffmpeg" | cut -f1), $(lipo -archs "$ROOT/build/bin/ffmpeg"))"
