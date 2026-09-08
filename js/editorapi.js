// Editor facade.
//
// Everything in editor.js talks to `Editor`, never to Ace or Monaco directly.
// A backend (js/editor-ace.js, later js/editor-monaco.js) registers itself via
// Editor.use() before Editor.create() is called.
//
// Theme names are 'dark' | 'light' rather than an Ace/Monaco theme id, so the
// call sites don't have to know which backend is installed.

var Editor = (function () {
    var backend = null;

    function required() {
        if (backend === null) {
            throw "No editor backend installed - call Editor.use() first.";
        }
        return backend;
    }

    return {
        use: function (impl) {
            backend = impl;
        },

        // containerId: id of the div to mount into.
        // opts: { value, theme, fontSize, readOnly }
        // Always a promise: Monaco's AMD loader is asynchronous, Ace is not.
        create: function (containerId, opts) {
            return Promise.resolve(required().create(containerId, opts || {}));
        },

        getValue: function () {
            return required().getValue();
        },

        // Replaces the document and puts the cursor at the top, selecting
        // nothing. This is Ace's setValue(text, -1).
        setValue: function (text) {
            return required().setValue(text);
        },

        // Scroll a 1-based line into view without highlighting it.
        revealLine: function (lineno) {
            return required().revealLine(lineno);
        },

        // Mark a 1-based line as the current step-debugger line and scroll to
        // it. Replaces the stylesheet-rule surgery the step debugger used to
        // do against the ace-monokai theme.
        setStepLine: function (lineno) {
            return required().setStepLine(lineno);
        },

        clearStepLine: function () {
            return required().clearStepLine();
        },

        setReadOnly: function (readOnly) {
            return required().setReadOnly(readOnly);
        },

        // theme: 'dark' | 'light'
        setTheme: function (theme) {
            return required().setTheme(theme);
        },

        // Re-measure after the container is resized or re-parented.
        layout: function () {
            return required().layout();
        },

        // fn(code) -> [{ caption, value, meta }], or null for no suggestions.
        registerCompletions: function (fn) {
            return required().registerCompletions(fn);
        },

        // Tear the editor down. The app never needs this - there is one editor
        // for the life of the page - but the conformance harness creates
        // hundreds in sequence, and an undisposed Monaco holds onto a worker
        // and its blob URL.
        dispose: function () {
            if (backend && backend.dispose) { backend.dispose(); }
        }
    };
})();
