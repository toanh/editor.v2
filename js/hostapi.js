// Registry for the Python-visible names this page provides.
//
// console.js owns the DOM side of the classroom API - console styling, images,
// buttons, sounds, the webcam, Philips Hue, the spinner. Those names have to
// end up as Python builtins, but *how* they are bound differs per interpreter:
// Skulpt wants Sk.builtin.sk_method wrappers, Pyodide wants a JS module plus a
// Python shim. So console.js declares them here, runtime-neutrally, and the
// active runtime backend drains the registry in its own way.
//
// The important property for the Pyodide migration is that declaring is now
// separate from binding. console.js used to bind at script-parse time, which
// only works because Skulpt loads synchronously; Pyodide does not.

var Host = (function () {
    var entries = [];

    function add(entry) {
        entries.push(entry);
        return entry;
    }

    return {
        // A plain value - the colour and style escapes.
        constant: function (name, value) {
            add({ kind: "constant", name: name, value: value });
        },

        // A function with argument metadata, so a backend can build a real
        // Python signature with named arguments and defaults.
        //   meta: { namedArgs: [...], defaults: [...], textsig: "...", doc: "..." }
        method: function (name, fn, meta) {
            add({ kind: "method", name: name, fn: fn, meta: meta || {} });
        },

        // A function bound with no wrapper at all: arguments arrive as whatever
        // the interpreter passes, and the implementation unwraps them itself.
        // This is how console.js has always registered these particular ones.
        raw: function (name, fn) {
            add({ kind: "raw", name: name, fn: fn });
        },

        // A second name for an already-declared entry.
        alias: function (name, target) {
            add({ kind: "alias", name: name, target: target });
        },

        list: function () {
            return entries.slice();
        },

        // Hand everything to the active runtime backend. Aliases resolve
        // against what the backend has already bound, so declaration order
        // matters: declare the target before the alias.
        installInto: function (backend) {
            for (var i = 0; i < entries.length; i++) {
                backend.installHostName(entries[i]);
            }
            return entries.length;
        }
    };
})();
