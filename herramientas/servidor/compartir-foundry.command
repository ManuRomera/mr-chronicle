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
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  curl -fL --progress-bar "$base/cloudflared-darwin-arm64.tgz" | tar xz -C "$BIN" ;;
    Darwin-x86_64) curl -fL --progress-bar "$base/cloudflared-darwin-amd64.tgz" | tar xz -C "$BIN" ;;
    Linux-x86_64)  curl -fL --progress-bar -o "$CF" "$base/cloudflared-linux-amd64" ;;
    Linux-aarch64) curl -fL --progress-bar -o "$CF" "$base/cloudflared-linux-arm64" ;;
    *) echo "Sistema no soportado: $(uname -s) $(uname -m)"; exit 1 ;;
  esac
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
