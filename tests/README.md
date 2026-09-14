# Conformance harness

Runs every curriculum file in `projects/` inside a real `editor.html` iframe,
captures what the console would have shown, and diffs it against a recorded
baseline. It exists so that "the Monaco/Pyodide migration didn't break the
curriculum" is something we measure rather than assert.

It drives the app entirely from the outside. No production file knows it
exists: the harness swaps three globals inside the iframe before starting a run
(`outputf`, `inputf`, `stopSkulpt`), all of which `editor.js` looks up at call
time, then calls `Editor.dispose()` before detaching the frame. It deliberately
depends only on `runSkulpt` and `codestring`, both of which exist in every
version of the app, so the same harness can drive the pre-refactor code, the
current code and the eventual Pyodide build.

## Files

| File | Purpose |
| --- | --- |
| `conform.html` | Interactive runner - filter the corpus, record or compare, click a row to see its output |
| `conform-cli.html` | Same engine, no UI, for headless runs |
| `conform.js` | The driver |
| `manifest.js` | Generated corpus list with per-file tags. Regenerate with `node tests/make-manifest.js` |
| `goldens.json` | The recorded baseline. **Currently recorded against Skulpt + Ace at commit `b529c5b`** |
| `hostnames.html` | Dumps every classroom builtin as it is actually bound - kind, value, argument metadata. Diff two builds to prove a registration change was neutral |
| `urlmodes.html` | Smoke-tests the URL-parameter surface the corpus never reaches: `?code=`, localStorage, headless, and the button-visibility flags. Includes a `?code=` payload carrying `%`, `<`, `>` and `#`, which is where two shipped bugs were hiding |
| `run-conformance.sh` | Runs the whole corpus in chunks and aggregates. The normal way to run it |
| `pygmi.html` | Unit tests for `js/pygmi.js` - the goto/label spellings, the `?wheels=1` beginner dialect, the print-concatenation rewrite and the cloud-variable lexer. Pure string in, string out; also asserts every pass is line-preserving and carries no state between calls |
| `check-combos.sh` | Runs a sample of the corpus through all four editor × runtime combinations. Phase 4 is on hold, so `?editor=ace` and `?runtime=skulpt` are supported features and need checking like anything else |
| `check-pyodide.sh` | Runs `pyodide-only/*.py` under Pyodide and diffs each against its checked-in `.expected` file |
| `stepping.html` | Drives the step debugger and breakpoints through the real editor UI - Step/Run code path, Next and Continue buttons - and records every pause: the highlighted line and what the watch table was given |
| `check-stepping.sh` | Runs the `stepping/*.py` scenarios through `stepping.html` under both runtimes and compares them pause by pause. Skulpt is the reference; one narrowly-scoped difference is accepted |
| `pyodide-only/*.py` | Programs that **cannot** be compared against Skulpt: hardware modules that both runtimes can only fail at (differently, on purpose), and behaviour the port deliberately corrects. Each has a `.expected` beside it |
| `turtle-api/*.py` | Hand-written programs for the turtle functions no curriculum file calls - `circle`, `dot`, `stamp`, `setheading`, `pensize`, `fillcolor`, `write(move=True)`, the shape table, `tracer`/`update`, `degrees`/`radians`, multiple turtles. Not in `projects/` on purpose: they are not curriculum and must not reach the manifest or the goldens |
| `pyangelo-api/*.py` | Hand-written static pictures of the `pyangelo` module's argument forms, compared against Skulpt by `compare-canvas.sh pyangelo-api`. `colour_args.py` draws every colour form once and holds still - numeric colours were painted white under Pyodide, and the only curriculum file that would have shown it animated the colour, so the difference read as timing |
| `canvas-probe.html` | Runs ONE drawing program under ONE interpreter and reports what it painted |
| `compare-canvas.sh` | Drives the probe over the pyangelo files and diffs the pixels |
| `cdp-run.js` | Loads a page in headless Chrome and waits for it to signal `DONE`. No dependencies - Node 22+ has a built-in WebSocket |
| `serve.py` | Dev server with the MIME types Pyodide needs |
| `spike-pyodide.html` | Establishes the facts the Pyodide design rests on - JSPI, `f_lineno` jump legality, stdout buffering, `sys.monitoring`. Re-run after any Pyodide upgrade |

`hostnames.html` and `urlmodes.html` exist because the corpus harness has blind
spots. Every file it runs arrives via `?project=`, so the `?code=`, `?id=` and
localStorage load paths are never exercised; and 53 of the 56 Python-visible
names console.js provides (Hue, the webcam, iframes, the `inputnumber` aliases)
appear in no curriculum file at all.

## Running it

```sh
python tests/serve.py 8731        # NOT python -m http.server
tests/run-conformance.sh compare  # ~75 seconds for all 226 files
```

`serve.py` exists because `python -m http.server` sends `.mjs` as `text/plain`,
which browsers refuse to execute as a module - so Pyodide never starts. It also
sets `application/wasm`, and enables HTTP/1.1 keep-alive, without which it is
about twice as slow as the stock server.

**Do not add a `Cache-Control` header to it.** The harness opens one iframe per
file, each pulling several MB of Monaco, Skulpt and Pyodide, and it depends on
the browser cache to fetch those once rather than 226 times. `no-store` and
`no-cache` were both measured at roughly 40x slower - 10 files went from 5
seconds to over 200. Use the `?t=` cache-busters in `editor.html` instead.

