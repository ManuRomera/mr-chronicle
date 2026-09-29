#!/bin/bash
# MR · Chronicle — procesa una sesión. Mac: doble clic. Linux: bash procesar.command
# Arrastra a la ventana la carpeta de la sesión (la que tiene una subcarpeta por participante).
AQUI="$(cd "$(dirname "$0")" && pwd)"
CARPETA="${1:-}"
if [ -z "$CARPETA" ]; then
  read -r -p "Arrastra aquí la carpeta de la sesión y pulsa Intro: " CARPETA
  # Al arrastrar, Terminal pone espacios escapados, comillas o un espacio final.
  CARPETA="${CARPETA//\\ / }"; CARPETA="${CARPETA%"${CARPETA##*[![:space:]]}"}"
  CARPETA="${CARPETA#\'}"; CARPETA="${CARPETA%\'}"; CARPETA="${CARPETA#\"}"; CARPETA="${CARPETA%\"}"
fi
NODE="$HOME/.cache/mr-chronicle/bin/node"
[ -x "$NODE" ] || NODE=node
"$NODE" "$AQUI/../post/mr-chronicle-post.mjs" "$CARPETA"
[ -z "${1:-}" ] && read -r -p "Pulsa Intro para cerrar" _
