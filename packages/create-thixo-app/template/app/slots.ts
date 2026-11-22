// Where plugins go. The app defines each slot: its size, the context the shell passes in, and the events a plugin can
// send back. Each slot is filled by one plugin.

import { slot } from "thixo/slots";
import { t } from "thixo/schema";

// The main area of the app. One plugin fills it.
export const main = slot.page({
  name: "main",
  emits: {
    // The plugin tells the shell which todo the user picked.
    select: t.object({ todoId: t.string() }),
  },
});

// Beside the selected todo. One plugin fills it.
export const todoDetail = slot.panel({
  name: "todo-detail",
  context: t.object({ todoId: t.string() }),
  contextScopes: { todoId: ["todos.read"] },
});
