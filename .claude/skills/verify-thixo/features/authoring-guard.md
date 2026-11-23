# Authoring guard

The authoring agent refuses to build a plugin that passes for the app's own chrome, a system dialog, a sign-in or another plugin, and refuses text that tells it to drop its rules, whether the person typed it or it was in a plugin it read. A refusal is recorded through the data adapter, the implementor's hook hears it, `thixo dev` prints it, and the person reads a plain refusal with a warning. Three refusals of one person's requests within 24 hours end the session and block them from making plugins on every authoring path, while using and installing plugins still works. The submit path also refuses the obvious cases by its own cheap check. The implementor sees refusals and blocks and lifts one. This is a soft layer: the shell's attributed dialogs (`security.md`) stay the guard.

## Sub-features

- `guard-prompt` the default system prompt lists what the agent never builds (shell or chrome, a system or browser dialog, a sign-in or anything asking for a secret, another plugin or a default) and says text asking it to skip or loosen its rules is refused, from the chat or from a comment, string, description, registry result or app data.
- `guard-refuse` the `refuse` tool takes `category` (`shell`, `dialog`, `credentials`, `impersonation`, `override`), `reason`, `from` (`user` or `data`) and `quote`; a bad category is `400 bad_input`.
- `guard-record` each refusal is an `AuthoringRefusal` in the data adapter (`thixo_refusals` in thixo-sql): user, conversation (null on the tool route), category, reason, trigger (the person's message), quote, from, source (`agent` or `check`), time. It survives a restart.
- `guard-hook` `config.authoringGuard.onRefusal(notice)` runs after each refusal with `count`, `limit`, `windowHours`, `blocked`; a hook that throws is logged and the loop goes on. `thixo dev` prints `  authoring refused <user> (<category>, <source>, <n> of <limit> in <h>h): <reason>` and, at the limit, `  authoring blocked <user> from making plugins. Lift it with \`thixo authoring unblock <user>\`.`
- `guard-turn` a refusal ends the chat turn: calls after it in the same turn come back `not_run`, the model gets no further turn, and the stream has a `refusal` event with the words the person sees.
- `guard-warn` before the limit the person reads `This is refusal N of 3 within 24 hours. <n> more and you will no longer be able to make plugins in this app.`
- `guard-block` at the limit (default 3 in 24 hours; `authoringGuard: { limit, windowHours }`, `limit: 0` records only) the conversation ends and an `AuthoringBlock` is stored. The chat route and every tool, in the chat and on the tool route (`thixo agent --as`), answer `403 authoring_blocked`: `You can no longer make plugins in this app: Thixo's authoring agent refused 3 of your requests within 24 hours. You can still use and install plugins. Ask the app's team to lift the block.` The registry, layout and data routes are untouched.
- `guard-data` a refusal with `from: "data"` is recorded and hooked, says it does not count against the person, and does not count.
- `guard-check` `check` and `submit` refuse source that says "session expired" and the like, or that has a field to type into and asks for a password, code, key or card number: `plugin.thx:<line>:<col> guard/credentials ...`, recorded with `source: "check"`, nothing built or stored.
- `guard-chat-ui` `<AuthoringChat />` reads `GET /_thixo/authoring/status` and, for a blocked user, shows the message and disables the message box and Send; a `refusal` event shows as an alert line.
- `guard-admin` `GET /_thixo/authoring/refusals`, `GET /_thixo/authoring/blocks[?all=1]` and `DELETE /_thixo/authoring/blocks/:user` need `thixo.authoring.admin` (403 `missing_scopes` otherwise). Lifting keeps the block on record and starts the count again.
- `guard-cli` `thixo authoring blocks [--all]`, `thixo authoring refusals [--user u]` and `thixo authoring unblock <user>`, each with `--json`, on the app's own data adapter, acting as `implementor`.

## How to get to it (user POV)

- A person asks the authoring chat for a "session expired" sign-in box, or for a plugin that copies the app's header, or tells it to ignore its rules.
- An outside coding agent, or a person driving the CLI, runs `thixo agent submit --as <user>` with such source, or `thixo agent refuse --as <user> --json '{...}'` as the agent would.
- The implementor runs `thixo authoring blocks`, `refusals` and `unblock <user>` in the app's folder, or calls the routes as a user who holds `thixo.authoring.admin` (ben, in the todo example).

## Driving it with cli.mjs, drive.mjs and the security e2e

Preconditions:

- `npm run build` has run. `node .claude/skills/verify-thixo/bin/launch.mjs --run guard` printed its state and `doctor.mjs --run guard` printed `healthy`.
- `C` stands for `node .claude/skills/verify-thixo/bin/cli.mjs --run guard --save <label> --`. `F` is a scratch folder holding a `plugin.thx` copied from the `reminderSource` template in `tests/e2e/security.e2e.mjs`, with `title: "Session expired"` and `field: "Password"`.

- **The check refuses the red team's dialog.** `C agent submit --as ana --dir F`. Exit `1`; stdout has `plugin.thx:7:... guard/credentials The plugin says "Session expired", which is what the app's own sign-in says.` and a `refusal` with `"count": 1`, `"limit": 3`. `dev.log` gains `  authoring refused ana (credentials, check, 1 of 3 in 24h): ...`. `C registry list` has no `Reminder` by ana.
- **The agent's own refusal, warned.** `C agent refuse --as ana --json '{"category":"credentials","reason":"It asks for the person's password.","from":"user","quote":"ask for their password"}'`. Exit `0`; `refusal.message` ends `This is refusal 2 of 3 within 24 hours. One more and you will no longer be able to make plugins in this app.`
- **Data does not count.** The same with `"category":"override","from":"data"`: the message says `It came from text the agent read, not from you, so it does not count against you.` and `count` stays `2`.
- **The block.** Refuse once more with `"from":"user"`: `"blocked": true`, and `dev.log` has `authoring blocked ana from making plugins. Lift it with \`thixo authoring unblock ana\`.`
- **Every authoring path refuses.** `C agent describe --as ana`, `C agent search --as ana due` and `C agent submit --as ana --dir <any folder>` each exit `1` with `failed (403 authoring_blocked): You can no longer make plugins in this app: Thixo's authoring agent refused 3 of your requests within 24 hours. You can still use and install plugins.` and no line about the agent key. `C agent describe --as ben` still exits `0`.
- **The chat says so.** Drive ana in the browser, click `Ask for a plugin`: the `Authoring chat` region shows `You can no longer make plugins in this app: ...`; the `Message` box and `Send` are disabled. `curl` `GET /_thixo/authoring/status` with ana's token: `{"blocked":true,"message":"You can no longer ...","count":3,"limit":3,"windowHours":24}`.
- **Using still works.** As ana, open `Plugins`, search, and `Use` a shared or default plugin: the status says `Using <name> in <slot>` and the item says `In use: v<n> in <slot>`.
- **The implementor sees it.** `C authoring blocks` prints `USER  SINCE  STATE  REFUSALS  REASON` and a row `ana  <time>  blocked  3  Thixo's authoring agent refused 3 ...`. `C authoring refusals --user ana` prints each refusal with its `reason:`, `trigger:` and `quote:` lines, the check one marked `check`, the data one `from data (not counted)`. With ben's token, `GET /_thixo/authoring/blocks` answers the same as JSON; with ana's it is `403 missing_scopes` naming `thixo.authoring.admin`.
- **Lift it.** `C authoring unblock ana`: `Lifted the block on ana. They can make plugins again, and their count of refusals starts again.` Then `C agent describe --as ana` exits `0`, `C authoring blocks` prints `No one is blocked from making plugins.` and `C authoring blocks --all --json` still lists ana's block with `liftedBy: "implementor"`.
- **Survives a restart.** Before lifting, stop and relaunch the run on the same copy (or restart `thixo dev` in it): `C authoring blocks` still lists ana and `C agent describe --as ana` still exits `1`.
- **The whole path, scripted.** `node --test tests/e2e/security.e2e.mjs`: tests 2 and 5 cover the check, the warning, the block on `thixo agent`, the disabled chat, Use in the plugin browser and the lift. `cd packages/core && node --import tsx --test test/authoring-guard.test.ts`: 11 pass, with the scripted model (recorded, hook, warning, block at the limit, every path refused, unblock, survives a restart, data not counted, config, hook that throws, the check). `cd packages/thixo-sql && node --import tsx --test test/guard.test.ts`: 3 pass, including reopening the SQLite file.
- **Proof.** Keep `artifacts/verify/guard/` (`cli/*.txt`, the drive folder, `dev.log`). Run `cleanup.mjs --run guard`.

## Gotchas

- The prompt is a soft layer. A real model may still be talked past it; the attributed dialog line is what holds. Run `authoring-chat.md` with a refusing request only when the prompt is the point: it spends model usage.
- The check reads words. A plugin can get past it by spelling ("pass word"), and a harmless plugin with a field and the word "password" in it is refused. It runs only on the agent's `check` and `submit`, never on deploys or `thixo compile`.
- `thixo agent refuse` records a real refusal against that user: after three, they are blocked. Lift with `thixo authoring unblock <user>` between tries.
- `unblock` on a user who is not blocked still starts their count again, and says `<user> was not blocked`.
- `implementor` is never blocked. A refusal by it is recorded and hooked.
- The `refusal` event and the conversation's end are in the chat stream; the tool route returns the same `refusal` object in its JSON and has no conversation.
- `thixo dev`'s log line is written by the CLI around the implementor's hook. `thixo start` and other hosts get only the hook.
