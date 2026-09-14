// Ace backend for the Editor facade.
//
// This will be deleted once Monaco is the only editor; until then it keeps the
// current behaviour byte-for-byte, with one deliberate change: the step-line
// highlight is an Ace marker instead of CSS rules injected into the
// ace-monokai stylesheet. The old approach only ever matched the dark theme,
// so stepping in light mode showed no highlight at all.

var AceEditorBackend = (function () {
    var ed = null;
    var Range = null;
    var stepMarkerId = null;
    var completionFn = null;
    var breakpointsEnabled = false;

    // Ace is no longer in editor.html - Monaco is the editor now - so the
    // ?editor=ace escape hatch pulls it in on demand. Nobody pays for it
    // unless they ask for it.
    var ACE_FILES = [
        "js/ace.js?t=2",
        "js/ext-language_tools.js?t=4",
        "js/mode-properties.js?t=4",
        "js/theme-monokai.js?t=4",
        "js/theme-eclipse.js?t=4"
    ];

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement("script");
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error("failed to load " + src)); };
            document.head.appendChild(s);
        });
    }

    function loadAce() {
        if (typeof ace !== "undefined") { return Promise.resolve(); }
        // Sequentially: the extensions and themes register against ace.js.
        return ACE_FILES.reduce(function (chain, src) {
            return chain.then(function () { return loadScript(src); });
        }, Promise.resolve());
    }

    function clearStepMarker() {
        if (stepMarkerId !== null) {
            ed.session.removeMarker(stepMarkerId);
            stepMarkerId = null;
        }
    }

    return {
        create: function (containerId, opts) {
            var self = this;
            return loadAce().then(function () {
                ed = ace.edit(containerId);
                Range = ace.require("ace/range").Range;
                ace.require("ace/ext/language_tools");

                ed.session.setMode("ace/mode/python");
                ed.setOptions({
                    fontSize: opts.fontSize || "12pt",
                    fixedWidthGutter: true,
                    showPrintMargin: false,
                    scrollPastEnd: 0.5
                });
                ed.setHighlightActiveLine(true);
                self.setTheme(opts.theme || "dark");

                // Click a line number to toggle a breakpoint, using Ace's own
                // gutter breakpoints.
                ed.on("guttermousedown", function (e) {
                    if (!breakpointsEnabled) { return; }
                    var row = e.getDocumentPosition().row;
                    if (ed.session.getBreakpoints()[row]) {
                        ed.session.clearBreakpoint(row);
                    } else {
                        ed.session.setBreakpoint(row);
                    }
                    e.stop();
                });

                // Ace keeps breakpoints by row number and does not move them
                // when lines are inserted or removed above, so a breakpoint
                // would silently land on a different line. Shift them here.
                ed.session.on("change", function (delta) {
                    var shift = delta.end.row - delta.start.row;
                    if (!shift) { return; }
                    if (delta.action === "remove") { shift = -shift; }
                    var old = ed.session.getBreakpoints();
                    var moved = [];
                    for (var r in old) {
                        if (!old[r]) { continue; }
                        var row = Number(r);
                        moved.push(row > delta.start.row ? Math.max(delta.start.row, row + shift) : row);
                    }
                    ed.session.clearBreakpoints();
                    moved.forEach(function (row) { ed.session.setBreakpoint(row); });
                });

                if (typeof opts.value === "string") {
                    self.setValue(opts.value);
                }
                if (opts.readOnly) {
                    self.setReadOnly(true);
                }
                return ed;
            });
        },

        getValue: function () {
            return ed.getValue();
        },

        setValue: function (text) {
            ed.setValue(text, -1);
        },

        revealLine: function (lineno) {
            ed.gotoLine(lineno);
        },

        setStepLine: function (lineno) {
            clearStepMarker();
            ed.gotoLine(lineno);
            stepMarkerId = ed.session.addMarker(
                new Range(lineno - 1, 0, lineno - 1, 1),
                "step-line",
                "fullLine"
            );
        },

        clearStepLine: function () {
            clearStepMarker();
        },

        setBreakpointsEnabled: function (enabled) {
            breakpointsEnabled = enabled;
            if (!enabled) { ed.session.clearBreakpoints(); }
        },

        getBreakpoints: function () {
            var rows = ed.session.getBreakpoints();
            var lines = [];
            for (var r in rows) {
                if (rows[r]) { lines.push(Number(r) + 1); }
            }
            return lines.sort(function (a, b) { return a - b; });
        },

        setBreakpoints: function (lines) {
            ed.session.clearBreakpoints();
            lines.forEach(function (n) { ed.session.setBreakpoint(n - 1); });
        },

        setReadOnly: function (readOnly) {
            ed.setReadOnly(readOnly);
        },

        setTheme: function (theme) {
            ed.setTheme(theme === "light" ? "ace/theme/eclipse" : "ace/theme/monokai");
        },

        layout: function () {
            // Ace re-measures on window resize; setDisplayMode already fires a
            // synthetic resize after re-parenting, so there is nothing to do.
            if (ed) { ed.resize(); }
        },

        dispose: function () {
            try { if (ed) { ed.destroy(); } } catch (e) {}
            ed = null; stepMarkerId = null;
        },

        registerCompletions: function (fn) {
            completionFn = fn;
            ed.completers = [{
                getCompletions: function (editor, session, pos, prefix, callback) {
                    var words = completionFn ? completionFn(ed.getValue()) : null;
                    callback(null, words || []);
                }
            }];
        }
    };
})();
