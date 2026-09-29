#!/bin/bash
# MR · Chronicle — instala lo necesario para procesar sesiones en un Mac.
# Doble clic en Finder, o en Terminal: bash instalar-mac.command
# Todo va a ~/.cache/mr-chronicle (ffmpeg, whisper.cpp y Node con Homebrew).
set -euo pipefail

CASA="$HOME/.cache/mr-chronicle"
BIN="$CASA/bin"
DEEPFILTER_VERSION=0.5.6
MODELO_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
AQUI="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$BIN"

echo "== MR · Chronicle: herramientas de postproducción para Mac =="

if ! command -v brew >/dev/null; then
  echo
  echo "Falta Homebrew, el instalador de programas para Mac. Instálalo pegando esto en Terminal"
  echo "(te pedirá la contraseña del Mac) y después vuelve a abrir este instalador:"
  echo
  echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  echo
  read -r -p "Pulsa Intro para cerrar" _
  exit 1
fi

echo "▸ ffmpeg, whisper.cpp y Node (Homebrew)"
# Solo lo que falte: `brew install` actualizaría lo que ya está instalado, y eso no nos toca.
for par in ffmpeg:ffmpeg whisper-cli:whisper-cpp node:node; do
  if command -v "${par%%:*}" >/dev/null; then echo "  ${par%%:*} ya estaba"; else brew install "${par##*:}"; fi
done

echo "▸ DeepFilterNet $DEEPFILTER_VERSION"
if [ ! -x "$BIN/deep-filter" ]; then
  [ "$(uname -m)" = arm64 ] && objetivo=aarch64-apple-darwin || objetivo=x86_64-apple-darwin
  curl -fL --progress-bar -o "$BIN/deep-filter" \
    "https://github.com/Rikorose/DeepFilterNet/releases/download/v$DEEPFILTER_VERSION/deep-filter-$DEEPFILTER_VERSION-$objetivo"
  chmod +x "$BIN/deep-filter"
  xattr -d com.apple.quarantine "$BIN/deep-filter" 2>/dev/null || true
else
  echo "  ya estaba"
fi

echo "▸ Modelo de Whisper large-v3-turbo (1,6 GB; si se corta, vuelve a abrir el instalador y sigue donde iba)"
if [ ! -f "$CASA/ggml-large-v3-turbo.bin" ]; then
  curl -fL -C - --progress-bar -o "$CASA/ggml-large-v3-turbo.bin.parte" "$MODELO_URL"
  mv "$CASA/ggml-large-v3-turbo.bin.parte" "$CASA/ggml-large-v3-turbo.bin"
else
  echo "  ya estaba"
fi

echo
node "$AQUI/../post/mr-chronicle-post.mjs" --comprobar && echo && echo "Listo. Para procesar una sesión, abre procesar.command."
read -r -p "Pulsa Intro para cerrar" _
