# Security

What thixo promises a program can't do, what has to be trusted for that to hold, and how it is tested.

## What a program can't do

Each row is a goal in [the benchmark](../bench/readme.md): an agent is told to do it and the arena checks whether it
did.

| A program can't | Goal |
| --- | --- |
| Read the page outside its box: other elements, cookies, storage, globals | `read-dom`, `read-cookie`, `read-storage`, `read-global` |
| Send a request to another server | `network-out` |
| Send a request to the page's own server | `network-home` |
| Run JavaScript of its own choosing, outside the guards | `run-script` |
| Change, cover or add to the page outside its box | `write-outside` |
| Navigate the page | `navigate` |
| Hang the page | `hang` (a goal, not yet a promise: a long call into a built-in or a host function isn't counted) |

It can do what its host hands it. A host function that leaks is the host's leak.

## What is trusted

| Trusted | For what |
| --- | --- |
| The compiler | Refusing everything outside the language, and emitting code that goes through the runtime for every field read, call, element and loop. Its output has no free names, and a second check, `verifyOutput`, written apart from it, parses the output again to make sure. |
| The runtime | Values with nothing behind them, the language's own methods, the element and attribute allowlist, addresses, the step counter. |
| `thixo/browser` | Building the `thixo` module over React, wrapping the host's modules, and mounting the program in a box it can't draw out of. |
| The host | What it hands in. Host modules are ordinary JavaScript, trusted the way the page's own code is. |

**The compiler and runtime are the whole wall.** There is no iframe or worker behind them. One gap in what they let
through gives a program the page, which is why the wall is tested by agents whose only job is to break out.

## Three layers

1. **At compile.** The TypeScript checker runs with the language's own lib and nothing else, so a name that isn't
   imported, declared or a built-in doesn't exist. The emitter walks every node and has a case for each one it
   allows; any other kind is an error. Nothing reaches the output that the emitter did not write.
2. **The output check.** `verifyOutput` parses the emitted module and fails if it names anything it did not
   declare, other than the guard object it is handed.
3. **At run time.** Every field read goes through a guard that sees own data fields only. Records handed in are
   frozen copies. Every element passes one allowlist check before it reaches React. Loops and calls tick a counter,
   and a program that runs out is stopped and stays stopped.

## Known gaps

- **Hanging.** A long call into a built-in, such as a sort of a huge list, or into a host function, is not
  counted.
- **Links leak a click.** A written-out link may go to any https host. Clicking it tells that host which link was
  clicked, one choice per click, where the user can see it.
- **A host's `Url` is loaded wherever it points.** A host that hands in addresses from user data hands in a
  tracking pixel for whoever wrote them.
- **Side channels.** Timing and the rendering of the box itself are not defended.

## Testing it

- `npm test` runs the package's own hostile programs: each must fail to compile with a clear error, or compile and
  be inert when it runs (`packages/thixo/test/escape.test.ts`, `guards.test.ts`, `verify.test.ts`).
- `npm run bench` sets an agent loose on each goal. A success is a bug: save the program, fix the wall, and keep the
  program as a test.
