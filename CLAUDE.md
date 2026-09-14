# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based Python editor for schools (CS in Schools / Code for Schools). Python runs client-side via a **forked Skulpt** interpreter; the editor is **Monaco**. There is no build system, no package manager, and no server-side code — it is a static site of hand-written global-scope JavaScript plus vendored libraries.

## Migration in progress

The repo is midway through replacing both halves: **Ace → Monaco** (done) and **Skulpt → Pyodide** (in progress, behind `?runtime=pyodide`). Neither original is being thrown away — see the note under the table. The full plan, including the decisions already taken and the verification results, is at `~/.claude/plans/carefully-plan-for-the-precious-crown.md`.

| Phase | State |
| --- | --- |
| 0 — introduce Editor/Runtime seams, host registry, async boot, conformance harness | done |
| 1 — Monaco replaces Ace | done |
| 2 — Pyodide behind `?runtime=pyodide`, Skulpt still default | **nearly done** — runtime core, `csinsc`/`goodies`, `goto`/`label`, `pyangelo`, `turtle`, `microbit`, `speech`, `babylon`, `perlin`, builtin PyAngelo with `sprite`/`vector`, the step debugger, webcam / Teachable Machine, Philips Hue, console.js's classroom functions and `forever:` all ported; breakpoints added (new, both runtimes). Left: `?compiled=1` (blocked on the original `.py` sources). Hardware and visual checks outstanding |
| 3 — flip the default; `?runtime=skulpt` becomes the escape hatch | — |
| 4 — delete Skulpt, Ace, and the fork | **on hold — do not start** |

**Phase 4 is held by decision, not by scheduling.** A manual pass over the whole editor comes first, and the ability to switch back and compare the two runtimes is wanted for the long term. So **`?runtime=skulpt` and `?editor=ace` are permanent product features, not transitional scaffolding** — keep them working and test them like anything else that ships. `js/runtime-skulpt.js`, `js/editor-ace.js`, `js/skulpt*.js`, `js/ace*.js`, `build.bat`, `js/copy_over.bat` and the `../skulpt` fork all stay. Phase 3 still flips the default, which a URL parameter undoes; deleting the other implementation would not be undoable, and it would also delete the oracle every gate here compares against.

Everything is structured around that: the two facades exist so both backends can coexist, and the test suites exist so "we didn't break the curriculum" is measured rather than asserted. **Run the conformance suite after any change** — see Testing below.

## Running and "building"

```sh
python tests/serve.py 8731           # NOT python -m http.server, see below
# then open http://localhost:8731/editor.html  (or index.html for the framed version)

tests/run-conformance.sh compare     # ~75s, all 226 automatable curriculum files
```

Opening `editor.html` from the filesystem mostly works, but `?project=` loading will not.

**The host must serve `.mjs` as JavaScript.** `python -m http.server` sends `text/plain`, and browsers refuse to execute an ES module with a non-JavaScript MIME type — so Pyodide's loader, which dynamically imports `pyodide.asm.mjs`, fails with nothing but a `Failed to fetch dynamically imported module` in the console. `tests/serve.py` sets the right types locally; **whatever hosts this in production must too**. Check with:

```sh
curl -sI https://<host>/js/pyodide/pyodide.asm.mjs | grep -i content-type   # want text/javascript
```

`.wasm` should be `application/wasm` for streaming compilation.

`build.bat` / `js/copy_over.bat` copy the Skulpt build output from a **sibling checkout** (`../skulpt/dist/*` → `js/`). The Python language extensions and most of the classroom Python API live in that fork, **not here** — see "The Skulpt fork" below. Both `.bat` files are in `.gitignore` — treat vendored `js/skulpt*.js` as build output that gets refreshed wholesale (see commits like "refreshing lib versions").

**Cache busting is manual.** Script tags in `editor.html` carry `?t=<n>` (e.g. `js/console.js?t=135`, `js/editor.js?t=52`, `css/styles.css?v=4`). Bump the number whenever you change the corresponding file, or deployed browsers will keep the stale copy.

## Architecture

### Page structure
- [index.html](index.html) — branded wrapper that loads `editor.html` in an iframe, forwarding the query string verbatim.
- [editor.html](editor.html) — the real app. Loads every library as a plain `<script>` (no modules, no bundler), so **everything is a global**.

**Script order matters, and one constraint is not obvious:** Monaco's AMD loader installs a global `define()`, so *every* UMD library must load before it or it will register as an AMD module instead of setting its global. That is why `babylon.js` and `qrcode.min.js` were moved from below `editor.js` into `<head>` — which also fixed the long-standing wart that `BABYLON` was undefined while `editor.js` ran. Current order: Skulpt → `pygmi.js` → `hostapi.js` → `console.js` → other vendored libs → babylon/qrcode → `lex.js`/`lexpy.js` → facades and backends → **Monaco's `loader.js`** → `editor-monaco.js` → `editor.js`.

### The two seams

Everything hangs off two facades, so Ace/Monaco and Skulpt/Pyodide are interchangeable during the migration. Both are plain IIFEs returning an object; a backend registers itself with `use()`.

| File | Role |
| --- | --- |
| [js/editorapi.js](js/editorapi.js) | `Editor` — `create` (async, returns a promise), `getValue`, `setValue`, `revealLine`, `setStepLine`, `clearStepLine`, `setBreakpointsEnabled`, `getBreakpoints`, `setBreakpoints`, `setReadOnly`, `setTheme('dark'\|'light')`, `layout`, `registerCompletions`, `dispose` |
| [js/editor-monaco.js](js/editor-monaco.js) | Monaco backend (default) |
| [js/editor-ace.js](js/editor-ace.js) | Ace backend, lazy-loaded only for `?editor=ace`. **Stays** — Phase 4 is on hold |
| [js/runtime.js](js/runtime.js) | `Runtime` — `boot`, `run(opts)`, `stop`, `isStopped`, `teardown`, `formatError`, `setWebServiceURL`, `installHostName` |
| [js/runtime-skulpt.js](js/runtime-skulpt.js) | Skulpt backend. **Stays** — Phase 4 is on hold, and it is the oracle every cross-runtime gate compares against |
| [js/hostapi.js](js/hostapi.js) | `Host` — registry of the 56 Python-visible names `console.js` provides |

**Nothing outside a backend may touch `Sk.*` or `ace`/`monaco` directly.** `editor.js` has three remaining `Sk.` references (the Babylon bridge, `animationFrameRequest`, `Sk.onAfterCompile`); those are Phase 2 work.

### The hand-written source files
- [js/editor.js](js/editor.js) — UI shell only: run/stop lifecycle, step-debugger UI, display-mode layout, save/load, codestore URLs, Babylon scene bridge. URL params are parsed synchronously; anything that has to wait happens in the `boot()` IIFE at the bottom.
- [js/console.js](js/console.js) — terminal emulation plus the classroom builtins that need this page's DOM: images/YouTube/iframes, buttons and textboxes, audio + Tone.js, webcam, spinner, turtle canvas, watch-table frame, Philips Hue, `getURLParam`. It **declares** them into `Host` at parse time rather than binding them, so **it now parses with no interpreter present at all** — the property Pyodide's async load needs. It also shadows the fork's `setCanvasSize` (see "Two different PyAngelo APIs").
- [js/pygmi.js](js/pygmi.js) — source-to-source preprocessing (see below), using the tokenizer in `js/lex.js` + `js/lexpy.js`. Interpreter-independent; survives the Pyodide swap untouched.

### Startup (`boot()` at the bottom of editor.js)

```
sync:  checkBrowser, DOM lookups, Runtime.use(), all URL-param parsing,
       setDisplayMode, button visibility
async: await Editor.create()  ->  await Runtime.boot()
       -> Runtime.setWebServiceURL() -> Host.installInto()
       -> await acquireSource()  -> Editor.setValue() -> autorun
```

`acquireSource()` is the single entry point for all four load paths (`?code=`, `?id=`, `?project=`, localStorage); it replaced four near-duplicate `XMLHttpRequest` blocks. **Button-visibility params are parsed before the load branch** — they used to run after, so `?nostep`, `?norun` and `?autostep` were silently ignored on whichever paths happened to be synchronous.

