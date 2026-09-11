"""`from turtle import *` - classic turtle graphics on the console canvas.

Written fresh rather than ported: Skulpt's turtle.js is 2400 lines of
promise-chained frame machinery bolted to Sk.misceval, and none of that
survives the move to a runtime that can simply block. What *is* carried across
verbatim is the arithmetic, because the pictures in the curriculum are the
specification:

  * A move is split into `round(max(1, pixels / speed))` steps and a turn into
    `round(max(1, degrees / speed))`, with `speed = turtle.speed() * 2` and a
    default of 3 (so 6). One animation frame per step. That is what sets the
    drawing pace a student sees, so it is not an implementation detail.
  * The pen path stays open across the steps of a single move, so round joins
    line up instead of stacking caps.
  * A fill records the position *before* each move, which makes the polygon lag
    one vertex behind. It closes correctly and it is what the fork draws.

Drawing itself lives in js/turtle-host.js. Frame pacing goes through the
prelude's `block(_host.frameYield())`, the same yield `goto` and the loop hook
use, so the Stop button reaches a turtle program like any other.

Two deliberate differences from the fork, both noted at their definitions:
`colormode()` actually takes effect, and all turtles share one drawing layer.
"""

import math
import re

import js

import _host
from prelude import block

from pyodide.ffi import can_run_sync, create_proxy


def _callback(fn):
    """A Python callable that JavaScript may call *later*.

    Pyodide destroys a proxy passed as an argument to a JS function as soon as
    that call returns, so a handler handed straight to addEventListener is dead
    before the first key press - and fails silently, because the host catches
    the error. Measured, not assumed: calling a stored plain callable raises
    JsException, a create_proxy one works. TurtleHost destroys these when it
    unbinds its listeners, so they do not leak across runs.
    """
    return create_proxy(fn)

_canvas = js.TurtleHost

TAU = 2 * math.pi

# The canvas is created and cleared once per run, when this module is imported -
# matching the fork, where getConfiguredTarget() empties the target on import.
_geometry = _canvas.start()

_turtles = []
_screen = None
_anonymous = None

# Frames queued since the last actual repaint. Skulpt calls this the frame
# buffer; tracer(n) sets how many updates to collect before painting one, and
# tracer(0) means "never paint until update() is called".
_pending = [0]


def _jsround(value):
    """JavaScript's Math.round: halves go up, not to even."""
    return int(math.floor(value + 0.5))


def _can_block():
    """True when we are inside the promising call that armed JSPI.

    False in a key or timer callback, which the browser delivers on a plain
    event - there is no suspendable stack there, so animation degrades to
    drawing the whole move at once rather than raising.
    """
    return can_run_sync()


def _paint():
    """Redraw the cursors and give the browser a frame to show the result."""
    _pending[0] = 0
    _canvas.clearSprites()
    for t in _turtles:
        if t._shown:
            _canvas.drawTurtle(t._x, t._y, t._radians, t._shape, t._color, t._fill, False)
    if not _can_block():
        return
    if _screen is not None and _screen._delay:
        block(_host.sleep(_screen._delay))
    else:
        block(_host.frameYield())


def _flush(count_as_frame=True):
    if count_as_frame:
        _pending[0] += 1
    buffer = 1 if _screen is None else _screen._tracer
    if buffer and _pending[0] >= buffer:
        _paint()


def _create_color(mode, color, g=None, b=None, a=None):
    """Turn turtle's several colour spellings into a CSS colour string.

    Transcribed from createColor() in the fork, error messages included.
    """
    if g is not None:
        color = [color, g, b, a]

    if isinstance(color, (list, tuple)) and len(color):
        values = list(color)
        rgb = []
        for i in range(3):
            v = values[i] if i < len(values) else None
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                raise ValueError("bad color sequence")
            if mode == 255:
                rgb.append(max(0, min(255, int(v))))
            elif v <= 1:
                rgb.append(max(0, min(255, int(255 * v))))
            else:
                # turtle raises TurtleGraphicsError here; Skulpt substituted
                # ValueError and the curriculum has never seen either.
                raise ValueError("bad color sequence")
        alpha = values[3] if len(values) > 3 else None
        if isinstance(alpha, (int, float)) and not isinstance(alpha, bool):
            return "rgba(%d,%d,%d,%s)" % (rgb[0], rgb[1], rgb[2], max(0.0, min(1.0, alpha)))
        return "rgb(%d,%d,%d)" % (rgb[0], rgb[1], rgb[2])

    if isinstance(color, str) and not re.search(r"\s*url\s*\(", color, re.I):
        # Whitespace is stripped, not rejected: "light green" becomes
        # "lightgreen", which CSS accepts.
        return re.sub(r"\s+", "", color)

    return "black"


