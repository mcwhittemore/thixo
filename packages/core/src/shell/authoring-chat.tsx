import * as React from "react";
import { useShellInternals } from "./shell.js";

type Line = { kind: "user" | "agent" | "tool" | "error" | "done"; text: string };

/** The authoring chat (U1): a user describes a plugin and Thixo's agent writes it. The server streams the agent's
 * events as newline-delimited JSON; when it is done, the layout is loaded again, in case the agent put a new version
 * in a slot. */
export function AuthoringChat() {
  const internals = useShellInternals();
  const [lines, setLines] = React.useState<Line[]>([]);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const conversation = React.useRef<string | undefined>(undefined);
  const abort = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => abort.current?.abort(), []);

  if (!internals) return null;
  const canAuthor = internals.session.user.scopes.includes("thixo.plugins.author");

  const push = (line: Line) =>
    setLines((all) => {
      const last = all[all.length - 1];
      if (line.kind === "agent" && last?.kind === "agent") return [...all.slice(0, -1), { kind: "agent", text: last.text + line.text }];
      return [...all, line];
    });

  async function send(message: string) {
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    push({ kind: "user", text: message });
    try {
      for await (const event of internals!.client.chat(message, conversation.current, controller.signal)) {
        if (event.type === "text" && typeof event.text === "string") push({ kind: "agent", text: event.text });
        else if (event.type === "tool" && typeof event.name === "string") push({ kind: "tool", text: `Using ${event.name}` });
        else if (event.type === "conversation" && typeof event.id === "string") conversation.current = event.id;
        else if (event.type === "error") push({ kind: "error", text: String(event.message ?? "The agent failed") });
        else if (event.type === "done") push({ kind: "done", text: "Done" });
      }
    } catch (error) {
      if (!controller.signal.aborted) push({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        await internals!.refreshLayout();
      }
    }
  }

  return (
    <section role="region" aria-label="Authoring chat" className="thixo-panel">
      <h2>Ask for a plugin</h2>
      <div role="log" aria-label="Chat messages" aria-live="polite" className="thixo-chat-log">
        {lines.map((line, i) =>
          line.kind === "error" ? (
            <div key={i} role="alert" className="thixo-slot-message">
              {line.text}
            </div>
          ) : (
            <div key={i} className={line.kind === "user" ? "thixo-chat-user" : line.kind === "agent" ? "thixo-chat-agent" : "thixo-chat-tool"} data-kind={line.kind}>
              {line.text}
            </div>
          ),
        )}
      </div>
      <form
        aria-label="Send a message"
        className="thixo-row"
        onSubmit={(e) => {
          e.preventDefault();
          const message = draft.trim();
          if (!message || busy || !canAuthor) return;
          setDraft("");
          void send(message);
        }}
      >
        <textarea
          className="thixo-input"
          aria-label="Message"
          rows={2}
          placeholder={canAuthor ? "Describe the plugin you want" : "You can't ask for plugins"}
          value={draft}
          disabled={!canAuthor}
          onChange={(e) => setDraft(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="thixo-button thixo-button-primary" disabled={busy || !canAuthor} aria-busy={busy} title={canAuthor ? undefined : "Asking needs thixo.plugins.author"}>
          {busy ? "Working…" : "Send"}
        </button>
      </form>
      {!canAuthor && <p className="thixo-muted">Asking for a plugin needs thixo.plugins.author.</p>}
    </section>
  );
}
