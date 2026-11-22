// How a scope reads when it says what a plugin does (G5). The registry's summary, the plugin browser and
// `thixo compile` all use these words, so a person sees the same sentence for a scope everywhere.

const VERBS = new Set(["read", "see", "create", "change", "delete", "add", "remove", "edit", "update", "write", "send", "view", "list", "manage", "assign", "close", "open", "export", "import", "approve", "archive", "move", "post", "invite"]);

function inflect(word: string): string {
  return /(s|sh|ch|x|z)$/.test(word) ? `${word}es` : `${word}s`;
}

/** "Read todos" becomes "Reads todos". "Create and change todos" becomes "Creates and changes todos". */
export function plainSentence(description: string): string {
  const words = description.trim().split(/\s+/);
  const out = words.map((word, i) => {
    const lower = word.toLowerCase();
    const afterAnd = words[i - 1]?.toLowerCase() === "and";
    return (i === 0 || afterAnd) && VERBS.has(lower) ? inflect(word) : word;
  });
  return out.join(" ");
}

/** Thixo's own scopes, as what a plugin that needs one does. The app's scopes take their words from defineScopes. */
export const THIXO_SCOPE_SENTENCES: Record<string, string> = {
  "thixo.data.read": "Reads its own data",
  "thixo.data.write": "Writes its own data",
  "thixo.data.admin": "Removes a field of plugin data",
  "thixo.plugins.author": "Writes plugins",
  "thixo.plugins.share": "Shares plugins",
  "thixo.plugins.promote": "Promotes plugins",
};

/** What a plugin that needs `scope` does, in a sentence: Thixo's words for its own scopes, the app's words
 * (from defineScopes) for the rest. Null for a scope with no words. */
export function scopeSentence(appScopes: Record<string, string>, scope: string): string | null {
  const own = THIXO_SCOPE_SENTENCES[scope];
  if (own) return own;
  const text = scope.startsWith("thixo.") ? undefined : appScopes[scope];
  return text ? plainSentence(text) : null;
}

/** A scope's name with its words beside it, such as `todos.read (reads todos)` or
 * `thixo.data.write (writes its own data)`. */
export function scopeLabel(appScopes: Record<string, string>, scope: string): string {
  const words = scopeSentence(appScopes, scope);
  return words ? `${scope} (${words.charAt(0).toLowerCase()}${words.slice(1)})` : scope;
}
