#!/usr/bin/env bash
# Read-only: is this checkout worth driving? Prints one line per check and exits 1 if any check fails.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
cd "$root"
fail=0
pass() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; fail=1; }

echo "checkout  $root"
echo "revision  $(git rev-parse --short HEAD)$(git diff --quiet HEAD -- packages bench 2>/dev/null || echo ' (uncommitted changes in packages/ or bench/)')"

node_v="$(node -p 'process.versions.node' 2>/dev/null || echo none)"
if node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; then pass "node $node_v (>= 22.13)"; else bad "node $node_v: needs >= 22.13"; fi

if [[ -d node_modules/@thixo/core && -d node_modules/playwright && -d node_modules/tsx ]]; then pass "npm install has run"; else bad "node_modules incomplete: run npm install"; fi

for pkg in core cli react; do
  newest_src="$(find "packages/$pkg/src" -type f -newer "packages/$pkg/dist" 2>/dev/null | head -1)"
  if [[ ! -d "packages/$pkg/dist" ]]; then bad "packages/$pkg/dist missing: run npm run build"
  elif [[ -n "$newest_src" ]] && [[ -z "$(find "packages/$pkg/dist" -type f -newer "$newest_src" | head -1)" ]]; then bad "packages/$pkg/dist is older than $newest_src: run npm run build"
  else pass "packages/$pkg/dist is built"; fi
done

usage="$(node packages/cli/bin/thixo.js 2>&1)"; code=$?
if [[ $code -eq 2 && "$usage" == usage:\ thixo\ compile* ]]; then pass "thixo command answers (usage, exit 2)"; else bad "thixo command: exit $code, said: ${usage:0:200}"; fi

chrome="$(node -e 'const {chromium}=require("playwright");const p=chromium.executablePath();process.stdout.write(require("fs").existsSync(p)?p:"")' 2>/dev/null)"
if [[ -n "$chrome" ]]; then pass "playwright chromium installed"; else bad "playwright chromium missing: run npx playwright install chromium"; fi

exit $fail
