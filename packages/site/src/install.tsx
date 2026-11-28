const STEPS = [
  { title: "Install", code: "npm i @thixo/core @thixo/react" },
  { title: "Compile a program", code: "npx @thixo/cli compile <folder> -o out.js" },
  {
    title: "Mount it",
    code: `import { load, mount } from "@thixo/react";
mount(document.getElementById("box")!, await load(code));`,
  },
];

export function Install() {
  return (
    <div className="install" id="install">
      {STEPS.map((step) => (
        <div key={step.title}>
          <h2>{step.title}</h2>
          <pre>
            <code>{step.code}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}