Cross-interpreter runs, for the Pyodide port:

```sh
# every file that needs no classroom module, under Pyodide
TOTAL=136 FILTER='&exclude=classroom' EXTRA='runtime=pyodide' \
  tests/run-conformance.sh compare 10
```

A run whose `EXTRA` contains `runtime=` is treated as a cross-interpreter
comparison: error *text* is expected to differ, so a file whose golden raised is
checked for still raising rather than for wording. A file whose golden did
**not** raise is still diffed in full, so a newly-appearing error is still a
failure.

Or open `http://localhost:8731/tests/conform.html` for the interactive version.

**Chunking is not optional, and `run-conformance.sh` exists because of it.**
Every file gets its own iframe carrying a complete editor - Skulpt, Monaco,
babylon.js, tf.js - and a single browser process falls over somewhere past
about 50 of them. Measured: 40 files finish in 14s; 60 in one process hang
indefinitely, with no error, just an unresponsive page. The script gives each
chunk a fresh browser and a fresh profile. The default chunk of 20 is reliable;
40 usually works. This is a harness constraint only - the real app creates one
editor per page.

A stale Chrome profile produces **exactly the same symptom** - an unresponsive
page and an empty status line - so always pass a unique `--user-data-dir` if
you drive the browser by hand:

```sh
chrome --headless --disable-gpu --no-sandbox \
  --user-data-dir="$(mktemp -d)" \
  --virtual-time-budget=1800000 --dump-dom \
  "http://localhost:8731/tests/conform-cli.html?mode=compare&offset=0&limit=20" > out.html
```

Clean up by PID or let `timeout` do it. **Never `taskkill /F /IM chrome.exe`** -
that closes the developer's own browser too.

Even at chunk 20 a chunk occasionally dies. `run-conformance.sh` retries each
one once with a fresh profile, and then **asserts the file count at the end** -
because a dropped chunk shows up as a smaller `TOTAL`, not as a failure, and
"0 failures" would otherwise quietly mean "0 failures among the files we
managed to run". The script exits non-zero on an incomplete run or any failure,
so it is safe to use as a gate.

`conform-cli.html` query params: `mode=record|compare`, `limit=N`, `offset=N`,
`exclude=tag,tag`, `only=tag,tag`, `all=1` (include manual-only files), and
`with=` to append a parameter to every editor URL - `with=editor%3Dace` runs
the whole corpus against the Ace fallback, `with=runtime%3Dskulpt` will do the
same for the interpreter. When it finishes, `<title>` becomes `DONE` and `#out`
holds a JSON report; in record mode the report includes the goldens, which you
extract to `tests/goldens.json`.

`--virtual-time-budget` fast-forwards timers, so `sleep()` costs nothing - **but
only for Skulpt.** `run-conformance.sh` switches to `cdp-run.js` and real time
whenever `EXTRA` names the Pyodide runtime, and that is not an optimisation to
undo:

> Chunk 40-49 timed out on its first attempt in three separate full runs and
> passed on retry each time. It is not a bad file and it is not chunk size -
> `limit=10` completed while `limit=8` hung, minutes apart. Under virtual time
> that chunk hung for **322 seconds**; over CDP in real time it completed in
> **30, 30 and 31 seconds** across three runs with identical tallies.
>
> The mechanism is the one the canvas probe already ran into. Virtual time only
> advances while the page is idle, and every Pyodide yield goes through
> `requestAnimationFrame` - `js/py/yielding.py` on each loop back-edge, and
> `gotolabel`'s label yield. A program suspended on rAF is not idle, so virtual
> time stalls, so the frame never arrives. Skulpt is immune because
> `killableWhile` yields through macrotasks, which virtual time fast-forwards
> happily.

Real time costs roughly 1.5x on a Pyodide chunk and buys back the retries.

## Long runs: the two-minute rule

**If a run can take more than about two minutes, it must print a line per item
as that item finishes, and something must check on it automatically. Waiting for
the timeout is not a plan.**

