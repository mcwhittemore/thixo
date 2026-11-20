# Contributing

Tailor is at the requirements stage. The work right now is on the documents, not on code.

## How a change is made

1. **Find the requirement.** Every point in [the requirements](docs/02-requirements.md) has an id and a status.
2. **Push on it.** If a Proposed requirement is wrong, say what it should be and why.
3. **Record the outcome.** When something is settled, add an entry to [decisions](docs/07-decisions.md), set the
   requirement to Decided and remove the matching open question.
4. **Test it against the example.** If the change alters how an app reads, update
   [examples/todo](examples/todo). If the example gets awkward, the requirement is wrong.

## Rules for the documents

- A requirement is Decided only when its entry in the decisions log says who settled it and why.
- Decisions are never edited. A reversal is a new entry that names the one it replaces.
- A word used in the docs means what [concepts](docs/01-concepts.md) says it means. Add the word there first.
- What is not settled is written down as open. Nothing is left implied.
- File and folder names are kebab-case.

## Code

Framework code is not accepted yet. Sketches in `examples/` are welcome when they test a requirement.
