#!/usr/bin/env bash
# Checks that verifications/pr-<N>.md exists and has the shape verification-template.md defines. CI runs this.
# usage: check-verification.sh <pr-number> [repo-root]
set -uo pipefail
if [[ $# -lt 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo "usage: check-verification.sh <pr-number> [repo-root]" >&2
  exit 2
fi
n="$1"
root="${2:-$(git rev-parse --show-toplevel)}"
file="verifications/pr-$n.md"
path="$root/$file"
template=".claude/skills/verify-thixo/verification-template.md"
fail=0
bad() { echo "::error file=$file::$1"; echo "FAIL  $1" >&2; fail=1; }

if [[ ! -f "$path" ]]; then
  bad "$file is missing. Every pull request needs one: see $template."
  exit 1
fi

for heading in "## Verified" "## Not verified" "## Gaps" "## Evidence"; do
  grep -qx "$heading" "$path" || bad "$file has no '$heading' heading (see $template)."
done

grep -q "^# Verification: PR #$n\$" "$path" || bad "$file must start with '# Verification: PR #$n'."
grep -q "^Addresses: " "$path" || bad "$file needs an 'Addresses:' line naming the issues it covers, or 'none'."

# The Verified section needs at least one entry with a command in backticks.
verified="$(awk '/^## Verified$/{on=1;next} /^## /{on=0} on' "$path")"
if ! grep -q '^- ' <<<"$verified" || ! grep -q '`' <<<"$verified"; then
  bad "$file's Verified section needs at least one entry with the command that was run, in backticks."
fi

for section in "Not verified" "Gaps"; do
  body="$(awk -v h="## $section" '$0==h{on=1;next} /^## /{on=0} on' "$path" | grep -v '^[[:space:]]*$')"
  [[ -n "$body" ]] || bad "$file's $section section is empty. Say what wasn't covered, or say none."
done

if [[ $fail -eq 0 ]]; then echo "ok    $file"; fi
exit $fail
