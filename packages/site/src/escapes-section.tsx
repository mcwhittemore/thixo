import { compile } from "@thixo/core";
import navigate from "../programs/escapes/navigate/main.thx";
import networkOut from "../programs/escapes/network-out/main.thx";
import readCookie from "../programs/escapes/read-cookie/main.thx";
import readDom from "../programs/escapes/read-dom/main.thx";
import runScript from "../programs/escapes/run-script/main.thx";
import { ESCAPES } from "./escapes.ts";
import { formatErrors } from "./format-errors.ts";

const THX: Record<string, string> = {
  "read-cookie": readCookie,
  "read-dom": readDom,
  "network-out": networkOut,
  "run-script": runScript,
  navigate,
};

function compileError(source: string): string {
  const result = compile({ "main.thx": source });
  return result.ok ? "It compiled. This is a hole in the wall: please report it." : formatErrors(result.errors);
}

export function Escapes() {
  return (
    <>
      <p>
        Each program below is a component that reaches past its box. As JavaScript it works. As thx it doesn't
        compile: the error under it is what <code>@thixo/core</code> says when this page compiles it in your browser.
      </p>
      {ESCAPES.map((escape) => (
        <div key={escape.id} className="escape" data-testid={`escape-${escape.id}`}>
          <h3>{escape.title}</h3>
          <div className="pair">
            <div>
              <h4>JavaScript: works</h4>
              <pre data-testid="js">
                <code>{escape.js}</code>
              </pre>
            </div>
            <div>
              <h4>thx: doesn't compile</h4>
              <pre data-testid="thx">
                <code>{THX[escape.id]}</code>
              </pre>
              <pre className="compile-error" data-testid="error">
                <code>{compileError(THX[escape.id])}</code>
              </pre>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
