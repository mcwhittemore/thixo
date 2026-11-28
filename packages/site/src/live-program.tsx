import { useEffect, useRef, useState } from "react";
import { compile } from "@thixo/core";
import { load, mount } from "@thixo/react";

export function LiveProgram({ source }: { source: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let unmount: (() => void) | undefined;
    let stopped = false;
    const result = compile({ "main.thx": source });
    if (!result.ok) {
      setError(result.errors.map((e) => `${e.file}:${e.line}:${e.column} ${e.message}`).join("\n"));
      return;
    }
    load(result.code).then(
      (module) => {
        if (stopped) return;
        unmount = mount(element, module, { onError: (e) => setError(e.message) }).unmount;
      },
      (e: unknown) => setError(String(e)),
    );
    return () => {
      stopped = true;
      unmount?.();
    };
  }, [source]);

  return (
    <div>
      <div className="box" ref={box} data-testid="box" />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
