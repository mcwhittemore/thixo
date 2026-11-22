import type { ServerContext } from "../context.js";

const FIXED = ["thixo/plugin", "thixo/ui", "thixo/data", "thixo/schema", "thixo/services"];

const LANGUAGE = `## The language (thx)

A plugin is a folder of .thx files: plugin.thx (the default export is definePlugin(slot, { name, description }, Component)),
an optional data.thx (annotate and store declarations), and any other .thx file it imports by relative path. Write
TypeScript with JSX. The build checks it and refuses anything outside the language. There are no warnings.

What is in:
- Modules: import and export with fixed names. A plugin imports thixo/*, @app/sdk, @app/sdk/optional, @app/slots, the
  exposed libraries listed below, and its own files. Nothing else.
- Values: numbers, strings, booleans, null, undefined, lists, records, functions, dates.
- const and let, destructuring, spread, default values. Declarations and arrows, closures, async and await.
- if, for...of, while, switch, return, ?:, &&, ||, ??, ?., try and catch.
- Template strings. The usual string, number and list methods (map, filter, reduce, find, sort, slice, split, join).
- Math, Date, JSON, Map, Set, each with a fixed list of methods.
- JSX: raw elements such as <div> and <svg>, components from thixo/ui, fragments, props, children, event handlers. Hooks
  come from thixo/plugin.
- TypeScript annotations: type, interface, unions, generics, optional fields. They are checked at build.

What is out (each is a build error):
- Globals: window, document, globalThis, fetch, setTimeout, localStorage. Reach the app through @app/sdk and thixo/plugin.
- eval, Function, import().
- Classes, this, new on anything but the built-ins, prototypes, constructor, __proto__.
- Proxy, Reflect, Symbol, getters and setters, with, var, delete, labels.
- any, "as", // @ts-ignore, the non-null "!".
- <script>, <iframe>, <object>, <embed> and attributes that take code.
- Refs and the real event object: a handler gets plain data (the value, the key, the position).
- == and != (use === and !==).
- Code at the top of a file other than declarations.

Where it differs from TypeScript:
- A record has only the fields it was given. todo.title reads a field. There is no prototype, no constructor, no inherited method.
- Methods belong to the language. A plugin can't replace list.map or add a method to every list.
- Values handed to a plugin (slot context, query results) are read-only. Change things by calling an endpoint or patching plugin data.
- Every loop and call is counted. A plugin that runs too long is stopped with an error the user sees.
- Imports are checked against a list. Anything else is a build error.`;

const ADDRESSES = `## The address rule

An image, a link, a font or a CSS url() sends a request, and an address can carry data out. So an address in a plugin is one
of two things:
- Written out in the source: <img src="https://example.com/logo.png">. It is fixed at build and must be on an allowed host.
- Handed to the plugin from outside it (an avatar address an endpoint returned, a route from the shell). It has the type
  Url. The plugin passes it along and can't look inside it, build one, join one from parts or add to one.
No string operation produces a Url. A field that holds an address is declared t.url(), and a plugin can write only a Url to
it, never a string. The manifest lists every outside address the source names.`;

const EXAMPLE = `## A worked example

This one is written for an app with a todo-detail slot, a getTodo endpoint and a Todo record. Use the names from the
generated modules above, not these.

--- plugin.thx
import { definePlugin, useAnnotation, useQuery, useStore } from "thixo/plugin";
import { DateInput, NumberInput, Stack, Text } from "thixo/ui";
import { todoDetail } from "@app/slots";
import { getTodo } from "@app/sdk";
import { due, prefs } from "./data";

export default definePlugin(
  todoDetail,
  { name: "Due dates", description: "Give a todo a due date and see a warning when it is close." },
  function DueDate({ context }) {
    const todo = useQuery(getTodo, { id: context.todoId });
    const [dates, patchDates] = useAnnotation(due, context.todoId);
    const [settings, patchSettings] = useStore(prefs);
    const warnDays = settings?.warnDaysBefore ?? 2;
    const close = dates?.dueOn && daysUntil(dates.dueOn) <= warnDays;
    return (
      <Stack>
        <Text>{todo.data?.title}</Text>
        <DateInput label="Due" value={dates?.dueOn} onChange={(dueOn) => patchDates({ dueOn })} />
        {close && <Text tone="warning">Due soon</Text>}
        <NumberInput label="Warn me this many days before" value={warnDays} onChange={(warnDaysBefore) => patchSettings({ warnDaysBefore })} />
      </Stack>
    );
  },
);

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

--- data.thx
import { annotate, store } from "thixo/data";
import { t } from "thixo/schema";
import { Todo } from "@app/sdk";

export const due = annotate(Todo, { dueOn: t.date() });
export const prefs = store("prefs", { fields: { warnDaysBefore: t.number() } });

The build derives the manifest from this: it requires the scopes of getTodo and of reading Todo, and declares an
annotation dueOn (date) on todo and a private store prefs { warnDaysBefore: number }. A field's type never changes
across versions (D8): a new type needs a new field name. Data declarations in data.thx must be exported consts with
literal arguments.`;

/** What an agent needs to write a plugin for this app. It is made from the app, so it changes when the app does. */
export function describeApp(ctx: ServerContext): string {
  const modules = ctx.compileEnv.modules;
  const order = [
    ...FIXED.filter((s) => s in modules),
    ...["@app/sdk", "@app/sdk/optional", "@app/slots"].filter((s) => s in modules),
    ...Object.keys(modules).filter((s) => !FIXED.includes(s) && !s.startsWith("@app/")),
  ];
  const declarations = order.map((specifier) => `### ${specifier}\n\n\`\`\`ts\n${modules[specifier].dts.trimEnd()}\n\`\`\``).join("\n\n");
  const scopes = Object.entries(ctx.app.scopes).map(([name, description]) => `- ${name}: ${description}`).join("\n");
  const slots = ctx.app.slots
    .map((s) => `- ${s.name} (export ${s.exportName}, ${s.kind})${s.children.length ? `, may place: ${s.children.join(", ")}` : ""}`)
    .join("\n");
  return [
    "# Writing a plugin for this app",
    LANGUAGE,
    ADDRESSES,
    `## The app\n\nScopes the app defines (the build derives which a plugin needs from what it imports):\n${scopes || "(none)"}\n\nSlots (a plugin fills exactly one, named by its export from @app/slots):\n${slots || "(none)"}`,
    `## The modules a plugin may import\n\nThese are the declarations the build checks against. @app/sdk, @app/sdk/optional and @app/slots are generated from this app.\n\n${declarations}`,
    EXAMPLE,
  ].join("\n\n");
}
