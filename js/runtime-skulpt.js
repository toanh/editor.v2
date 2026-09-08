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

    function makeStepper(opts, pickFrame, withLocals) {
        var prevLine = -1;
        return async function (susp) {
            checkForStop();
            try {
                var frame = pickFrame(susp);
                if (frame.$lineno != prevLine) {
                    await opts.onStep({
                        lineno: frame.$lineno,
                        locals: withLocals ? collectLocals(susp, []) : null
                    });
                    prevLine = frame.$lineno;
                }
                return Promise.resolve(susp.resume());
            } catch (e) {
                return Promise.reject(e);
            }
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
            if (opts.stepMode) {
                var stepper = opts.autoStep
                    ? makeStepper(opts, deepestFrame, false)
                    : makeStepper(opts, deepestStdinFrame, true);
                handlers["Sk.debug"] = stepper;
                handlers["Sk.delay"] = stepper;
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