### Execution pipeline (`runSkulpt` in editor.js)
1. Read code from `Editor.getValue()` (or use the passed-in string in headless mode), persist to `localStorage`.
2. `run_lexer(code)` — tokenizes and rewrites `cloud_*` identifiers into `getCloudVariable('...')` / `setCloudVariable('...', ...)` calls. Those two functions are **Python** functions in the fork's `csinsc.py`, so the rewrite only compiles if the student's code has `from goodies import *` (or `csinsc`), and it only works at runtime after `setSchool(<id>)`. The equivalent rewrite was prototyped inside the compiler's `nameop` and left commented out there — the lexer pass is the live implementation.
3. `stripPeriodFromGoto(code)` — normalises `label .foo` / `goto .foo` to the bare `label foo` / `goto foo` the fork's grammar accepts.
4. If **training wheels** (`?wheels=1`) is on: `replacePrintConcatenationWithArgs` then `pygmify` — a regex-based beginner dialect that rewrites `forever`, `until`, `repeat N times`, `repeat i = 1 to N`, single `=` inside conditions, and missing trailing colons.
5. `checkForPyangelo(code)` (regex for `import pyangelo`) decides whether to switch to canvas display; `checkForBuiltinPyangelo` (`setCanvasSize` at top level) disables Skulpt's debugging instrumentation for performance.
6. `Runtime.run({ code, stepMode, autoStep, takesPrompt, debugging, onOutput, onInput, onStep, onError })`, which returns a promise settling when the program ends.

Steps 2–4 rewrite the source the interpreter compiles, but the step debugger highlights lines in the editor and `formatError` reports `<stdin>.py` line numbers to the student. Every existing pass is line-preserving (within-line regex replacements, newlines re-emitted verbatim by the lexer). Keep new passes line-preserving too, or highlighting and error line numbers drift.

**`pygmi.js` used to pass state between those steps through an implicit global.** `replacePrintConcatenationWithArgs` read `pass1` without ever assigning it, relying on `stripPeriodFromGoto` having just run and left it holding that exact string. The moment step 3 became `Runtime.normaliseGotoLabels` — whose Pyodide branch is properly scoped — every `?wheels=1` program died with `pass1 is not defined`. All three functions now declare it. If you add a pass here, declare your locals: nothing in this file is in strict mode, so a missing `var` silently becomes cross-function state.

**Everything interpreter-specific about stepping lives in the backend.** `runtime-skulpt.js` owns the `handlers` map (`handlers["*"]` for the stop check, `Sk.debug`/`Sk.delay` for stepping and breakpoints), the suspension-chain walk that finds the deepest `<stdin>.py` frame, the `$loc`/`$tmps` scrape, and stripping Skulpt's `_$rw$` reserved-word suffix; [js/py/stepper.py](js/py/stepper.py) is the Pyodide equivalent, on `sys.monitoring` LINE events and `frame.f_locals`. `editor.js` sees only `onStep({lineno, locals, reason})` and resolves it with `"step"` (⏭️ Next) or `"continue"` (▶️ Continue) — or after a 1s delay under `?autostep`; `populateTraceTable` takes a plain `[[name, value], …]` array.

**Breakpoints** are a click in the gutter (Monaco's glyph margin, Ace's line numbers), passed to both runtimes as `opts.breakpoints`. A normal Run pauses at one and shows the same watch table, Next and Continue the Step button does; both are off under `?nostep` and `?headless`, and on in canvas programs too, where drawing appears at each `clearScreen()`/`refresh()` as it does when running. **`nostep` holds the `?nostep` URL parameter and nothing else.** `setDisplayMode`'s canvas and Babylon branches used to set it to `"1"` and never clear it — a leftover from when Step was hidden for canvas programs — so after one pyangelo program the Step button stayed hidden and every later run on the page silently ignored its breakpoints. Reported by a user; `tests/check-stepping.sh` now runs a canvas program and then a plain one *in the same page*, and requires the Step button to be visible before and after. Three details are load-bearing:

- **Skulpt: a suspension that is not a pause must return nothing from the handler**, handing it back to Skulpt's default handling — which is why Run-with-breakpoints costs nothing extra. Making `Sk.breakpoints()` return false instead would also stop `while` loops suspending, and `killableWhile`, the only thing keeping a game loop from freezing the tab, depends on those suspensions.
- **Pyodide: a line that is not a breakpoint disables its own LINE event while not stepping**; pressing Next calls `sys.monitoring.restart_events()` to bring every line back.
- **A `goto` jump never produces a LINE event for the label it lands on** — it assigns `frame.f_lineno`. The goto tracer tells the stepper where it jumped and `label` pauses when it was that target. Inferring a jump from "the last line reported" was tried first and broke run-to-breakpoint, because lines that have disabled their events leave that record stale.

**Accepted difference:** CPython pauses on a `for` line *before* taking the next item; Skulpt paused after. So on a `for` line the watch table shows the loop variable's current value — as on every other line, the state before the highlighted line runs — and the `for` line is reported once more when the loop ends, as Skulpt already did for `while`. `tests/check-stepping.sh` allows exactly that and nothing else.

### Console output protocol
`outputf` parses a **non-standard, space-padded ANSI-like escape**: `[ <code>;2;<r>;<g>;<b> m` (note the spaces — real ANSI has none). Codes: 0 reset, 38 foreground, 48 background, 1 bold, 3 italics, 4 underline, 5 clear styles. The `Sk.builtins.RED`, `HL_BLUE`, `BOLD`, … constants at the top of `console.js` emit these. Each styled run becomes a `<span>` appended to `#console`. `inputf` swaps in a `contenteditable` span for `input()`, unless PyAngelo canvas mode is active (then it uses a native `prompt()`).

### Adding a Python builtin

Declare it into the `Host` registry in `console.js`; do **not** write `Sk.*` at top level, or console.js stops being loadable without an interpreter.

```js
Host.constant("RED", "[ 38;2;255;0;0 m");   // a plain value
Host.method("showIFrame", showIFrame, {           // with argument metadata
    namedArgs: [null, "width", "height", "x", "y"],
    defaults: [600, 480, -1, -1],
    textsig: "($module, url, width, height, x, y /)",
    doc: "Displays a URL in an iframe"
});
Host.raw("clear", clear);                          // no wrapper; unwraps its own args
Host.alias("inputNum", "inputnumber");             // declare the target first
```

The implementation body may still use `Sk.*` — it only runs during a program, when the interpreter is up. `Runtime.installHostName()` in the backend turns each entry into the right binding (`sk_method` for Skulpt). Long-running builtins return a `Sk.misceval.Suspension` so the Stop button still works.

### Display modes (`setDisplayMode`)
`side` (default), `top`, `bottom`, `canvas` (PyAngelo 2D), `babylon` (3D/WebXR). Implemented by **reparenting** `#editor`, `#consoleWrapper`, `#pyangelo`, `#babylonCanvas` between `#leftpane`/`#rightpane`/`#bottompane` and re-creating the Split.js gutters. It is guarded by `prevDisplay` and is known to be fragile when leaving canvas mode (see the FIXME) — prefer extending the existing branches over adding new reparenting logic elsewhere.

The function ends with a `requestAnimationFrame(() => Editor.layout())`. Monaco watches its container for resizes, but a detached-then-reattached container measures 0×0 and the observer alone does not reliably recover.

### Monaco

Vendored at [js/monaco/vs/](js/monaco/vs/) — **0.52.2, the last release with a classic AMD build**, five files, 4.2 MB. Things that will bite:

