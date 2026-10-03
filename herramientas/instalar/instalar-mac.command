#!/bin/bash
# MR · Chronicle — instala lo necesario para procesar sesiones en un Mac.
# Doble clic en Finder, o en Terminal: bash instalar-mac.command
# Todo va a ~/.cache/mr-chronicle (ffmpeg, whisper.cpp y Node con Homebrew).
set -euo pipefail

CASA="$HOME/.cache/mr-chronicle"
BIN="$CASA/bin"
DEEPFILTER_VERSION=0.5.6
MODELO_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"

# Comprobación de las descargas con huella fija (SHA-256): lo que no coincide no se instala.
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
verificar() {
  if [ "$(sha "$1")" != "$2" ]; then
    echo "✖ La descarga $(basename "$1") no coincide con la huella esperada. No se instala."; rm -f "$1"; exit 1
  fi
}
MODELO_SHA=1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69
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
  [ "$(uname -m)" = arm64 ] && { objetivo=aarch64-apple-darwin; huella=4601e7f4e4c03e59a4c5b5000216ef3add3e808799cfccd95e14e83ea4611081; } || { objetivo=x86_64-apple-darwin; huella=d3be84003acb7c23e738ad7f70a158ec779a8d233a82e7fa3e717d112eb5b50f; }
  curl -fL --progress-bar -o "$BIN/deep-filter" \
    "https://github.com/Rikorose/DeepFilterNet/releases/download/v$DEEPFILTER_VERSION/deep-filter-$DEEPFILTER_VERSION-$objetivo"
  verificar "$BIN/deep-filter" "$huella"
  chmod +x "$BIN/deep-filter"
  xattr -d com.apple.quarantine "$BIN/deep-filter" 2>/dev/null || true
else
  echo "  ya estaba"
fi

echo "▸ Modelo de Whisper large-v3-turbo (1,6 GB; si se corta, vuelve a abrir el instalador y sigue donde iba)"
if [ ! -f "$CASA/ggml-large-v3-turbo.bin" ]; then
  curl -fL -C - --progress-bar -o "$CASA/ggml-large-v3-turbo.bin.parte" "$MODELO_URL"
  verificar "$CASA/ggml-large-v3-turbo.bin.parte" "$MODELO_SHA"
  mv "$CASA/ggml-large-v3-turbo.bin.parte" "$CASA/ggml-large-v3-turbo.bin"
else
  echo "  ya estaba"
fi

echo
node "$AQUI/../post/mr-chronicle-post.mjs" --comprobar && echo && echo "Listo. Para procesar una sesión, abre procesar.command."
read -r -p "Pulsa Intro para cerrar" _
