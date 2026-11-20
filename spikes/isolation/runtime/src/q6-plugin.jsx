// Q6: a real React component that exercises each rendering technique and reports what worked.
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=";
const pngBytes = () => Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
const color = (el) => (el ? getComputedStyle(el).color : null);
const b64 = (buf) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };

function imgLoaded(img) {
  return new Promise((resolve) => {
    if (img.complete && img.naturalWidth) return resolve({ ok: true, naturalWidth: img.naturalWidth });
    img.onload = () => resolve({ ok: img.naturalWidth === 2, naturalWidth: img.naturalWidth });
    img.onerror = () => resolve({ ok: false, error: "img error event" });
    setTimeout(() => resolve({ ok: false, error: "img timeout" }), 2000);
  });
}

async function fontCheck(name, source) {
  try {
    const f = new FontFace(name, source);
    document.fonts.add(f);
    await Promise.race([f.load(), new Promise((_, r) => setTimeout(() => r(new Error("font timeout")), 2500))]);
    return { ok: f.status === "loaded", status: f.status };
  } catch (e) {
    return { ok: false, error: String(e && (e.message || e.name || e)) };
  }
}

async function workerCheck(make) {
  try {
    const w = make();
    return await new Promise((resolve) => {
      w.onmessage = (e) => resolve({ ok: true, got: e.data });
      w.onerror = (e) => { e.preventDefault?.(); resolve({ ok: false, error: "worker error event: " + (e.message || "") }); };
      setTimeout(() => resolve({ ok: false, error: "no message from worker" }), 1500);
    });
  } catch (e) {
    return { ok: false, error: String(e && (e.message || e.name)) };
  }
}

async function runChecks(root, ctx) {
  const q = (s) => root.querySelector(s);
  const out = {};
  out.reactRendered = { ok: q("#hello")?.textContent === "hello plugin", react: React.version, env: process.env.NODE_ENV };
  out.styleProp = { ok: color(q("#style-prop")) === "rgb(1, 2, 3)" && getComputedStyle(q("#style-prop")).paddingLeft === "5px", got: color(q("#style-prop")) };
  out.styleElementRendered = { ok: color(q("#style-jsx")) === "rgb(14, 15, 16)", got: color(q("#style-jsx")) };

  const s = document.createElement("style");
  s.textContent = ".injected{color: rgb(4, 5, 6)}";
  document.head.appendChild(s);
  out.styleElementInjected = { ok: color(q("#injected")) === "rgb(4, 5, 6)", got: color(q("#injected")) };

  try {
    const sh = new CSSStyleSheet();
    sh.replaceSync(".adopted{color: rgb(7, 8, 9)}");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh];
    sh.insertRule(".ins-constructed{color: rgb(17, 18, 19)}");
    out.adoptedStyleSheets = { ok: color(q("#adopted")) === "rgb(7, 8, 9)", got: color(q("#adopted")) };
    out.insertRuleConstructed = { ok: color(q("#ins-constructed")) === "rgb(17, 18, 19)", got: color(q("#ins-constructed")) };
  } catch (e) { out.adoptedStyleSheets = { ok: false, error: String(e) }; }

  try {
    const s2 = document.createElement("style");
    document.head.appendChild(s2);
    s2.sheet.insertRule(".ins{color: rgb(11, 12, 13)}");
    out.insertRuleStyleElement = { ok: color(q("#ins")) === "rgb(11, 12, 13)", got: color(q("#ins")) };
  } catch (e) { out.insertRuleStyleElement = { ok: false, error: String(e) }; }

  const t = q("#token");
  out.designTokens = { ok: color(t) === "rgb(10, 20, 30)" && getComputedStyle(t).marginLeft === "7px", got: color(t) + " / " + getComputedStyle(t).marginLeft };

  out.dataImage = await imgLoaded(q("#img-data"));
  out.blobImage = await imgLoaded(q("#img-blob"));

  const rect = q("#svg-rect");
  out.inlineSvg = { ok: !!rect && rect.getBBox().width === 20 && getComputedStyle(rect).fill === "rgb(0, 128, 0)", got: rect && getComputedStyle(rect).fill };

  const c = q("#cv");
  const g = c.getContext("2d");
  g.fillStyle = "rgb(255, 0, 0)"; g.fillRect(0, 0, 10, 10);
  out.canvas = { ok: Array.from(g.getImageData(5, 5, 1, 1).data).join(",") === "255,0,0,255", got: Array.from(g.getImageData(5, 5, 1, 1).data).join(",") };
  try { out.canvasToDataURL = { ok: c.toDataURL().startsWith("data:image/png") }; } catch (e) { out.canvasToDataURL = { ok: false, error: String(e) }; }

  out.fontUrlSameServer = await fontCheck("FUrl", `url(${ctx.fontUrl})`);
  out.fontDataUrl = ctx.fontBuffer ? await fontCheck("FData", `url(data:font/ttf;base64,${b64(ctx.fontBuffer)})`) : { ok: false, error: "no font sent" };
  out.fontArrayBuffer = ctx.fontBuffer ? await fontCheck("FBuf", ctx.fontBuffer.slice(0)) : { ok: false, error: "no font sent" };
  // @font-face in a stylesheet, data: source
  if (ctx.fontBuffer) {
    const fs = document.createElement("style");
    fs.textContent = `@font-face{font-family:FCss;src:url(data:font/ttf;base64,${b64(ctx.fontBuffer)})}`;
    document.head.appendChild(fs);
    try {
      const faces = await Promise.race([document.fonts.load("16px FCss", "\u{10280}"), new Promise((r) => setTimeout(() => r(null), 2500))]);
      out.fontFaceRuleData = { ok: !!faces && faces.length > 0 && faces.every((f) => f.status === "loaded"), got: faces ? faces.map((f) => f.status).join(",") || "no faces" : "timeout" };
    } catch (e) { out.fontFaceRuleData = { ok: false, error: String(e) }; }
  }

  try { out.evalRuns = { ok: new Function("return 2")() === 2 }; } catch (e) { out.evalRuns = { ok: false, error: String(e && e.message) }; }
  out.workerBlob = await workerCheck(() => new Worker(URL.createObjectURL(new Blob(["postMessage('hi')"], { type: "text/javascript" }))));
  out.workerUrl = await workerCheck(() => new Worker(ctx.workerUrl));
  return out;
}