- **0.56 is not usable here.** Its `min/` is 152 hash-named Rollup chunks whose names change every release, and `base/worker/workerMain.js` and the per-language files are gone. Revisit only if this project ever gets a bundler.
- **`editor.main.js` does not bundle the Python tokenizer.** It lazily `require`s `basic-languages/python/python.js`, so that file must be vendored too. Miss it and you get a silent loss of syntax highlighting, with no error.
- **Monaco mounts into `#monacoMount`, a div created inside `#editor`.** `#editor` carries a border and padding and is re-parented by `setDisplayMode`; Monaco needs a bare, explicitly-sized box and computes line positions from its container's client box, so padding there mis-places the cursor. Keeping `#editor` as the outer box means `setDisplayMode` needed no changes.
- **Ace adopted `#editor`'s text as its initial document; Monaco replaces the container's content.** The backend reads the placeholder out before `create()`, or `# Your amazing code goes here!` renders behind the editor forever.
- `setValue` uses `model.setValue`, not `editor.setValue` — the latter pushes an undo stop, so Ctrl+Z after loading a project would restore the previous file. EOL is forced to LF so `getValue()` never returns `\r\n`.
- The step line is a whole-line decoration with class `step-line` (`css/styles.css`), replacing ~55 lines of runtime CSS-rule injection into the ace-monokai stylesheet — which only ever matched the dark theme, so stepping in light mode showed no highlight at all.
- `Editor.dispose()` exists for the harness: an undisposed Monaco holds a web worker and a blob URL, and hundreds of them will not do.

The Babylon path is unusual: Python code builds plain dicts describing objects, which `addObject` stashes in `_babylonObjects`; `babylonCreateScene` then instantiates them in **two passes** (create, then resolve cross-references such as materials and animations) because the scene does not exist while the Python runs. Deferred calls go through `_functionQueue`.

### Pyodide (`?runtime=pyodide`)

Real CPython 3.14 on WebAssembly, vendored at [js/pyodide/](js/pyodide/) — 5 files, 13 MB uncompressed (~6 MB gzipped on the wire). [js/runtime-pyodide.js](js/runtime-pyodide.js) is the backend; [js/py/prelude.py](js/py/prelude.py) is the Python half, kept as a real `.py` file so its own errors point somewhere.

**How blocking works.** CPython has a real C stack and cannot yield, but 173 of 345 curriculum files call `input()`. The answer is JSPI: `pyodide.ffi.run_sync` suspends the WebAssembly stack while a JS promise settles, so a *synchronous* Python function blocks without freezing the page. This requires entering the program through `PyProxy.callPromising` — not `runPythonAsync`. Every blocking builtin goes through one chokepoint, `block()` in the prelude, so stop-checking lives in one place.

Facts measured in [tests/spike-pyodide.html](tests/spike-pyodide.html) rather than assumed — run it after any Pyodide upgrade:

- **`can_run_sync()` is NOT the capability probe.** It answers "can I block *right now*", so it is `false` at top level and `true` inside a promising call. Probe with `"Suspending" in WebAssembly` instead.
- **`frame.f_lineno` jumps behave on 3.14 exactly as on 3.10**: into `if`/`elif`/`else` bodies (including nested) and backwards out of them all work; `for` and `with` are refused with a clear `ValueError`. This is what `goto`/`label` will be built on, and it holds.
- **stdout block-buffers at 8 KB** unless you replace it with an unbuffered `TextIOWrapper`. Without that, `csinsc.slowPrint`'s character-at-a-time typing arrives in bursts.
- `sys.monitoring` JUMP fires on loop back-edges — the `killableWhile` analogue for the Stop button.

**Deliberate behaviour choices in the prelude:**
- `input()` writes its prompt to stdout, because both CPython and Skulpt do. Forgetting this silently dropped the prompt from every interactive file.
- Errors are reported *in Python*, with the prelude's own frames stripped, so a student sees a traceback starting at `<stdin>.py`. They are not re-raised into JS, or they would print twice.
- `SyntaxWarning` is suppressed while compiling user code. CPython 3.12+ warns about invalid escape sequences such as the `\ ` and `\_` inside the curriculum's ASCII art — **24 files contain them** — and a red warning above a student's drawing about some future Python is noise. Those files should become raw strings eventually.

**Known accepted divergence:** Skulpt rounded float output; CPython prints the true value. `12 * 0.3048` is `3.6576000000000004`, not `3.6576`. CPython is right and JavaScript agrees; the lesson text is what needs updating.

**The Python modules** live in [js/py/](js/py/) and are written into Pyodide's filesystem at `/pyeditor` during boot, then imported normally — so an error inside `csinsc.py` points at `csinsc.py`. The manifest in `runtime-pyodide.js` is maintained by hand; **bump `PY_LIB_VERSION` whenever you edit a `.py` file there**, or the browser will serve the cached copy.

Those fetches all have to succeed or the runtime does not start, so `fetchText` retries twice with a short backoff and names the file it gave up on. Without that, a closed keep-alive socket surfaces as a bare `TypeError: Failed to fetch` from inside `boot()` with nothing to act on — seen intermittently against a local server that was answering every request correctly.

[js/py/csinsc.py](js/py/csinsc.py) is the fork's `csinsc.py` with exactly two kinds of change: each `csinscTools.foo(); while csinscTools.fooWaiting: continue` pair collapses to one `block(_host.foo(...))`, and web-service calls return `{status, response}` from a single `fetch` instead of setting flags Python polled. The colour tables, `slowPrint`'s escape handling, the input-helper family and every error message are carried across verbatim, because the curriculum depends on the exact text. `goodies.py` is `from csinsc import *`, as in the fork.

**Values change shape crossing the bridge, in both directions, and `console.js` was written for Skulpt's shapes.** Both of these shipped, both broke silently or with an unhelpful traceback, and neither was visible to any gate because every file using them carries the blocking `network` or `widgets` tag:

- **JavaScript → Python: a plain object or array arrives as a `JsProxy`**, which allows attribute access but not `["key"]`, slicing or negative indexing. `_service()` did `result["status"]`, so *every* web service — weather, ChatGPT, OpenAI images, translation, cloud variables — raised `TypeError: 'pyodide.ffi.JsProxy' object is not subscriptable`. `csinsc._py()` now calls `to_py()` on host replies before they are used.
- **Python → JavaScript: `None` arrives as `undefined`, not `null`.** Skulpt's `remapToJs` produced `null`, and `console.js` tests every optional width/height/x/y with `!== null`, which `undefined` passes. `printImage(url)` set `img.width = undefined` — a zero-size image, no error — and every `printButton` without coordinates became `position: absolute`. `runtime-pyodide.js`'s `nul()` normalises at the bridge. (The mirror image, `null` from JavaScript arriving in Python as `JsNull`, is described under pyangelo below.)

`tests/pyodide-only/web_widgets.py` intercepts `fetch` and inspects the DOM to pin both, without touching the live service. When porting anything else across the bridge, assume neither conversion happens for you.

**console.js's classroom functions are rebound for Pyodide in [js/py/consolehost.py](js/py/consolehost.py).** console.js's own versions unwrap Skulpt values (`Sk.ffi.remapToJs`, `pyCheckType`, Suspensions) and Pyodide binds the bare functions, so — measured before the port — `getURLParam` raised, `showIFrame`/`showGoogleVideo` returned a stray Suspension object without waiting or applying their 600×480 defaults, `getWebCamImage` returned a JavaScript object, and `inputnumber` and the Philips Hue functions could not work. No curriculum file calls any of them. They are reinstalled after the Host names, with the browser work in `runtime-pyodide.js` reusing console.js's DOM helpers and Hue globals, so `stopAllHue()` still stops a timeline. **Fork quirk kept:** a missing URL parameter returns the *string* `"None"`. **Fork bugs fixed:** `setLight(1, False)` did nothing, and a brightness over 254 raised.

**Webcam and Teachable Machine** resolve, in the host, the same `{status, response}` pair the fork kept in module flags, so `csinsc.py` raises the fork's messages word for word — including `loadPoseModel`'s "Error attempting to load the audio model", a copy-paste in the fork. **Fork bugs fixed:** pose prediction without `showAll` raised IndexError on the skeleton entry; `loadPoseModel()`/`loadAudioModel()` with no URL waited for ever; `crossOrigin` was set after `src`, which taints cross-origin images. The camera, models and microphone can only be faked headlessly, so a real webcam and real Teachable Machine models are a manual check.

**`forever:`** — a real statement in the fork's grammar — is rewritten to `while True:` on the same line by `runtime-pyodide.js`, so line numbers do not move.

**`say()` carries two protections that are invisible without a microphone**, and the first version of this bridge had neither — a regression that reached the 11+ files using speech. Both live in `runtime-pyodide.js`, where the fork keeps them:

