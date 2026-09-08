// Canvas backend for `from turtle import *`.
//
// Pyodide's CPython has no browser turtle, and Skulpt's turtle.js is 2400 lines
// of promise-chained frame machinery welded to Sk.misceval. So this is written
// fresh - but the *rendering* is a faithful transcription of that file, because
// the curriculum's turtle pictures are the specification.
//
// Everything worth knowing about the geometry:
//
//   * The target is #turtleCanvas, a div console.js appends to the console.
//     Three stacked 500x500 canvases live inside it: background (z 1), the
//     drawing paper (z 2), and the turtle cursor (z 3). They are stacked with
//     a negative margin-top, not absolute positioning, so the inline-block
//     wrapper still snaps to their size.
//   * World coordinates are Cartesian and centred: (-250,-250) to (250,250).
//     The transform is scale(1,-1) then translate(250,-250), which puts turtle
//     (x,y) at device pixel (x+250, 250-y).
//   * lineScale is min(|xScale|,|yScale|), so pen size 1 is one device pixel
//     until setworldcoordinates() changes the scale.
//
// This file is drawing only. Frame pacing, state and the whole Python API are
// in js/py/turtle.py, which yields through the prelude's frameYield so Stop
// works the same way it does everywhere else.

var TurtleHost = (function () {
    var target = null;
    var bg = null, paper = null, sprites = null;
    var measurer = null;
    var fillBuf = [];
    var listeners = [];
    var timers = [];

    // Transcribed from src/lib/turtle.js. Every entry is a closed polygon in
    // turtle-local coordinates, drawn with x negated (see drawTurtle).
    var SHAPES = {
        arrow: [[-10, 0], [10, 0], [0, 10]],
        square: [[10, -10], [10, 10], [-10, 10], [-10, -10]],
        triangle: [[10, -5.77], [0, 11.55], [-10, -5.77]],
        classic: [[0, 0], [-5, -9], [0, -7], [5, -9]],
        turtle: [
            [0, 16], [-2, 14], [-1, 10], [-4, 7], [-7, 9], [-9, 8], [-6, 5], [-7, 1],
            [-5, -3], [-8, -6], [-6, -8], [-4, -5], [0, -7], [4, -5], [6, -8], [8, -6],
            [5, -3], [7, 1], [6, 5], [9, 8], [7, 9], [4, 7], [1, 10], [2, 14]
        ],
        circle: [
            [10, 0], [9.51, 3.09], [8.09, 5.88], [5.88, 8.09], [3.09, 9.51], [0, 10],
            [-3.09, 9.51], [-5.88, 8.09], [-8.09, 5.88], [-9.51, 3.09], [-10, 0],
            [-9.51, -3.09], [-8.09, -5.88], [-5.88, -8.09], [-3.09, -9.51], [-0, -10],
            [3.09, -9.51], [5.88, -8.09], [8.09, -5.88], [9.51, -3.09]
        ]
    };

    var world = { llx: -250, lly: -250, urx: 250, ury: 250, xScale: 1, yScale: -1, lineScale: 1 };
    var W = 500, H = 500;

    function setUpWorld(llx, lly, urx, ury) {
        world.llx = llx; world.lly = lly; world.urx = urx; world.ury = ury;
        world.xScale = (urx - llx) / W;
        world.yScale = -1 * (ury - lly) / H;
        world.lineScale = Math.min(Math.abs(world.xScale), Math.abs(world.yScale));
    }

    function clearLayer(ctx, color) {
        if (!ctx) { return; }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        } else {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
        ctx.restore();
    }

    // Clears the layer and re-establishes the world transform as its base
    // state, so every drawing helper can save()/restore() around itself.
    function applyWorld(ctx) {
        if (!ctx) { return; }
        clearLayer(ctx);
        ctx.restore();
        ctx.save();
        ctx.scale(1 / world.xScale, 1 / world.yScale);
        ctx.translate(-world.llx, -world.ury);
    }

    function createLayer(z) {
        var canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        canvas.style.position = "relative";
        canvas.style.display = "block";
        // The first canvas sits normally; each later one is pulled back over it.
        canvas.style.setProperty("margin-top", target.firstChild ? (-H) + "px" : "0");
        canvas.style.setProperty("z-index", z);
        target.appendChild(canvas);
        var ctx = canvas.getContext("2d");
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        applyWorld(ctx);
        return ctx;
    }

    function unbind() {
        listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], false); });
        listeners = [];
        timers.forEach(function (t) { window.clearTimeout(t); });
        timers = [];
    }

    function on(el, type, fn) {
        el.addEventListener(type, fn, false);
        listeners.push([el, type, fn]);
    }

    return {
        // Called once per run, from turtle.py's module body. showTurtle() is
        // console.js's own helper - the same one the Skulpt module calls - so
        // the div lands in the console at the same point in the output.
        start: function () {
            if (typeof showTurtle === "function") { showTurtle(); }
            target = document.getElementById("turtleCanvas");
            if (!target) { throw new Error("turtle canvas is missing"); }
            unbind();
            while (target.firstChild) { target.removeChild(target.firstChild); }
            if (!target.hasAttribute("tabindex")) { target.setAttribute("tabindex", 0); }
            W = 500; H = 500;
            setUpWorld(-W / 2, -H / 2, W / 2, H / 2);
            bg = createLayer(1);
            paper = createLayer(2);
            sprites = createLayer(3);
            fillBuf = [];
            return { width: W, height: H };
        },

        stop: function () { unbind(); },

        width: function () { return W; },
        height: function () { return H; },
        lineScale: function () { return world.lineScale; },

        setWorld: function (llx, lly, urx, ury) {
            setUpWorld(llx, lly, urx, ury);
            applyWorld(sprites);
            applyWorld(bg);
            applyWorld(paper);
        },

        // --- painting -------------------------------------------------------

        bgcolor: function (color) { clearLayer(bg, color); },

        clearPaper: function () { clearLayer(paper); },

        // One segment of a movement. beginPath is true only for the first
        // partial step, so the path stays open across the whole move and the
        // round joins line up - exactly as drawLine() in the fork does it.
        drawLine: function (fromX, fromY, toX, toY, beginPath, size, color) {
            if (beginPath) {
                paper.beginPath();
                paper.moveTo(fromX, fromY);
            }
            paper.lineWidth = size * world.lineScale;
            paper.strokeStyle = color;
            paper.lineTo(toX, toY);
            paper.stroke();
        },

        drawDot: function (x, y, size, color) {
            paper.beginPath();
            paper.moveTo(x, y);
            paper.arc(x, y, (size * world.lineScale) / 2, 0, 2 * Math.PI);
            paper.closePath();
            paper.fillStyle = color;
            paper.fill();
        },

        // The world transform has y growing upwards, so text has to be flipped
        // back or it renders mirrored.
        drawText: function (x, y, message, align, font, fill) {
            paper.save();
            if (font) { paper.font = font; }
            if (align && /^(left|right|center)$/.test(align)) { paper.textAlign = align; }
            paper.scale(1, -1);
            paper.fillStyle = fill;
            paper.fillText(String(message), x, -y);
            paper.restore();
        },

        measureText: function (message, font) {
            if (!measurer) { measurer = document.createElement("canvas").getContext("2d"); }
            if (font) { measurer.font = font; }
            return measurer.measureText(String(message)).width;
        },

        // --- fills ----------------------------------------------------------
        // The path is accumulated here rather than marshalled from Python at
        // the end, which keeps PyProxies out of the hot loop entirely.

        fillBegin: function (x, y) { fillBuf = [{ x: x, y: y, stroke: false }]; },

        fillPush: function (x, y, stroke, color, size) {
            fillBuf.push({ x: x, y: y, stroke: !!stroke, color: color, size: size });
        },

        // Fills the polygon, then re-strokes the pen-down segments on top -
        // otherwise the fill would swallow the outline it was drawn with.
        fillEnd: function (fillColor) {
            var path = fillBuf;
            fillBuf = [];
            if (!path.length) { return; }
            paper.save();
            paper.beginPath();
            paper.moveTo(path[0].x, path[0].y);
            for (var i = 1; i < path.length; i++) { paper.lineTo(path[i].x, path[i].y); }
            paper.closePath();
            paper.fillStyle = fillColor;
            paper.fill();
            for (i = 1; i < path.length; i++) {
                if (!path[i].stroke) { continue; }
                paper.beginPath();
                paper.moveTo(path[i - 1].x, path[i - 1].y);
                paper.lineWidth = path[i].size * world.lineScale;
                paper.strokeStyle = path[i].color;
                paper.lineTo(path[i].x, path[i].y);
                paper.stroke();
            }
            paper.restore();
        },

        // --- the cursor -----------------------------------------------------

        clearSprites: function () { clearLayer(sprites); },

        // onPaper is what stamp() uses: the same drawing, but permanent.
        drawTurtle: function (x, y, radians, shape, color, fill, onPaper) {
            var poly = SHAPES[shape] || SHAPES.classic;
            var ctx = onPaper ? paper : sprites;
            // The heading has to be computed through the scale, not from the
            // angle directly, or a stretched world would shear the cursor.
            var bearing = Math.atan2(Math.sin(radians) / world.yScale,
                                     Math.cos(radians) / world.xScale) - Math.PI / 2;
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(world.xScale, world.yScale);
            ctx.rotate(bearing);
            ctx.beginPath();
            ctx.lineWidth = 1;
            ctx.strokeStyle = color;
            ctx.fillStyle = fill;
            ctx.moveTo(-poly[0][0], poly[0][1]);
            for (var i = 1; i < poly.length; i++) { ctx.lineTo(-poly[i][0], poly[i][1]); }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        },

        shapeNames: function () { return Object.keys(SHAPES).join(","); },
        hasShape: function (name) { return Object.prototype.hasOwnProperty.call(SHAPES, name); },

        // --- events ---------------------------------------------------------
        // Skulpt fires these asynchronously while the program is still alive;
        // mainloop()/done() are no-ops there too. Here the handler runs
        // straight off the DOM event, so turtle.py falls back to instant
        // (unyielded) motion when it cannot suspend - see _can_block().

        listen: function () { try { target.focus(); } catch (e) {} },

        onKey: function (fn, down) {
            on(target, down ? "keydown" : "keyup", function (e) {
                try { fn(e.key); } catch (x) { console.error(x); }
            });
        },

        onClick: function (fn) {
            on(target, "mousedown", function (e) {
                var r = target.getBoundingClientRect();
                var x = (e.clientX - r.left) * world.xScale + world.llx;
                var y = (e.clientY - r.top) * world.yScale + world.ury;
                try { fn(x, y); } catch (x2) { console.error(x2); }
            });
        },

        setTimer: function (fn, ms) {
            timers.push(window.setTimeout(function () {
                try { fn(); } catch (x) { console.error(x); }
            }, Math.max(0, ms | 0)));
        }
    };
})();
