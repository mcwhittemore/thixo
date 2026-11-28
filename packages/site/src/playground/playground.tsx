import { useEffect, useRef, useState } from "react";
import { compile, type ThixoError } from "@thixo/core";
import starter from "./starter.thx";
import { BENCH_DTS, look, type Look } from "./detector.ts";
import { PLAYGROUND_GOALS, REQUESTS_NOTE } from "./goal-notes.ts";

interface File {
  name: string;
  source: string;
}

type Status = { kind: "idle" } | { kind: "errors"; errors: ThixoError[] } | { kind: "running" } | { kind: "done"; look: Look } | { kind: "failed"; message: string };

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

export function Playground() {
  const [files, setFiles] = useState<File[]>([{ name: "main.thx", source: starter }]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const secret = useRef<HTMLDivElement>(null);
  const outside = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const unmount = useRef<() => void>(undefined);

  useEffect(() => () => unmount.current?.(), []);

  const edit = (i: number, patch: Partial<File>) => setFiles((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = () => setFiles((fs) => [...fs, { name: `file-${fs.length + 1}.thx`, source: "" }]);
  const remove = (i: number) => setFiles((fs) => fs.filter((_, j) => j !== i));

  const run = async () => {
    unmount.current?.();
    unmount.current = undefined;
    const result = compile(Object.fromEntries(files.map((f) => [f.name, f.source])), { modules: { bench: { dts: BENCH_DTS } } });
    if (!result.ok) return setStatus({ kind: "errors", errors: result.errors });
    setStatus({ kind: "running" });
    await frame();
    try {
      const { unmount: stop, ...seen } = await look(result.code, { secret: secret.current!, outside: outside.current!, box: box.current! });
      unmount.current = stop;
      setStatus({ kind: "done", look: seen });
    } catch (e) {
      setStatus({ kind: "failed", message: String((e as Error)?.message ?? e) });
    }
  };

  const errors = status.kind === "errors" ? status.errors : [];
  const running = status.kind === "running";

  return (
    <div className="playground">
      <div className="editor">
        {files.map((f, i) => (
          <div className="file" key={i} data-testid="file">
            <div className="file-head">
              <input aria-label="File name" value={f.name} disabled={i === 0 || running} onChange={(e) => edit(i, { name: e.target.value })} />
              {i > 0 && (
                <button type="button" disabled={running} onClick={() => remove(i)}>
                  Remove
                </button>
              )}
            </div>
            <textarea aria-label={`Source of ${f.name}`} spellCheck={false} value={f.source} disabled={running} onChange={(e) => edit(i, { source: e.target.value })} rows={Math.max(6, f.source.split("\n").length + 1)} />
            <ErrorList errors={errors.filter((e) => e.file === f.name)} />
          </div>
        ))}
        <ErrorList errors={errors.filter((e) => !files.some((f) => f.name === e.file))} />
        <div className="actions">
          <button type="button" disabled={running} onClick={add}>
            Add file
          </button>
          <button type="button" className="primary" disabled={running} onClick={run} data-testid="run">
            {running ? "Running…" : "Compile and run"}
          </button>
        </div>
      </div>
      <div className="stage">
        <p className="stage-label">The page around the box holds four secrets: this element, a cookie, a localStorage value and a global. They change every run and are never shown.</p>
        <div className="planted">
          <span>Secret element</span>
          <div id="secret" ref={secret} aria-hidden="true" />
        </div>
        <div id="outside" ref={outside}>
          untouched
        </div>
        <div id="box" className="play-box" ref={box} data-testid="play-box" />
        <Report status={status} />
      </div>
    </div>
  );
}

function ErrorList({ errors }: { errors: ThixoError[] }) {
  if (!errors.length) return null;
  return (
    <ul className="errors" data-testid="errors">
      {errors.map((e, i) => (
        <li key={i}>
          <code>
            {e.file}:{e.line}:{e.column} {e.code}
          </code>{" "}
          {e.message}
          {e.hint && <div className="hint">{e.hint}</div>}
        </li>
      ))}
    </ul>
  );
}

function Report({ status }: { status: Status }) {
  if (status.kind === "failed") return <p className="error">{status.message}</p>;
  if (status.kind !== "done") return null;
  const { reached, evidence: e } = status.look;
  return (
    <div className="report" data-testid="report">
      <p data-testid="verdict">{reached.length ? `Reached: ${reached.join(", ")}. If this holds in the arena, it is a hole in thixo.` : "Reached no goal."}</p>
      <table>
        <tbody>
          {PLAYGROUND_GOALS.map((g) => (
            <tr key={g.id} data-goal={g.id} className={reached.includes(g.id) ? "reached" : undefined}>
              <td>
                <code>{g.id}</code>
              </td>
              <td>{reached.includes(g.id) ? "reached" : "not seen"}</td>
              <td>
                {g.title}
                <div className="note">{g.note}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">{REQUESTS_NOTE}</p>
      <h3>What the page saw</h3>
      <dl data-testid="seen">
        <dt>said</dt>
        <dd>{e.said.length ? e.said.slice(0, 10).map((s) => JSON.stringify(s.slice(0, 200))).join(", ") : "nothing"}</dd>
        <dt>box text</dt>
        <dd>{JSON.stringify(e.boxText.slice(0, 300))}</dd>
        <dt>requests to other origins</dt>
        <dd>{e.collectorHits.length ? e.collectorHits.slice(0, 5).join(", ") : "none"}</dd>
        <dt>requests to this origin</dt>
        <dd>{e.sameOriginHits.length ? e.sameOriginHits.slice(0, 5).join(", ") : "none"}</dd>
        <dt>outside the box</dt>
        <dd>
          {e.outsideMutations} changes, {e.drewOutside ? "drew over the page" : "drew nothing over the page"}
        </dd>
        <dt>navigated, hung, window.__pwned</dt>
        <dd>
          {String(e.navigated)}, {String(e.hung)}, {String(e.pwned)}
        </dd>
        <dt>runtime errors</dt>
        <dd>{e.runtimeErrors.length ? e.runtimeErrors.join(" | ") : "none"}</dd>
      </dl>
      <p className="note">This is a fast first look from inside the tab. The arena replay is the real verdict.</p>
    </div>
  );
}