**And every test run, of any length, is reported on every minute while it runs**
- the current step, how long it has been going, and the latest results -
whether or not anything changed since the last report. The person waiting on a
run should never have to ask how it is going. This was asked for directly ("how's
it going? can you report every minute please") and is a standing instruction,
not a courtesy for long runs only.

The reason is specific, not general tidiness: here a slow run and a hung run
look identical. `inquisitive/turtle/y5l3d1` legitimately takes ~90 seconds per
runtime because it is a 5000-frame drawing; a stale Chrome profile, a
`while True:` with no yield, and an iframe that never loaded all present as the
same silence. Waiting out a 300-second timeout to tell them apart costs the
timeout. Reading the last completed line costs nothing.

### Do this

```sh
# 1. Log EVERYTHING, unfiltered, and let the run go in the background.
#    pipefail matters: without it the exit status is tee's, so a gate reports
#    "1 problem(s)" and still exits 0.
set -o pipefail
tests/compare-canvas.sh 30 turtle 2>&1 | tee /tmp/turtle.log
```

```sh
# 2. Heartbeat: REPORT every 60s - unconditionally, changed or not - and PROBE
#    FOR LIFE after 2 minutes without a new line. Run it as a watcher, not as
#    something you intend to remember, and pass every STATUS line on to the
#    person waiting as it arrives. The log is the primary signal: if it grew,
#    the run is fine.
prev=0; stale=0
while ! grep -qE 'TOTAL [0-9]+ files|problem\(s\)|no blank' /tmp/turtle.log; do
    sleep 60
    n=$(wc -l < /tmp/turtle.log)
    echo "STATUS $(date +%H:%M:%S): $n lines; last: $(tail -1 /tmp/turtle.log)"
    if [ "$n" -gt "$prev" ]; then prev=$n; stale=0; continue; fi
    stale=$((stale + 1))
    [ "$stale" -ge 2 ] && { echo "no new line for 2 min - run step 3"; stale=0; }
done
```

The thresholds are the rule, not a detail. A first version checked every 90
seconds and only probed after three quiet beats - **four and a half minutes**,
more than double the two-minute limit - and nobody noticed until the question
was asked directly. Check the arithmetic of a watcher, not just that one is
running.

```powershell
# 3. Only after 2 minutes with no new log line: is the browser alive?
#    Sum the whole process tree - the parent alone is idle by design.
$p    = Get-CimInstance Win32_Process | Where-Object Name -eq 'chrome.exe'
$hl   = $p | Where-Object { $_.CommandLine -match '--headless' }
$tree = $p | Where-Object { $hl.ProcessId -contains $_.ProcessId -or
                            $hl.ProcessId -contains $_.ParentProcessId }
'{0} procs, {1}s cpu, oldest started {2}' -f $tree.Count,
    [int](($tree | Measure-Object UserModeTime -Sum).Sum / 1e7),
    ($tree | Sort-Object CreationDate | Select-Object -First 1).CreationDate
```

Growing log means progress, full stop. Zero processes with an unfinished log
means it died. A live tree whose oldest process is older than the per-chunk
timeout means it really is stuck.

**Trust the log above any process metric, and never act on a single signal.** A
first attempt at the check above filtered on `--headless` and summed
`UserModeTime` — which measures the *browser* process, idle by design, while the
renderer children do the work. On the same healthy run, minutes apart:

```
filtering on --headless :   2 procs,  1s cpu     <- looks dead
summing the whole tree  :  24 procs, 24s cpu     <- actually working
```

It reported `cpu +0s` beat after beat, and a Pyodide chunk that "stalled" for
three minutes turned out to finish in 21 seconds when re-run alone. Two broken
signals at once — a `tail`-buffered log and a CPU figure from the wrong
processes — read exactly like a hang, and a perfectly good run got killed on
the strength of them.

### The traps that make this fail

All of these have been hit here, and each one makes the monitoring *look* set up
while telling you nothing:

1. **Piping a long run through `tail`, `head` or `sort` buffers the whole
   stream.** `run-conformance.sh compare | tail -5` reads as "just show me the
   summary" and means "make this run unobservable until it ends". The log then
   stays empty, and a watcher pointed at that log can never fire — so the
   monitoring *looks* set up while reporting nothing. Log everything; filter
   when you read.
2. **A machine that sleeps mid-run leaves it dead, and `timeout` does not save
   you.** Observed here: a browser still alive after **4 hours 15 minutes**
   holding 9 seconds of CPU, with the log frozen on one chunk, because the
   machine suspended overnight. `run-conformance.sh` gives each chunk
   `timeout 300`, but that is wall-clock and does not fire sensibly across a
   suspend. The tell is the *age* of the oldest process against how long the
   run should have taken - which is why the liveness check prints it. Kill the
   browsers, kill the driver, start again; the partial log is worthless because
   you cannot tell which chunks ran before the machine went down.
3. **Orphaned headless browsers throttle every later run.** A driver that is
   killed or times out leaves its Chrome behind, idle-looking but competing for
   CPU. Twelve of them from two earlier runs stretched a two-minute conformance
   pass past half an hour; chunks dropped straight back to 5s once they were
   killed. **Sweep before starting anything long:**

   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
     Where-Object { $_.CommandLine -match '--headless' } |
     Select-Object ProcessId, CreationDate,
       @{n='profile';e={ if ($_.CommandLine -match '--user-data-dir=([^ "]+)') { Split-Path $Matches[1] -Leaf } }}
   ```

   `run-conformance.sh` names its profiles `profile-<offset>-<attempt>` and
   `cdp-run.js` uses `cdp-*`. Anything else, or anything older than the run you
   started, is an orphan — kill those **by PID**. Non-headless Chrome in that
   list is the developer's own browser: **never `taskkill /F /IM chrome.exe`**
   and never kill by name.

   That filter finds the *browser* process only. Its renderer and GPU children
   do not carry `--headless` on their command lines, so killing the matches one
   by one leaves them running. Kill the tree from its root instead:
   `taskkill /PID <browser-or-driver-pid> /T /F`. Killing a stuck probe's
   driver loop the same way also stops it launching the next probe.
4. **A liveness probe that cannot see processes reports the same thing for a
   live run and a dead one.** `wmic process ... | grep -c` run from Git Bash
   returns **0** for every query - measured: 0 chrome.exe via `wmic` against
   20 via PowerShell at the same moment. A watcher built on it printed
   `headless chrome procs=0, cdp-run node=0` every minute for eighteen minutes
   while a probe sat hung, which reads as "finished" rather than "stuck". Query
   through `powershell.exe -NoProfile -Command "Get-CimInstance ..."`, and
   **test the probe against a process you know is alive before trusting it.**
   When a liveness line does fire, act on it that turn - the alert is the whole
   point of the watcher.
5. **A page that freezes its main thread used to hang `cdp-run.js` for ever.**
   Its wait loop checked the deadline only between CDP calls, and a page stuck
   in synchronous work never answers `Runtime.evaluate`, so the `await` never
   returned. The trigger was a probe doing `for i in range(100000000)` under
   Skulpt, which builds the whole list before iterating; it sat for 19 minutes
   on a 115-second timeout. `cdp-run.js` now gives each call 5 seconds and has a
   hard watchdog at `timeout + 10s` that kills Chrome regardless - checked
   against `data:` page running `for(;;){}`, which now exits in 11 seconds. If
   you write another CDP driver, give it both.

### The rest of the rules

- **Per-item timeouts, not one budget for the run.** `probe()` gives every file
  its own `timeout`, so one stall costs that file and not the suite.
  `run-conformance.sh` does the same per chunk, and retries once.
- **Say how long slow is.** Each script's header gives expected durations
  (turtle ~15 min, `y5l3d1` ~90 s each way) so "still going" is checkable
  against something rather than against a feeling.
- **Do not run anything else against the browser while a suite is running.**
  Measured: `demos/turtle_demo` completed twice standalone and then timed out
  inside the suite, purely because two extra probe browsers were competing for
  CPU. A timeout under load is not a result — re-run that file alone before
  believing it.
- **Never edit a running script.** `bash` reads a script incrementally by byte
  offset, so editing `compare-canvas.sh` mid-run corrupts execution from that
  point; and `canvas-probe.html` is re-fetched per file, so an edit applies to
  the second half of a run and not the first. Stop the run, edit, re-run.
- **Killing the shell does not kill the run.** Stopping the parent leaves
  `run-conformance.sh` and its browsers running: a "cancelled" pass here went
  on to complete and write its summary *while the replacement pass was already
  going*, so two full conformance runs competed for the machine and both
  results were suspect. After cancelling anything long, confirm no headless
  Chrome and no `run-conformance` process survives before starting again.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `pass` | Console output is byte-identical to the golden |
| `smoke` | File uses `random`/`time`, so its text can't be compared. Asserts only that it still runs and still does/doesn't raise |
| `timeout` | Didn't finish inside 20s. The golden is partial and marked `TRUNCATED` |
| `unchecked` | Cross-runtime only: the golden raised, so the file was going to be asked "do you still raise?", and the run was cut short before we could tell. **Not a pass** - it is listed by name in the summary so a shrinking failure count cannot be read as an improvement |
| `fail` | Output differs, or an expected error stopped happening |
| `new` | No golden recorded yet |

## Tags and coverage

`make-manifest.js` tags each file by what it needs. Five tags are **blocking** -
they exclude a file from the automated diff because it can't run unattended:
`network`, `hardware`, `canvas`, `speech`, `widgets`. That leaves 226 of 345
files automatable; the other 119 need a manual smoke test (one micro:bit, one
webcam, one school ID, a look at the canvas demos).

Non-blocking tags are informational: `interactive`, `nondeterministic`, `goto`,
`wheels`, `blanks`, `expect-error`.

Two honest limits:

- **Input coverage is shallow.** Files that call `input()` are fed a fixed
  cycling answer list (`1, y, 2, n, 3, …`), capped at 60 reads. That reaches a
  valid path through most menu-driven files but explores one branch, not all of
  them. Per-file overrides can be supplied via `Conform.setFixtures()`.
- **`nondeterministic` files are not text-compared at all.** Shuffled emoji and
  variable-length dice games produce different output every run and no
  normalisation makes them comparable. They get `smoke` instead - which still
  catches a crash or a control-flow regression, but not a wording change.
- **"Did it raise?" is decided by a colour, not by an exception.**
  `raisedAnError()` looks for the exact red foreground escape `logError()`
  paints with - but the curriculum also *prints* red text. Across the 122
  goldens containing that escape, 105 look like genuine errors and **17 are red
  output with no error at all**, so the predicate over-reports by about 14%.
  That is the safe direction for the `unchecked` verdict (it flags files that
  had nothing to verify) but it also means a `pass` reading "raised, as
  expected" is sometimes only "printed something red, as expected".
- **48 of the 226 files are `unchecked` under Pyodide, and that is the gate's
  real coverage limit.** They are interactive programs whose golden raised and
  which the harness cut short - at 60 inputs or 20 seconds - before it could
  ask whether they still raise. They were previously reported as `smoke`,
  indistinguishable from "ran fine", which let the failure count move on its
  own: two Pyodide passes minutes apart, no code change between them, gave
  `168 pass · 57 smoke · 1 fail` and `168 pass · 56 smoke · 2 fail`, because
  `intro.v2/answers/0604a` (the `quit()` loop) drifted across the truncation
  boundary. With the split there are **48 unchecked and only 9 genuine
  smokes**. **Treat a drop in the failure count as suspicious until you have
  found the file that moved**, and check it in isolation -
  `offset=<index in the automatable list>&limit=1` runs exactly one. Most of
  the 48 would become real comparisons with a longer input script or per-file
  `Conform.setFixtures()`.
- **The corpus never runs `?wheels=1`.** All 6 `wheels`-tagged files are turtle
  files, so all 6 carry the blocking `canvas` tag and **0 of the 226 automatable
  files** exercise the `pygmify` preprocessor. That is how a `pass1 is not
  defined` ReferenceError reached every wheels program in the Pyodide build with
  nothing here failing. `compare-canvas.sh turtle` now covers all 6 of them, and
  `pygmi.html` covers the preprocessor itself -
  including `forever`, `until`, `repeat i = 1 to N` and single `=` in a
  condition, which the dialect supports and no curriculum file uses.

## Canvas programs

```sh
tests/compare-canvas.sh 30                # all four groups
tests/compare-canvas.sh 30 pyangelo       # 15 curriculum files, ~4 min
tests/compare-canvas.sh 30 turtle         # 14 curriculum files, ~15 min
tests/compare-canvas.sh 30 api            # 8 hand-written turtle files, ~3 min
tests/compare-canvas.sh 30 pyangelo-api   # hand-written pyangelo pictures, ~30 s each
```

Runs each drawing program under Skulpt and under Pyodide and compares the
pixels. Expect `identical` or `close`; the failure that matters is a canvas
blank under one runtime and not the other.

The groups end differently, and the probe handles each accordingly:

| Group | Target | How it ends |
| --- | --- | --- |
| `pyangelo` | `#pyangelo`, one canvas | Endless game loops. Autorun, count `frames` animation frames, sample. Ink is anything not pure black |
| `turtle` | `#turtleCanvas`, a div of three stacked canvases | These *finish*. The probe holds the run back with `norun=1`, swaps `stopSkulpt`, starts it itself and samples at the end. Layers are flattened onto white; ink is anything not pure white |
| `api` | the same, from `tests/turtle-api/*.py` | The micro-suite. Loaded with `?codeurl=`, which fetches the source and hands it to `editor.html?code=` rather than `?project=` |
| `pyangelo-api` | the `#pyangelo` canvas, from `tests/pyangelo-api/*.py` | Static pictures, so a pixel difference cannot be explained away as animation phase. When a curriculum file "differs" and timing is the suspected reason, freeze the animation in a copy and compare again - that is how the numeric-colour bug was found |

The `api` group also compares the **console text**, and so does the `turtle`
group. Query functions - `heading()`, `distance()`, `pencolor()`, the shape and
speed tables - have no pixels that could show a difference, so those programs
print their answers (rounded, since CPython and Skulpt disagree about float
repr and that is an accepted divergence elsewhere). It also means a traceback
is caught as a text mismatch rather than being mistaken for a blank canvas.

**The turtle group is slow by construction, not hung.** A turtle picture is
drawn at the program's own speed - `inquisitive/turtle/y5l3d1` is about 5000
animation frames, ~90 seconds per runtime - so budget a quarter of an hour.
`TURTLE_TIMEOUT` (seconds, default 300) caps each probe.

Half the turtle corpus is in the training-wheels dialect (`repeat 6:`), which
is a load-time source rewrite, so the flag has to be right or the file will not
compile. The probe fetches the source and applies `make-manifest.js`'s own test,
which keeps the shell driver free of per-file knowledge.

**`&runs=2` runs the same program twice in one page** and reports both, which is
where a stateful module that has to be re-imported between runs shows up —
`pyangelo` needed exactly that fix, or the second run drew into a canvas whose
render loop had been torn down. `turtle/002` and `demos/turtle_demo` are
pixel-identical across a re-run under both interpreters.

Two metrics, because either alone has a blind spot: **ink** (pixels differing
from the blank background) misses a wrong colour painted over the same shape,
and a `bgcolor()` program lights every pixel; **light** (summed intensity)
misses a shape moved onto equally bright pixels. A verdict needs both above
0.9. Add `&detail=1` to a probe URL for per-row and per-column ink profiles,
which localise a mismatch to a band of the picture.

Exact-hash equality *is* achievable across the two interpreters and is the
normal result here: 13 of the 14 turtle files and 7 of the 8 API files hash
identically. Do not shrug off a "close" verdict as inevitable antialiasing
without checking - before the layers were composited in `z-index` order, six of
those files reported "close (ink 1.000)" and the difference was real. When it
genuinely is rounding, `&detail=1` shows it: `turtle/001` matched row-for-row
and column-for-column with a total intensity difference of 3 units in 190
million, which is one antialiased pixel going the other way.

**These use `cdp-run.js`, not `--dump-dom --virtual-time-budget`, and must.** A
drawing program keeps requesting animation frames, so virtual time races ahead
burning the entire budget on real painting and the dump never arrives - the
symptom is a zero-byte output file that looks like a mystery rather than a
timeout. One browser per file per runtime keeps each page short-lived.

## The four combinations

```sh
tests/check-combos.sh 20      # ~3 min
```

Deleting Skulpt and Ace (Phase 4) is **on hold by decision**, so both remain
switchable and both have to keep working:

| | Skulpt | Pyodide |
| --- | --- | --- |
| **Monaco** | default today | `?runtime=pyodide` |
| **Ace** | `?editor=ace` | `?editor=ace&runtime=pyodide` |

The full conformance run only ever exercises one of those four. This samples the
corpus through all of them, so a change that quietly breaks the fallback is
caught by something other than a person trying it months later. Last measured,
20 files each:

```
monaco + skulpt (default)    {"pass":15,"timeout":1,"smoke":4}
ace + skulpt                 {"pass":15,"timeout":1,"smoke":4}
monaco + pyodide             {"pass":14,"unchecked":6}
ace + pyodide                {"pass":14,"unchecked":6}
```

The tallies match within each runtime, which is the useful signal: the editor
has no effect on what a program does. The `unchecked` verdicts under Pyodide are
expected - passing `runtime=` puts `conform.js` into cross-runtime mode, where a
truncated run is not asked whether it still raises.

## Pacing: measure what the player feels

A healthy browser proves nothing about whether a game feels right. While
`demos/snake.py` was polling its keys 81 times a second and missing a quarter
of quick taps under Pyodide, every browser-level number was perfect: frames at
16.7 ms, no long tasks, timer lag under 3 ms, and a bare frame yield timed at
exactly one frame. What found the bug was instrumenting the *program*:

- **the interval between the game's own state changes** - snake should move
  every 250 ms, and it moved 267-301 ms apart;
- **loops per second**, against Skulpt on the same machine;
- **synthetic key taps of realistic length** (40 ms) dispatched on the canvas
  and counted by the program itself.

```sh
# tests/pacing/pacing.html runs one program in an editor iframe and reports
# frame intervals, timer lag, long tasks and the program's console text.
node tests/cdp-run.js "http://localhost:8731/tests/pacing/pacing.html?runtime=pyodide&codeurl=tests/pacing/tap_program.py&taps=40" "#out" 115000
python tests/pacing/make_variants.py   # instrumented snake/pong copies, both runtimes
```

Cautions from that investigation:

- **Skulpt's own loop rate varied up to 3x between identical runs** (snake 1604
  vs 3225 loops/s, pong's intro body 979 vs 3070). Compare against a range,
  never one number.
- **Measure the reference implementation directly before designing to copy
  it.** pong's slow Skulpt loop suggested Skulpt throttled every `while`
  iteration, so a 1500/s cap was built for canvas programs. Timing Skulpt on
  bare loops disproved that (an empty canvas `while` loop: ~80,000/s), and the
  cap - which made light loops 30-50x slower than Skulpt - was removed. One
  program is an anecdote; time the construct itself.
- **A per-statement bisect must flush.** Timing `drawText` in a loop with no
  `clearScreen()` grows Skulpt's command queue without bound, and every section
  measured after it slowed to ~18,000/s - even `isKeyPressed`. It looked like a
  uniform per-call cost and was an artefact.
- **Stop when the answer stops mattering.** Once Skulpt's slow loops were shown
  to be the cost of its own execution, *why* one body costs more no longer
  changed the design. The resulting rule is documented in `js/py/prelude.py`.

## Stepping and breakpoints

```sh
tests/check-stepping.sh     # 11 scenarios x 2 runtimes, ~5 min
```

The conformance corpus never presses a button, so it cannot see the debugger at
all. Under Pyodide the Step button used to run the program straight through,
highlighting nothing, and every gate still passed.

`stepping.html` loads a program into a real editor, sets gutter breakpoints
through the `Editor` facade, starts it exactly as Step or Run does, and clicks
the real Next and Continue buttons - recording what `Editor.setStepLine` and
`populateTraceTable` were handed at each pause. `check-stepping.sh` does that
under both runtimes and compares the two.

What comparing against Skulpt caught, none of it visible from the code:

- **A `goto` jump never arrives at its label** as far as CPython's LINE event
  is concerned, so stepping silently skipped every label after a jump.
- **The first fix for that inferred a jump from the last line reported.** While
  running to a breakpoint, lines disable their own events, so that record goes
  stale: a breakpoint on a label fired twice where Skulpt fired three times.
- **Skulpt sent no watch-table data after Next at a breakpoint**, leaving the
  table blank - a bug in the new code, in the reference runtime.

Watch tables are compared as sets, because name order within a frame is
JavaScript property order under Skulpt and means nothing to a student. The one
accepted difference - CPython pauses on a `for` line before taking the next item,
Skulpt after - is expressed per scenario as the exact expected Pyodide lines and
the lines whose table is not compared. It is not a tolerance.

## Pyodide-only checks

```sh
tests/check-pyodide.sh              # all of them
tests/check-pyodide.sh microbit_logic
```

Some ported modules cannot be compared against Skulpt at all, and pretending
otherwise would either weaken the check or lock in a bug:

- **Hardware.** micro:bit needs a paired board and speech needs microphone
  permission, so in headless Chrome both runtimes can only fail - and they fail
  *differently on purpose*, because the port reports a clear message where the
  fork threw whatever the browser threw.
- **Deliberate corrections.** `Microbit.getCompass()` answered `"NW"` for
  north in the fork. Matching Skulpt would mean keeping the bug.
- **Things headless Chrome has no device for.** `babylon` needs WebGL and
  `speech` needs a microphone, so a cross-runtime comparison of either is a
  comparison of two failures.

What the checks cover today:

| File | Checks |
| --- | --- |
| `microbit_logic.py` | The compass arithmetic at every boundary, and the failed-pairing path |
| `perlin_values.py` | Seven noise values and a mirroring case, against numbers computed from the fork's JavaScript. **Exact to 12 decimal places** - Perlin is pure arithmetic, so there is no reason to accept less |
| `babylon_scene.py` | Builds `demos/vr.py`'s scene, stubs the handover and prints the exact description that crosses to JavaScript. Catches the two failure modes that would otherwise show up only as an empty 3D canvas: a `Map` instead of a plain object, and unresolved object references |
| `speech_sendsms.py` | The module surface - that `speech.say` is not `csinsc.say`, and that the long-dead `sendsms` says so |
| `speech_safety.py` | The profanity filter and the language table, by intercepting `speechSynthesis.speak` - nothing has to be audible |
| `builtin_pyangelo.py` | The whole Processing-style API, `vector` and `sprite`, plus **real dispatched mouse and key events**, because `mouseX` updating is a callback from JavaScript into Python and nothing else would exercise it |
| `turtle_events.py` | `onkey` / `onkeypress` / `onscreenclick` with real dispatched events |

**Dispatch the real event; do not trust that a callback is wired.** Three bugs
in this port were completely silent, because every host wraps its callbacks in
`try/catch` and none of this code is reachable from the curriculum: a Python
callable handed to JavaScript is destroyed as soon as the call that received
it returns (use `create_proxy`); a JavaScript `null` arrives in Python as
`JsNull`, which `is not None` (pass `undefined`); and the speech bridge had
lost its profanity filter. Each was found only by a test that fired the actual
DOM event or intercepted the actual browser call.

So these are diffed against a checked-in `.expected` file instead. Lines
beginning `Error:` are normalised before comparison: the text after them is
Chrome's, not ours, and changes between versions - the check is that the line is
there, not what it says.

## What is still unverified

**Everything the micro:bit actually does.** 43 curriculum files import it, and
none of them can run here. `pyodide-only/microbit_logic.py` covers the compass
arithmetic at every boundary and the failed-pairing path, and the LED
bit-packing was checked exhaustively against the fork's algorithm for all 32 row
patterns - but pairing, the buttons, the screen and the sensors need a human
with a flashed board.

**How breakpoints look and feel.** `check-stepping.sh` sets breakpoints through
`Editor.setBreakpoints()` and clicks the Next and Continue buttons in the DOM, so
it proves pausing, stepping and the watch table's contents. It does not click
the gutter, see the red dot or the hover hint, or check that the paused-state
buttons and the watch-table window sit sensibly on screen. Check by hand in
Monaco and in `?editor=ace` - including that a breakpoint follows its line when
lines are added above it.

**A real webcam and real Teachable Machine models.** `pyodide-only/teachable_machine.py`
fakes the camera, `tmImage`, `tmPose` and `speechCommands`, so it proves the
port's arguments, return shapes and messages - not that tf.js loads a model,
that the browser grants camera or microphone permission, or that the pose
skeleton draws over the video. The upload-dialog path of `loadImageModel()` is
not exercised at all.

**A real Philips Hue bridge.** `pyodide-only/host_functions.py` fakes `fetch`
and checks every request's method, path and body. Whether a bridge on the school
network accepts them - over HTTPS with its self-signed certificate - needs a
bridge.

`?id=` (codestore snapshots) needs the live web service, so nothing here covers
it. Check it by hand after touching `fetchFromCodestore()` in `editor.js`.

Everything visual is also out of scope: these suites capture console text and
DOM state, so they say nothing about whether the step-line highlight, the
canvas panes or the Monaco layout actually look right.

## Lessons this harness has already cost us

Every one of these was paid for. They generalise past this repo.

**Ask what the number would be if the feature were completely broken.** If the
answer is "the same", it is not a metric. `ink` counts pixels differing from the
blank background, so for any program that calls `bgcolor()` it is 250000 out of
250000 on both sides and the ratio is 1.000 unconditionally - `demos/turtle_demo`
would have scored a flawless ink ratio with one runtime drawing the picture and
the other drawing nothing at all. Summed intensity is the second, independent
axis, and it is what actually exposed that file. Prefer two cheap orthogonal
metrics over one clever one.

**"We could not tell" must not be spelled the same as "fine".** The harness had
one verdict, `smoke`, covering both "text is not comparable, but it ran" and
"the run was cut short before we could check whether it still errors". The
second is an untested case wearing a passing colour, and it moved the failure
count on its own: two identical Pyodide passes reported 1 fail and 2 fail with
no code change between them, because one file drifted across that boundary.
Splitting out `unchecked` — listed by name in the summary, amber in the UI —
costs six lines and makes a shrinking failure count impossible to misread.
Whenever a verdict can mean "not verified", give it its own name.

**Compare what the user sees, not what the DOM holds.** The turtle target is
three stacked canvases and Skulpt allocates them lazily, so its background
canvas - created by the first `bgcolor()` - is appended *after* the paper it
belongs underneath, and relies on `z-index`. Flattening in DOM order painted
the background over the drawing and invented a difference between the runtimes
that did not exist. Sorting by `z-index` turned six files from "close" to
"identical" at a stroke, because the cursor layer had been composited under its
own lines the whole time.

**Derive lists from the source; never hand-write them.** The first turtle file
list came from `grep -rl "turtle"` and picked up two text adventures whose menu
has a `goto .turtle` branch. They block on `input()`, so they cost the run
twenty minutes of timeouts before anyone noticed they were not turtle programs.
`^\s*(from|import)\s+turtle\b` is the definition; the list is now computed.

**When a new test goes red, suspect the test first.** Two of `pygmi.html`'s 26
cases failed on first run because the expected strings were my guesses: the
cloud rewrite keeps the prefix, so the variable really is `cloud_score`, not
`score`. Record what the working system does, then read it and decide whether it
is right - do not "fix" the code to match an invented expectation.

**Fixtures made of plain ASCII words test almost nothing.** `urlmodes.html`
covered `?code=` from the beginning - with `print("hi from code param")`. Two
shipped bugs sat behind that fixture for as long as it existed: the source was
percent-decoded twice, so a bare `%` threw `URIError` and killed the rest of
`editor.js` (and `%` is Python's modulo, so the URL button emitted links that
broke the editor for any program containing `i % 2`); and the address-bar
rewrite re-appended *decoded* values, so a single `<` broke every relative
subresource load in the page. Neither character appeared in any fixture. When
a test's input is data the system round-trips, put the awkward characters in
it - `% & < > # + " '` and a newline - not a friendly sentence.

**Look for coverage holes where tags intersect.** All 6 `wheels` files are also
`canvas` files, so a whole language dialect had zero automated coverage and a
`pass1 is not defined` ReferenceError that broke every one of them sailed
through a green suite. Cross-tabulate the blocking tags against the feature
tags; a feature whose every file is excluded is a feature nothing tests.

**Test pure functions as pure functions.** `pygmi.js` is string in, string out.
It needed no browser, no interpreter and no corpus - and `pygmi.html` catches a
class of bug the 226-file suite structurally cannot reach. Look for the parts of
the pipeline that have no dependencies and test those directly and cheaply.

**Assert the invariants, not only the output.** Equality of one output string is
weak. Every `pygmi.js` pass must also be *line-preserving* (the step debugger
and error line numbers are keyed to line numbers) and must give the same answer
when called twice (they used to communicate through implicit globals). Both are
one line each in the runner and both would have caught real bugs.

**Exact equality across engines is the wrong bar for pixels.** `turtle/001`
matches row-for-row and column-for-column with a total intensity difference of 3
units in 190 million - one antialiased pixel rounding the other way. Chase a
hash mismatch only until the profiles agree; then stop.

**Attach the evidence to the failure.** "no #turtleCanvas" is a true statement
and a useless one. Once the probe captured the iframe's console text *alongside*
the failure rather than instead of it, the same runs immediately reported
`SyntaxError: bad input on line 8` and `TypeError: Failed to fetch` - two
completely different causes that had been presenting identically. When a probe
reports "the thing I was looking for was not there", make it also carry the
nearest available explanation of why.

**Compare every channel the program produces, not just the headline one.** The
canvas probe compared pixels, so it could not see that `shape("dinosaur")`
raises in one runtime and is silently ignored in the other, or that the two
disagree about `speed(<not a number>)`. Both files were *pixel-identical*.
Adding console text to the same report - four lines - turned a picture
comparison into a behaviour comparison.

**A cross-implementation test must avoid what either side cannot parse.** The
micro-suite's first version used `goto(x, y)`, which is how the turtle
documentation writes it - and which is a `SyntaxError` under the Skulpt fork,
because it added `goto <label>` to the grammar and thereby made `goto` a
reserved word. Worth knowing, but it is a finding about the runtimes, not a
thing to leave in a file whose job is to compare them. Write the suite in the
intersection, and record the divergence separately.

**Fix transient infrastructure failures in the product, not the harness.** One
of seven boot-time fetches occasionally failed against a local server that was
answering every request correctly - a closed keep-alive socket. The tempting fix
is a retry in the test. The right fix is a retry in `runtime-pyodide.js`,
because a school's wifi will do the same thing and a student would have seen a
bare `TypeError: Failed to fetch`.

**Take control of the thing you are measuring.** The probe originally
piggy-backed on `?autorun=1` and raced the program's start. Loading with
`norun=1`, installing the completion hook, and then calling `runSkulpt()`
yourself removes the race entirely - which is what `conform.js` already did.

**A gate piped through `tee` is not a gate.** A pipeline's exit status is its
*last* command's, so `compare-canvas.sh ... | tee log` reported "1 problem(s)"
and exited 0. If you pipe a gate anywhere - `tee`, `head`, `grep` - use
`set -o pipefail` or read `${PIPESTATUS[0]}`. And make sure every bad verdict
actually counts: `differs` used to print in the report without incrementing the
failure count at all.

**Watch out for the platform.** Node on Windows resolves `/tmp` to `C:\tmp`, so
a Bash heredoc writing `/tmp/x.json` and a `node -e` reading it disagree about
where the file is; use the session scratchpad. And `| tee /dev/stderr` for
"show me and count me" interleaves the two streams and mangles both - it made a
correct file list read as `os/turtle`.

## Provenance of the current baseline

`goldens.json` was recorded from a clean `git worktree` at `b529c5b` — Ace +
Skulpt, before any migration work.

The expected tally is **205 pass · 3 timeout · 18 smoke · 0 fail**, and it has
not moved through four structural changes: the Editor/Runtime seams, the Host
registry extraction, the async `boot()`, and the Monaco swap. Anything else
means you changed behaviour.

Re-record only when you intend to, and say so in the commit message.
