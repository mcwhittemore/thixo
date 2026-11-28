import gallery from "thixo:gallery";
import { LiveProgram } from "./live-program.tsx";
import { Source } from "./source.tsx";

export function Gallery() {
  return (
    <>
      <p>
        Each of these is a folder of <code>.thx</code> files, compiled and mounted here the same way as the spinner.
      </p>
      {gallery.map((program) => (
        <article key={program.id} className="live gallery-item" data-testid={`gallery-${program.id}`}>
          <div>
            <h3>{program.title}</h3>
            <p>{program.blurb}</p>
            <LiveProgram files={program.files} />
          </div>
          <Source files={program.files} />
        </article>
      ))}
    </>
  );
}
