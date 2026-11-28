import type { ReactNode } from "react";
import spin from "../programs/spin/main.thx";
import { LiveProgram } from "./live-program.tsx";

export interface Section {
  id: string;
  title: string;
  body: () => ReactNode;
}

export const SECTIONS: Section[] = [
  {
    id: "live",
    title: "A live program",
    body: () => (
      <>
        <p>
          This spinner is thixo source, compiled in your browser by <code>@thixo/core</code> and mounted by{" "}
          <code>@thixo/react</code>. It draws and animates inside its box, and can't reach anything else on this page.
        </p>
        <div className="live">
          <LiveProgram source={spin} />
          <pre data-testid="source">
            <code>{spin}</code>
          </pre>
        </div>
      </>
    ),
  },
];
