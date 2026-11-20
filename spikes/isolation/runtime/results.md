# Tailor runtime spike results

Generated 2026-11-20T04:11:49.892Z by `node run.mjs` (Node v22.13.0, Playwright 1.65.1, darwin arm64).

Browsers: **chromium** 159.0.8154.6 (Playwright Chromium (full build; new headless)); **chromium-headless-shell** 159.0.8154.6 (chromium-headless-shell (Playwright's default headless Chromium)); **chrome** 157.0.8103.79 (installed Google Chrome); **firefox** 159.0 (Playwright Firefox (Juggler build)); **firefox-fission** 159.0 (Playwright Firefox with fission.autostart=true); **webkit** 27.2 (Playwright WebKit build, not shipping Safari).

Playwright WebKit is a WebKit build driven by Playwright, not shipping Safari. Playwright Firefox is a patched Nightly (Juggler); `firefox-fission` forces the Fission prefs on.

- webkit: webkit-compat: Playwright 1.65 + WebKit build 2251 (macOS 14) needed one protocol call dropped (Page.overrideSetting PushAPIEnabled); patched 1 call site at load time

## Q3. Main thread and process sharing

Frame busy-loops 3000 ms. Cell: longest shell `setInterval(10)` gap / longest rAF gap; whether a click on the shell 1 s into the loop was handled during the loop; renderer processes with the page open (CDP `SystemInfo.getProcessInfo` for Chromium, `ps` otherwise; `oopif` = frame is its own CDP iframe target).

| | chromium headless | chromium headed | chromium-headless-shell headless | chrome headless | chrome headed | firefox headless | firefox headed | firefox-fission headless | firefox-fission headed | webkit headless | webkit headed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (a) same origin, no sandbox | 3018 / 3028 ms; click during loop: no; 3 renderers | 3005 / 3005 ms; click during loop: no; 3 renderers | 3009 / 3021 ms; click during loop: no; 1 renderers | 3016 / 3028 ms; click during loop: no; 3 renderers | 3002 / 3005 ms; click during loop: no; 3 renderers | 3005 / 3008 ms; click during loop: no; 2 content procs (ps) | 3009 / 3011 ms; click during loop: no; 2 content procs (ps) | 3008 / 3003 ms; click during loop: no; 2 content procs (ps) | 3009 / 3003 ms; click during loop: no; 2 content procs (ps) | 3003 / 3002 ms; click during loop: no; 1 content procs (ps) | 3003 / 3009 ms; click during loop: no; 1 content procs (ps) |
| (b) same origin, sandbox + CSP | 12 / 18 ms; click during loop: yes; 4 renderers, oopif | 12 / 18 ms; click during loop: yes; 4 renderers, oopif | 3006 / 3005 ms; click during loop: no; 1 renderers | 13 / 19 ms; click during loop: yes; 4 renderers, oopif | 12 / 19 ms; click during loop: yes; 4 renderers, oopif | 3003 / 3002 ms; click during loop: no; 2 content procs (ps) | 3006 / 3017 ms; click during loop: no; 2 content procs (ps) | 3010 / 3015 ms; click during loop: no; 2 content procs (ps) | 3004 / 3002 ms; click during loop: no; 2 content procs (ps) | 3009 / 3003 ms; click during loop: no; 1 content procs (ps) | 3001 / 3014 ms; click during loop: no; 1 content procs (ps) |
| (b') same origin, sandbox attribute only | 21 / 18 ms; click during loop: yes; 4 renderers, oopif | 13 / 18 ms; click during loop: yes; 4 renderers, oopif | 3010 / 3014 ms; click during loop: no; 1 renderers | 12 / 19 ms; click during loop: yes; 4 renderers, oopif | 12 / 19 ms; click during loop: yes; 4 renderers, oopif | 3006 / 3004 ms; click during loop: no; 2 content procs (ps) | 3007 / 3009 ms; click during loop: no; 2 content procs (ps) | 3008 / 3000 ms; click during loop: no; 2 content procs (ps) | 3003 / 3011 ms; click during loop: no; 2 content procs (ps) | 3005 / 3003 ms; click during loop: no; 1 content procs (ps) | 3002 / 3012 ms; click during loop: no; 1 content procs (ps) |
| (c) other site, no sandbox | 12 / 18 ms; click during loop: yes; 4 renderers, oopif | 17 / 18 ms; click during loop: yes; 4 renderers, oopif | 3006 / 3004 ms; click during loop: no; 1 renderers | 13 / 19 ms; click during loop: yes; 4 renderers, oopif | 13 / 19 ms; click during loop: yes; 4 renderers, oopif | 3001 / 3001 ms; click during loop: no; 2 content procs (ps) | 3002 / 3006 ms; click during loop: no; 2 content procs (ps) | 12 / 25 ms; click during loop: yes; 3 content procs (ps) | 11 / 25 ms; click during loop: yes; 3 content procs (ps) | 3003 / 3008 ms; click during loop: no; 1 content procs (ps) | 3006 / 3016 ms; click during loop: no; 1 content procs (ps) |
| (d) other site, sandbox + CSP | 16 / 18 ms; click during loop: yes; 4 renderers, oopif | 18 / 18 ms; click during loop: yes; 4 renderers, oopif | 3008 / 3005 ms; click during loop: no; 1 renderers | 18 / 19 ms; click during loop: yes; 4 renderers, oopif | 22 / 19 ms; click during loop: yes; 4 renderers, oopif | 3003 / 3002 ms; click during loop: no; 2 content procs (ps) | 3004 / 3004 ms; click during loop: no; 2 content procs (ps) | 13 / 26 ms; click during loop: yes; 3 content procs (ps) | 11 / 25 ms; click during loop: yes; 3 content procs (ps) | 3009 / 3008 ms; click during loop: no; 1 content procs (ps) | 3004 / 3004 ms; click during loop: no; 1 content procs (ps) |

Infinite loop (`while(true){}`) in the frame; 1.5 s later the shell is asked to run JS and remove the frame (6 s limit).

| | chromium headless | chromium headed | chromium-headless-shell headless | chrome headless | chrome headed | firefox headless | firefox headed | firefox-fission headless | firefox-fission headed | webkit headless | webkit headed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (a) same origin, no sandbox | shell hung | shell hung | shell hung | shell hung | shell hung | shell hung | shell hung | shell hung | shell hung | shell hung | shell hung |
| (b) same origin, sandbox + CSP | shell responsive (309 ms), frame removed | shell responsive (310 ms), frame removed | shell hung | shell responsive (303 ms), frame removed | shell responsive (301 ms), frame removed | shell hung | shell hung | shell hung | shell hung | shell hung | shell hung |
| (b') same origin, sandbox attribute only | shell responsive (302 ms), frame removed | shell responsive (308 ms), frame removed | shell hung | shell responsive (307 ms), frame removed | shell responsive (302 ms), frame removed | shell hung | shell hung | shell hung | shell hung | shell hung | shell hung |
| (c) other site, no sandbox | shell responsive (303 ms), frame removed | shell responsive (308 ms), frame removed | shell hung | shell responsive (303 ms), frame removed | shell responsive (304 ms), frame removed | shell hung | shell hung | shell responsive (306 ms), frame removed | shell responsive (304 ms), frame removed | shell hung | shell hung |
| (d) other site, sandbox + CSP | shell responsive (305 ms), frame removed | shell responsive (304 ms), frame removed | shell hung | shell responsive (309 ms), frame removed | shell responsive (304 ms), frame removed | shell hung | shell hung | shell responsive (305 ms), frame removed | shell responsive (304 ms), frame removed | shell hung | shell hung |

Two sandboxed plugin frames from the app origin; one loops 3 s. Cell: longest gap in the other frame's own 10 ms heartbeat.

| | chromium headless | chromium headed | chromium-headless-shell headless | chrome headless | chrome headed | firefox headless | firefox headed | firefox-fission headless | firefox-fission headed | webkit headless | webkit headed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sibling plugin | 3008 ms (froze) | 3004 ms (froze) | 3006 ms (froze) | 3001 ms (froze) | 3002 ms (froze) | 3007 ms (froze) | 3009 ms (froze) | 3005 ms (froze) | 3003 ms (froze) | 3029 ms (froze) | 3027 ms (froze) |

## Q5. Loading plugin code in the opaque-origin document

Cell: **policy** (sandbox attribute + proposed CSP) / sandbox attribute only / control (no sandbox, no CSP). `yes` = the code ran. Policy errors are in results.json.

| | chromium headless | chrome headless | firefox headless | webkit headless |
| --- | --- | --- | --- | --- |
| i: inline &lt;script nonce> — `script-src 'nonce-tailorN0nce4201'` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| i (negative): inline &lt;script> without nonce (should be blocked by policy) — `script-src 'nonce-tailorN0nce4201'` | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes |
| ii: inline &lt;script type=module nonce> — `script-src 'nonce-tailorN0nce4201'` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| iii: &lt;script src=/plugin/...> with script-src 'self' — `script-src 'nonce-tailorN0nce4201' 'self'` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **no** / yes / yes |
| iv: &lt;script src> with script-src http://localhost:4201 — `script-src 'nonce-tailorN0nce4201' http://localhost:4201` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| iv+: &lt;script nonce src=...> with script-src nonce only — `script-src 'nonce-tailorN0nce4201'` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| v: &lt;script type=module src>, origin in script-src, no ACAO — `script-src 'nonce-tailorN0nce4201' http://localhost:4201` | **no** / no / yes | **no** / no / yes | **no** / no / yes | **no** / no / yes |
| v: &lt;script type=module src>, origin in script-src, ACAO * — `script-src 'nonce-tailorN0nce4201' http://localhost:4201` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| v: &lt;script type=module src>, origin in script-src, ACAO null — `script-src 'nonce-tailorN0nce4201' http://localhost:4201` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| v: &lt;script type=module src>, script-src 'self', ACAO * — `script-src 'nonce-tailorN0nce4201' 'self'` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **no** / yes / yes |
| v: &lt;script type=module nonce src>, script-src nonce only, ACAO * — `script-src 'nonce-tailorN0nce4201'` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| vi: module statically importing a second module, origin in script-src, ACAO * — `script-src 'nonce-tailorN0nce4201' http://localhost:4201` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| vi: nonce'd module statically importing a second module, script-src nonce only — `script-src 'nonce-tailorN0nce4201'` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| vi: esbuild ESM entry importing shared React chunk (chunk-GK52V2GQ.js), origin in script-src, ACAO * — `script-src 'nonce-tailorN0nce4201' http://localhost:4201` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| vi: same, nonce'd entry, script-src nonce only — `script-src 'nonce-tailorN0nce4201'` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| vi: same, origin in script-src, no ACAO — `script-src 'nonce-tailorN0nce4201' http://localhost:4201` | **no** / no / yes | **no** / no / yes | **no** / no / yes | **no** / no / yes |
| vii: nonce'd import map + nonce'd inline module importing a bare specifier — `script-src 'nonce-tailorN0nce4201' http://localhost:4201` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| vii: import map without nonce + nonce'd inline module — `script-src 'nonce-tailorN0nce4201' http://localhost:4201` | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes |
| viii: blob: module via &lt;script type=module nonce src=blob:>, script-src nonce only — `script-src 'nonce-tailorN0nce4201'` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| viii: blob: module via &lt;script type=module src=blob:> (no nonce), script-src without blob: — `script-src 'nonce-tailorN0nce4201'` | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes |
| viii: blob: module via &lt;script type=module src=blob:> (no nonce), script-src blob: — `script-src 'nonce-tailorN0nce4201' blob:` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| viii: blob: module via dynamic import(blobURL), script-src blob: — `script-src 'nonce-tailorN0nce4201' blob:` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| ix: import('/plugin/star/mod.js') from nonce'd inline script, script-src nonce only — `script-src 'nonce-tailorN0nce4201'` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| ix: import() from nonce'd inline script, origin in script-src, ACAO * — `script-src 'nonce-tailorN0nce4201' http://localhost:4201` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| ix: import(), origin in script-src, no ACAO — `script-src 'nonce-tailorN0nce4201' http://localhost:4201` | **no** / no / yes | **no** / no / yes | **no** / no / yes | **no** / no / yes |
| extra: trusted nonce'd script injects &lt;script src> without nonce, script-src nonce 'strict-dynamic' — `script-src 'nonce-tailorN0nce4201' 'strict-dynamic'` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| extra: same injection with script-src nonce only (no strict-dynamic) — `script-src 'nonce-tailorN0nce4201'` | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes |
| leak: plugin script reads the nonce from the DOM and injects &lt;script nonce src=http://127.0.0.1:4202/...?d=secret>; script-src nonce only (yes = leak worked) — `script-src 'nonce-tailorN0nce4201'` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| leak: same, but the host script first replaces HTMLElement.prototype.nonce with a getter returning '' (yes = leak worked) — `script-src 'nonce-tailorN0nce4201'` | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes |
| leak: no nonce anywhere: inline scripts by hash, bundle by path; script-src 'sha256-…' http://localhost:4201/plugin/none/ (yes = leak worked) — `script-src http://localhost:4201/plugin/none/` | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes |
| iv (path): classic bundle allowed by path; inline host script by hash; script-src 'sha256-…' http://localhost:4201/plugin/none/ — `script-src http://localhost:4201/plugin/none/` | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes | **yes** / yes / yes |
| iv (path): script outside the allowed path: &lt;script src=/plugin/star/classic.js> with script-src 'sha256-…' http://localhost:4201/plugin/none/ — `script-src http://localhost:4201/plugin/none/` | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes |
| extra: eval('1') from nonce'd script (policy has no unsafe-eval) — `script-src 'nonce-tailorN0nce4201'` | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes |
| Q3 worker: new Worker(blob:) from nonce'd script — `script-src 'nonce-tailorN0nce4201' blob:` | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes | **no** / yes / yes |
| Q3 worker: new Worker('/plugin/none/worker.js') — `script-src 'nonce-tailorN0nce4201' http://localhost:4201` | **no** / no / yes | **no** / no / yes | **no** / no / yes | **no** / no / yes |

## Q6. Rendering under the policy

A React 19.3.1 component in the sandboxed frame. Cell: **proposed policy** / style-src 'none' / + font-src data: / + font-src app origin / React dev build under policy / control.

| | chromium headless | chrome headless | firefox headless | webkit headless |
| --- | --- | --- | --- | --- |
| reactRendered | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes |
| styleProp | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes |
| styleElementRendered | **yes** / no / yes / yes / yes / yes | **yes** / no / yes / yes / yes / yes | **yes** / no / yes / yes / yes / yes | **yes** / no / yes / yes / yes / yes |
| styleElementInjected | **yes** / no / yes / yes / yes / yes | **yes** / no / yes / yes / yes / yes | **yes** / no / yes / yes / yes / yes | **yes** / no / yes / yes / yes / yes |
| adoptedStyleSheets | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes |
| insertRuleConstructed | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes |
| insertRuleStyleElement | **yes** / no / yes / yes / yes / yes | **yes** / no / yes / yes / yes / yes | **yes** / no / yes / yes / yes / yes | **yes** / no / yes / yes / yes / yes |
| designTokens | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes |
| dataImage | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes |
| blobImage | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes |
| inlineSvg | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes |
| canvas | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes |
| canvasToDataURL | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes |
| fontUrlSameServer | **no** / no / no / yes / no / yes | **no** / no / no / yes / no / yes | **no** / no / no / yes / no / yes | **no** / no / no / yes / no / yes |
| fontDataUrl | **no** / no / yes / no / no / yes | **no** / no / yes / no / no / yes | **no** / no / yes / no / no / yes | **no** / no / yes / no / no / yes |
| fontArrayBuffer | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes | **yes** / yes / yes / yes / yes / yes |
| fontFaceRuleData | **no** / no / yes / no / no / yes | **no** / no / yes / no / no / yes | **no** / no / yes / no / no / yes | **no** / no / yes / no / no / yes |
| evalRuns | **no** / no / no / no / no / yes | **no** / no / no / no / no / yes | **no** / no / no / no / no / yes | **no** / no / no / no / no / yes |
| workerBlob | **no** / no / no / no / no / yes | **no** / no / no / no / no / yes | **no** / no / no / no / no / yes | **no** / no / no / no / no / yes |
| workerUrl | **no** / no / no / no / no / yes | **no** / no / no / no / no / yes | **no** / no / no / no / no / yes | **no** / no / no / no / no / yes |

## Q8. The channel and the frame's place in the page

| | chromium headless | chrome headless | firefox headless | webkit headless |
| --- | --- | --- | --- | --- |
| (a) MessagePort both ways; origin/source | ports work both ways; e.source identifies the frame. shell sees origin "null", source===frame yes, other frame no; port msgs origin "" source null yes; frame sees shell origin "http://localhost:4201"; post to frame with targetOrigin=app delivered: no | ports work both ways; e.source identifies the frame. shell sees origin "null", source===frame yes, other frame no; port msgs origin "" source null yes; frame sees shell origin "http://localhost:4201"; post to frame with targetOrigin=app delivered: no | ports work both ways; e.source identifies the frame. shell sees origin "null", source===frame yes, other frame no; port msgs origin "" source null yes; frame sees shell origin "http://localhost:4201"; post to frame with targetOrigin=app delivered: no | ports work both ways; e.source identifies the frame. shell sees origin "null", source===frame yes, other frame no; port msgs origin "" source null yes; frame sees shell origin "http://localhost:4201"; post to frame with targetOrigin=app delivered: no |
| (b) height via ResizeObserver on body | frame tracks content height (grow and shrink) with nothing left to scroll. heights 195 -> 795 -> 105 | frame tracks content height (grow and shrink) with nothing left to scroll. heights 195 -> 795 -> 105 | frame tracks content height (grow and shrink) with nothing left to scroll. heights 199 -> 819 -> 106 | frame tracks content height (grow and shrink) with nothing left to scroll. heights 180 -> 720 -> 99 |
| (b') height via html.scrollHeight | frame left scrollable or did not resize. heights 195 -> 795 -> 795 | frame left scrollable or did not resize. heights 195 -> 795 -> 795 | frame left scrollable or did not resize. heights 199 -> 819 -> 819 | frame left scrollable or did not resize. heights 180 -> 720 -> 720 |
| (c) Tab order | Tab goes into the frame, through its controls in order, and back out, both directions. shell:s1 > frame:f1 > frame:f2 > frame:f3 > shell:s2 > frame:f3 > frame:f2 > frame:f1 > shell:s1 | Tab goes into the frame, through its controls in order, and back out, both directions. shell:s1 > frame:f1 > frame:f2 > frame:f3 > shell:s2 > frame:f3 > frame:f2 > frame:f1 > shell:s1 | Tab goes into the frame, through its controls in order, and back out, both directions. shell:s1 > frame:f1 > frame:f2 > frame:f3 > shell:s2 > frame:f3 > frame:f2 > frame:f1 > shell:s1 | Tab enters and leaves the frame in order both ways; the button is skipped (Tab reaches text fields only by default here). shell:s1 > frame:f1 > frame:f3 > shell:s2 > shell:BODY > shell:s2 > frame:f3 > frame:f1 > shell:s1 |
| (d) fixed/oversized clipped | clipped: nothing in the frame paints outside its box; overlays must be drawn by the shell | clipped: nothing in the frame paints outside its box; overlays must be drawn by the shell | clipped: nothing in the frame paints outside its box; overlays must be drawn by the shell | clipped: nothing in the frame paints outside its box; overlays must be drawn by the shell |
| (e) insertion to paint, median ms (frames vs direct) | N=1: 36 vs 24; N=5: 34 vs 24; N=20: 123 vs 23 | N=1: 35 vs 25; N=5: 40 vs 24; N=20: 122 vs 23 | N=1: 52 vs 40; N=5: 64 vs 25; N=20: 177 vs 24 | N=1: 73 vs 26; N=5: 80 vs 24; N=20: 167 vs 33 |