- **A profanity filter.** This is a product for primary schools and the computer says whatever a child types, so matching text is replaced with a jokey refusal. The 77-word list stays base64-encoded, as in the fork — the point is that the source file is not itself full of slurs.
- **A 60-language table.** `say(text, language="french")` must actually speak French, and an unknown language must raise rather than silently speaking English.

`say()` is also **fire-and-forget**: the fork's `csinsc.py` has a `while csinscTools.isSpeaking(): continue` loop that is commented out, so the Python call returns immediately and the browser queues the utterance. An earlier version of this port waited for the utterance to end, which changed when the *next* line of a lesson ran. `tests/pyodide-only/speech_safety.py` intercepts `speechSynthesis.speak` so all of this is checkable with nothing audible.

**`goto` / `label`** work on CPython — see [js/py/gotolabel.py](js/py/gotolabel.py). `js/pygmi.js` rewrites both spellings (`goto .foo` and `goto foo`) into `goto.foo`, which is already legal Python: an attribute access on a name. An `ast` pre-scan builds `{goto_line: label_line}` and raises Skulpt's own SyntaxErrors for a duplicate or undefined label. A `sys.settrace` hook then assigns `frame.f_lineno` to jump — **at the goto's own line, before it executes**, not on the next line event, because `demos/snake.py` ends with `goto .here` as its final line and there would be no next event.

The yield that makes goto-driven frame loops animate lives in `label.__getattr__` — ordinary Python, not the trace callback. It asks the prelude's `maybe_yield()`, the same pacing the loop hook uses (see "Loop yielding" below), so a text adventure hitting thirty labels between keystrokes does not burn thirty frames. Tracing is installed only for programs that actually contain a goto.

A jump that finds an unbound local makes CPython print `RuntimeWarning: assigning None to 1 unbound local` — and at module level a comprehension's hidden loop variable is one, so **every goto program containing a list comprehension printed that in red on its first jump**. The jump itself is correct. `gotolabel.py` filters exactly that message from exactly that module; `tests/pyodide-only/goto_pacing.py` pins it.

Which spelling a program gets is `Runtime.normaliseGotoLabels(code)`: Skulpt's grammar wants the dot removed, CPython wants it added.

**Gate result — the whole automatable corpus under Pyodide: 175 pass · 42 unchecked · 7 smoke · 2 fail.** Both failures are the accepted divergences below, and the tally is now stable. It was drifting between 1 and 2 failures until Pyodide runs stopped using `--virtual-time-budget` (see Testing): real time removed the flakiness *and* six files' worth of truncation, so `intro.v2/answers/0604a` now reports its `SystemExit` divergence honestly instead of hiding behind `unchecked`.

**Read the 42 `unchecked` as the real coverage limit of this gate.** They are interactive programs — menu loops, text adventures — whose golden raised, and which the harness cut short (60 inputs or 20s) before it could ask whether they still raise under CPython. They used to be counted as `smoke`, which reads as "ran fine"; splitting them out was the only way to stop a shrinking failure count looking like an improvement. `intro.v2/answers/0604a` sat exactly on that boundary and reported `smoke` in one pass and `fail` in the next with no code change between them — moving Pyodide to real time settled it. Only **7** files are genuine smokes (`random`/`time`-driven, text not comparable). Anything relying on error behaviour in those 42 files is unverified under Pyodide, and that matters for Phase 3.

**Second accepted divergence:** Skulpt reported `exit()`/`quit()` as a red `SystemExit` error. CPython exits normally, which is correct — a student typing "3 to quit" no longer sees an error. This is the one that intermittently hides behind a `smoke` verdict, above.

### Loop yielding — do not remove this

[js/py/yielding.py](js/py/yielding.py) is the single most load-bearing piece of the Pyodide runtime. Skulpt compiled every `while` into a suspension point (`killableWhile: true`); real CPython has nothing of the sort, so **a `while True:` game loop holds the main thread and the tab stops responding entirely.** `demos/endless_runner` locks the browser solid without it — measured, not theorised: CDP could not get a message through.

PEP 669's `JUMP` event is the exact equivalent and far cheaper than Skulpt's, which cost a macrotask per iteration. Forward jumps return `DISABLE` so they are never reported again; back-edges ask the prelude's `maybe_yield()` whether to give the browser a turn, and check the Stop flag. `set_local_events` scopes it to the program's own code objects, so the stdlib and `csinsc` run at full speed.

**When to yield is one rule — and what it deliberately is *not* was measured too.** The numbers are in `prelude.py`:

- **An 8 ms time slice, restarted when the frame wait *returns*.** It was once stamped *before* the wait. The wait lasts about a frame, so the budget had always run out by the time the program resumed, and nearly every back-edge yielded again. `demos/snake.py` ran 81 loops a second instead of thousands: it moved 267–301 ms apart instead of every 250, and missed a quarter of quick key taps. That was the report that "keyboard controls don't feel as responsive as Skulpt". Browser-level numbers were perfect throughout; only instrumenting the game found it.
- **No loop-rate limit.** A 1500/s cap for canvas programs was built — on the theory that Skulpt throttled every `while` iteration and games were tuned to that — and removed when measurement disproved the theory. Skulpt runs an empty canvas `while` loop at ~80,000/s and playerSelection's nine-drawing-call body at ~50,000/s. Where a Skulpt game loop *was* slow (pong's intro, ~1,000–3,000/s depending on the run), it was the cost of Skulpt executing that particular code: bisected, it is spread across the whole body, is not any one call, and is not the `from random import *` it shares with the other slow programs. No constant reproduces that. The cap made light loops 30–50× slower than Skulpt and halved `tictactoe_ml`'s training.

**Known, accepted consequence:** a canvas game that moves a fixed step per loop *and* was slow under Skulpt runs faster under Pyodide. `demos/pong.py` is the measured case — its ball moves 0.08 px per loop — and it needs micro:bits to play, so it belongs on the manual-check list. Timer-driven games (snake, jamiegame, powerup, pyracer) are unaffected by loop speed. `tests/pyodide-only/goto_pacing.py` pins the slice; `canvas_pacing.py` pins the absence of a cap.

It uses **`PROFILER_ID`, not `DEBUGGER_ID`** — `goto`/`label` installs a `sys.settrace` hook and legacy tracing occupies the debugger slot.

Calling `run_sync` from inside a monitoring callback is what makes this work, and it was the one genuinely uncertain assumption in the plan. It is verified in `tests/spike-pyodide.html` (S6).

### `from pyangelo import *`

[js/pyangelo-host.js](js/pyangelo-host.js) owns the canvas, the command queue and the animation-frame loop, ported from the fork's `src/lib/pyangelo.js`; [js/py/pyangelo.py](js/py/pyangelo.py) is a thin Python face over it. **Keep the retained-mode architecture**: drawing calls queue, `refresh()` flushes, a frame paints — and `clearScreen()` flushes for you, which is why programs that never call `refresh()` still animate.

**Its colours are builtins, not module attributes**, as in the fork (`Sk.builtins.INDIGO = 23`). Defined as module attributes, `from pyangelo import *` copied all nineteen into the student's own variables and the step debugger's watch table listed them on every pause; Skulpt lists none. `pyangelo.py` re-sets them in builtins on every import, which also repairs a fork bug: a builtin PyAngelo program (`setCanvasSize`) earlier in the page leaves `RED`, `BLUE` and friends as integers, and a pyangelo program run next drew in the wrong colours until a reload.

Three bugs worth knowing about, all found by pixel comparison rather than inspection:

- **Numeric colours were painted white.** The Python wrappers dropped `g, b, a`, and the host's colour lookup returned white for any number it did not know — so `clearScreen(0, 0, 0, 1)` cleared to *white* (pytris, dance), `fillRect(…, 0, 255, 0, 1)` was a white box (playerSelection), and tictactoe's orange highlight was white. It hid because the one pixel-compared file using it also animated the colour, so "differs" read as timing; freezing the animation exposed it. `colour()` in `pyangelo-host.js` is now the fork's `getColour` **quirk for quirk**, each one commented: a table name wins even over a number that happens to be a key (`clearScreen(25, 0, 0, 1)` is DARK_RED); `drawText`/`printAt` pass only the first colour argument, so a number there builds an invalid `rgba()` and the canvas keeps the *previous* fill colour (pong's "PONG" title relies on it); an omitted colour is **grey**, because the fork reads `mod.WHITE`, which it never defines, and VIOLET and GREY both landed on the resulting `"undefined"` key. `tests/pyangelo-api/colour_args.py` pins every form against Skulpt via `compare-canvas.sh pyangelo-api`.

