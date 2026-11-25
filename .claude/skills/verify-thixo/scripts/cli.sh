#!/usr/bin/env bash
# Runs the built thixo command and records it: the command, stdout, stderr and exit code, under <run-dir>.
# usage: cli.sh <run-dir> <step-name> -- <thixo args...>
# Exits with thixo's own exit code, so a failing compile is visible to the caller.
set -uo pipefail
if [[ $# -lt 4 || "$3" != "--" ]]; then
  echo "usage: cli.sh <run-dir> <step-name> -- <thixo args...>" >&2
  exit 2
fi
run="$1"; step="$2"; shift 3
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
mkdir -p "$run"
dir="$run/$step"
mkdir -p "$dir"
printf 'thixo' > "$dir/command.txt"; printf ' %q' "$@" >> "$dir/command.txt"; echo >> "$dir/command.txt"
node "$root/packages/cli/bin/thixo.js" "$@" > "$dir/stdout.txt" 2> "$dir/stderr.txt"
code=$?
echo "$code" > "$dir/exit-code.txt"
echo "$ $(cat "$dir/command.txt")"
echo "exit $code"
if [[ -s "$dir/stdout.txt" ]]; then echo "--- stdout ($(wc -c < "$dir/stdout.txt" | tr -d ' ') bytes)"; head -c 2000 "$dir/stdout.txt"; echo; fi
if [[ -s "$dir/stderr.txt" ]]; then echo "--- stderr"; head -c 2000 "$dir/stderr.txt"; echo; fi
exit "$code"
