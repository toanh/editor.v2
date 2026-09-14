// Skulpt backend for the Runtime facade.
//
// Everything in here knows about Skulpt internals - suspensions, $loc/$tmps,
// tp$name, the _$rw$ reserved-word mangling. Nothing outside this file should.
// It will be deleted once Pyodide is the only runtime.

var SkulptRuntime = (function () {
    var stopped = false;

    // Walks the suspension chain collecting [name, value] pairs from each
    // frame's locals ($loc) and temporaries ($tmps), skipping dunders and
    // Skulpt's own $-prefixed bookkeeping.
    function collectFrame(bag, frame, key) {
        if (!frame.hasOwnProperty(key)) {
            return;
        }
        var names = frame[key];
        for (var property in names) {
            if (property.substring(0, 2) === "__" &&
                property.substring(property.length - 2) === "__") {
                continue;
            }
            if (property.substring(0, 1) === "$") {
                continue;
            }
            if (names[property] !== undefined && "v" in names[property]) {
                bag.push([sanitiseName(property), names[property].v]);
            }
        }
    }

    function collectLocals(susp, traces) {
        if (susp.child == null) {
            return traces;
        }
        traces = collectLocals(susp.child, traces);
        collectFrame(traces, susp.child, "$loc");
        collectFrame(traces, susp.child, "$tmps");
        return traces;
    }

    // Skulpt appends _$rw$ to names that collide with JS reserved words.
    function sanitiseName(name) {
        if (name.substr(-5) === "_$rw$") {
            return name.substr(0, name.length - 5);
        }
        return name;
    }

    // The frame whose line number should be shown to the student: the deepest
    // one still executing their own file.
    function deepestStdinFrame(susp) {
        var child = susp.child;
        var last = child;
        while (child.child.child != null) {
            child = child.child;
            if (child.$filename === "<stdin>.py") {
                last = child;
            }
        }
        return last;
    }

    // The autostep variant has always used the deepest frame regardless of
    // which file it belongs to. Kept as-is so slow-mo stepping is unchanged.
    function deepestFrame(susp) {
        var child = susp.child;
        while (child.child.child != null) {
            child = child.child;
        }
        return child;
    }

    // Pauses for the step debugger and for breakpoints. Installed on Sk.debug
    // and Sk.delay, so it sees one suspension per statement while `debugging`
    // is on, plus one per `while` iteration.
    //
    // onStep's promise resolves with "step" (Next: pause on the next line too)
    // or "continue" (run on to the next breakpoint).
    //
    // When a suspension is not a pause - not stepping, and not on a breakpoint -
    // this returns nothing, which hands it back to Skulpt's default handling:
    // Sk.debug resumes synchronously, Sk.delay through setImmediate. A run with
    // breakpoints set therefore costs no more than a run without. That must NOT
    // be done by making Sk.breakpoints() return false instead: the same
    // predicate decides whether a `while` loop suspends each iteration, and
    // killableWhile - the only thing keeping a game loop from freezing the tab -
    // depends on it.
    function makeDebugger(opts, pickFrame, withLocals) {
        var stepping = !!opts.stepMode;
        var breakpoints = {};
        (opts.breakpoints || []).forEach(function (n) { breakpoints[n] = true; });
        var lastLine = -1;

        return function (susp) {
            checkForStop();
            var frame;
            try {
                frame = pickFrame(susp);
            } catch (e) {
                if (stepping) { return Promise.reject(e); }
                return undefined;
            }
            var line = frame.$lineno;
            var atBreakpoint = breakpoints[line] === true && frame.$filename === "<stdin>.py";
            var newLine = line != lastLine;
            lastLine = line;

            if (!newLine || (!stepping && !atBreakpoint)) {
                if (!stepping) { return undefined; }
                try {
                    return Promise.resolve(susp.resume());
                } catch (e) {
                    return Promise.reject(e);
                }
            }

            return (async function () {
                var command = await opts.onStep({
                    lineno: line,
                    locals: (withLocals || atBreakpoint) ? collectLocals(susp, []) : null,
                    reason: atBreakpoint ? "breakpoint" : "step"
                });
                stepping = command !== "continue";
                return susp.resume();
            })();
        };
    }

    function checkForStop() {
        if (stopped) {
            throw 'Stopped!';
        }
    }

    return {
        name: "skulpt",

        boot: function () {
            Sk.configure({ __future__: Sk.python3 });
        },

        setWebServiceURL: function (url) {
            Sk.builtins.webServiceURL = new Sk.builtin.str(url);
        },

        // The fork's grammar accepts `label NAME`, so the dot comes off.
        normaliseGotoLabels: function (code) {
            return stripPeriodFromGoto(code);
        },

        // Bind one entry from the Host registry into Sk.builtins. Reproduces
        // exactly the three shapes console.js used to write by hand.
        installHostName: function (entry) {
            if (entry.kind === "constant") {
                Sk.builtins[entry.name] = new Sk.builtin.str(entry.value);
                return;
            }
            if (entry.kind === "raw") {
                Sk.builtins[entry.name] = entry.fn;
                return;
            }
            if (entry.kind === "alias") {
                Sk.builtins[entry.name] = Sk.builtins[entry.target];
                return;
            }
            // kind === "method"
            var m = entry.meta;
            var spec = {
                $meth: entry.fn,
                $name: entry.name
            };
            if (m.namedArgs || m.defaults) {
                spec.$flags = { NamedArgs: m.namedArgs || [], Defaults: m.defaults || [] };
            }
            if (m.textsig) { spec.$textsig = m.textsig; }
            if (m.doc) { spec.$doc = m.doc; }
            Sk.builtins[entry.name] = new Sk.builtin.sk_method(spec, null, "builtins");
        },

        stop: function () {
            stopped = true;
        },

        isStopped: function () {
            return stopped;
        },

        checkForStop: checkForStop,

        teardown: function () {
            // stop the keylisteners for pyangelo
            Sk.PyAngelo.stopPyangelo();
        },

        run: function (opts) {
            stopped = false;

            Sk.configure({
                output: opts.onOutput,
                inputfun: opts.onInput,
                inputfunTakesPrompt: opts.takesPrompt ? true : false,
                debugging: opts.debugging ? true : false,
                killableWhile: true,
                __future__: Sk.python3
            });

            // turtle graphics
            (Sk.TurtleGraphics || (Sk.TurtleGraphics = {})).target = 'turtleCanvas';

            var handlers = {};
            handlers["*"] = checkForStop;
            if (opts.stepMode || (opts.breakpoints && opts.breakpoints.length)) {
                var debug = opts.stepMode && opts.autoStep
                    ? makeDebugger(opts, deepestFrame, false)
                    // Locals at every manual pause - including the lines
                    // stepped to after Next at a breakpoint, not only the
                    // breakpoint itself.
                    : makeDebugger(opts, deepestStdinFrame, true);
                handlers["Sk.debug"] = debug;
                handlers["Sk.delay"] = debug;
            }

            var self = this;
            var code = opts.code;
            return Sk.misceval.asyncToPromise(function () {
                var a;
                try {
                    a = Sk.importMainWithBody("<stdin>", true, code, true);
                }
                catch (err) {
                    // Compile-time errors (the whole point of projects/debugging)
                    // are reported here rather than being rethrown, so they get
                    // the readable "TypeError: ... on line N" form instead of the
                    // raw JS message the rejection path would produce.
                    opts.onError(self.formatError(err));
                }
                return a;
            }, handlers);
        },

        formatError: function (err) {
            var ret = err.tp$name;
            if (!ret) {
                return err;
            }
            ret += ": " + err.tp$str().v;
            if (err.traceback.length !== 0) {
                var i;
                for (i = 0; i < err.traceback.length; i++) {
                    if (err.traceback[i].filename == "<stdin>.py") {
                        ret += " on line " + err.traceback[i].lineno;
                        break;
                    }
                }
                // no frame from the student's own file - fall back to the top
                if (i == err.traceback.length) {
                    ret += " on line " + err.traceback[0].lineno;
                }
            } else {
                ret += " at <unknown>";
            }
            return ret;
        }
    };
})();
