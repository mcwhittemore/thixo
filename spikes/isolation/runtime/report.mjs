// Turns results.json into results.md: one table per question, rows = technique or arrangement, columns = browsers.
const yn = (v) => (v === true ? "yes" : v === false ? "no" : v == null ? "-" : String(v));

function table(rows, cols, cell) {
  const head = `| | ${cols.join(" | ")} |\n| --- | ${cols.map(() => "---").join(" | ")} |`;
  return head + "\n" + rows.map((r) => `| ${r.label} | ${cols.map((c) => String(cell(r, c) ?? "-").replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ")} |`).join("\n");
}

function colsFor(results, q) {
  const seen = [];
  for (const r of results) if (r.question === q && r.browser) { const k = `${r.browser} ${r.mode || ""}`.trim(); if (!seen.includes(k)) seen.push(k); }
  return seen;
}
const colKey = (r) => `${r.browser} ${r.mode || ""}`.trim();
const find = (results, q, test, col) => results.find((r) => r.question === q && r.test === test && colKey(r) === col);

export function writeMarkdown(doc) {
  const R = doc.results;
  const out = [];
  out.push(`# Tailor runtime spike results\n\nGenerated ${doc.generatedAt} by \`node run.mjs\` (Node ${doc.node}, Playwright ${doc.playwright}, ${doc.platform}).`);
  const versions = {};
  R.forEach((r) => { if (r.browser && r.browserVersion) versions[r.browser] = `${r.browserVersion}${r.browserNote ? ` (${r.browserNote})` : ""}`; });
  out.push("Browsers: " + Object.entries(versions).map(([k, v]) => `**${k}** ${v}`).join("; ") + ".");
  out.push("Playwright WebKit is a WebKit build driven by Playwright, not shipping Safari. Playwright Firefox is a patched Nightly (Juggler); `firefox-fission` forces the Fission prefs on.");
  const notes = R.filter((r) => r.question === "all");
  if (notes.length) out.push(notes.map((n) => `- ${n.browser}: ${n.test}: ${n.outcome}${n.error ? ` (${n.error})` : ""}`).join("\n"));

  // Q3
  const c3 = colsFor(R, "Q3");
  const arr = [["a", "(a) same origin, no sandbox"], ["b", "(b) same origin, sandbox + CSP"], ["b-attr-only", "(b') same origin, sandbox attribute only"], ["c", "(c) other site, no sandbox"], ["d", "(d) other site, sandbox + CSP"]];
  out.push("## Q3. Main thread and process sharing\n\nFrame busy-loops 3000 ms. Cell: longest shell `setInterval(10)` gap / longest rAF gap; whether a click on the shell 1 s into the loop was handled during the loop; renderer processes with the page open (CDP `SystemInfo.getProcessInfo` for Chromium, `ps` otherwise; `oopif` = frame is its own CDP iframe target).");
  out.push(table(arr.map(([id, label]) => ({ id, label })), c3, (r, c) => {
    const e = find(R, "Q3", `busy-loop-${r.id}`, c);
    if (!e) return null;
    if (!e.numbers) return `${e.outcome}${e.error ? `: ${e.error}` : ""}`;
    const p = e.processes || {};
    const procs = p.cdp && p.cdp.rendererProcesses != null ? `${p.cdp.rendererProcesses} renderers${p.cdp.iframeTargets?.length ? ", oopif" : ""}` : p.psRenderersWithPage != null ? `${p.psRenderersWithPage} content procs (ps)` : "";
    return `${e.numbers.maxIntervalGapMs} / ${e.numbers.maxRafGapMs} ms; click during loop: ${yn(e.numbers.clickHandledDuringLoop)}; ${procs}`;
  }));
  out.push("Infinite loop (`while(true){}`) in the frame; 1.5 s later the shell is asked to run JS and remove the frame (6 s limit).");
  out.push(table(arr.map(([id, label]) => ({ id, label })), c3, (r, c) => {
    const e = find(R, "Q3", `infinite-loop-${r.id}`, c);
    return e ? (e.shellIsolated === true ? `shell responsive (${e.numbers.shellRespondedAfterMs} ms), frame removed` : e.shellIsolated === false ? "shell hung" : e.outcome) : null;
  }));
  out.push("Two sandboxed plugin frames from the app origin; one loops 3 s. Cell: longest gap in the other frame's own 10 ms heartbeat.");
  out.push(table([{ label: "sibling plugin" }], c3, (r, c) => { const e = find(R, "Q3", "sibling-plugins-b", c); return e ? (e.numbers ? `${e.numbers.siblingMaxGapMs} ms (${e.siblingIsolated ? "kept running" : "froze"})` : e.outcome) : null; }));

  // Q5
  const c5 = colsFor(R, "Q5");
  const tests5 = [...new Set(R.filter((r) => r.question === "Q5" && r.test !== "harness").map((r) => r.test))];
  out.push("## Q5. Loading plugin code in the opaque-origin document\n\nCell: **policy** (sandbox attribute + proposed CSP) / sandbox attribute only / control (no sandbox, no CSP). `yes` = the code ran. Policy errors are in results.json.");
  out.push(table(tests5.map((t) => { const any = R.find((r) => r.question === "Q5" && r.test === t); return { t, label: `${any.sub}: ${any.attempted.replace(/</g, "&lt;")} — \`script-src ${any.scriptSrc}\`` }; }), c5, (r, c) => {
    const e = find(R, "Q5", r.t, c);
    return e ? `**${yn(e.outcome.policy)}** / ${yn(e.outcome.sandboxOnly)} / ${yn(e.outcome.control)}` : null;
  }));

  // Q6
  const c6 = colsFor(R, "Q6");
  const tests6 = [...new Set(R.filter((r) => r.question === "Q6" && r.test !== "violations" && r.test !== "harness").map((r) => r.test))];
  const conds = ["policy", "policy-style-none", "policy-font-data", "policy-font-origin", "policy-dev-react", "control"];
  out.push(`## Q6. Rendering under the policy\n\nA React ${R.find((r) => r.question === "Q6" && r.test === "reactRendered")?.detail?.policy?.react || ""} component in the sandboxed frame. Cell: **proposed policy** / style-src 'none' / + font-src data: / + font-src app origin / React dev build under policy / control.`);
  out.push(table(tests6.map((t) => ({ t, label: t })), c6, (r, c) => {
    const e = find(R, "Q6", r.t, c);
    return e ? conds.map((k, i) => (i === 0 ? `**${yn(e.outcome[k])}**` : yn(e.outcome[k]))).join(" / ") : null;
  }));

  // Q8
  const c8 = colsFor(R, "Q8");
  out.push("## Q8. The channel and the frame's place in the page");
  const q8rows = [
    { t: "a-message-port", label: "(a) MessagePort both ways; origin/source", f: (e) => `${e.outcome}. shell sees origin "${e.numbers.shellSawHelloOrigin}", source===frame ${yn(e.numbers.shellHelloSourceIsThisFrame)}, other frame ${yn(e.numbers.shellHelloSourceIsOtherFrame)}; port msgs origin "${e.numbers.shellSawPortMessageOrigin}" source null ${yn(e.numbers.shellPortMessageSourceNull)}; frame sees shell origin "${e.numbers.frameSawDirectStarOrigin}"; post to frame with targetOrigin=app delivered: ${yn(e.numbers.directWithShellOriginDelivered)}` },
    { t: "b-resize-observer-body", label: "(b) height via ResizeObserver on body", f: (e) => `${e.outcome}. heights ${e.numbers.frameHeights?.join(" -> ")}` },
    { t: "b-resize-observer-documentElement", label: "(b') height via html.scrollHeight", f: (e) => `${e.outcome}. heights ${e.numbers.frameHeights?.join(" -> ")}` },
    { t: "c-tab-order", label: "(c) Tab order", f: (e) => `${e.outcome}. ${e.numbers.sequence.join(" > ")}` },
    { t: "d-fixed-clipping", label: "(d) fixed/oversized clipped", f: (e) => e.outcome },
    { t: "e-cost", label: "(e) insertion to paint, median ms (frames vs direct)", f: (e) => [1, 5, 20].map((n) => `N=${n}: ${e.numbers[`frames-${n}`]?.medianMs} vs ${e.numbers[`direct-${n}`]?.medianMs}`).join("; ") },
  ];
  out.push(table(q8rows, c8, (r, c) => { const e = find(R, "Q8", r.t, c); return e ? (e.numbers || e.outcome !== "harness error" ? r.f(e) : `${e.outcome}: ${e.error}`) : null; }));
  const harness = R.filter((r) => r.test === "harness" || r.test === "launch" || r.outcome === "harness error");
  if (harness.length) out.push("## Harness problems\n\n" + harness.map((h) => `- ${h.question} ${h.test} ${h.browser || ""} ${h.mode || ""}: ${h.outcome} ${String(h.error || "").split("\n")[0]}`).join("\n"));
  return out.join("\n\n") + "\n";
}
