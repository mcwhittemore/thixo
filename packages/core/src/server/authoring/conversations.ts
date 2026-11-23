import type { ServerContext } from "../context.js";
import type { Conversation } from "./types.js";

const MAX_CONVERSATIONS = 500;

/** In memory, per server context. A restart forgets every chat. docs/10 notes this is in tension with "each request
 * stands alone" (X3): moving it into the data adapter is left for later. */
const stores = new WeakMap<ServerContext, Map<string, Conversation>>();

export function conversationsOf(ctx: ServerContext): Map<string, Conversation> {
  let store = stores.get(ctx);
  if (!store) {
    store = new Map();
    stores.set(ctx, store);
  }
  return store;
}

/** The oldest conversations go first once there are too many, so a long-running server does not grow without bound. */
export function remember(store: Map<string, Conversation>, id: string, conversation: Conversation): void {
  store.delete(id);
  store.set(id, conversation);
  for (const key of store.keys()) {
    if (store.size <= MAX_CONVERSATIONS) break;
    if (!store.get(key)?.busy) store.delete(key);
  }
}