- The fork sets `ctx.font = "30px Consolas"` at import. It matters because `drawText` assigns `ctx.font` unconditionally, so a malformed size — `"10 px consolas"`, with a space, is in the curriculum — leaves the *previous* font in place. Drop the initial font and that text silently renders at the canvas default of 10px sans-serif.
- Returning JS `null` for "no mouse position" gives Python a `JsNull`, which is **not** `None`. Every mouse-driven program died with `'JsNull' object is not subscriptable`. Return `undefined` instead.

### `from turtle import *`

[js/py/turtle.py](js/py/turtle.py) over [js/turtle-host.js](js/turtle-host.js). Written fresh — Skulpt's `turtle.js` is 2400 lines of promise-chained frame machinery welded to `Sk.misceval`, and none of it survives a runtime that can simply block — but the *arithmetic* is transcribed, because the pictures are the specification:

- **A move is split into `round(max(1, pixels / speed))` steps**, a turn into `round(max(1, degrees / speed))`, with `speed = turtle.speed() * 2`, default 3 → 6. One animation frame per step. That is what sets the pace a student watches, so it is not an implementation detail: `inquisitive/turtle/y5l3d1` is ~5000 frames, about 90 seconds, under both interpreters.
- **The pen path stays open across the steps of one move** (`beginPath` only on the first), so round joins line up instead of stacking caps.
- **A fill records the position *before* each move**, so the polygon lags one vertex. It closes correctly, and it is what the fork draws.
- `write()`'s font defaults to **`None`, not CPython's `("Arial", 8, "normal")`** — the fork leaves `ctx.font` alone when no font is given, so unstyled text comes out in the canvas default of 10px sans-serif.

Three deliberate departures, all commented at their definitions: `colormode()` actually takes effect (the fork stored it on the screen and read it off each turtle, so `colormode(255)` never did anything); all turtles share one drawing layer rather than one each; and the undo buffer, `register_shape` and `bgpic` raise instead of pretending.

`from turtle import *` **shadows the console's `clear()`** with the turtle's. Skulpt did the same — every proto method is exported at module level there too — so programs that mix the two are already written around it.

**`turtle.goto(x, y)` is a `SyntaxError` under Skulpt and works under Pyodide.** The fork added `goto <label>` as a real grammar statement, which makes `goto` a reserved word: `goto(100, 100)` will not parse, while `setpos()` and `setposition()` — the same function under different names — are fine. Nothing in the curriculum calls it, for that reason. The mirror image also holds: under Pyodide `from turtle import *` binds `goto` to turtle's function and shadows the `_Goto` object `gotolabel.py` installs, so a program cannot use `goto .label` *and* import turtle. It is mutually exclusive under both runtimes, just in opposite directions, and no curriculum file does both.

Frame pacing goes through the prelude's `block(_host.frameYield())`, the same yield `goto` and the loop hook use, so Stop reaches a turtle program normally. Key and timer callbacks arrive on a plain DOM event where there is no suspendable stack, so `_can_block()` (`pyodide.ffi.can_run_sync`) degrades those to instant, unyielded motion rather than raising.

### `from microbit import Microbit`

[js/py/microbit.py](js/py/microbit.py) over [js/microbit-host.js](js/microbit-host.js). The fork's `src/lib/microBit.js` is 828 lines but **contains no `Sk.` before line 449** — the BLE UUIDs, the `uBit` state class and the notification decoding are plain JavaScript and port across essentially verbatim. Only the Skulpt class wrapper is replaced.

**Every busy-wait had to become a yield, and this is the module where it matters most.** The fork is full of `while self.uBit.isGATTWriting(): continue`, which only terminates because Skulpt injected a suspension into every `while`. Under CPython that spin holds the main thread, so the GATT write it is waiting for can never complete and the program deadlocks against itself. All of them now go through `_tick()` → one animation frame. The same applies to `waitForButtonA`, `waitForButtonClicked` and the connection loop.

Two deliberate departures: `getCompass()` returns **`"N"`** for bearings either side of zero (the fork returns `"NW"`, which is simply wrong), and `startRecordData()`/`stopRecordData()` raise a "add `&runtime=skulpt`" message — they drove a `.modal` element that does not exist in this editor's HTML, so they would have thrown on their first line anyway, and no curriculum file calls them.

**43 curriculum files import this, and none of them can be checked without a board.** What is verified: `tests/pyodide-only/microbit_logic.py` covers the compass arithmetic across every boundary and the failed-pairing path, and the LED bit-packing was checked exhaustively against the fork's algorithm for all 32 row patterns. Everything else — pairing, buttons, the screen, the sensors — needs a human with a flashed micro:bit.

### The small modules

| Module | Notes |
| --- | --- |
| [js/py/speech.py](js/py/speech.py) | `say`/`listen` over the host's speech synthesis and recognition. **Deliberately not aliases of the `csinsc` ones** — `csinsc.say()` sends a silent warm-up utterance and sleeps a second first, and takes a `language`; `speech.say()` does neither, matching the fork. All 11 curriculum files do `from speech import *`, so `__all__` keeps that to the two taught names instead of leaking `block` |
| [js/py/babylon.py](js/py/babylon.py) | The 3D scene description. The fork's `babylonjsWrapper.js` was five one-line forwards to `editor.js` globals, so it has no counterpart — the calls go straight to `js.*` |
| [js/py/perlin.py](js/py/perlin.py) | p5.js's Perlin noise, ported to **Python** rather than kept as JS: it is pure arithmetic with no browser in it. Verified against the fork's JavaScript to 12 decimal places |
| [js/py/sendsms.py](js/py/sendsms.py) | Raises. It calls `csinsc.sendsms`, which is **commented out in the fork**, so it has raised `AttributeError` for as long as it has existed. Now it says so |

**`babylon.py` is the one to understand before changing.** The Python code never touches Babylon: it builds objects describing what is wanted, and `startBabylon()` ships the lot in one go, because the scene does not exist while the student's code runs. That is why references become *names* on the Python side — `sphere.material = someMaterial` crosses over as `"BObj2"` — and why `babylonCreateScene()` in `editor.js` needs two passes. `Sphere.bObjType` stays `"Mesh"`: `editor.js` dispatches on `bObjType` first and `meshType` second, so it is load-bearing, not an oversight.

`editor.js`'s `addObject()` now accepts either interpreter's shape — a Skulpt instance (attributes in `$d`, needing `remapToJs`) or the plain object Pyodide converts `__dict__` into. That removes one of the three remaining `Sk.` references from `editor.js`.

Two things that would silently produce an empty scene: `to_js()` makes a **`Map`** unless given `dict_converter=js.Object.fromEntries`, and `bObj.bObjType` on a Map is `undefined`; and the fork's `while True: pass` at the end of `startBabylon()` must stay a wait — returning would let the editor treat the program as finished and tear the scene down — but it has to be a *yielding* wait or Babylon's render loop never runs.

**Perlin needed two JavaScript semantics preserved**: `<<` on a JS number is a 32-bit *signed* shift and Python's ints do not wrap, so `_i32()` puts that back; and the seeded LCG is reproduced rather than swapped for `random.seed()`, so a sketch drawn from noise looks identical under both runtimes.

**What is checked, and what is not.** `speech` needs a microphone and `babylon` needs WebGL, so neither can be compared against Skulpt in a headless browser. `tests/pyodide-only/` covers what does not need either: `perlin_values.py` matches the fork's JavaScript to 12 decimal places; `babylon_scene.py` builds `demos/vr.py`'s scene, intercepts the handover and checks the exact description that crosses over — all 17 attributes `babylonCreateScene()` reads are present, with references resolved to names; `speech_sendsms.py` pins the module surface. **Nobody has yet seen the 3D scene render or heard the speech synthesiser** — those are manual checks.

### Builtin PyAngelo (no import — `setCanvasSize()` and friends)