function Plugin({ ctx }) {
  const ref = useRef(null);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([pngBytes()], { type: "image/png" }));
    ref.current.querySelector("#img-blob").src = url;
    requestAnimationFrame(() => runChecks(ref.current, ctx).then((r) => window.__r("q6", r), (e) => window.__r("error", "checks threw: " + e)));
  }, []);
  return (
    <div ref={ref}>
      <style>{".style-jsx{color: rgb(14, 15, 16)}"}</style>
      <p id="hello">hello plugin</p>
      <span id="style-prop" style={{ color: "rgb(1, 2, 3)", paddingLeft: 5 }}>style prop</span>
      <span id="style-jsx" className="style-jsx">style jsx</span>
      <span id="injected" className="injected">injected</span>
      <span id="adopted" className="adopted">adopted</span>
      <span id="ins" className="ins">ins</span>
      <span id="ins-constructed" className="ins-constructed">ins2</span>
      <span id="token" style={{ color: "var(--brand)", marginLeft: "var(--gap)", display: "inline-block" }}>token</span>
      <img id="img-data" src={`data:image/png;base64,${PNG}`} width="2" height="2" />
      <img id="img-blob" width="2" height="2" />
      <svg width="40" height="40"><rect id="svg-rect" x="0" y="0" width="20" height="20" fill="rgb(0, 128, 0)" /></svg>
      <canvas id="cv" width="10" height="10" />
    </div>
  );
}

window.__ctxReady.then((ctx) => {
  for (const [k, v] of Object.entries(ctx.tokens || {})) document.documentElement.style.setProperty(k, v);
  const el = document.getElementById("root");
  createRoot(el).render(<Plugin ctx={ctx} />);
});
