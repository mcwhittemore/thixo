#!/usr/bin/env bash
# Mounts a compiled thixo program in headless Chromium with thixo-react and saves screenshots and render.json.
# usage: render.sh <compiled.js> --out <dir> [--wait <ms>] [--no-poke]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
cd "$root"
args=()
for a in "$@"; do
  if [[ "$a" != -* && -e "$OLDPWD/$a" && "$a" != /* ]]; then args+=("$OLDPWD/$a"); else args+=("$a"); fi
done
exec node --import tsx "$here/render.ts" "${args[@]}"
