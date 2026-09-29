#!/bin/bash
# MR · Chronicle — instala lo necesario para procesar sesiones en Linux (x86_64 o ARM64).
# En una terminal: bash instalar-linux.sh
# No necesita sudo: todo va a ~/.cache/mr-chronicle. Requiere glibc 2.34 o superior
# (Ubuntu 22.04+, Debian 12+, Oracle Linux 9+, Fedora 35+).
set -euo pipefail

CASA="$HOME/.cache/mr-chronicle"
BIN="$CASA/bin"
WHISPER_VERSION=v1.9.2
DEEPFILTER_VERSION=0.5.6
MODELO_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
AQUI="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$BIN"

case "$(uname -m)" in
  x86_64)        ARQ=x64;   FFMPEG=amd64; DF=x86_64-unknown-linux-musl ;;
  aarch64|arm64) ARQ=arm64; FFMPEG=arm64; DF=aarch64-unknown-linux-gnu ;;
  *) echo "Arquitectura no soportada: $(uname -m)"; exit 1 ;;
esac

echo "== MR · Chronicle: herramientas de postproducción para Linux ($ARQ) =="

glibc="$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+$' || echo 0)"
if [ "$(printf '%s\n' 2.34 "$glibc" | sort -V | head -1)" != 2.34 ]; then
  echo "⚠ Tu sistema tiene glibc $glibc y whisper.cpp necesita 2.34 o superior: la transcripción no funcionará."
fi

bajar() { echo "  descargando $(basename "$1")"; curl -fL --progress-bar -o "$2" "$1"; }

echo "▸ ffmpeg"
if [ -x "$BIN/ffmpeg" ] || command -v ffmpeg >/dev/null; then echo "  ya estaba"; else
  bajar "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-$FFMPEG-static.tar.xz" "$TMP/ffmpeg.tar.xz"
  tar -xJf "$TMP/ffmpeg.tar.xz" -C "$TMP"
  cp "$TMP"/ffmpeg-*-static/ffmpeg "$BIN/"
fi

echo "▸ Node.js"
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then echo "  ya estaba"
elif [ -x "$BIN/node" ]; then echo "  ya estaba"
else
  version="$(curl -fsL https://nodejs.org/dist/index.json | grep -oE '"version":"v[0-9.]+"[^}]*"lts":"[A-Za-z]+"' | head -1 | grep -oE 'v[0-9.]+' | head -1)"
  bajar "https://nodejs.org/dist/$version/node-$version-linux-$ARQ.tar.xz" "$TMP/node.tar.xz"
  rm -rf "$CASA/node" && mkdir -p "$CASA/node"
  tar -xJf "$TMP/node.tar.xz" -C "$CASA/node" --strip-components=1
  ln -sf "$CASA/node/bin/node" "$BIN/node"
fi

echo "▸ whisper.cpp $WHISPER_VERSION"
if [ -x "$BIN/whisper-cli" ]; then echo "  ya estaba"; else
  bajar "https://github.com/ggml-org/whisper.cpp/releases/download/$WHISPER_VERSION/whisper-bin-ubuntu-$ARQ.tar.gz" "$TMP/whisper.tar.gz"
  tar -xzf "$TMP/whisper.tar.gz" -C "$BIN" --strip-components=1
fi

echo "▸ DeepFilterNet $DEEPFILTER_VERSION"
if [ -x "$BIN/deep-filter" ]; then echo "  ya estaba"; else
  bajar "https://github.com/Rikorose/DeepFilterNet/releases/download/v$DEEPFILTER_VERSION/deep-filter-$DEEPFILTER_VERSION-$DF" "$BIN/deep-filter"
  chmod +x "$BIN/deep-filter"
fi

echo "▸ Modelo de Whisper large-v3-turbo (1,6 GB; si se corta, vuelve a ejecutar y sigue donde iba)"
if [ -f "$CASA/ggml-large-v3-turbo.bin" ]; then echo "  ya estaba"; else
  curl -fL -C - --progress-bar -o "$CASA/ggml-large-v3-turbo.bin.parte" "$MODELO_URL"
  mv "$CASA/ggml-large-v3-turbo.bin.parte" "$CASA/ggml-large-v3-turbo.bin"
fi

echo
NODE="$(command -v node || echo "$BIN/node")"
[ -x "$BIN/node" ] && NODE="$BIN/node"
"$NODE" "$AQUI/../post/mr-chronicle-post.mjs" --comprobar && echo && echo "Listo. Para procesar una sesión: bash procesar.command"
