// Sketch. Nothing here runs yet. See ../readme.md.
//
// Where plugins go (S1). The app defines each slot (S5): its size, and its
// contract (S11): the context the shell passes in, and the events a plugin
// can send back. Each slot is filled by one plugin (S12).

import { slot } from "thixo/shell";
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
});