def _hex_to_rgb(color):
    """Best-effort inverse, for the colour getters."""
    m = re.match(r"^rgba?\((\d+),(\d+),(\d+)(?:,([.\d]+))?\)$", color)
    if m:
        out = [int(m.group(1)), int(m.group(2)), int(m.group(3))]
        if m.group(4):
            out.append(float(m.group(4)))
        return tuple(out)
    m = re.match(r"^#?([a-fA-F\d]{3}|[a-fA-F\d]{6})$", color)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = h[0] * 2 + h[1] * 2 + h[2] * 2
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    return color


def _coordinates(x, y=None):
    """turtle accepts goto(x, y), goto((x, y)) and goto(vec)."""
    if y is None:
        if isinstance(x, (list, tuple)) and len(x) >= 2:
            return float(x[0]), float(x[1])
        if hasattr(x, "x") and hasattr(x, "y"):
            return float(x.x), float(x.y)
        return 0.0, 0.0
    return float(x), float(y)


class _Screen(object):
    """The drawing surface. One per run; Screen() always returns this one."""

    def __init__(self):
        self._mode = "standard"
        self._bgcolor = "none"
        self._colormode = 1.0
        self._tracer = 1        # frames collected per repaint
        self._delay = None      # ms; None means one animation frame
        self._width = int(_geometry.width)
        self._height = int(_geometry.height)
        self._set_up_world(-self._width / 2, -self._height / 2,
                           self._width / 2, self._height / 2)

    def _set_up_world(self, llx, lly, urx, ury):
        self.llx, self.lly, self.urx, self.ury = llx, lly, urx, ury
        self.xScale = (urx - llx) / self._width
        self.yScale = -1.0 * (ury - lly) / self._height
        self.lineScale = min(abs(self.xScale), abs(self.yScale))

    # --- screen API --------------------------------------------------------

    def bgcolor(self, color=None, g=None, b=None, a=None):
        if color is None:
            return _hex_to_rgb(self._bgcolor)
        self._bgcolor = _create_color(self._colormode, color, g, b, a)
        _canvas.bgcolor(self._bgcolor)
        return None

    def colormode(self, cmode=None):
        if cmode is None:
            return self._colormode
        # The fork stores this on the screen but reads it off each turtle, so
        # colormode(255) never actually took effect and color(255, 0, 0) still
        # raised. Fixed here: no working program can depend on the error.
        self._colormode = 255 if cmode == 255 else 1.0
        for t in _turtles:
            t._colormode = self._colormode
        return None

    def tracer(self, n=None, delay=None):
        if n is None and delay is None:
            return self._tracer
        if delay is not None:
            self._delay = delay
        if n is not None:
            self._tracer = int(n)
            if self._tracer and _pending[0] >= self._tracer:
                _paint()
        return None

    def delay(self, delay=None):
        if delay is None:
            return 1000 // 30 if self._delay is None else self._delay
        self._delay = delay
        return None

    def update(self):
        if _pending[0]:
            _paint()

    def clear(self):
        self.reset()

    clearscreen = clear

    def reset(self):
        _canvas.clearPaper()
        _canvas.clearSprites()
        for t in _turtles:
            t._reset()
        _paint()

    resetscreen = reset

    def setworldcoordinates(self, llx, lly, urx, ury):
        self._mode = "world"
        self._set_up_world(llx, lly, urx, ury)
        _canvas.setWorld(llx, lly, urx, ury)
        self.reset()

    def setup(self, width=None, height=None, startx=None, starty=None):
        # The canvas is a fixed 500x500 element in the console; resizing it is
        # not supported, and every curriculum picture is drawn for that size.
        return None

    def screensize(self, width=None, height=None, bg=None):
        if bg is not None:
            self.bgcolor(bg)
        return (self._width, self._height)

    def window_width(self):
        return self._width

    def window_height(self):
        return self._height

    def mode(self, mode=None):
        if mode is None:
            return self._mode
        self._mode = mode
        return None

    def title(self, title):
        js.document.title = str(title)

    def turtles(self):
        return tuple(_turtles)

    def getshapes(self):
        return sorted(str(_canvas.shapeNames()).split(","))

    def bye(self):
        _canvas.stop()

    def exitonclick(self):
        return None

    # mainloop()/done() are no-ops in the fork too: the page keeps running and
    # the registered handlers keep firing after the program's last statement.
    def mainloop(self):
        return None

    done = mainloop

    # --- events ------------------------------------------------------------

    def listen(self, xdummy=None, ydummy=None):
        _canvas.listen()

    def onkey(self, fun=None, key=None):
        # turtle's own signature is onkey(fun, key); the fork also accepted
        # them the other way round.
        if callable(key) or (fun is not None and not callable(fun)):
            fun, key = key, fun
        if fun is None:
            return None
        want = _key_name(key)
        _canvas.onKey(_callback(_key_filter(fun, want)), False)

    onkeyrelease = onkey

    def onkeypress(self, fun=None, key=None):
        if callable(key) or (fun is not None and not callable(fun)):
            fun, key = key, fun
        if fun is None:
            return None
        _canvas.onKey(_callback(_key_filter(fun, _key_name(key))), True)

    def onclick(self, fun=None, btn=1, add=None):
        if fun is None:
            return None
        _canvas.onClick(_callback(lambda x, y: fun(float(x), float(y))))

    onscreenclick = onclick

    def ontimer(self, fun=None, t=0):
        if fun is None:
            return None
        _canvas.setTimer(_callback(fun), t)

    # Both would need an <img> loaded into the canvas, which the fork supports
    # and nothing in the curriculum uses.
    def register_shape(self, name, shape=None):
        raise NotImplementedError(
            "register_shape() is not available; the built-in shapes are "
            + str(_canvas.shapeNames()))

    def bgpic(self, name=None):
        raise NotImplementedError("bgpic() is not available on this turtle")


