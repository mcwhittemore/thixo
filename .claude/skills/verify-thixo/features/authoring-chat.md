# The authoring chat with a real model

A person types what they want into `Ask for a plugin`, and Thixo's agent finds, forks or writes a plugin, checks it until it builds, stores it, and puts it in their layout. The log shows each tool call and what it came to. When the agent's `use` is confirmed, the page shows the new plugin at once, without a reload. This recipe runs the app's real model adapter (in the examples, `claudeCode()`: the local `claude` command), so it spends model usage.

## Sub-features

- `chat-send` sends on Enter in textbox `Message` (Shift+Enter is a new line); the button reads `Working…` and a status `The agent is working…` while the turn runs.
- `chat-tool-lines` shows a line per tool call that becomes the tool's outcome: `search_registry found 3 plugins`, `check passed`, `submit stored plg_…@2`, `use put plg_…@2 in main/todo-row (confirmed in your layout)`, or `<tool> failed: <message>` with `data-ok="false"`.
- `chat-use-confirmed` has `use` name the slot by its full path and read the layout entry back. The default prompt tells the model to confirm it before saying the plugin shows.
- `chat-live-page` loads the layout again right after a confirmed `use`, so the slot shows the new plugin without a reload.
- `chat-final-message` keeps the newest line in view, so the agent's last message is not cut off.
- `chat-buttons` asks the model, in the default prompt, to make anything clickable a real button.
- `chat-continue` sends the next message with the conversation id the last turn ended with.

## How to get to it (user POV)

- In an app whose config has a `model`, signed in as a user who holds `thixo.plugins.author` (`ana` in the todo example), press `Ask for a plugin`, type a request and press Enter.

## Driving it with drive.mjs and cli.mjs

Preconditions:

- `npm run build` has run. `node .claude/skills/verify-thixo/bin/launch.mjs --run <id>` (or `--app <folder>` for another app) printed its state and `doctor.mjs --run <id>` printed `healthy`.
- The `claude` command is installed and signed in (for `claudeCode()`), or the app's config names another model adapter with its key.
- `C` is `node .claude/skills/verify-thixo/bin/cli.mjs --run <id> --`.

- **One turn.** Run `ASK="Add a star button to each todo row that marks the todo as important. Clicking it toggles the star." EXPECT_USE=1 WAIT_MS=300000 node .claude/skills/verify-thixo/bin/drive.mjs --run <id> --as ana --script .claude/skills/verify-thixo/journeys/chat.mjs --name chat`. It prints `ok Enter sent the message and the status says the agent is working`, `ok the turn ended with Done`, a `tools:` line with each outcome, and `ok a use the layout confirmed: use put plg_…@<n> in main/todo-row (confirmed in your layout)`. Any `failed tool calls:` line lists what the model had to recover from.
- **The page, without a reload.** `chat/03-end.aria.txt` has a region `<plugin name> (main/todo-row)` in each row, holding a `button` (not text): in run repair-r2, `button "☆ Mark important"` three times. The Done badge is gone from the rows: a slot holds one plugin.
- **The final message.** `chat/03-end.png` shows the agent's last paragraph and `Done` at the bottom of the log, not cut off.
- **Stored where it shows.** Run `C registry list`: the plugin is `personal  ana` with its versions, and its SLOT column reads `main/todo-row`. Run `PLUGIN="<plugin name>" node .claude/skills/verify-thixo/bin/drive.mjs --run <id> --as ana --script .claude/skills/verify-thixo/journeys/row-plugin.mjs --name row-plugin`: `ok <name> fills main/todo-row in 3 rows`.
- **Not for ben.** `node .claude/skills/verify-thixo/bin/drive.mjs --run <id> --as ben --name ben` shows `Done badge (main/todo-row)` in the rows: ana's plugin is hers.
- **Scripted, in the suites.** `npm test -w thixo`: `shell.test.ts` `the authoring chat streams the agent's events, shows each tool's outcome, and the page shows what use put in the layout without a reload`, and `authoring.test.ts` `use names a child slot by its path…` (the describe line, `confirmed`, the prompt).
- **Proof.** Keep `artifacts/verify/<id>/chat/` (`requests.json` has the `POST /_thixo/authoring/chat` and a `GET /_thixo/layout` after it), `cli/*.txt` and `dev.log`. Run `cleanup.mjs --run <id>`.

## Gotchas

- It costs model usage and takes 30 s to a few minutes. It is not part of a routine run: say so rather than reporting it verified.
- The model chooses its own path. In run repair-r2 it searched twice, read the Done badge, described the app, forked the badge, checked, submitted v2 and used it at `main/todo-row`, confirmed. Another run may write from nothing. Prove the outcome (the rows, the registry), not the exact tool sequence.
- A fork of another author's plugin makes v1 (the copy) then v2 (the change), so a first request can leave a plugin with versions `1,2`.
- An annotation the plugin adds is shared by the todo's group: ben (also in `design`) can read ana's stars through any plugin that reads that field. A store is per user.
- The chat's conversation lives in the server's memory. A restart forgets it; the next message starts a new one.
