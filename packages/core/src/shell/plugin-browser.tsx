import * as React from "react";
import type { AppInfo, PluginSummary, PluginVersionRef, User } from "../contract.js";
import { scopeLabel as labelOf } from "../scope-words.js";
import { slotPaths as pathsOf } from "../slots/paths.js";
import { useShellInternals } from "./shell.js";

/** Every slot path a layout can name: the top-level slots, and each child slot under its parent (S13). */
export function slotPaths(app: AppInfo): string[] {
  return pathsOf(app.slots);
}

const lastSegment = (path: string) => path.slice(path.lastIndexOf("/") + 1);

interface Action {
  label: string;
  disabled?: string;
  run: () => Promise<unknown>;
  /** What the status says after: text, or text made from the reply. */
  done: string | ((reply: unknown) => string);
}

/** A scope with its words beside it, so a user reading a plugin's scopes knows what they mean: the app's words from
 * defineScopes, Thixo's for its own. The registry's summary uses the same words. */
export function scopeLabel(scope: string, appScopes: Record<string, string> = {}): string {
  return labelOf(appScopes, scope);
}

/** Why a user can't take each action on a plugin, or undefined when they can. Buttons are disabled with the reason. */
export function reasons(summary: PluginSummary, user: User, paths: string[], resolved: Record<string, PluginVersionRef>) {
  const holds = (scope: string) => user.scopes.includes(scope);
  const missing = summary.requiredScopes.filter((s) => !holds(s));
  const targets = paths.filter((p) => lastSegment(p) === summary.manifest.slot);
  const inUse = targets.find((p) => resolved[p]?.plugin === summary.plugin.id && resolved[p]?.number === summary.latest);
  const isAuthor = summary.plugin.author === user.id;
  return {
    targets,
    use: missing.length
      ? `You don't hold ${missing.join(", ")}`
      : targets.length === 0
        ? `This app has no ${summary.manifest.slot} slot`
        : inUse
          ? `Already in use in ${inUse}`
          : undefined,
    fork: holds("thixo.plugins.author") ? undefined : "Forking needs thixo.plugins.author",
    share: summary.isDefault || summary.plugin.visibility === "shared"
      ? "Already shared"
      : !isAuthor
        ? "Only its author can share it"
        : holds("thixo.plugins.share")
          ? undefined
          : "Sharing needs thixo.plugins.share",
    promote: summary.isDefault ? "Already a default" : holds("thixo.plugins.promote") ? undefined : "Promoting needs thixo.plugins.promote",
  };
}

/** The registry (G1, G2, G5): search, a plugin's summary and scopes before it is used, and use, fork, share, promote
 * and reset. While it is open, empty slots show where they are. */
