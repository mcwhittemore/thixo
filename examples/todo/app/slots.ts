// Sketch. Nothing here runs yet. See ../readme.md.
//
// Where plugins go (S1). A slot has a kind and a contract (S2): the context
// the shell passes in, and the events a plugin can send back.

import { slot, t } from "tailor/shell";

// The main area of the app. One plugin fills it.
export const main = slot.page({
  name: "main",
  emits: {
    // The plugin tells the shell which todo the user picked.
    select: t.object({ todoId: t.string() }),
  },
});

// Beside the selected todo. Any number of plugins can sit here.
export const todoDetail = slot.panel({
  name: "todo-detail",
  many: true,
  context: t.object({ todoId: t.string() }),
});