# Turtle key names -> the browser's event.key. Anything not listed is used as
# written, which covers every printable character.
_KEY_NAMES = {
    "space": " ", "enter": "Enter", "return": "Enter", "tab": "Tab",
    "backspace": "Backspace", "escape": "Escape", "esc": "Escape",
    "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight",
    "delete": "Delete", "insert": "Insert", "home": "Home", "end": "End",
    "pageup": "PageUp", "pagedown": "PageDown", "shift": "Shift",
    "control": "Control", "ctrl": "Control", "alt": "Alt",
}


def _key_name(key):
    if key is None:
        return None
    name = str(key)
    return _KEY_NAMES.get(name.lower().replace(" ", "").replace("-", "").replace("arrow", ""), name)


def _key_filter(fun, want):
    def handler(pressed):
        if want is None or str(pressed) == want or str(pressed).lower() == str(want).lower():
            fun()
    return handler


class Turtle(object):
    def __init__(self, shape="turtle"):
        if not _canvas.hasShape(str(shape)):
            raise ValueError(
                "Shape:'" + str(shape) + "' not in default shape, please check shape again!")
        self._shape = str(shape)
        self._reset()
        _turtles.append(self)

    def _reset(self):
        self._x = 0.0
        self._y = 0.0
        self._angle = 0.0
        self._radians = 0.0
        self._shown = True
        self._down = True
        self._color = "black"
        self._fill = "black"
        self._size = 1
        self._filling = False
        self._speed = 3
        self._computed_speed = 6
        self._colormode = 1.0 if _screen is None else _screen._colormode
        self._is_radians = False
        self._full_circle = 360.0

    # --- geometry ----------------------------------------------------------

    def _heading(self, value):
        if self._is_radians:
            angle = radians = value % TAU
        elif self._full_circle:
            angle = value % self._full_circle
            radians = angle / self._full_circle * TAU
        else:
            angle = radians = 0.0
        if angle < 0:
            angle += self._full_circle
            radians += TAU
        return angle, radians

    def _translate(self, dx, dy, begin_path=True, is_circle=False):
        start_x, start_y = self._x, self._y
        speed = self._computed_speed
        screen = _get_screen()
        pixels = math.sqrt(dx * dx * abs(screen.xScale) + dy * dy * abs(screen.yScale))
        frames = _jsround(max(1, pixels / speed)) if speed else 1
        # A circle drawn at speed 0 must not cost a frame per segment, or
        # "instant" would be the slowest setting of all.
        counts = not (not speed and is_circle)

        if self._filling:
            _canvas.fillPush(self._x, self._y, self._down, self._color, self._size)

        x_step = dx / frames
        y_step = dy / frames
        for i in range(frames):
            nx = start_x + x_step * (i + 1)
            ny = start_y + y_step * (i + 1)
            if self._down:
                _canvas.drawLine(self._x, self._y, nx, ny, begin_path, self._size, self._color)
            self._x, self._y = nx, ny
            begin_path = False
            _flush(counts)
        # Recompute from the start rather than accumulating the steps, so a
        # thousand small moves do not drift.
        self._x, self._y = start_x + dx, start_y + dy

    def _rotate(self, delta, is_circle=False):
        start_angle = self._angle
        speed = self._computed_speed
        degrees = delta / self._full_circle * 360.0
        frames = _jsround(max(1, abs(degrees) / speed)) if speed else 1
        counts = not (not speed and is_circle)
        d_angle = delta / frames
        for i in range(frames):
            self._angle, self._radians = self._heading(start_angle + d_angle * (i + 1))
            _flush(counts)
        self._angle, self._radians = self._heading(start_angle + delta)

    # --- movement ----------------------------------------------------------

    def forward(self, distance):
        distance = float(distance)
        self._translate(math.cos(self._radians) * distance,
                        math.sin(self._radians) * distance)

    fd = forward

    def backward(self, distance):
        self.forward(-float(distance))

    back = bk = backward

    def left(self, angle):
        self._rotate(float(angle))

    lt = left

    def right(self, angle):
        self._rotate(-float(angle))

    rt = right

    def setheading(self, angle):
        end = float(angle) % self._full_circle
        if end < 0:
            end += self._full_circle
        self._rotate(end - self._angle)

    seth = setheading

    def goto(self, x, y=None):
        tx, ty = _coordinates(x, y)
        self._translate(tx - self._x, ty - self._y)

    setpos = setposition = goto

    def setx(self, x):
        self._translate(float(x) - self._x, 0)

    def sety(self, y):
        self._translate(0, float(y) - self._y)

    def home(self):
        angle = self._angle
        self._translate(-self._x, -self._y)
        self._rotate(-angle)

    def circle(self, radius, extent=None, steps=None):
        radius = float(radius)
        if extent is None:
            extent = self._full_circle
        extent = float(extent)
        if steps is None:
            scale = 1.0 / _get_screen().lineScale
            frac = abs(extent) / self._full_circle
            steps = 1 + int(min(11 + abs(radius * scale) / 6, 59) * frac)
        steps = int(steps)
        w = extent / steps
        w2 = 0.5 * w
        length = 2 * radius * math.sin(w * math.pi / self._full_circle)
        if radius < 0:
            length, w, w2 = -length, -w, -w2
            end_angle = self._angle - extent
        else:
            end_angle = self._angle + extent

        angle = self._angle + w2
        begin_path = True
        for i in range(steps):
            self._angle, self._radians = self._heading(angle + w * i)
            self._translate(math.cos(self._radians) * length,
                            math.sin(self._radians) * length,
                            begin_path, True)
            begin_path = False
        self._angle, self._radians = self._heading(end_angle)
        _flush(True)

    def dot(self, size=None, *color):
        if size is None:
            size = max(self._size + 4, self._size * 2)
        else:
            size = max(1, int(abs(size)))
        pen = _create_color(self._colormode, *color) if color else self._color
        _canvas.drawDot(self._x, self._y, size, pen)
        _flush(True)

    def stamp(self):
        _canvas.drawTurtle(self._x, self._y, self._radians, self._shape,
                           self._color, self._fill, True)
        _flush(True)

    def speed(self, speed=None):
        if speed is None:
            return self._speed
        names = {"fastest": 0, "fast": 10, "normal": 6, "slow": 3, "slowest": 1}
        if isinstance(speed, str):
            if speed not in names:
                raise TypeError("speed string expected one of " + ", ".join(names))
            speed = names[speed]
        if not isinstance(speed, (int, float)) or isinstance(speed, bool):
            raise TypeError("speed expected a string or number")
        speed = round(speed) if 0.5 < speed < 10.5 else 0
        self._speed = speed
        self._computed_speed = speed * 2
        return None

    # --- pen ---------------------------------------------------------------

    def penup(self):
        self._down = False

    pu = up = penup

    def pendown(self):
        self._down = True

    pd = down = pendown

    def isdown(self):
        return self._down

    def pensize(self, width=None):
        if width is None:
            return self._size
        self._size = width
        return None

    width = pensize

    def pencolor(self, *args):
        if not args:
            return _hex_to_rgb(self._color)
        self._color = _create_color(self._colormode, *args)
        _flush(self._shown)
        return None

    def fillcolor(self, *args):
        if not args:
            return _hex_to_rgb(self._fill)
        self._fill = _create_color(self._colormode, *args)
        _flush(self._shown)
        return None

    def color(self, *args):
        if not args:
            return (self.pencolor(), self.fillcolor())
        # color(c) and color(r, g, b) set both; color(pen, fill) sets each.
        if len(args) == 2:
            self._color = _create_color(self._colormode, args[0])
            self._fill = _create_color(self._colormode, args[1])
        else:
            self._color = _create_color(self._colormode, *args)
            self._fill = self._color
        _flush(self._shown)
        return None

    # The fork adds this spelling; CS in Schools is Australian.
    colour = color

    def begin_fill(self):
        if self._filling:
            return
        self._filling = True
        _canvas.fillBegin(self._x, self._y)

    def end_fill(self):
        if not self._filling:
            return
        # The closing vertex carries no stroke flag, so the final edge is
        # filled but not re-stroked - as in the fork.
        _canvas.fillPush(self._x, self._y, False, self._color, self._size)
        _canvas.fillEnd(self._fill)
        self._filling = False
        _flush(True)

    def filling(self):
        return self._filling

    # font defaults to None, not CPython's ("Arial", 8, "normal"): the fork
    # leaves ctx.font untouched when no font is given, so an unstyled write()
    # comes out in the canvas default of 10px sans-serif. That is what the
    # curriculum's pictures were drawn with.
    def write(self, arg, move=False, align="left", font=None):
        message = str(arg)
        css = None
        if isinstance(font, (list, tuple)) and len(font):
            face = font[0] if isinstance(font[0], str) else "Arial"
            size = str(font[1] if len(font) > 1 and font[1] else "12pt")
            style = font[2] if len(font) > 2 and isinstance(font[2], str) else "normal"
            if re.match(r"^\d+$", size):
                size += "pt"
            css = " ".join([style, size, face])
        if not align:
            align = "left"
        _canvas.drawText(self._x, self._y, message, align, css, self._fill)
        _flush(True)
        if move and align in ("left", "center"):
            width = float(_canvas.measureText(message, css))
            if align == "center":
                width = width / 2
            self._translate(width, 0)

    # --- queries -----------------------------------------------------------

    def xcor(self):
        return 0.0 if abs(self._x) < 1e-13 else self._x

    def ycor(self):
        return 0.0 if abs(self._y) < 1e-13 else self._y

    def position(self):
        return (self.xcor(), self.ycor())

    pos = position

    def heading(self):
        return 0.0 if abs(self._angle) < 1e-13 else self._angle

    def towards(self, x, y=None):
        tx, ty = _coordinates(x, y)
        radians = math.pi + math.atan2(self._y - ty, self._x - tx)
        return radians * (self._full_circle / TAU)

    def distance(self, x, y=None):
        tx, ty = _coordinates(x, y)
        return math.hypot(tx - self._x, ty - self._y)

    def degrees(self, fullcircle=360.0):
        self._full_circle = abs(float(fullcircle)) or 360.0
        self._is_radians = False
        self._angle = self._radians / TAU * self._full_circle

    def radians(self):
        self._is_radians = True
        self._full_circle = TAU
        self._angle = self._radians

    def shape(self, name=None):
        # An unknown name is silently ignored and the current shape returned -
        # the fork validates in the Turtle() constructor but not here, and a
        # teacher's shape("dinosaur") must not start raising.
        if name is None or not _canvas.hasShape(str(name)):
            return self._shape
        self._shape = str(name)
        _flush(self._shown)
        return None

    def showturtle(self):
        self._shown = True
        _flush(True)

    st = showturtle

    def hideturtle(self):
        self._shown = False
        _flush(True)

    ht = hideturtle

    def isvisible(self):
        return self._shown

    def clear(self):
        # One shared drawing layer, unlike the fork's layer-per-turtle. No
        # curriculum file creates a second turtle, and three stacked canvases
        # per turtle is a poor trade for that.
        _canvas.clearPaper()
        _flush(True)

    def reset(self):
        self.clear()
        self._reset()
        _flush(True)

    def getscreen(self):
        return _get_screen()

    def getturtle(self):
        return self

    getpen = getturtle

    def clone(self):
        other = Turtle(self._shape)
        for attr in ("_x", "_y", "_angle", "_radians", "_shown", "_down", "_color",
                     "_fill", "_size", "_speed", "_computed_speed", "_colormode",
                     "_is_radians", "_full_circle"):
            setattr(other, attr, getattr(self, attr))
        return other

    # The undo buffer is not implemented: it would have to record and replay
    # every canvas operation, and nothing in the curriculum calls it.
    def undo(self):
        raise NotImplementedError("undo() is not available on this turtle")

    def undobufferentries(self):
        return 0

    def setundobuffer(self, size):
        return None

    # Per-turtle events are screen events in this implementation; there is one
    # canvas and hit-testing a shape is not worth a fourth layer.
    def onclick(self, fun=None, btn=1, add=None):
        _get_screen().onclick(fun, btn, add)

    def onrelease(self, fun=None, btn=1, add=None):
        return None

    def ondrag(self, fun=None, btn=1, add=None):
        return None


