#!/bin/bash
# MR · Chronicle — comparte tu Foundry con una dirección HTTPS gratuita (túnel de Cloudflare).
# Para el máster que tiene Foundry en su ordenador (o en un servidor Linux).
# Mac: doble clic. Linux: bash compartir-foundry.command [puerto]
#
# Los jugadores necesitan HTTPS para poder grabar. Esto da una dirección
# https://algo.trycloudflare.com que lleva a tu Foundry, sin dominio, sin abrir puertos del
# router y sin que los jugadores instalen nada. Mientras esta ventana esté abierta, funciona.
set -euo pipefail

CLOUDFLARED_VERSION=2026.9.3
BIN="$HOME/.cache/mr-chronicle/bin"
mkdir -p "$BIN"
CF="$BIN/cloudflared"

if [ ! -x "$CF" ]; then
  echo "▸ Descargando cloudflared $CLOUDFLARED_VERSION (solo la primera vez)…"
  base="https://github.com/cloudflare/cloudflared/releases/download/$CLOUDFLARED_VERSION"
  # Se baja a un archivo, se comprueba su huella SHA-256 y solo entonces se instala.
  sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  archivo=cloudflared-darwin-arm64.tgz; huella=587c2cfb1c230fe36c7fa7727da78be459dae028cabe8c001291999350f07095 ;;
    Darwin-x86_64) archivo=cloudflared-darwin-amd64.tgz; huella=d1155d0837487f261183b15c1eab6c4ebcad9dc49b94675f1524c3564cea3977 ;;
    Linux-x86_64)  archivo=cloudflared-linux-amd64; huella=77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2 ;;
    Linux-aarch64) archivo=cloudflared-linux-arm64; huella=aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d ;;
    *) echo "Sistema no soportado: $(uname -s) $(uname -m)"; exit 1 ;;
  esac
  descarga="$(mktemp)"
  curl -fL --progress-bar -o "$descarga" "$base/$archivo"
  if [ "$(sha "$descarga")" != "$huella" ]; then echo "✖ La descarga no coincide con la huella esperada. No se instala."; rm -f "$descarga"; exit 1; fi
  case "$archivo" in *.tgz) tar xz -C "$BIN" -f "$descarga"; rm -f "$descarga" ;; *) mv "$descarga" "$CF" ;; esac
  chmod +x "$CF"
  xattr -d com.apple.quarantine "$CF" 2>/dev/null || true
fi

PUERTO="${1:-}"
if [ -z "$PUERTO" ]; then
  read -r -p "¿En qué puerto está Foundry? [30000]: " PUERTO
fi
PUERTO="${PUERTO:-30000}"

if ! curl -s -o /dev/null "http://localhost:$PUERTO"; then
  echo "⚠ No responde nada en http://localhost:$PUERTO. Arranca Foundry primero (y lanza el mundo)."
  read -r -p "Pulsa Intro para cerrar" _
  exit 1
fi

echo
echo "▸ Abriendo el túnel hacia http://localhost:$PUERTO … (tarda unos segundos)"
echo "  Deja esta ventana abierta durante toda la partida. Para cerrarlo: Ctrl+C o cierra la ventana."
echo
"$CF" tunnel --no-autoupdate --url "http://localhost:$PUERTO" 2>&1 | while IFS= read -r linea; do
  if [[ "$linea" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
    url="${BASH_REMATCH[1]}"
    echo
    echo "=================================================================="
    echo "  Pasa esta dirección a tus jugadores (y úsala tú también):"
    echo
    echo "      $url"
    echo
    echo "  IMPORTANTE: cualquiera con la dirección puede llegar a tu Foundry."
    echo "  Pon contraseña a los usuarios, sobre todo al máster."
    echo "  La dirección cambia cada vez que abres el túnel."
    echo "=================================================================="
    echo
  elif [[ "$linea" =~ (ERR|error) ]]; then
    echo "$linea"
  fi
done
