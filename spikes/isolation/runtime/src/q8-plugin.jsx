// Q8: an ordinary plugin component (a list with controls). Used inside frames and directly in the shell.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

function Row({ i }) {
  return (
    <li style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid #ddd" }}>
      <span style={{ flex: 1 }}>Row {i}</span>
      <button type="button">Open</button>
    </li>
  );
}

function Plugin({ initialRows, api }) {
  const [rows, setRows] = useState(initialRows);
  api.setRows = setRows;
  return (
    <div style={{ fontFamily: "sans-serif", padding: 8, color: "var(--fg, #111)" }}>
      <h3 style={{ margin: "0 0 8px" }}>Plugin</h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {Array.from({ length: rows }, (_, i) => <Row key={i} i={i} />)}
      </ul>
    </div>
  );
}

// mount(el, rows) renders synchronously and returns an api with setRows.
function mount(el, rows = 20) {
  const api = {};
  const root = createRoot(el);
  flushSync(() => root.render(<Plugin initialRows={rows} api={api} />));
  return api;
}

window.TailorPlugin = { mount };
