import { createRoot } from "react-dom/client";
import { Install } from "./install.tsx";
import { SECTIONS } from "./sections.tsx";

function Site() {
  return (
    <>
      <header className="header">
        <h1>thixo</h1>
        <p className="tagline">Let your users embed code in your site, safely.</p>
        <Install />
      </header>
      <nav className="nav">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.title}
          </a>
        ))}
        <a href="https://github.com/mcwhittemore/thixo">GitHub</a>
      </nav>
      <main>
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="section">
            <h2>{s.title}</h2>
            {s.body()}
          </section>
        ))}
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Site />);
