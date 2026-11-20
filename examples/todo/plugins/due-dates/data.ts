// Sketch. Nothing here runs yet. See ../../readme.md.
//
// The plugin's data (D1). The build reads the fields and types from this
// file, hashes them and records the hash with the version (D3). It is
// written as plain literals so the build can read it without running it
// (U11).

import { annotate, store } from "thixo/data";
import { t } from "thixo/schema";
import { Todo } from "@app/sdk";

// An annotation: a field this plugin attaches to the app's todos. The app's
// schema does not change.
export const due = annotate(Todo, {
  dueOn: t.date(),
});

// A store: the plugin's own records. This one is private to each user.
export const prefs = store("prefs", {
  visibility: "private",
  fields: {
    warnDaysBefore: t.number(),
  },
});
