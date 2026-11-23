// Where plugins go. The app defines each slot: its size, the context the shell passes in, and the events a plugin can
// send back. Each slot is filled by one plugin.

import { slot } from "thixo/slots";

// The main area of the app. One plugin fills it.
export const main = slot.page({ name: "main" });
