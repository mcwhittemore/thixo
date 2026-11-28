#!/usr/bin/env bash
# Builds @thixo/site, serves it under /thixo/ and drives it in headless Chromium; saves screenshots, page text and site.json.
# usage: site.sh --out <dir> [--do <json | @file>] [--no-build] [--wait <ms>]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
export VERIFY_CALLER_DIR="$PWD"
cd "$root"
exec node --import tsx "$here/site.ts" "$@"
