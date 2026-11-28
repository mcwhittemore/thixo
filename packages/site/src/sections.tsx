import type { ReactNode } from "react";
import spin from "../programs/spin/main.thx";
import { Gallery } from "./gallery.tsx";
import { LiveProgram } from "./live-program.tsx";
import { Source } from "./source.tsx";

const SPIN = { "main.thx": spin };

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
          <LiveProgram files={SPIN} />
          <Source files={SPIN} />
        </div>
      </>
    ),
  },
  {
    id: "gallery",
    title: "Gallery",
    body: () => <Gallery />,
  },
];
