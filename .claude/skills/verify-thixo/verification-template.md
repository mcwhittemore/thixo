# Verification file

Every pull request has one, at `verifications/pr-<N>.md` (N is the PR number), committed on the PR's branch after the
PR is opened. CI (`.github/workflows/verification.yml`) fails without it. `scripts/check-verification.sh <N>` runs the
same check locally.

It exists so that every check is either done and recorded or recorded as not done. Nothing gets skipped silently.
It's also the data that improves verification: the Gaps sections across PRs say what to build next.

Copy this skeleton. Keep the four `##` headings exactly; CI looks for them.

```markdown
# Verification: PR #<N>

Addresses: #<issue>, #<issue>        (or "none")
Revision: <short sha the evidence was taken at>

## Verified

- **<feature-id from the map>: <what this shows>.**
  `<the exact command or step>`
  Saw: <the relevant output, trimmed: exit code, error line, render.json values>.
  Before the change: <what it did on origin/main> (for bug fixes and behavior changes)

## Not verified

- <the check, and why it wasn't done: costs money, no way to drive it, out of scope>
  (or "Nothing: every check the change calls for is under Verified.", but only if that's true)

## Gaps

- <what would have made verification easier or possible: a missing hook, a command that doesn't exist, a
  feature not in the map, a flaky step>
  (or "None.")

## Evidence

Local evidence folder: `artifacts/verify/<run-id>/` (not committed; rerun the commands above to reproduce)
```

Rules for the content:

- Every Verified entry can be rerun by someone else from the command alone.
- Name feature IDs from `.claude/skills/verify-thixo/features/`. A feature the map doesn't have goes under Gaps.
- Quote output, don't describe it. "Exit 1, `main.thx:2:14 thixo/no-global`" beats "it failed as expected".
- When a reviewer finds something you missed, add it here when you fix it.
