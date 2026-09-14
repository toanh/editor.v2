// Monaco backend for the Editor facade.
//
// Uses the classic AMD distribution (monaco-editor 0.52.2, vendored under
// js/monaco/), which is the last release that ships a stable four-file
// min/vs tree. 0.56's min/ is 152 hash-named Rollup chunks whose names change
// every release, and its base/worker/workerMain.js and per-language files are
// gone - unusable without a bundler, which this project deliberately does not
// have.
//
// Monaco mounts into a div this file creates *inside* #editor rather than into
// #editor itself. #editor carries a border and padding (css/styles.css) and is
// re-parented between panes by setDisplayMode(); Monaco needs a bare,
// explicitly-sized box and computes line positions from its container's client
// box, so padding on the container mis-places the cursor. Keeping #editor as
// the outer box means setDisplayMode() needs no changes.

var MonacoEditorBackend = (function () {
    var ed = null;
    var model = null;
    var stepDecorations = null;
    var breakpointDecorations = null;
    var hintDecorations = null;
    var breakpointsEnabled = false;
    var completionFn = null;
    var loading = null;

    // Breakpoints are decorations rather than a list of numbers, so Monaco
    // moves them with the text: add a line above one and it follows its line.
    function breakpointLines() {
        if (!breakpointDecorations) { return []; }
        var seen = {};
        breakpointDecorations.getRanges().forEach(function (r) { seen[r.startLineNumber] = true; });
        return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
    }

    function setBreakpointLines(lines) {
        breakpointDecorations.set(lines.map(function (n) {
            return {
                range: new monaco.Range(n, 1, n, 1),
                options: {
                    glyphMarginClassName: "breakpoint-glyph",
                    glyphMarginHoverMessage: { value: "Breakpoint - click to remove" },
                    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
                }
            };
        }));
    }

    function toggleBreakpoint(line) {
        var lines = breakpointLines();
        var i = lines.indexOf(line);
        if (i >= 0) { lines.splice(i, 1); } else { lines.push(line); }
        setBreakpointLines(lines);
    }

    var THEME_DARK = "csis-monokai";
    var THEME_LIGHT = "vs";

    // The editor worker only powers word-based suggestions and diffing - the
    // Python tokenizer is Monarch and runs on the main thread - but without it
    // Monaco logs errors on every model change.
    var workerBlob = null;

    function workerUrl() {
        if (workerBlob) { return workerBlob; }
        var base = location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
        var src = "self.MonacoEnvironment={baseUrl:'" + base + "js/monaco/'};" +
                  "importScripts('" + base + "js/monaco/vs/base/worker/workerMain.js');";
        workerBlob = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
        return workerBlob;
    }

    function loadMonaco() {
        if (loading) { return loading; }
        loading = new Promise(function (resolve, reject) {
            if (window.monaco && window.monaco.editor) { return resolve(); }
            if (typeof require !== "function" || !require.config) {
                return reject(new Error("Monaco's AMD loader (js/monaco/vs/loader.js) is not loaded"));
            }
            window.MonacoEnvironment = { getWorkerUrl: workerUrl };
            require.config({ paths: { vs: "js/monaco/vs" } });
            require(["vs/editor/editor.main"], function () { resolve(); }, reject);
        });
        return loading;
    }

    // Approximates the Monokai palette students have been looking at in Ace,
    // so the switch doesn't feel like a different product.
    function defineThemes() {
        monaco.editor.defineTheme(THEME_DARK, {
            base: "vs-dark",
            inherit: true,
            rules: [
                { token: "", foreground: "f8f8f2", background: "272822" },
                { token: "comment", foreground: "75715e" },
                { token: "string", foreground: "e6db74" },
                { token: "number", foreground: "ae81ff" },
                { token: "keyword", foreground: "f92672" },
                { token: "operator", foreground: "f92672" },
                { token: "identifier", foreground: "f8f8f2" },
                { token: "type", foreground: "66d9ef", fontStyle: "italic" },
                { token: "delimiter", foreground: "f8f8f2" }
            ],
            colors: {
                "editor.background": "#272822",
                "editor.foreground": "#f8f8f2",
                "editor.lineHighlightBackground": "#3e3d32",
                "editorLineNumber.foreground": "#90908a",
                "editorCursor.foreground": "#f8f8f0",
                "editor.selectionBackground": "#49483e"
            }
        });
    }

    return {
        create: function (containerId, opts) {
            return loadMonaco().then(function () {
                var host = document.getElementById(containerId);

                // Ace adopted the container's text as its initial document.
                // Monaco replaces the container's content instead, so read the
                // placeholder out first or it renders behind the editor forever.
                var seed = typeof opts.value === "string" ? opts.value : host.textContent;
                if (seed) { seed = seed.replace(/^\n/, "").replace(/\s+$/, ""); }
                host.textContent = "";

                var mount = document.createElement("div");
                mount.id = "monacoMount";
                mount.style.width = "100%";
                mount.style.height = "100%";
                host.appendChild(mount);

                defineThemes();
                ed = monaco.editor.create(mount, {
                    value: seed || "",
                    language: "python",
                    theme: opts.theme === "light" ? THEME_LIGHT : THEME_DARK,
                    // Monaco wants pixels; 12pt is about 16px.
                    fontSize: 16,
                    // Monaco re-measures on its own ResizeObserver. It still
                    // needs an explicit layout() after setDisplayMode
                    // re-parents #editor - a detached container measures 0x0.
                    automaticLayout: true,
                    lineNumbersMinChars: 4,
                    scrollBeyondLastLine: true,
                    renderLineHighlight: "all",
                    minimap: { enabled: false },
                    // The glyph margin holds breakpoints; it appears when
                    // setBreakpointsEnabled(true) is called.
                    glyphMargin: false,
                    readOnly: !!opts.readOnly
                });

                model = ed.getModel();
                // Keep getValue() free of \r\n. run_lexer() and the recorded
                // conformance goldens both assume \n.
                model.setEOL(monaco.editor.EndOfLineSequence.LF);
                stepDecorations = ed.createDecorationsCollection();
                breakpointDecorations = ed.createDecorationsCollection();
                hintDecorations = ed.createDecorationsCollection();

                // Click the margin to the left of a line number to toggle a
                // breakpoint; hovering shows a faint dot where one would go.
                ed.onMouseDown(function (e) {
                    if (!breakpointsEnabled || !e.target || !e.target.position) { return; }
                    if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                        toggleBreakpoint(e.target.position.lineNumber);
                        hintDecorations.clear();
                    }
                });
                ed.onMouseMove(function (e) {
                    if (!breakpointsEnabled) { return; }
                    var t = e.target;
                    var line = t && t.position && t.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
                        ? t.position.lineNumber : null;
                    hintDecorations.set(line !== null && breakpointLines().indexOf(line) < 0 ? [{
                        range: new monaco.Range(line, 1, line, 1),
                        options: { glyphMarginClassName: "breakpoint-hint" }
                    }] : []);
                });
                ed.onMouseLeave(function () { hintDecorations.clear(); });
                return ed;
            });
        },

        getValue: function () {
            return ed.getValue();
        },

        setValue: function (text) {
            // model.setValue rather than editor.setValue: the latter pushes an
            // undo stop, so Ctrl+Z after loading a project would bring back the
            // previous file.
            model.setValue(text);
            model.setEOL(monaco.editor.EndOfLineSequence.LF);
            ed.setPosition({ lineNumber: 1, column: 1 });
            ed.setScrollPosition({ scrollTop: 0 });
        },

        revealLine: function (lineno) {
            ed.revealLineInCenterIfOutsideViewport(lineno);
        },

        setStepLine: function (lineno) {
            ed.revealLineInCenterIfOutsideViewport(lineno);
            stepDecorations.set([{
                range: new monaco.Range(lineno, 1, lineno, 1),
                options: { isWholeLine: true, className: "step-line" }
            }]);
        },

        clearStepLine: function () {
            if (stepDecorations) { stepDecorations.clear(); }
        },

        setBreakpointsEnabled: function (enabled) {
            breakpointsEnabled = enabled;
            ed.updateOptions({ glyphMargin: enabled });
            if (!enabled) {
                breakpointDecorations.clear();
                hintDecorations.clear();
            }
        },

        getBreakpoints: function () {
            return breakpointLines();
        },

        setBreakpoints: function (lines) {
            setBreakpointLines(lines);
        },

        setReadOnly: function (readOnly) {
            ed.updateOptions({ readOnly: readOnly });
        },

        setTheme: function (theme) {
            // Monaco's setTheme is global rather than per-instance. There is
            // only ever one editor on this page.
            monaco.editor.setTheme(theme === "light" ? THEME_LIGHT : THEME_DARK);
        },

        layout: function () {
            if (ed) { ed.layout(); }
        },

        dispose: function () {
            try {
                if (stepDecorations) { stepDecorations.clear(); }
                if (breakpointDecorations) { breakpointDecorations.clear(); }
                if (hintDecorations) { hintDecorations.clear(); }
                if (ed) { ed.dispose(); }
                if (model && !model.isDisposed()) { model.dispose(); }
                if (workerBlob) { URL.revokeObjectURL(workerBlob); }
            } catch (e) { /* nothing useful to do while tearing down */ }
            ed = null; model = null; stepDecorations = null; workerBlob = null;
            breakpointDecorations = null; hintDecorations = null;
        },

        registerCompletions: function (fn) {
            completionFn = fn;
            monaco.languages.registerCompletionItemProvider("python", {
                provideCompletionItems: function (m, position) {
                    var words = completionFn ? completionFn(m.getValue()) : null;
                    if (!words) { return { suggestions: [] }; }
                    var word = m.getWordUntilPosition(position);
                    var range = {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endColumn: word.endColumn
                    };
                    return {
                        suggestions: words.map(function (w) {
                            return {
                                label: w.caption || w.value,
                                insertText: w.value,
                                detail: w.meta,
                                kind: monaco.languages.CompletionItemKind.Function,
                                range: range
                            };
                        })
                    };
                }
            });
        }
    };
})();