def Screen():
    return _get_screen()


def _get_screen():
    global _screen
    if _screen is None:
        _screen = _Screen()
    return _screen


def _get_turtle():
    global _anonymous
    if _anonymous is None:
        _get_screen()
        _anonymous = Turtle("turtle")
    return _anonymous


# --- module-level API ------------------------------------------------------
# The fork exposes every Turtle method at module level, bound to an anonymous
# turtle created on first use, plus a fixed list of Screen methods. Both are
# generated here so the two never drift.

def _bind(cls, names, resolve):
    for _name in names:
        def _make(_n=_name):
            def _fn(*args, **kwargs):
                return getattr(resolve(), _n)(*args, **kwargs)
            _fn.__name__ = _n
            _fn.__qualname__ = _n
            _fn.__doc__ = getattr(cls, _n).__doc__
            return _fn
        globals()[_name] = _make()


_TURTLE_NAMES = [n for n in vars(Turtle) if not n.startswith("_")]

# Note `clear`: `from turtle import *` shadows the console's own clear() with
# the turtle's. Skulpt did exactly the same, so programs that mix the two are
# already written around it.
_SCREEN_NAMES = [
    "bgcolor", "bgpic", "colormode", "tracer", "delay", "update", "clearscreen",
    "resetscreen", "setworldcoordinates", "setup", "screensize", "window_width",
    "window_height", "mode", "title", "turtles", "getshapes", "bye", "exitonclick",
    "mainloop", "done", "listen", "onkey", "onkeypress", "onkeyrelease",
    "onscreenclick", "ontimer", "register_shape",
]

_bind(Turtle, _TURTLE_NAMES, _get_turtle)
_bind(_Screen, _SCREEN_NAMES, _get_screen)

__all__ = sorted(set(_TURTLE_NAMES) | set(_SCREEN_NAMES) | {"Turtle", "Screen"})