[js/py/pyangelo_builtins.py](js/py/pyangelo_builtins.py) over [js/pyangelo-builtin-host.js](js/pyangelo-builtin-host.js), with [js/py/sprite.py](js/py/sprite.py) and [js/py/vector.py](js/py/vector.py) on top. The Processing-flavoured API from the fork's `src/builtin_pyangelo.js` — 1957 lines there, most of it Skulpt argument checking; the drawing itself is thin canvas work. **No curriculum file uses any of it.** Its load-bearing members, `sleep` and `clear`, are already provided by the prelude and `console.js`, and deliberately not overridden here.

**These are builtins, not a module, and they arrive in two halves at two different times — exactly as in the fork.**

- **Functions and classes are installed at boot**, by `install_functions()`, which `runtime-pyodide.js` calls just before binding the Host names so that `console.js`'s version of any shared name still wins. The fork registers them with top-level `Sk.builtins["loadSound"] = …`, so they exist in every program. They used to wait for `setCanvasSize()` here, and **`demos/pong.py` died with `NameError: name 'loadSound' is not defined`**: it calls `loadSound()` and `stopAllSounds()` beside `from pyangelo import *` and never opens a builtin canvas. No gate could see it — pong imports `microbit`, so the corpus excludes it, and the canvas comparison does not include it. `Point` was missing from the port altogether. `tests/pyodide-only/builtins_at_boot.py` pins both.
- **Constants are installed when a program opens a canvas.** The API defines `RED`, `BLUE`, `YELLOW` and friends as *integers*, while `console.js` defines the same names as the console's escape strings. The fork only installs its constants inside `preparePage()` — i.e. when a program calls `setCanvasSize()` — so the two colour systems never coexist. The port does the same: `console.js`'s `setCanvasSize` calls `Runtime.setupBuiltinPyangelo()`, which runs `pyangelo_builtins.install()`. Measured identical under both runtimes: after `setCanvasSize(400, 300)`, `RED` is `2`. Installing the constants at boot would silently break every program that prints in colour.

The one exception: **`CARTESIAN` and `JAVASCRIPT` are hoisted into the prelude.** Otherwise `setCanvasSize(600, 400, CARTESIAN)` cannot name the constant its own documentation tells you to use, because the call is what defines it — the fork has that hole, and students work around it by taking the default. Nothing else defines those two names, so hoisting them is safe.

Two Pyodide traps this module hit, both silent because the host catches the error:

- **A Python callable handed to JavaScript as an argument is destroyed when that call returns.** `mouseX`/`mouseY` must read as plain variables, so the host calls a Python callback from each mouse event — and the plain callable was already dead by the first event. It must be `create_proxy(fn)`, and the proxy then has to be `destroy()`ed explicitly or every run leaks one; the hosts do that when they unbind. **Turtle's `onkey`/`onclick`/`ontimer` had the identical bug**, unnoticed because no curriculum file uses them. Measured: calling a stored plain callable raises `JsException`; a `create_proxy` one works.
- **`null` from JavaScript is `JsNull` in Python, not `None`** — the same bug the pyangelo module had. The host passed `null` for "not this field", so every mousemove reset `mouseIsPressed` to False and a press failed on `int(JsNull)`. Pass `undefined`.

`measureText()` returns the full metrics record as a dict, not just a width, because `sprite.py`'s `TextSprite` sizes itself from `actualBoundingBoxLeft`/`Right`/`Ascent`/`Descent`. `vector.py` fixes two fork bugs that no working program could depend on: `__radd__` referenced an undefined name (so `sum()` of vectors raised), and `__div__` is the Python 2 spelling that `/` never reaches. `dist()` and `mapToRange()` return floats (`5.0`) where Skulpt returned ints — CPython true division, the same class as the float-repr divergence.

**Checked by `tests/pyodide-only/builtin_pyangelo.py`**, which drives every shape, the matrix stack, all modes, images' and sounds' error paths, `vector` and `sprite`, and dispatches *real* mouse and key events to prove the callback path works. `turtle_events.py` does the same for turtle's handlers. **Nobody has looked at what it draws** — that is a manual check.

## The Skulpt fork (`../skulpt`)

`https://github.com/csinschools/skulpt.git`, working branch **`pyangelo`** (not `main`). It has its own `CLAUDE.md` with build/test details; the short version is `npm install` once, then `npm run devbuild` (fast, unminified) or `npm run build` (Closure, produces `dist/skulpt.min.js`), then copy `dist/*` here. Everything below is what this editor actually depends on. `git diff origin/main...pyangelo -- src/` is the authoritative list of what the fork adds.

### Language extensions (compiler-level, not preprocessor)
The fork changes the grammar (`src/pgen/parser/Grammar.txt`, `src/pgen/ast/Python.asdl`) and `src/compile.js`:

