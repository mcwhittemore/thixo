// Where plugins go (S1). The app defines each slot (S5): its size, and its
// contract (S10): the context the shell passes in, and the events a plugin
// can send back. Each slot is filled by one plugin (S12).

import { slot } from "thixo/slots";
import { t } from "thixo/schema";

// A slot inside a slot (S13): the plugin filling `main` places one for each
// todo, and whatever fills this one decides how a row looks. The todo's id
// is context a plugin can only read with the scopes named for it.
export const todoRow = slot.widget({
  name: "todo-row",
  context: t.object({ todoId: t.string() }),
  contextScopes: { todoId: ["todos.read"] },
  emits: {
    select: t.object({ todoId: t.string() }),
  },
});

// The main area of the app. One plugin fills it.
export const main = slot.page({
  name: "main",
  emits: {
    // The plugin tells the shell which todo the user picked.
    select: t.object({ todoId: t.string() }),
  },
  children: [todoRow],
});

// Beside the selected todo. One plugin fills it.
export const todoDetail = slot.panel({
  name: "todo-detail",
  context: t.object({ todoId: t.string() }),
  contextScopes: { todoId: ["todos.read"] },
});
