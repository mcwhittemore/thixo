import * as React from "react";
import { useShellInternals } from "./shell.js";

type Line = { kind: "user" | "agent" | "tool" | "error" | "done"; text: string; id?: string; ok?: boolean };

const clip = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One short line for what a tool call came to, made from its JSON output: the failure's message, or the gist of the
 * result, such as `put plg_x@2 in main/todo-row`. */
export function toolOutcome(name: string, ok: boolean, output: string): string {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(output);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {}
  const error = body.error as { message?: unknown } | undefined;
  if (error && typeof error.message === "string") return `${name} failed: ${clip(error.message)}`;
  if (!ok) {
    const report = typeof body.report === "string" ? body.report.split("\n")[0] : typeof body.note === "string" ? body.note : "";
    const count = Array.isArray(body.errors) ? body.errors.length : 0;
    return `${name} failed${count ? ` with ${count} error${count === 1 ? "" : "s"}` : ""}${report ? `: ${clip(report)}` : ""}`;
  }
  const ref = typeof body.plugin === "string" ? `${body.plugin}${typeof body.version === "number" ? `@${body.version}` : ""}` : "";
  switch (name) {
    case "search_registry":
      return `search_registry found ${Array.isArray(body.results) ? body.results.length : 0} plugin${Array.isArray(body.results) && body.results.length === 1 ? "" : "s"}`;
    case "read_plugin":
      return `read_plugin read ${ref}`;
    case "describe_app":
      return "describe_app read the app's reference";
    case "check":
      return "check passed";
    case "submit":
      return `submit stored ${ref}`;
    case "fork":
      return `fork made ${ref}`;
    case "use":
      return `use put ${ref} in ${typeof body.slot === "string" ? body.slot : "its slot"}${body.confirmed === true ? " (confirmed in your layout)" : ""}`;
    default:
      return `${name} done`;
  }
}

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
  const form = React.useRef<HTMLFormElement | null>(null);
  const log = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => () => abort.current?.abort(), []);
  // Keep the newest line in view, so the agent's last message is never cut off below the fold of the log.
  React.useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!internals) return null;
  const canAuthor = internals.session.user.scopes.includes("thixo.plugins.author");
  const turn = lines.slice(lines.map((l) => l.kind).lastIndexOf("user") + 1);
  const lastTool = [...turn].reverse().find((l) => l.kind === "tool");

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
        else if (event.type === "tool" && typeof event.name === "string") push({ kind: "tool", text: `Using ${event.name}`, id: typeof event.id === "string" ? event.id : undefined });
        else if (event.type === "tool_result" && typeof event.name === "string") {
          const ok = event.ok === true;
          const text = toolOutcome(event.name, ok, typeof event.output === "string" ? event.output : "");
          const id = typeof event.id === "string" ? event.id : undefined;
          setLines((all) => {
            const at = id === undefined ? -1 : all.findIndex((l) => l.kind === "tool" && l.id === id && l.ok === undefined);
            if (at < 0) return [...all, { kind: "tool", text, id, ok }];
            return all.map((l, i) => (i === at ? { ...l, text, ok } : l));
          });
          // The agent put a plugin in the layout: show it now, not only when the turn ends.
          if (event.name === "use" && ok) void internals!.refreshLayout();
        } else if (event.type === "conversation" && typeof event.id === "string") conversation.current = event.id;
        else if (event.type === "error") push({ kind: "error", text: String(event.message ?? "The agent failed") });
        else if (event.type === "done") {
          const id = (event as { conversation?: unknown }).conversation;
          if (typeof id === "string") conversation.current = id;
          push({ kind: "done", text: "Done" });
        }
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
      <div ref={log} role="log" aria-label="Chat messages" aria-live="polite" className="thixo-chat-log">
        {lines.map((line, i) =>
          line.kind === "error" ? (
            <div key={i} role="alert" className="thixo-slot-message">
              {line.text}
            </div>
          ) : (
            <div
              key={i}
              className={line.kind === "user" ? "thixo-chat-user" : line.kind === "agent" ? "thixo-chat-agent" : line.ok === false ? "thixo-chat-tool thixo-chat-tool-failed" : "thixo-chat-tool"}
              data-kind={line.kind}
              {...(line.kind === "tool" && line.ok !== undefined ? { "data-ok": String(line.ok) } : {})}
            >
              {line.text}
            </div>
          ),
        )}
      </div>
      {busy && (
        <p role="status" className="thixo-muted">
          The agent is working{lastTool ? `: ${lastTool.text.replace(/^Using /, "using ")}` : ""}…
        </p>
      )}
      <form
        ref={form}
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
          onKeyDown={(e) => {
            // Enter sends, as in any chat; Shift+Enter starts a new line.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              form.current?.requestSubmit();
            }
          }}
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
