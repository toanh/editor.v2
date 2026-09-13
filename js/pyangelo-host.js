// Canvas backend for the `from pyangelo import *` module, ported from the
// Skulpt fork's src/lib/pyangelo.js with the Skulpt wrappers removed.
//
// The architecture is retained-mode and must stay that way: drawing calls push
// onto a command queue, refresh() swaps that queue into the active one, and a
// requestAnimationFrame loop drains the active queue each frame. Programs such
// as demos/snake.py depend on it - clearScreen() implicitly calls refresh(),
// which is what makes a frame appear.
//
// Y is Cartesian throughout: _convY(y) = canvas.height - y. That is why rects
// are drawn with a negative height.

var PyAngeloHost = (function () {
    var canvas = null;
    var ctx = null;
    var commands = [];
    var activeCommands = null;
    var rafHandle = null;

    var keysDown = {};
    var keysUp = {};
    var mouseDown = [];
    var mousePos = [0, 0];
    var mouseClicks = [];
    var images = {};
    var startTime = null;

    // Keyed exactly as the fork keyed them: the base colours by console.js's
    // pseudo-ANSI escape strings (the same values students get from WHITE,
    // RED and so on), the later additions by plain numbers.
    //
    // The fork also registers VIOLET and GREY, but console.js never defines
    // those names, so both collapsed onto a single `undefined` key and neither
    // worked. No curriculum file uses them; reproduced here by omission.
    var ESC = {
        BLACK: "[ 38;2;0;0;0 m",
        WHITE: "[ 38;2;255;255;255 m",
        RED: "[ 38;2;255;0;0 m",
        GREEN: "[ 38;2;0;255;0 m",
        YELLOW: "[ 38;2;255;255;0 m",
        BLUE: "[ 38;2;0;0;255 m",
        ORANGE: "[ 38;2;255;165;0 m",
        CYAN: "[ 38;2;0;255;255 m"
    };

    var COLOURS = {};
    COLOURS[ESC.BLACK] = "rgba(0, 0, 0, 1)";
    COLOURS[ESC.WHITE] = "rgba(255, 255, 255, 1)";
    COLOURS[ESC.RED] = "rgba(255, 0, 0, 1)";
    COLOURS[ESC.GREEN] = "rgba(0, 255, 0, 1)";
    COLOURS[ESC.YELLOW] = "rgba(255, 255, 0, 1)";
    COLOURS[ESC.BLUE] = "rgba(0, 0, 255, 1)";
    COLOURS[ESC.ORANGE] = "rgba(203, 75, 22, 1)";
    COLOURS[ESC.CYAN] = "rgba(42, 161, 152, 1)";
    COLOURS[23] = "rgba(75, 0, 130, 1)";     // INDIGO
    COLOURS[24] = "rgba(64, 64, 64, 1)";     // DARK_GREY / DARK_GRAY
    COLOURS[25] = "rgba(64, 0, 0, 1)";       // DARK_RED
    COLOURS[26] = "rgba(0, 0, 64, 1)";       // DARK_BLUE
    COLOURS[27] = "rgba(0, 64, 0, 1)";       // DARK_GREEN
    COLOURS[28] = "rgba(192, 0, 0, 1)";      // LIGHT_RED
    COLOURS[29] = "rgba(0, 0, 192, 1)";      // LIGHT_BLUE
    COLOURS[30] = "rgba(0, 192, 0, 1)";      // LIGHT_GREEN
    COLOURS[31] = "rgba(192, 192, 192, 1)";  // LIGHT_GREY
    COLOURS[32] = "rgba(255, 192, 203, 1)";  // PINK
    // The fork's VIOLET and GREY keys: both names are undefined in console.js,
    // so both assignments wrote to the key "undefined", GREY last. It matters,
    // because an omitted colour looks that key up - see colour() below.
    COLOURS["undefined"] = "rgba(127, 127, 127, 1)";

    function convY(y) { return canvas.height - y; }

    // The fork's getColour(color, defaultCol, b, a), reproduced quirk for
    // quirk, because the curriculum's pictures were made with its output. An
    // earlier version of this port simplified it to "named colour, else a CSS
    // string, else white" - which painted every numeric colour white:
    // clearScreen(0, 0, 0, 1) cleared to white, and playerSelection's green box
    // was a white one. The difference hid for months behind animation in the
    // one pixel-compared program that used it.
    //
    //  * A name from the table is checked first, so a number that happens to be
    //    a key wins: clearScreen(25, 0, 0, 1) is DARK_RED, not rgb(25, 0, 0).
    //  * Anything else is concatenated into "rgba(c,g,b,a)". With all four
    //    numbers that is a real colour. drawText and printAt pass only the first,
    //    so a number there builds "rgba(255,undefined,undefined,undefined)",
    //    which the canvas rejects - and a rejected fillStyle leaves the previous
    //    one in place. demos/pong.py's "PONG" title is drawn exactly that way.
    //  * An omitted colour reads COLOURS[undefined], because the fork's
    //    `defaultCol = mod.WHITE` names something the module never defines. So
    //    an uncoloured drawText or fillRect is grey, not white.
    //  * A CSS string such as "#ff0000" is not in the table and builds an
    //    invalid rgba() too. Skulpt strings are objects, so the fork's
    //    `typeof color === "string"` branch could never fire. No curriculum file
    //    passes one.
    //
    // A Python None arrives here as undefined, the same as an omitted argument
    // did in Skulpt.
    function colour(c, g, b, a) {
        var defaultCol = g;
        if (c === undefined) { return COLOURS[defaultCol]; }
        if (c in COLOURS) { return COLOURS[c]; }
        return "rgba(" + c + "," + defaultCol + "," + b + "," + a + ")";
    }

    // --- painters, run from the animation frame -----------------------------
    function _clearScreen(a) { ctx.fillStyle = a.fillStyle; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    function _drawText(a) { ctx.fillStyle = a.fillStyle; ctx.font = a.font; ctx.fillText(a.text, a.x, convY(a.y)); }
    function _drawImage(a) {
        ctx.save();
        ctx.globalAlpha = a.opacity;
        ctx.drawImage(a.image, a.x, convY(a.y) - a.height, a.width, a.height);
        ctx.restore();
    }
    function _drawRect(a) {
        ctx.lineWidth = a.lineWidth; ctx.strokeStyle = a.strokeStyle;
        ctx.beginPath(); ctx.rect(a.x, convY(a.y), a.width, -a.height); ctx.stroke();
    }
    function _drawLine(a) {
        ctx.lineWidth = a.lineWidth; ctx.strokeStyle = a.strokeStyle;
        ctx.beginPath(); ctx.moveTo(a.x1, convY(a.y1)); ctx.lineTo(a.x2, convY(a.y2)); ctx.stroke();
    }
    function _fillRect(a) {
        ctx.fillStyle = a.fillStyle; ctx.fillRect(a.x, convY(a.y), a.width, -a.height);
    }

    function render() {
        if (activeCommands != null) {
            while (activeCommands.length > 0) {
                var c = activeCommands.shift();
                c[0](c[1]);
            }
        }
        rafHandle = window.requestAnimationFrame(render);
        activeCommands = null;
    }

    function refresh() {
        activeCommands = commands.slice();
        commands = [];
        // drop clicks older than the threshold (the fork's comment says one
        // second, its code says 100ms; the code is what shipped)
        while (mouseClicks.length > 0 && (Date.now() - mouseClicks[0][0]) > 100) {
            mouseClicks.shift();
        }
    }

    function canvasPoint(e) {
        var rect = canvas.getBoundingClientRect();
        var sx = canvas.width / rect.width;
        var sy = canvas.height / rect.height;
        return [Math.round((e.clientX - rect.left) * sx),
                convY(Math.round((e.clientY - rect.top) * sy))];
    }

    var listeners = [];
    function on(target, type, fn) {
        target.addEventListener(type, fn, false);
        listeners.push([target, type, fn]);
    }

    return {
        // Called once per run, before the program starts.
        start: function () {
            canvas = document.getElementById("pyangelo");
            ctx = canvas.getContext("2d");
            // The fork sets this at import time. It matters more than it looks:
            // drawText assigns ctx.font unconditionally, so a program passing a
            // malformed size - "10 px consolas", with a space, appears in the
            // curriculum - leaves the previous font in place. Without this the
            // fallback is the canvas default of 10px sans-serif and the text
            // comes out a third of the size.
            ctx.font = "30px Consolas";
            commands = []; activeCommands = null;
            keysDown = {}; keysUp = {};
            mouseDown = []; mousePos = [0, 0]; mouseClicks = [];
            startTime = Date.now();

            on(canvas, "keydown", function (e) { keysDown[e.key] = true; delete keysUp[e.key]; });
            on(canvas, "keyup", function (e) { keysUp[e.key] = true; delete keysDown[e.key]; });
            on(canvas, "mousedown", function (e) { mouseDown = canvasPoint(e); });
            on(canvas, "mouseup", function () { mouseDown = []; });
            on(canvas, "mousemove", function (e) { mousePos = canvasPoint(e); });
            on(canvas, "click", function (e) { mouseClicks.push([Date.now()].concat(canvasPoint(e))); });

            rafHandle = window.requestAnimationFrame(render);
            return { width: canvas.width, height: canvas.height };
        },

        stop: function () {
            if (rafHandle !== null) { window.cancelAnimationFrame(rafHandle); rafHandle = null; }
            listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], false); });
            listeners = [];
            commands = []; activeCommands = null;
        },

        timeElapsed: function () {
            var now = Date.now();
            var result = (now - startTime) / 1000;
            startTime = now;
            return result;
        },

        refresh: refresh,

        clearScreen: function (c, g, b, a) {
            // clearScreen flushes the previous frame itself - this is what makes
            // a program that never calls refresh() still animate
            refresh();
            // The fork meant to default to black here, but its guard compares g
            // with the *string* "undefined", so every call takes the four-argument
            // path. No curriculum file calls clearScreen() bare.
            commands.push([_clearScreen, { fillStyle: colour(c, g, b, a) }]);
        },

        drawText: function (text, x, y, font, c) {
            commands.push([_drawText, {
                text: String(text), x: x, y: y,
                // The fork sets a "32px Consolas" default and then unconditionally
                // overwrites it with the argument, so an omitted font leaves the
                // canvas font untouched. Every curriculum call passes one.
                font: font,
                fillStyle: colour(c)
            }]);
        },

        printAt: function (text, col, row, c) {
            commands.push([_drawText, {
                text: String(text), x: col * 10, y: row * 20,
                font: "20px monospace", fillStyle: colour(c)
            }]);
        },

        drawLine: function (x1, y1, x2, y2, lineWidth, c, g, b, a) {
            commands.push([_drawLine, {
                x1: x1, y1: y1, x2: x2, y2: y2,
                lineWidth: lineWidth === undefined ? 1 : lineWidth,
                strokeStyle: colour(c, g, b, a)
            }]);
        },

        drawRect: function (x, y, w, h, lineWidth, c, g, b, a) {
            commands.push([_drawRect, {
                x: x, y: y, width: w, height: h,
                lineWidth: lineWidth === undefined ? 1 : lineWidth,
                strokeStyle: colour(c, g, b, a)
            }]);
        },

        fillRect: function (x, y, w, h, c, g, b, a) {
            commands.push([_fillRect, { x: x, y: y, width: w, height: h, fillStyle: colour(c, g, b, a) }]);
        },

        // Resolves once the image is decoded; the Python side blocks on it, as
        // Skulpt did by turning the same promise into a suspension.
        drawImage: function (url, x, y, w, h, opacity) {
            return new Promise(function (resolve) {
                function queue(img) {
                    commands.push([_drawImage, {
                        image: img, x: x, y: y,
                        width: w === undefined ? img.naturalWidth : w,
                        height: h === undefined ? img.naturalHeight : h,
                        opacity: opacity === undefined ? 1.0 : opacity
                    }]);
                    resolve(true);
                }
                if (images[url]) { return queue(images[url]); }
                var img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = function () { images[url] = img; queue(img); };
                img.onerror = function () { resolve(false); };
                img.src = url;
            });
        },

        isKeyPressed: function (key) { return key in keysDown; },
        isKeyReleased: function (key) {
            var r = key in keysUp;
            if (r) { delete keysUp[key]; }
            return r;
        },
        isMouseClicked: function () {
            var clicked = mouseClicks.length > 0;
            mouseClicks = [];
            return clicked;
        },
        isMousePressed: function () { return mouseDown.length > 0; },
        getMouseDownPosition: function () {
            if (mouseDown.length > 0) { var p = mouseDown; mouseDown = []; return p; }
            // undefined, not null: Pyodide maps undefined to Python None, but
            // maps null to a distinct JsNull singleton that `is None` does not
            // match. Returning null here made every mouse-driven program die
            // with "'JsNull' object is not subscriptable".
            return undefined;
        },
        getMousePosition: function () { return mousePos; },

        overlaps: function (x1, y1, w1, h1, x2, y2, w2, h2) {
            return !(x1 + w1 < x2 || x2 + w2 < x1 || y1 + h1 < y2 || y2 + h2 < y1);
        },

        getStringWidth: function (text, font) {
            var c = document.createElement("canvas").getContext("2d");
            c.font = font;
            return Math.round(c.measureText(String(text)).width);
        }
    };
})();
