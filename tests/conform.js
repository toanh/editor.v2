// Conformance harness driver.
//
// Runs each curriculum file inside a real editor.html iframe and captures what
// the console would have shown. Two modes:
//
//   Record   - run everything, produce goldens.json for download
//   Compare  - run everything, diff against a loaded goldens.json
//
// It drives the app from the outside: no production file knows this exists.
// The only hooks are three globals it swaps inside the iframe before starting
// a run (outputf, inputf, stopSkulpt), all of which editor.js looks up at call
// time.

var Conform = (function () {

    var RUN_TIMEOUT_MS = 20000;   // hard kill for a program that never ends
    var LOAD_TIMEOUT_MS = 15000;  // waiting for ?project= to populate the editor
    var MAX_INPUTS = 60;          // stop menu loops from reading forever

    // Answers fed to input() when a file has no fixture. Deterministic, so the
    // golden is reproducible; cycles so menu-driven files explore more than one
    // branch before they give up.
    var DEFAULT_STDIN = ["1", "y", "2", "n", "3", "", "4", "yes", "5", "no"];

    var goldens = {};   // path -> recorded output
    var fixtures = {};  // path -> array of input lines
    var results = [];
    var cancelled = false;
    // Appended to every editor.html URL, so the whole corpus can be run
    // against a non-default backend (e.g. "editor=ace" or "runtime=skulpt").
    var extraParams = "";
    // Set when the run uses a different interpreter from the one the goldens
    // were recorded on. Error *text* is then expected to differ - CPython's
    // wording is not Skulpt's - so a file whose golden raised is compared on
    // whether it still raises, not on what it said. A file whose golden did
    // NOT raise is still diffed in full, so a new error is still a failure.
    var crossRuntime = false;

    function stripAnsi(s) {
        // the app's own space-padded escape: [ 38;2;r;g;b m
        return s.replace(/\[ \d+;\d+;\d+;\d+;\d+ m/g, "");
    }

    function normalise(s) {
        return stripAnsi(s).replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
    }

    // logError() paints errors with this exact foreground escape.
    function raisedAnError(output) {
        return output.indexOf("[ 38;2;255;0;0 m") !== -1;
    }

    function sleep(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }

    // Boot an editor.html iframe on one project and wait until its code is in.
    // `expected` is the source we fetched ourselves, so we can tell "loaded"
    // from "still loading" even when the file is empty.
    function loadEditor(entry, expected) {
        return new Promise(function (resolve, reject) {
            // ?project= prefers localStorage over the network; make sure the
            // slot is empty or we would replay the previous file's source.
            try { localStorage.removeItem("__conform__"); } catch (e) {}

            var frame = document.createElement("iframe");
            frame.className = "runner";
            var params = [
                "project=" + encodeURIComponent(entry.path),
                "name=__conform__",
                "norun=1", "nosave=1", "nosnap=1", "nofs=1"
            ];
            if (entry.tags.indexOf("wheels") !== -1) params.push("wheels=1");
            if (extraParams) params.push(extraParams);
            frame.src = "../editor.html?" + params.join("&");
            document.getElementById("frames").appendChild(frame);

            var started = Date.now();
            frame.onload = function () {
                (function poll() {
                    var w = frame.contentWindow;
                    var ready = false;
                    try {
                        // Compare against the source we fetched ourselves.
                        // Polling `codestring.length > 0` would hang on the
                        // empty files in the corpus, and polling the editor's
                        // content is no good either - Ace adopts the #editor
                        // div's placeholder text as its initial document, so
                        // it is non-empty before the ?project= fetch has even
                        // landed.
                        //
                        // Deliberately checks only `runSkulpt` + `codestring`,
                        // both of which exist in every version of the app. The
                        // harness has to drive the pre-refactor code, the
                        // current code and eventually the Pyodide build, so it
                        // must not depend on the Editor/Runtime facades.
                        ready = w && typeof w.runSkulpt === "function" &&
                                w.codestring === expected;
                    } catch (e) { /* still navigating */ }

                    if (ready) return resolve(frame);
                    if (Date.now() - started > LOAD_TIMEOUT_MS) {
                        return fail(new Error("timed out loading source"));
                    }
                    setTimeout(poll, 60);
                })();
            };
            frame.onerror = function () { fail(new Error("iframe failed to load")); };

            // An abandoned iframe keeps a whole editor - Skulpt, babylon, tf.js
            // - alive. Leaking one per failure is enough to bring the run down.
            function fail(err) {
                if (frame.parentNode) frame.parentNode.removeChild(frame);
                reject(err);
            }
        });
    }

    // Stop a running program. The refactored app exposes Runtime.stop();
    // the pre-refactor app only has stopEditor(), which throws by design.
    function stopProgram(w) {
        if (w.Runtime && typeof w.Runtime.stop === 'function') { w.Runtime.stop(); return; }
        try { w.stopEditor(); } catch (e) { /* stopEditor throws 'Stopped!' */ }
    }

    // Swap the three globals, run, and resolve with everything the console saw.
    function runInFrame(frame, entry) {
        return new Promise(function (resolve) {
            var w = frame.contentWindow;
            var chunks = [];
            var reads = 0;
            var script = fixtures[entry.path] || DEFAULT_STDIN;
            var settled = false;
            var timer = null;
            var truncated = false;   // we had to stop it; the golden is partial

            function finish(status) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ output: chunks.join(""), status: status,
                          inputsRead: reads, truncated: truncated });
            }

            w.outputf = function (text) { chunks.push(String(text)); };

            w.inputf = function (prompt) {
                reads++;
                if (reads > MAX_INPUTS) {
                    // Looks like an unbounded menu loop. Stop the program the
                    // same way the Stop button would.
                    truncated = true;
                    setTimeout(function () { try { stopProgram(w); } catch (e) {} }, 0);
                    return Promise.resolve("");
                }
                var line = script[(reads - 1) % script.length];
                chunks.push(line + "\n");
                return Promise.resolve(line);
            };

            var origStop = w.stopSkulpt;
            w.stopSkulpt = function () {
                try { origStop.apply(w, arguments); } catch (e) {}
                finish("ok");
            };

            timer = setTimeout(function () {
                truncated = true;
                try { stopProgram(w); } catch (e) {}
                setTimeout(function () { finish("timeout"); }, 500);
            }, RUN_TIMEOUT_MS);

            try {
                w.runSkulpt(false);
            } catch (e) {
                chunks.push("\n[harness] runSkulpt threw: " + e + "\n");
                finish("threw");
            }
        });
    }

    async function runOne(entry) {
        var frame = null;
        var started = Date.now();
        try {
            var res = await fetch("../projects/" + entry.path + ".py");
            if (!res.ok) throw new Error("source fetch " + res.status);
            var expected = await res.text();
            frame = await loadEditor(entry, expected);
            var r = await runInFrame(frame, entry);
            r.ms = Date.now() - started;
            return r;
        } catch (e) {
            return { output: "", status: "error", error: String(e.message || e),
                     ms: Date.now() - started, inputsRead: 0, truncated: false };
        } finally {
            // Dispose before detaching. Monaco holds a web worker and a blob
            // URL per instance; across a few hundred files the leak is enough
            // to slow the run to a crawl.
            try { frame.contentWindow.Editor.dispose(); } catch (e) {}
            if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
        }
    }

    function classify(entry, run) {
        var golden = goldens[entry.path];
        var errored = raisedAnError(run.output);

        if (run.status === "error") return { verdict: "error", note: run.error };
        if (run.status === "timeout") return { verdict: "timeout", note: "no end after 20s" };

        if (golden === undefined) return { verdict: "new", note: "no golden recorded" };

        // A run we had to interrupt has an arbitrary tail. Comparing it against
        // a golden that was interrupted at a different point in a different
        // interpreter says nothing. (Within one interpreter the cut is
        // deterministic, so those are still diffed.)
        if (crossRuntime && run.truncated) {
            return { verdict: "smoke", note: "run was cut short - tail not comparable" };
        }

        // Files whose recorded behaviour is "it raises" - the debugging lessons,
        // and under a cross-runtime comparison anything that errors at all.
        // Assert that they still raise, not what they said: CPython's wording
        // will differ from Skulpt's by design. Gated on the golden having
        // raised too, so a file that used to run and now errors is still a fail.
        if ((crossRuntime || entry.tags.indexOf("expect-error") !== -1) &&
            raisedAnError(golden)) {
            return errored ? { verdict: "pass", note: "raised, as expected" }
                           : { verdict: "fail", note: "expected an error, got none" };
        }

        // Anything driven by random/time produces different text every run -
        // shuffled emoji, a different number of dice rolls - and no amount of
        // normalising makes those comparable. Don't pretend otherwise: assert
        // only that it still runs the same way. That still catches a crash or
        // a control-flow regression, which is most of what matters.
        if (entry.tags.indexOf("nondeterministic") !== -1) {
            if (errored !== raisedAnError(golden)) {
                return { verdict: "fail",
                         note: errored ? "now raises an error" : "no longer raises" };
            }
            return { verdict: "smoke", note: "random output - ran clean, text not compared" };
        }

        if (normalise(run.output) === normalise(golden)) {
            return { verdict: "pass", note: "" };
        }
        return { verdict: "fail", note: firstDifference(golden, run.output) };
    }

    function firstDifference(a, b) {
        var x = normalise(a).split("\n");
        var y = normalise(b).split("\n");
        for (var i = 0; i < Math.max(x.length, y.length); i++) {
            if (x[i] !== y[i]) {
                return "line " + (i + 1) + ": expected " + JSON.stringify(x[i] || "") +
                       ", got " + JSON.stringify(y[i] || "");
            }
        }
        return "differs";
    }

    return {
        setExtraParams: function (s) {
            extraParams = s || "";
            crossRuntime = /runtime=/.test(extraParams);
        },
        setGoldens: function (obj) { goldens = obj || {}; },
        setFixtures: function (obj) { fixtures = obj || {}; },
        getGoldens: function () { return goldens; },
        getResults: function () { return results; },
        cancel: function () { cancelled = true; },

        // mode: "record" | "compare"
        run: async function (entries, mode, onProgress) {
            cancelled = false;
            results = [];
            for (var i = 0; i < entries.length; i++) {
                if (cancelled) break;
                var entry = entries[i];
                var run = await runOne(entry);

                if (mode === "record") {
                    goldens[entry.path] = run.output;
                }
                var verdict = mode === "record"
                    ? { verdict: run.status === "ok" ? "recorded" : run.status,
                        note: run.error ||
                              (run.truncated ? "TRUNCATED - partial golden. " : "") +
                              (run.inputsRead ? run.inputsRead + " inputs" : "") }
                    : classify(entry, run);

                var row = {
                    path: entry.path, tags: entry.tags, ms: run.ms,
                    status: run.status, inputsRead: run.inputsRead,
                    truncated: run.truncated,
                    verdict: verdict.verdict, note: verdict.note,
                    output: run.output
                };
                results.push(row);
                onProgress(row, i + 1, entries.length);
                await sleep(0);
            }
            return results;
        }
    };
})();
