import { look } from "../../src/playground/detector.ts";

const stage = {
  secret: document.getElementById("secret")!,
  outside: document.getElementById("outside")!,
  box: document.getElementById("box")!,
};

(window as unknown as { __look: (code: string) => Promise<unknown> }).__look = async (code) => {
  const { unmount, ...seen } = await look(code, stage);
  unmount();
  return seen;
};
