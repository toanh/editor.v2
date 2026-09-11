// Canvas engine for builtin PyAngelo - the Processing-flavoured API that lives
// in the fork's src/builtin_pyangelo.js and is registered as *globals* rather
// than a module, so a student calls background() and circle() with no import.
//
// This is the second, entirely separate PyAngelo in the product. It is not the
// `from pyangelo import *` module (js/pyangelo-host.js): different canvas,
// different colour constants, different everything. See "Two different PyAngelo
// APIs" in CLAUDE.md before assuming anything carries over.
//
//   this one          #canvas, inside a JSFrame floating window
//   the module        #pyangelo, static in editor.html
//
// The fork's file is 1957 lines, but most of that is Skulpt argument checking
// and sk_method registration. The drawing itself is thin canvas work, and it is
// what lives here. Argument defaults are applied on the Python side.

var PyAngeloBuiltinHost = (function () {
    var canvas = null;
    var ctx = null;
    var consoleEl = null;

    var doFill = true;
    var doStroke = true;
    var fillStates = [];
    var strokeStates = [];
    var vertices = [];
    var images = {};
    var sounds = {};
    var keys = {};
    var keyWasPressed = {};

    // Modes. The numeric values are the fork's and are visible to Python as
    // CARTESIAN, DEGREES, CORNER and so on - see pyangelo_builtins.py.
    var CARTESIAN = 1, JAVASCRIPT = 2;
    var RADIANS = 1, DEGREES = 2;
    var CORNER = 1, CORNERS = 2, CENTER = 3;
    var CLOSE = 1;

    var yAxisMode = JAVASCRIPT;
    var angleModeValue = RADIANS;
    var rectModeValue = CORNER;
    var circleModeValue = CENTER;

    var textColour = "rgba(248, 248, 242, 1)";
    var highlightColour = "rgba(40, 42, 54, 1)";
    var textSize = "16px";

    var listeners = [];
    var onMouse = null;    // Python callback, so mouseX/mouseY stay live

    // The fork's palette, by index. Note the `default:` sits in the *middle* of
    // its switch - legal JavaScript, and it does behave correctly, but it is
    // why GREY/GRAY/DEFAULT and anything unrecognised all come out grey.
    var RGB = {
        0:  "rgba(181, 137, 0, 1)",     // YELLOW
        1:  "rgba(203, 75, 22, 1)",     // ORANGE
        2:  "rgba(220, 50, 47, 1)",     // RED
        3:  "rgba(211, 54, 130, 1)",    // MAGENTA
        4:  "rgba(108, 113, 196, 1)",   // VIOLET
        5:  "rgba(38, 139, 210, 1)",    // BLUE
        6:  "rgba(42, 161, 152, 1)",    // CYAN
        7:  "rgba(133, 153, 0, 1)",     // GREEN
        8:  "rgba(253, 246, 227, 1)",   // WHITE
        10: "rgba(0, 0, 0, 1)",         // BLACK
        11: "rgba(40, 42, 54, 1)",      // DRACULA_BACKGROUND
        12: "rgba(68, 71, 90, 1)",      // DRACULA_CURRENT_LINE
        13: "rgba(68, 71, 90, 1)",      // DRACULA_SELECTION
        14: "rgba(248, 248, 242, 1)",   // DRACULA_FOREGROUND
        15: "rgba(98, 114, 164, 1)",    // DRACULA_COMMENT
        16: "rgba(139, 233, 253, 1)",   // DRACULA_CYAN
        17: "rgba(80, 250, 123, 1)",    // DRACULA_GREEN
        18: "rgba(255, 184, 108, 1)",   // DRACULA_ORANGE
        19: "rgba(255, 121, 198, 1)",   // DRACULA_PINK
        20: "rgba(189, 147, 249, 1)",   // DRACULA_PURPLE
        21: "rgba(255, 85, 85, 1)",     // DRACULA_RED
        22: "rgba(241, 250, 140, 1)",   // DRACULA_YELLOW
        23: "rgba(75, 0, 130, 1)",      // INDIGO
        24: "rgba(64, 64, 64, 1)",      // DARK_GREY / DARK_GRAY
        25: "rgba(64, 0, 0, 1)",        // DARK_RED
        26: "rgba(0, 0, 64, 1)",        // DARK_BLUE
        27: "rgba(0, 64, 0, 1)",        // DARK_GREEN
        28: "rgba(192, 0, 0, 1)",       // LIGHT_RED
        29: "rgba(0, 0, 192, 1)",       // LIGHT_BLUE
        30: "rgba(0, 192, 0, 1)",       // LIGHT_GREEN
        31: "rgba(255, 192, 203, 1)"    // PINK
    };
    var GREY = "rgba(147, 161, 161, 1)";   // 9 = GRAY/GREY/DEFAULT, and the fallback

    function getRGB(colour) {
        return Object.prototype.hasOwnProperty.call(RGB, colour) ? RGB[colour] : GREY;
    }

    function rgba(r, g, b, a) { return "rgba(" + r + "," + g + "," + b + "," + a + ")"; }
    function toRadians(a) { return Math.PI / 180 * a; }
    function convertYToCartesian(y) { return canvas.height - y - 1; }

    function applyFill() { if (doFill) { ctx.fill(); } }
    function applyStroke() { if (doStroke) { ctx.stroke(); } }
    function applyFillAndStroke() { applyFill(); applyStroke(); }

    function on(target, type, fn) {
        target.addEventListener(type, fn, false);
        listeners.push([target, type, fn]);
    }

    function unbind() {
        listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], false); });
        listeners = [];
    }

    // The mouse callback is a Pyodide create_proxy, which is not freed by the
    // garbage collector on either side - it has to be destroyed explicitly or
    // every run leaks one.
    function releaseMouse() {
        if (onMouse && typeof onMouse.destroy === "function") {
            try { onMouse.destroy(); } catch (e) { /* already gone */ }
        }
        onMouse = null;
    }

    function reportMouse(ev) {
        if (!onMouse || !canvas) { return; }
        var r = canvas.getBoundingClientRect();
        var x = Math.round(ev.clientX - r.left);
        var y = Math.round(ev.clientY - r.top);
        if (yAxisMode === CARTESIAN) { y = convertYToCartesian(y); }
        // Straight into Python, so mouseX/mouseY read as live variables rather
        // than needing a function call - which is how the fork presents them.
        //
        // `undefined` for "not this one", NEVER `null`. Pyodide maps undefined
        // to None but null to a separate JsNull, which `is not None`: passing
        // null made every mousemove reset mouseIsPressed to False, and made a
        // press fail on int(JsNull) - silently, inside the catch below. The
        // pyangelo module hit exactly this; see CLAUDE.md.
        try { onMouse(x, y, undefined); } catch (e) { console.error(e); }
    }

    return {
        // Called by console.js's setCanvasSize, once the JSFrame exists.
        prepare: function (w, h, mode, mouseCallback) {
            canvas = document.getElementById("canvas");
            if (!canvas) { throw new Error("builtin PyAngelo canvas is missing"); }
            ctx = canvas.getContext("2d");
            consoleEl = document.getElementById("console");
            releaseMouse();
            onMouse = mouseCallback || null;

            unbind();
            doFill = true; doStroke = true;
            fillStates = []; strokeStates = []; vertices = [];
            keys = {}; keyWasPressed = {};
            angleModeValue = RADIANS;
            rectModeValue = CORNER;
            circleModeValue = CENTER;

            canvas.style.display = "block";
            canvas.width = w;
            canvas.height = h;
            canvas.focus();

            // The y-axis flip is a canvas transform, applied once. Everything
            // downstream then draws in whichever coordinate system was asked
            // for without knowing about it - except text and images, which
            // would come out mirrored and undo it locally.
            if (mode === CARTESIAN) {
                ctx.transform(1, 0, 0, -1, 0, h);
                yAxisMode = CARTESIAN;
            } else {
                ctx.transform(1, 0, 0, 1, 0, 0);
                yAxisMode = JAVASCRIPT;
            }

            on(document, "keydown", function (ev) {
                keys[ev.code] = true;
                keyWasPressed[ev.code] = true;
            });
            on(document, "keyup", function (ev) { keys[ev.code] = false; });
            on(canvas, "mousemove", function (ev) { ev.preventDefault(); reportMouse(ev); });
            on(canvas, "mousedown", function (ev) {
                ev.preventDefault();
                reportMouse(ev);
                if (onMouse) { try { onMouse(undefined, undefined, true); } catch (e) { console.error(e); } }
                canvas.focus();
            });
            on(canvas, "mouseup", function (ev) {
                ev.preventDefault();
                reportMouse(ev);
                if (onMouse) { try { onMouse(undefined, undefined, false); } catch (e) { console.error(e); } }
            });
            if (consoleEl) {
                on(consoleEl, "mousedown", function (ev) {
                    var el = document.getElementById("inputElement");
                    if (el) { el.focus(); ev.preventDefault(); }
                });
            }
            return { width: canvas.width, height: canvas.height };
        },

        stop: function () {
            unbind();
            releaseMouse();
            for (var s in sounds) { try { sounds[s].stop(); } catch (e) {} }
            sounds = {};
        },

        isReady: function () { return ctx !== null; },
        yAxisMode: function () { return yAxisMode; },

        // --- canvas -----------------------------------------------------------
        noCanvas: function () {
            if (!canvas) { return; }
            canvas.style.display = "none";
            canvas.width = 0;
            canvas.height = 0;
        },
        focusCanvas: function () { if (canvas) { canvas.focus(); } },
        setConsoleSize: function (size) {
            if (consoleEl) { consoleEl.style.height = size + "px"; }
        },

        // --- drawing ----------------------------------------------------------
        background: function (r, g, b, a) {
            var fs = ctx.fillStyle;
            ctx.fillStyle = rgba(r, g, b, a);
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = fs;
        },

        text: function (str, x, y, fontSize, fontName) {
            var fs = ctx.font;
            ctx.font = fontSize + "px " + fontName;
            ctx.textBaseline = "top";
            if (yAxisMode === CARTESIAN) {
                // Flip back locally, or the glyphs are upside down. The height
                // offset keeps the baseline where the caller asked for it.
                var m = ctx.measureText(str);
                var height = Math.abs(m.actualBoundingBoxAscent) +
                             Math.abs(m.actualBoundingBoxDescent);
                ctx.save();
                ctx.translate(x, y);
                ctx.transform(1, 0, 0, -1, 0, height);
                ctx.fillText(str, 0, 0);
                ctx.restore();
            } else {
                ctx.fillText(str, x, y);
            }
            ctx.font = fs;
        },

        // The whole metrics record, not just the width: sprite.py's TextSprite
        // sizes itself from actualBoundingBoxLeft/Right/Ascent/Descent. The
        // fields are copied out explicitly because TextMetrics exposes them as
        // prototype accessors, so anything that walks own properties sees none.
        measureText: function (str, fontSize, fontName) {
            ctx.save();
            ctx.font = fontSize + "px " + fontName;
            ctx.textBaseline = "top";
            var m = ctx.measureText(str);
            ctx.restore();
            return {
                width: m.width,
                actualBoundingBoxLeft: m.actualBoundingBoxLeft,
                actualBoundingBoxRight: m.actualBoundingBoxRight,
                actualBoundingBoxAscent: m.actualBoundingBoxAscent,
                actualBoundingBoxDescent: m.actualBoundingBoxDescent
            };
        },

        // --- state and transforms ---------------------------------------------
        saveState: function () {
            ctx.save();
            fillStates.push(doFill);
            strokeStates.push(doStroke);
        },
        restoreState: function () {
            ctx.restore();
            if (fillStates.length > 0) { doFill = fillStates.pop(); }
            if (strokeStates.length > 0) { doStroke = strokeStates.pop(); }
        },
        translate: function (x, y) { ctx.translate(x, y); },
        applyMatrix: function (a, b, c, d, e, f) { ctx.transform(a, b, c, d, e, f); },
        rotate: function (a) {
            ctx.rotate(angleModeValue === DEGREES ? toRadians(a) : a);
        },
        shearX: function (a) {
            var r = angleModeValue === DEGREES ? toRadians(a) : a;
            ctx.transform(1, 0, Math.tan(r), 1, 0, 0);
        },
        shearY: function (a) {
            var r = angleModeValue === DEGREES ? toRadians(a) : a;
            ctx.transform(1, Math.tan(r), 0, 1, 0, 0);
        },

        angleMode: function (m) {
            if (m === RADIANS || m === DEGREES) { angleModeValue = m; }
        },
        rectMode: function (m) {
            if (m === CORNER || m === CORNERS || m === CENTER) { rectModeValue = m; }
        },
        circleMode: function (m) {
            if (m === CORNER || m === CENTER) { circleModeValue = m; }
        },

        // --- fill and stroke ---------------------------------------------------
        fill: function (r, g, b, a) { ctx.fillStyle = rgba(r, g, b, a); doFill = true; },
        noFill: function () { doFill = false; },
        stroke: function (r, g, b, a) { ctx.strokeStyle = rgba(r, g, b, a); doStroke = true; },
        noStroke: function () { doStroke = false; },
        strokeWeight: function (w) { ctx.lineWidth = w; },

        // --- shapes ------------------------------------------------------------
        line: function (x1, y1, x2, y2) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            applyStroke();
        },
        circle: function (x, y, radius) {
            if (circleModeValue === CORNER) { x += radius; y += radius; }
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            applyFillAndStroke();
        },
        ellipse: function (x, y, rx, ry) {
            if (circleModeValue === CORNER) { x += rx; y += ry; }
            ctx.beginPath();
            ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
            applyFillAndStroke();
        },
        arc: function (x, y, rx, ry, start, end) {
            if (circleModeValue === CORNER) { x += rx; y += ry; }
            if (angleModeValue === DEGREES) { start = toRadians(start); end = toRadians(end); }
            ctx.beginPath();
            ctx.ellipse(x, y, rx, ry, 0, start, end);
            applyFillAndStroke();
        },
        triangle: function (x1, y1, x2, y2, x3, y3) {
            ctx.beginPath();
            ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
            ctx.closePath();
            applyFillAndStroke();
        },
        quad: function (x1, y1, x2, y2, x3, y3, x4, y4) {
            ctx.beginPath();
            ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
            ctx.closePath();
            applyFillAndStroke();
        },
        rect: function (x, y, w, h) {
            if (rectModeValue === CORNERS) { w = w - x; h = h - y; }
            else if (rectModeValue === CENTER) { x = x - w * 0.5; y = y - h * 0.5; }
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            applyFillAndStroke();
        },
        point: function (x, y) {
            if (!doStroke) { return; }
            // A point is drawn in the *stroke* colour but by filling, so the
            // fill style is swapped in and put back.
            var s = ctx.strokeStyle;
            var f = ctx.fillStyle;
            ctx.fillStyle = s;
            ctx.beginPath();
            if (ctx.lineWidth > 1) {
                ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
            } else {
                ctx.rect(x, y, 1, 1);
            }
            applyFillAndStroke();
            ctx.fillStyle = f;
        },

        beginShape: function () { vertices = []; },
        vertex: function (x, y) { vertices.push([x, y]); },
        endShape: function (mode) {
            if (vertices.length === 0) { return; }
            if (vertices.length === 1) {
                this.point(vertices[0][0], vertices[0][1]);
                vertices = [];
                return;
            }
            ctx.beginPath();
            ctx.moveTo(vertices[0][0], vertices[0][1]);
            for (var i = 1; i < vertices.length; i++) {
                ctx.lineTo(vertices[i][0], vertices[i][1]);
            }
            if (mode === CLOSE) { ctx.closePath(); }
            applyFillAndStroke();
            vertices = [];
        },

        // --- images -------------------------------------------------------------
        // Resolves with {file, width, height}; the Python Image class holds those.
        loadImage: function (file) {
            return new Promise(function (resolve, reject) {
                var img = new Image();
                img.onload = function () {
                    images[file] = img;
                    resolve({ file: file, width: img.naturalWidth, height: img.naturalHeight });
                };
                img.onerror = function () {
                    reject(new Error("Could not load the image. Check your have uploaded " +
                                     "the file " + file + " to your sketch"));
                };
                img.src = file;
            });
        },
        hasImage: function (file) {
            return Object.prototype.hasOwnProperty.call(images, file);
        },
        drawImage: function (file, x, y, width, height, opacity) {
            var img = images[file];
            var ga = ctx.globalAlpha;
            if (opacity !== null && opacity !== undefined) {
                ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
            }
            if (yAxisMode === CARTESIAN) {
                ctx.save();
                ctx.translate(x, y);
                ctx.transform(1, 0, 0, -1, 0, height);
                ctx.drawImage(img, 0, 0, width, height);
                ctx.restore();
            } else {
                ctx.drawImage(img, x, y, width, height);
            }
            ctx.globalAlpha = ga;
        },

        getPixelColour: function (x, y) {
            if (yAxisMode === CARTESIAN) { y = convertYToCartesian(y); }
            var d = ctx.getImageData(x, y, 1, 1).data;
            return [d[0], d[1], d[2], d[3]];
        },

        // --- sound ---------------------------------------------------------------
        // Howler is already bundled for the classroom sound API.
        loadSound: function (filename) {
            return new Promise(function (resolve, reject) {
                if (typeof Howl !== "function") {
                    return reject(new Error("Sound support is not available"));
                }
                var sound = new Howl({
                    src: [filename],
                    onload: function () { sounds[filename] = sound; resolve(filename); },
                    onloaderror: function () {
                        reject(new Error("The sound could not be loaded. Check your have " +
                                         "uploaded the sound " + filename + " to your sketch"));
                    }
                });
            });
        },
        hasSound: function (name) {
            return Object.prototype.hasOwnProperty.call(sounds, name);
        },
        playSound: function (name, loop, volume) {
            sounds[name].loop(loop);
            sounds[name].volume(volume);
            sounds[name].play();
        },
        stopSound: function (name) { sounds[name].stop(); },
        pauseSound: function (name) { sounds[name].pause(); },
        stopAllSounds: function () {
            for (var s in sounds) { sounds[s].stop(); }
        },

        // --- keys -----------------------------------------------------------------
        isKeyPressed: function (code) { return keys[code] === true; },
        wasKeyPressed: function (code) {
            // Latches: reading one clears it, so a press is delivered once.
            if (keyWasPressed[code]) { keyWasPressed[code] = false; return true; }
            return false;
        },

        // --- console styling --------------------------------------------------------
        setTextSize: function (size) { textSize = size + "px"; },
        setTextColour: function (colour) { textColour = getRGB(colour); },
        setHighlightColour: function (colour) { highlightColour = getRGB(colour); },
        clearConsole: function (colour) {
            if (!consoleEl) { return; }
            consoleEl.innerHTML = "";
            var rgb = getRGB(colour);
            consoleEl.style.backgroundColor = rgb;
            highlightColour = rgb;
        },
        getRGB: getRGB
    };
})();