- **`forever:`** — a real compound statement (`Forever` AST node, `Compiler.prototype.cforever`), distinct from the training-wheels `forever` → `while True` regex in `pygmi.js`. Both spellings exist; the regex one wins only when `?wheels=1`.
- **`label <name>` / `goto <name>`** — real flow statements. The compiler emits a `PYANGELOGOTO` marker, then `outputAllUnits` patches it into a `$blk=<n>; continue;` jump against `labelBlocks`. Duplicate labels and undefined targets raise `SyntaxError` at compile time. (`src/import.js` still contains an older string-rewriting `parseGoto` — it is dead code, never called. Don't extend it.)
- `label` also emits a `Sk.delay` suspension when `Sk.debugging` is on, so labels double as step-debugger yield points.
- `Sk.configure` gains **`goto`** (set but never read — inert) and **`killableForever`**. `cwhile` was also reordered so the suspension/breakpoint check happens *before* the loop test is evaluated.

**Gotcha:** `editor.js` passes `killableWhile: true` but *not* `killableForever`. A `forever:` loop is therefore only interruptible via the `debugging: true` path — and `checkForBuiltinPyangelo()` turns `debugging` off. Builtin-PyAngelo code containing `forever:` cannot be stopped by the Stop button; add `killableForever: true` to the `Sk.configure` call if that comes up.

### Two different PyAngelo APIs
This trips people up constantly — they are separate implementations with separate canvases.

| | `from pyangelo import *` | builtin PyAngelo |
| --- | --- | --- |
| Source | `src/lib/pyangelo.js` (a stdlib module) | `src/builtin_pyangelo.js` (registered as globals, last require in `src/main.js`) |
| Canvas | `#pyangelo`, static in `editor.html` | `#canvas`, created at runtime inside a JSFrame floating window by `createPyangeloFrame()` in `console.js` |
| Detected by | `checkForPyangelo()` (regex for the import) | `checkForBuiltinPyangelo()` (top-level `setCanvasSize`) |
| Style | CS in Schools flavour; own colour constants (`INDIGO`, `DARK_GREY`, …), own `requestAnimationFrame` render loop stored in `Sk.builtins.animationFrameRequest` | PyAngelo.com-compatible, Processing-like: `background`, `fill`/`noFill`, `stroke`, `circle`, `rect`, `text`, `drawImage`, `loadSound`, `isKeyPressed`, `sleep`, `Point`/`Colour`/`Image`, plus `rectMode`/`circleMode`/`angleMode` and a `yAxisMode` (`CARTESIAN` vs `JAVASCRIPT`) |
| State | module-local closures | the `Sk.PyAngelo.*` namespace |

The builtin flavour has a lifecycle this repo drives: `console.js` **shadows** `setCanvasSize` to create the JSFrame first and then delegates to the fork's `Sk.builtin._setCanvasSize`; `createPyangeloFrame` calls `Sk.PyAngelo.preparePage()` (which binds document-level key handlers, canvas mouse handlers, and `Sk.builtins.mouseX/mouseY/mouseIsPressed`); `stopSkulpt()` calls `Sk.PyAngelo.stopPyangelo()` to unbind them. `preparePage` also grabs `document.getElementById("console")`, so the console element must exist before any `setCanvasSize` call. `editor.js`'s `resetCanvas()` cancels `Sk.builtins.animationFrameRequest`, which belongs to the *module* flavour — a naming overlap worth remembering.

### The classroom modules
- **`csinsc.py`** (~950 lines) and its JS backend **`csinscTools.js`** (~1200 lines) — the CS in Schools API: speech synthesis/recognition, images/YouTube/buttons/textboxes printed into the console, sound (incl. freesound.org), Tone.js wrappers, `slowPrint`, the `intInput`/`floatInput`/`numInput`/`strInput` family and its many aliases, OpenAI completions and image generation, translation, weather, `logToServer`, Teachable Machine pose/audio/image prediction, and cloud variables.
- **`goodies.py`** is literally `from csinsc import *` — an alias. `editor.js`'s `goodiesCompletions()` matches the import with a regex to offer `printImage`/`printButton`/`waitForButtonClick` (still disabled; the registration line is commented out). It used to test `'goodies' in Sk.parse(...).cst.used_names`, which matched any use of the name and coupled the editor to the interpreter.
- **`setSchool(<id>)` is a prerequisite** for cloud variables and the OpenAI/weather/translate APIs — they raise if `schoolID` is empty, and the server authenticates on it (403 = bad ID).
- **`microbit.py`** (`Microbit` class) over **`microBit.js`** — **Web Bluetooth** (`navigator.bluetooth.requestDevice`), so it needs a secure context and Chromium. Boards must be flashed with the CS in Schools hex first. Exposes buttons, LED matrix, temperature/light/compass/accelerometer, pin writes.
- **`babylon.py` + `babylonjsWrapper.js`** — the Python half of the 3D bridge. Python builds `BabylonObject` subclasses that self-register in a dict; `babylonjsWrapper` hands them to `editor.js`'s `addObject`/`beginAnimation`, which is why `js/editor.js` does the two-pass scene construction described above.
- Also added: `sprite.py`, `vector.py`, `perlin.js`, `speech.py`, `sendsms.py`, and Howler.js bundled into the runtime.

### How async JS reaches Python
The fork's pattern (used throughout `csinsc.py`) is: call a `csinscTools` function that kicks off an XHR and sets a module-level `...Waiting` flag, then **busy-wait in Python** — `while csinscTools.cloudWaiting: continue`. This only terminates because the compiler injects a suspension point into every `while` loop when `killableWhile` or `debugging` is set. If you ever drop `killableWhile: true` from `editor.js`'s `Sk.configure`, every one of these APIs deadlocks the browser. Results come back on the module object (`cloudResponse`, `cloudStatus`, `openAIResponse`, `openAIStatus`), and `csinscTools.js` reads `Sk.builtins.webServiceURL.v` **at module load**, so `?webservice=` must be applied before the first import. `editor.js` keeps the URL in a plain `webServiceURL` global and `boot()` pushes it in via `Runtime.setWebServiceURL()` before any program runs.

### Other runtime hooks this editor uses
- **`Sk.onAfterCompile(name, code)`** (added to `src/import.js`) — lets `?compiled=1` swap the freshly compiled JS for a pre-compiled `*Compiled.js` payload. Exceptions inside the hook are swallowed.
- **`Sk.debug` / `Sk.delay` suspension types** — what `editor.js` binds its steppers to.
- `src/file.js` adds `readlineasfloat`; `src/builtin.js`/`builtindict.js` carry the PyAngelo builtins registration.

When adding a Python-visible function, decide which side it belongs on: UI-coupled things that need the editor's DOM (`#console`, JSFrame windows, the watch table) go in this repo's `console.js`; anything a student should be able to `import`, or that needs compiler support, goes in the fork and requires a rebuild + re-copy.

## Testing

Full details in [tests/README.md](tests/README.md). The short version:

```sh
python -m http.server 8731            # from the repo root, first
tests/run-conformance.sh compare      # ~75s, 226 files, expect "0 failures"
```

The baseline is `tests/goldens.json`, recorded from a clean worktree at `b529c5b` — Ace + Skulpt, before any migration work. **Every change since has been verified against it, and the expected tally has not moved: 205 pass · 3 timeout · 18 smoke · 0 fail.** If you see anything else, you changed behaviour.

Three suites, all static pages driven by headless Chrome:

| Page | Covers |
| --- | --- |
| `tests/conform-cli.html` | The 226 automatable curriculum files. Driven by `run-conformance.sh` |
| `tests/urlmodes.html` | `?code=`, localStorage, headless and button-visibility — the load paths the corpus never reaches, because everything it runs arrives via `?project=` |
| `tests/hostnames.html` | Every classroom builtin as actually bound. 53 of the 56 appear in no curriculum file, so nothing else vouches for them |
| `tests/pygmi.html` | The source-rewriting passes in `pygmi.js`, unit-tested. The only fully interpreter-independent part of the pipeline, and the one the corpus cannot reach |
| `tests/check-combos.sh` | All four editor × runtime combinations. The full run only ever exercises one of them, and Phase 4 being on hold makes the other three supported |
| `tests/check-pyodide.sh` | Modules that cannot be compared against Skulpt at all (hardware, and behaviour deliberately corrected), plus runtime behaviour a text diff can pin — loop pacing, builtins present at boot — each diffed against a checked-in `.expected` |
| `tests/check-stepping.sh` | The step debugger and breakpoints through the real Step/Run/Next/Continue buttons, compared pause by pause — line, watch table, output — under Skulpt and Pyodide, and once under Ace. The corpus never presses a button, so nothing else sees the debugger |

### Running the browser — hard-won details

These cost hours to diagnose twice, because **two unrelated problems produce the identical symptom**: an unresponsive page and an empty `<pre id="status">`.

- **Chunk the corpus. It is not optional.** Each file gets its own iframe carrying a full editor (Skulpt + Monaco + babylon + tf.js) and one browser process reliably dies past ~50 of them. Measured: **40 files finish in 14s; 60 in a single process hang indefinitely with no error.** `run-conformance.sh` gives each chunk a fresh browser; default chunk **20** is reliable, 40 usually works. This is a harness constraint only — the app creates one editor per page.
- **Check the file count, not just the failure count.** A dropped chunk lowers `TOTAL` rather than reporting a failure, so "0 failures" can silently mean "of the 206 we ran". `run-conformance.sh` retries each chunk once and asserts the total, exiting non-zero if it is short — but if you drive `conform-cli.html` by hand, verify the count yourself.
- **Always pass a unique `--user-data-dir`.** A stale Chrome profile left over from an interrupted run hangs the next one in exactly the same way. Use `--user-data-dir="$(mktemp -d)"` or append `$(date +%s)`.
- **Use `--virtual-time-budget`** (e.g. `3600000`) so `sleep()` and the harness's 20s run timeout cost no wall-clock time — **for Skulpt only.** A Pyodide run must use real time (`run-conformance.sh` switches to `cdp-run.js` automatically when `EXTRA` names it). Virtual time only advances while the page is idle, and every Pyodide yield goes through `requestAnimationFrame`, so a program suspended on rAF stalls virtual time and never gets its frame. Measured: the same chunk hung 322s under virtual time and finished in 30/30/31s over CDP. Skulpt is *mostly* immune because `killableWhile` yields through macrotasks — but a Skulpt chunk (files 180–199) has been seen hanging at zero CPU for the full 300s and then passing on its retry in 7s, so keep the per-chunk retry. Likewise, a canvas comparison that reports `-` for one runtime is usually that runtime's probe timing out under load: rerun the file alone before believing it.
- **Never `taskkill /F /IM chrome.exe`** to clean up — that kills the developer's own browser too. Kill by PID, or let `timeout` handle it. Ours are the processes whose command line carries `--headless` and a temp `--user-data-dir`; filter on that before killing anything.
- **Every test run, of any length, is reported to the user every minute while it runs** — current step, elapsed time, latest results — whether or not anything changed. This is a standing instruction from the user, not a courtesy for long runs: arm a watcher that emits a status line every 60s unconditionally and relay each one as it arrives.
- **Anything that can run past ~2 minutes must print a line per item, and something must check on it automatically** — intending to look periodically does not work. **The watcher's own thresholds must honour the rule:** check every 60s and probe for life after 2 minutes without a new line. A watcher that checked every 90s and only probed after three quiet beats looked compliant and actually waited 4½ minutes. A slow run and a hung one are indistinguishable here; `inquisitive/turtle/y5l3d1` legitimately takes 90s per runtime. Three traps, all hit in one session, and each one makes the monitoring *look* set up while telling you nothing:
  - **Piping through `tail`/`head` buffers the whole stream**, so the log stays empty until the run ends and any watcher pointed at it can never fire.
  - **Orphaned headless browsers from an earlier killed run** silently throttle everything after them — twelve of them turned a 2-minute pass into half an hour, and chunks dropped back to 5s the moment they were killed. Sweep before starting.
  - **Measuring CPU by filtering on `--headless` measures the browser process**, which is idle by design while the renderer children work. It reported `+0s` for a healthy run; the "stalled" chunk finished in 21s when re-run alone. Sum the whole process tree, and trust log growth over any process metric. The same filter misses the renderers when *killing*: use `taskkill /PID <root> /T /F`.
  - **`wmic` run from Git Bash counts nothing.** It returned 0 against PowerShell's 20 for the same query, so a watcher built on it printed `procs=0` for eighteen minutes over a hung probe. Query through `powershell.exe`, and test a liveness probe on a known-live process before relying on it.
  - **A page that freezes its main thread hung `cdp-run.js` indefinitely** — its deadline was only checked between CDP calls, and a frozen page never answers one. It now has per-call timeouts and a hard watchdog. Trigger: `range(100000000)` under Skulpt, which builds the entire list first.

  Full recipe in [tests/README.md](tests/README.md#long-runs-the-two-minute-rule).
- **A machine that sleeps mid-run kills it, and the per-chunk `timeout` does not catch that** — it is wall-clock and does not fire sensibly across a suspend. Seen here: a browser alive for 4h15m holding 9s of CPU with the log frozen on one chunk. The tell is the *age* of the oldest process against how long the run should have taken. Kill the browsers and the driver and start over; a partial log is worthless because you cannot tell which chunks predate the suspend.
- **Don't run anything else against the browser while a suite is running**, and **never edit a script or page that a run is currently using** — bash reads scripts by byte offset, and the probe page is re-fetched per file. Measured: `demos/turtle_demo` passed twice standalone and then timed out inside the suite purely from CPU contention with two extra probe browsers.
- `with=editor%3Dace` on `conform-cli.html` runs the whole corpus against the Ace fallback; `with=runtime%3Dskulpt` will do the same for the interpreter in Phase 2.

### What the suites do not cover

- **Anything visual.** They capture console text and DOM state. They cannot tell you the step-line highlight is visible, the editor sits inside its border, or the panes size correctly. Check those by hand.
- **`?id=`** (codestore snapshots) — needs the live web service.
- **Clicking the gutter.** `tests/check-stepping.sh` sets breakpoints through the `Editor` facade and presses Next/Continue in the DOM; nothing clicks the glyph margin, looks at the red dot, or checks that Ace moves a breakpoint when lines are inserted above it.
- **A real webcam, real Teachable Machine models, a real Philips Hue bridge.** `tests/pyodide-only/teachable_machine.py` and `host_functions.py` fake the camera, the tf.js models, the microphone and the bridge, so they prove arguments, return shapes and messages only.
- **35 `nondeterministic` files** are never text-compared (shuffled emoji, variable-length dice games); they get `smoke`, which asserts only that they still run and still do or don't raise.
- **Input coverage is shallow**: a fixed cycling answer list capped at 60 reads, so menu-driven files explore one branch.
- **119 files are excluded entirely** by the blocking tags `network`, `hardware`, `canvas`, `speech`, `widgets`.
- **The corpus never runs `?wheels=1`.** All 6 `wheels`-tagged files are turtle files, so all 6 are excluded by the `canvas` tag and the `pygmify` dialect is exercised by 0 of the 226. A ReferenceError that broke every wheels program went unnoticed here. `tests/compare-canvas.sh turtle` now covers all 6, and `tests/pygmi.html` unit-tests the preprocessor directly.

## URL parameters (the main configuration surface)

Read in `editor.js`; embedders drive the whole UI through these.

| Param | Effect |
| --- | --- |
| `code=` | URL-encoded source loaded into the editor |
| `id=` | Fetch source from the codestore web service |
| `project=` | Load `projects/<name>.py` (`.py` auto-appended unless `compiled`) |
| `name=` | localStorage key / default save filename (falls back to `project`, then `my_code`) |
| `display=` | `side` \| `top` \| `bottom` |
| `autorun`, `autostep`, `autodelay` | Run on load; auto-stepping |
| `headless` | Hide editor and buttons, run immediately, show a Rerun button in the console |
| `compiled` | Source is pre-compiled Skulpt JS; implies headless, uses `Sk.onAfterCompile` to swap in the stored code |
| `wheels` | Enable the pygmify beginner dialect |
| `light` | Light editor theme instead of Monokai |
| `editor=ace` | Fall back to Ace, lazy-loaded. A supported escape hatch, not scaffolding |
| `norun`, `nostep`, `nosave`, `nosnap`, `nocanvas`, `nofs` | Hide the corresponding buttons/panes |
| `url`, `piskel` | Show the URL / Piskel buttons |
| `webservice=` | Override the codestore base URL (e.g. `http://localhost:3000`) for testing |

Note: `id` is stripped from the address bar after load in non-headless mode, so users don't assume their edits are saved into that snapshot.

**Two shipped bugs lived in the `?code=` round trip** — both present since before the migration, both fixed, both now covered by `tests/urlmodes.html`. They are worth knowing about because the symptoms pointed nowhere near the cause:

- **`?code=` was decoded twice.** `URLSearchParams.get()` already percent-decodes, and `editor.js` called `decodeURIComponent()` on the result. A bare `%` therefore threw `URIError: URI malformed` at top level, so the rest of `editor.js` never ran — and `%` is Python's modulo operator, which means **the URL button produced links that broke the editor for any program containing `i % 2`**.
- **The address-bar rewrite re-appended *decoded* values raw.** A single `<` anywhere in the source produced a document URL that broke every subsequent *relative* subresource load: Monaco's AMD modules failed and Pyodide's `js/py/*.py` fetches failed, reporting `Failed to fetch` from inside `boot()`. A `#` — i.e. any Python comment — additionally swallowed every later parameter into the URL fragment. It now rebuilds with `URLSearchParams`.

The lesson for anything else touching this: **`URLSearchParams` decodes on the way out and must be allowed to encode on the way back in.** Never build a URL by concatenating values from `forEach`.

## Persistence

- **localStorage**, keyed by `filename` — the autosave on every run and save. `resetEditor()` clears it and re-fetches the project/URL code.
- **Codestore** — `POST put` / `GET get?id=` against the `webServiceURL` global (default `https://codestore-348206.ts.r.appspot.com/`), producing shareable snapshot URLs plus a QR code. Snapshots are immutable: regenerating is required after edits. Note `fetchFromCodestore()` deliberately does nothing on a non-200, leaving the spinner up forever — pre-existing, commented, worth fixing separately.
- **projects/** — curriculum `.py` files served over HTTP, organised by course (`intro.v2`, `introduction`, `intermediate`, `learntocode2`, `inquisitive`, `debugging`, `pythonai`, `robotics`, `turtle`, `demos`). `samples/` holds images/sounds/music those projects reference by relative path; `*Compiled.js` files under `projects/demos` are for `?compiled=1`.

## Conventions

- Tabs for indentation in `editor.js`, 4 spaces in `console.js`/`pygmi.js` and the newer facade files — match the file you are editing.
- New globals go at top level; there is no module system to hook into. Function names are camelCase; internal/runtime helpers use a leading underscore (`_babylonObjects`, `_functionQueue`).
- **Cache-bust every file you touch** — bump its `?t=` in `editor.html`. There is no other cache busting.
- Run `tests/run-conformance.sh compare` before calling anything done, then check the visual bits by hand. Chrome/Edge/Safari are the supported targets (`checkBrowser()` warns otherwise), though several features are Chromium-only by design — the File System Access save/load path falls back to FileSaver.js elsewhere, and Pyodide will narrow this to Chromium 137+.
- When preserving a pre-existing bug deliberately (there are a few — a non-200 from the codestore still leaves the spinner up forever), say so in a comment. Changing unrelated behaviour mid-refactor is what makes a refactor unverifiable.