export function PluginBrowser() {
  const internals = useShellInternals();
  const [query, setQuery] = React.useState("");
  const [slotFilter, setSlotFilter] = React.useState("");
  const [results, setResults] = React.useState<PluginSummary[] | undefined>(undefined);
  const [names, setNames] = React.useState<Record<string, string>>({});
  // The newest version of each plugin the browser has seen, to say when a slot is on an older one.
  const [latestOf, setLatestOf] = React.useState<Record<string, number>>({});
  const [message, setMessage] = React.useState<{ text: string; error?: boolean } | undefined>(undefined);
  const [busy, setBusy] = React.useState(false);

  const setBrowserOpen = internals?.setBrowserOpen;
  React.useEffect(() => {
    if (!setBrowserOpen) return;
    setBrowserOpen(true);
    return () => setBrowserOpen(false);
  }, [setBrowserOpen]);

  const client = internals?.client;
  const search = React.useCallback(
    async (q: string, slot: string) => {
      if (!client) return;
      try {
        const found = await client.search(q, slot ? lastSegment(slot) : undefined);
        setResults(found);
        setNames((n) => ({ ...n, ...Object.fromEntries(found.map((s) => [s.plugin.id, s.plugin.name])) }));
        setLatestOf((l) => ({ ...l, ...Object.fromEntries(found.map((s) => [s.plugin.id, s.latest])) }));
      } catch (error) {
        setResults([]);
        setMessage({ text: `Search failed: ${error instanceof Error ? error.message : String(error)}`, error: true });
      }
    },
    [client],
  );

  React.useEffect(() => {
    void search("", "");
  }, [search]);

  const resolved = internals?.layout?.resolved ?? {};
  const resolvedIds = Object.values(resolved)
    .map((r) => r.plugin)
    .filter((id, i, all) => all.indexOf(id) === i)
    .join(",");
  React.useEffect(() => {
    if (!client || !resolvedIds) return;
    let live = true;
    for (const id of resolvedIds.split(",")) {
      client.plugin(id).then(
        (s) => {
          if (!live) return;
          setNames((n) => ({ ...n, [id]: s.plugin.name }));
          setLatestOf((l) => ({ ...l, [id]: s.latest }));
        },
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, resolvedIds]);

  if (!internals) return null;
  const { app, layout, session } = internals;
  const paths = slotPaths(app);
  const user = session.user;

  async function act(action: Action) {
    setBusy(true);
    setMessage(undefined);
    try {
      const reply = await action.run();
      setMessage({ text: typeof action.done === "string" ? action.done : action.done(reply) });
      await internals!.refreshLayout();
      await search(query, slotFilter);
    } catch (error) {
      setMessage({ text: `${action.label} failed: ${error instanceof Error ? error.message : String(error)}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  const label = (ref: PluginVersionRef | undefined) => (ref ? `${names[ref.plugin] ?? ref.plugin} v${ref.number}` : "Empty");

  return (
    <section role="region" aria-label="Plugin browser" className="thixo-panel">
      <h2>Plugins</h2>

      <h3 id="thixo-layout-heading">Your layout</h3>
      <ul aria-labelledby="thixo-layout-heading" className="thixo-result">
        {paths.map((path) => {
          const changed = layout?.changes[path];
          const reset = changed ? undefined : "This slot already has its default";
          const ref = resolved[path];
          const newest = ref ? latestOf[ref.plugin] : undefined;
          const newer = ref && newest !== undefined && newest > ref.number ? newest : undefined;
          return (
            <li key={path} aria-label={`Slot ${path}`} className="thixo-row">
              <strong>{path}</strong>
              <span data-testid={`slot-fill-${path}`}>{label(ref)}</span>
              <span className="thixo-muted">{changed ? "your choice" : layout?.defaults[path] ? "default" : ""}</span>
              {newer !== undefined && ref && (
                <>
                  <span className="thixo-badge thixo-tone-warning">v{newer} is newer</span>
                  <ActionButton
                    label={`Move to v${newer}`}
                    name={`Move ${path} to v${newer}`}
                    disabled={busy ? "Busy" : undefined}
                    onClick={() =>
                      act({
                        label: "Move",
                        run: () => internals.client.use(path, { plugin: ref.plugin, number: newer }),
                        done: `Moved ${path} to ${names[ref.plugin] ?? ref.plugin} v${newer}${changed ? "" : ". It is your choice now: it stays on this version until you change or reset it"}`,
                      })
                    }
                  />
                </>
              )}
              <ActionButton
                label="Reset"
                name={`Reset ${path} to default`}
                disabled={busy ? "Busy" : reset}
                onClick={() => act({ label: "Reset", run: () => internals.client.reset(path), done: `Reset ${path} to its default` })}
              />
            </li>
          );
        })}
      </ul>

      <form
        role="search"
        aria-label="Search plugins"
        className="thixo-row"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query, slotFilter);
        }}
      >
        <input className="thixo-input" aria-label="Search plugins" placeholder="Search plugins" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
        <select className="thixo-input" aria-label="Slot" value={slotFilter} onChange={(e) => setSlotFilter(e.currentTarget.value)}>
          <option value="">Any slot</option>
          {paths.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="submit" className="thixo-button">
          Search
        </button>
      </form>

      {message && (
        <div role={message.error ? "alert" : "status"} className={message.error ? "thixo-slot-message" : "thixo-muted"}>
          {message.text}
        </div>
      )}

      <div role="list" aria-label="Search results" aria-busy={results === undefined}>
        {results?.length === 0 && <p className="thixo-muted">No plugins found.</p>}
        {results?.map((s) => {
          const why = reasons(s, user, paths, resolved);
          const target = slotFilter && why.targets.includes(slotFilter) ? slotFilter : why.targets[0];
          return (
            <article role="listitem" key={s.plugin.id} aria-label={s.plugin.name} className="thixo-result">
              <div className="thixo-row">
                <strong>{s.plugin.name}</strong>
                {s.isDefault ? (
                  <span className="thixo-badge thixo-tone-success thixo-badge-default">Default</span>
                ) : (
                  s.plugin.author !== user.id && <span className="thixo-badge thixo-tone-warning thixo-badge-default">From {s.plugin.author}</span>
                )}
                <span className="thixo-muted">
                  v{s.latest}
                  {s.isDefault && s.defaultVersion !== undefined && s.defaultVersion !== s.latest ? ` (the default is v${s.defaultVersion})` : ""} · fills{" "}
                  {s.manifest.slot} · {s.isDefault ? "default" : s.plugin.visibility} · by {s.plugin.author} · id {s.plugin.id}
                </span>
              </div>
              {(() => {
                const using = paths.filter((p) => resolved[p]?.plugin === s.plugin.id);
                if (!using.length) return null;
                return (
                  <p className="thixo-muted" aria-label={`${s.plugin.name} in use`}>
                    In use: {using.map((p) => `v${resolved[p].number} in ${p}`).join(", ")}
                    {using.some((p) => resolved[p].number < s.latest) ? ` (v${s.latest} is newer: Use moves to it)` : ""}
                  </p>
                );
              })()}
              <p className="thixo-muted">{s.plugin.description}</p>
              <ul aria-label={`What ${s.plugin.name} does`}>
                {s.summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div className="thixo-muted" aria-label={`Scopes of ${s.plugin.name}`}>
                Needs: {s.requiredScopes.map((scope) => scopeLabel(scope, app.scopes)).join(", ") || "nothing"}
                {s.optionalScopes.length > 0 && <> · Uses if you have them: {s.optionalScopes.map((scope) => scopeLabel(scope, app.scopes)).join(", ")}</>}
              </div>
              <div className="thixo-row">
                <ActionButton
                  label="Use"
                  name={`Use ${s.plugin.name}`}
                  disabled={busy ? "Busy" : why.use}
                  onClick={() =>
                    act({ label: "Use", run: () => internals.client.use(target!, { plugin: s.plugin.id, number: s.latest }), done: `Using ${s.plugin.name} in ${target}` })
                  }
                />
                <ActionButton
                  label="Fork"
                  name={`Fork ${s.plugin.name}`}
                  disabled={busy ? "Busy" : why.fork}
                  onClick={() =>
                    act({
                      label: "Fork",
                      run: () => internals.client.fork(s.plugin.id, s.latest),
                      done: (reply) => {
                        const id = (reply as { plugin?: { id?: string } } | undefined)?.plugin?.id;
                        return `Forked ${s.plugin.name}${id ? ` as ${id}` : ""}. The copy is yours and is not in your layout yet: Use it below to show it. To change it, use Ask for a plugin${id ? `, or write its files to a folder with \`thixo agent read --as ${user.id} ${id} --out <folder>\`, edit them, and \`thixo agent submit --as ${user.id} --dir <folder> --plugin ${id}\`` : ""}.`;
                      },
                    })
                  }
                />
                <ActionButton
                  label="Share"
                  name={`Share ${s.plugin.name}`}
                  disabled={busy ? "Busy" : why.share}
                  onClick={() => act({ label: "Share", run: () => internals.client.share(s.plugin.id), done: `Shared ${s.plugin.name}` })}
                />
                <ActionButton
                  label="Promote"
                  name={`Promote ${s.plugin.name}`}
                  disabled={busy ? "Busy" : why.promote}
                  onClick={() =>
                    act({
                      label: "Promote",
                      run: () => internals.client.promote(s.plugin.id),
                      done: (reply) => {
                        const r = (reply ?? {}) as { folder?: string; done?: string; next?: string };
                        if (r.done && r.next) return `${r.done} ${r.next}`;
                        return `Promoted ${s.plugin.name}${r.folder ? `: wrote plugins/${r.folder}/. It fills no slot until layout in thixo.config.ts names "${r.folder}" and the app deploys` : ""}.`;
                      },
                    })
                  }
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ActionButton(props: { label: string; name: string; disabled?: string; onClick: () => void }) {
  const id = React.useId();
  return (
    <span className="thixo-row">
      <button
        type="button"
        className="thixo-button"
        aria-label={props.name}
        disabled={props.disabled !== undefined}
        aria-describedby={props.disabled ? id : undefined}
        title={props.disabled}
        onClick={props.onClick}
      >
        {props.label}
      </button>
      {props.disabled && props.disabled !== "Busy" && (
        <span id={id} className="thixo-muted">
          {props.disabled}
        </span>
      )}
    </span>
  );
}
