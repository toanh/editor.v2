// Python runtime facade.
//
// editor.js owns the UI (buttons, panes, watch table, display mode) and talks
// to `Runtime` for everything to do with actually executing Python. A backend
// (js/runtime-skulpt.js, later js/runtime-pyodide.js) registers itself via
// Runtime.use() before boot().
//
// The point of the split is that the backend knows how its interpreter
// suspends, stores locals and formats errors; the UI does not.

var Runtime = (function () {
    var backend = null;

    function required() {
        if (backend === null) {
            throw "No Python runtime backend installed - call Runtime.use() first.";
        }
        return backend;
    }

    return {
        use: function (impl) {
            backend = impl;
        },

        name: function () {
            return backend ? backend.name : "none";
        },

        // Resolves once the interpreter can run code. Synchronous backends
        // (Skulpt) resolve immediately; Pyodide will not.
        boot: function () {
            return Promise.resolve(required().boot());
        },

        setWebServiceURL: function (url) {
            return required().setWebServiceURL(url);
        },

        // Bind one entry from the Host registry. A backend whose interpreter
        // is not up yet (Pyodide) queues these and flushes them during boot().
        installHostName: function (entry) {
            return required().installHostName(entry);
        },

        // Rewrite the curriculum's goto/label statements into whatever this
        // interpreter understands. Skulpt has real `goto NAME` grammar and
        // wants the dot removed; CPython has no such statement and wants
        // `goto.NAME`, an attribute access it can then give meaning to.
        // Line-preserving in both directions.
        normaliseGotoLabels: function (code) {
            return required().normaliseGotoLabels(code);
        },

        // opts:
        //   code                 preprocessed source
        //   stepMode             run one line at a time
        //   autoStep             step automatically instead of on the Next button
        //   takesPrompt          pass the prompt string through to onInput
        //   debugging            emit per-line suspension points
        //   onOutput(text)       stdout
        //   onInput(prompt)      -> Promise<string>
        //   onStep({lineno, locals})  -> Promise, resolved when the UI is ready
        //                        to advance. `locals` is [[name, value], ...].
        // Returns a Promise that settles when the program ends.
        run: function (opts) {
            return required().run(opts);
        },

        // Ask the running program to stop at its next suspension point.
        stop: function () {
            return required().stop();
        },

        isStopped: function () {
            return required().isStopped();
        },

        // Throws if a stop has been requested. Backends call this themselves;
        // it is exposed because some host builtins need to check too.
        checkForStop: function () {
            return required().checkForStop();
        },

        // Interpreter-specific teardown between runs.
        teardown: function () {
            return required().teardown();
        },

        // Wire up builtin PyAngelo. Called from console.js's setCanvasSize,
        // once the JSFrame holding #canvas exists.
        //
        // Skulpt does this itself in the fork (Sk.PyAngelo.preparePage plus
        // Sk.builtin._setCanvasSize) so its backend has no implementation here;
        // Pyodide has to do it from Python, because the API is a set of
        // *builtins* and mouseX/mouseY have to be real names a student can read.
        setupBuiltinPyangelo: function (w, h, yAxisMode) {
            var b = required();
            if (typeof b.setupBuiltinPyangelo !== "function") { return; }
            return b.setupBuiltinPyangelo(w, h, yAxisMode);
        },

        // Render an error thrown by run() as a single line of text.
        formatError: function (err) {
            return required().formatError(err);
        }
    };
})();
