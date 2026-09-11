"""Builtin PyAngelo - the Processing-flavoured drawing API.

These are *builtins*, not a module: in the fork they are registered into
`Sk.builtins`, so a student writes `background(0, 0, 0)` with no import at all.
`install()` reproduces that by binding them into Python's `builtins`, and it is
called from `setCanvasSize()` - which is exactly when the fork's `preparePage()`
runs `Sk.PyAngelo.reset()`.

**That timing is load-bearing.** This API defines `RED`, `BLUE`, `YELLOW` and
friends as *integers*, while `console.js` defines the same names as the
pseudo-ANSI escape strings the console understands. Both cannot be true at once.
The fork resolves it by only installing these when a program opens a canvas, so
the two colour systems are mutually exclusive and whichever the program asked
for wins. Installing them at boot instead would silently break every program
that prints in colour.

Drawing itself is in js/pyangelo-builtin-host.js. This file is the Python face:
argument defaults, type coercion, and the constants.
"""

import math

import js

import _host
from prelude import block
from pyodide.ffi import create_proxy

_c = js.PyAngeloBuiltinHost

# --- constants, from Sk.PyAngelo.reset() ----------------------------------

QUARTER_PI = 0.7853982
HALF_PI = 1.57079632679489661923
PI = 3.14159265358979323846
TWO_PI = 6.28318530717958647693
TAU = 6.28318530717958647693

# Keys are event.code values, so KEY_A is "KeyA" and not "a".
_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
KEY_SPACE = "Space"
KEY_ENTER = "Enter"
KEY_ESC = "Escape"
KEY_DEL = "Delete"
KEY_BACKSPACE = "Backspace"
KEY_TAB = "Tab"
KEY_LEFT = "ArrowLeft"
KEY_RIGHT = "ArrowRight"
KEY_UP = "ArrowUp"
KEY_DOWN = "ArrowDown"

YELLOW = 0
ORANGE = 1
RED = 2
MAGENTA = 3
VIOLET = 4
BLUE = 5
CYAN = 6
GREEN = 7
WHITE = 8
GRAY = 9
GREY = 9
DEFAULT = 9
BLACK = 10
DRACULA_BACKGROUND = 11
DRACULA_CURRENT_LINE = 12
DRACULA_SELECTION = 13
DRACULA_FOREGROUND = 14
DRACULA_COMMENT = 15
DRACULA_CYAN = 16
DRACULA_GREEN = 17
DRACULA_ORANGE = 18
DRACULA_PINK = 19
DRACULA_PURPLE = 20
DRACULA_RED = 21
DRACULA_YELLOW = 22
INDIGO = 23
DARK_GREY = 24
DARK_GRAY = 24
DARK_RED = 25
DARK_BLUE = 26
DARK_GREEN = 27
LIGHT_RED = 28
LIGHT_BLUE = 29
LIGHT_GREEN = 30
PINK = 31

CARTESIAN = 1
JAVASCRIPT = 2
RADIANS = 1
DEGREES = 2
CORNER = 1
CORNERS = 2
CENTER = 3
CLOSE = 1
OPEN = 2
SMALL_SCREEN = 300
MEDIUM_SCREEN = 500
LARGE_SCREEN = 1000
SMALL_FONT = 8
MEDIUM_FONT = 16
LARGE_FONT = 24

# Updated from the browser's mouse events - see _on_mouse().
width = 0
height = 0
mouseX = 0
mouseY = 0
mouseIsPressed = False


def _on_mouse(x, y, pressed):
    """Called from JavaScript on every mouse event.

    These have to look like plain variables to a student (`if mouseIsPressed:`),
    not function calls, so the host pushes new values in rather than Python
    polling for them. A move sends coordinates and no button state; a press or
    release sends button state and no coordinates.
    """
    import builtins
    if x is not None:
        builtins.mouseX = int(x)
        builtins.mouseY = int(y)
    if pressed is not None:
        builtins.mouseIsPressed = bool(pressed)


# --- canvas -----------------------------------------------------------------

def _setCanvasSize(w, h, yAxisMode=CARTESIAN):
    """Wire up the canvas. console.js calls this after creating the JSFrame."""
    import builtins
    # create_proxy, not the bare function: Pyodide destroys a proxy passed as an
    # argument once the call returns, so the host would be holding a dead
    # callback and mouseX would silently stay 0. The host destroys this one
    # when it stops.
    size = _c.prepare(int(w), int(h), int(yAxisMode), create_proxy(_on_mouse))
    builtins.width = int(size.width)
    builtins.height = int(size.height)


def noCanvas():
    import builtins
    _c.noCanvas()
    builtins.width = 0
    builtins.height = 0


def focusCanvas():
    _c.focusCanvas()


def setConsoleSize(size):
    if size < 100 or size > 2000:
        raise TypeError("Size must be between 100 and 2000")
    _c.setConsoleSize(size)


# --- drawing -----------------------------------------------------------------

def background(r=220, g=220, b=220, a=1):
    _c.background(r, g, b, a)


def text(text, x, y, fontSize=20, fontName="Arial"):
    _c.text(str(text), x, y, fontSize, fontName)


def measureText(text, fontSize, fontName):
    """The full metrics record, as a dict.

    sprite.py's TextSprite indexes this - textMetrics["actualBoundingBoxLeft"]
    and friends - so returning just the width would break it.
    """
    m = _c.measureText(str(text), fontSize, fontName)
    return {
        "width": float(m.width),
        "actualBoundingBoxLeft": float(m.actualBoundingBoxLeft),
        "actualBoundingBoxRight": float(m.actualBoundingBoxRight),
        "actualBoundingBoxAscent": float(m.actualBoundingBoxAscent),
        "actualBoundingBoxDescent": float(m.actualBoundingBoxDescent),
    }


def saveState():
    _c.saveState()


def restoreState():
    _c.restoreState()


def translate(x, y):
    _c.translate(x, y)


def applyMatrix(a, b, c, d, e, f):
    _c.applyMatrix(a, b, c, d, e, f)


def rotate(angle):
    _c.rotate(angle)


def shearX(angle):
    _c.shearX(angle)


def shearY(angle):
    _c.shearY(angle)


def angleMode(mode):
    _c.angleMode(mode)


def rectMode(mode):
    _c.rectMode(mode)


def circleMode(mode):
    _c.circleMode(mode)


def strokeWeight(weight):
    _c.strokeWeight(weight)


def fill(r=255, g=255, b=255, a=1):
    _c.fill(r, g, b, a)


def noFill():
    _c.noFill()


def stroke(r=0, g=0, b=0, a=1):
    _c.stroke(r, g, b, a)


def noStroke():
    _c.noStroke()


def line(x1, y1, x2, y2):
    _c.line(x1, y1, x2, y2)


def circle(x, y, radius):
    _c.circle(x, y, radius)


def ellipse(x, y, radiusX, radiusY):
    _c.ellipse(x, y, radiusX, radiusY)


def arc(x, y, radiusX, radiusY, startAngle, endAngle):
    _c.arc(x, y, radiusX, radiusY, startAngle, endAngle)


def triangle(x1, y1, x2, y2, x3, y3):
    _c.triangle(x1, y1, x2, y2, x3, y3)


def quad(x1, y1, x2, y2, x3, y3, x4, y4):
    _c.quad(x1, y1, x2, y2, x3, y3, x4, y4)


def point(x, y):
    _c.point(x, y)


def rect(x, y, w, h):
    _c.rect(x, y, w, h)


def beginShape():
    _c.beginShape()


def vertex(x, y):
    _c.vertex(x, y)


def endShape(mode=CLOSE):
    _c.endShape(mode)


# --- colour ------------------------------------------------------------------

class Colour:
    """An r, g, b, a colour. Returned by getPixelColour()."""

    def __init__(self, r=255, g=255, b=255, a=1.0):
        self.r = r
        self.g = g
        self.b = b
        self.a = a

    def __repr__(self):
        return "Colour(%s, %s, %s, %s)" % (self.r, self.g, self.b, self.a)

    __str__ = __repr__


def getPixelColour(x, y):
    d = _c.getPixelColour(x, y)
    return Colour(int(d[0]), int(d[1]), int(d[2]), int(d[3]))


# --- images -------------------------------------------------------------------

class Image:
    """Loads an image file. Blocks until it has decoded, as the fork did."""

    def __init__(self, file):
        info = block(_c.loadImage(str(file)))
        self.file = str(info.file)
        self.width = int(info.width)
        self.height = int(info.height)

    def __repr__(self):
        return "Image(%s)" % self.file

    def __str__(self):
        return "Image Object - file: %s, width: %s, height: %s" % (
            self.file, self.width, self.height)


def drawImage(image, x, y, width=None, height=None, opacity=None):
    if not _c.hasImage(image.file):
        raise IOError("Image " + image.file + " has not been loaded")
    if width is None:
        width = image.width
    if height is None:
        height = image.height
    _c.drawImage(image.file, x, y, width, height, opacity)


# --- sound ---------------------------------------------------------------------

def loadSound(filename):
    return str(block(_c.loadSound(str(filename))))


def playSound(sound, loop=False, volume=1.0):
    if not _c.hasSound(sound):
        raise IOError("Cannot play Sound " + str(sound) + " as it has not been loaded")
    _c.playSound(sound, bool(loop), volume)


def stopSound(sound):
    if not _c.hasSound(sound):
        raise IOError("Cannot stop Sound " + str(sound) + " as it has not been loaded")
    _c.stopSound(sound)


def pauseSound(sound):
    if not _c.hasSound(sound):
        raise IOError("Cannot pause Sound " + str(sound) + " as it has not been loaded")
    _c.pauseSound(sound)


def stopAllSounds():
    _c.stopAllSounds()


# --- keys -----------------------------------------------------------------------

def isKeyPressed(code):
    return bool(_c.isKeyPressed(code))


def wasKeyPressed(code):
    return bool(_c.wasKeyPressed(code))


# --- console styling --------------------------------------------------------------

def setTextSize(size):
    if size < 8 or size > 128:
        raise TypeError("Size must be between 8 and 128")
    _c.setTextSize(size)


def setTextColour(colour):
    _c.setTextColour(colour)


def setHighlightColour(colour):
    _c.setHighlightColour(colour)


# --- maths -------------------------------------------------------------------------

def constrain(n, low, high):
    return max(min(n, high), low)


def mapToRange(n, start1, stop1, start2, stop2, withinBounds=False):
    newval = (n - start1) / (stop1 - start1) * (stop2 - start2) + start2
    if not withinBounds:
        return newval
    if start2 < stop2:
        return constrain(newval, start2, stop2)
    return constrain(newval, stop2, start2)


def dist(x1, y1, x2, y2):
    return math.hypot(x2 - x1, y2 - y1)


# --- speech ---------------------------------------------------------------------------

def say(text, voice=0):
    """Speaks the text. The profanity filter lives in the host bridge."""
    _host.saySomething(str(text), voice, None)


# `talk` is the same call under the name the older lessons use.
talk = say


# --- install ------------------------------------------------------------------------

# Everything a student can reach without an import. `clear` and `sleep` are
# deliberately absent: console.js registers its own `clear()` into the Host
# registry and the prelude installs `sleep`, and those are the versions 43 and
# 70 curriculum files respectively already depend on.
_NAMES = [
    "QUARTER_PI", "HALF_PI", "PI", "TWO_PI", "TAU",
    "KEY_SPACE", "KEY_ENTER", "KEY_ESC", "KEY_DEL", "KEY_BACKSPACE", "KEY_TAB",
    "KEY_LEFT", "KEY_RIGHT", "KEY_UP", "KEY_DOWN",
    "YELLOW", "ORANGE", "RED", "MAGENTA", "VIOLET", "BLUE", "CYAN", "GREEN",
    "WHITE", "GRAY", "GREY", "DEFAULT", "BLACK",
    "DRACULA_BACKGROUND", "DRACULA_CURRENT_LINE", "DRACULA_SELECTION",
    "DRACULA_FOREGROUND", "DRACULA_COMMENT", "DRACULA_CYAN", "DRACULA_GREEN",
    "DRACULA_ORANGE", "DRACULA_PINK", "DRACULA_PURPLE", "DRACULA_RED",
    "DRACULA_YELLOW", "INDIGO", "DARK_GREY", "DARK_GRAY", "DARK_RED",
    "DARK_BLUE", "DARK_GREEN", "LIGHT_RED", "LIGHT_BLUE", "LIGHT_GREEN", "PINK",
    "CARTESIAN", "JAVASCRIPT", "RADIANS", "DEGREES", "CORNER", "CORNERS",
    "CENTER", "CLOSE", "OPEN",
    "SMALL_SCREEN", "MEDIUM_SCREEN", "LARGE_SCREEN",
    "SMALL_FONT", "MEDIUM_FONT", "LARGE_FONT",
    "noCanvas", "focusCanvas", "setConsoleSize",
    "background", "text", "measureText", "saveState", "restoreState",
    "translate", "applyMatrix", "rotate", "shearX", "shearY",
    "angleMode", "rectMode", "circleMode", "strokeWeight",
    "fill", "noFill", "stroke", "noStroke",
    "line", "circle", "ellipse", "arc", "triangle", "quad", "point", "rect",
    "beginShape", "vertex", "endShape",
    "Colour", "getPixelColour", "Image", "drawImage",
    "loadSound", "playSound", "stopSound", "pauseSound", "stopAllSounds",
    "isKeyPressed", "wasKeyPressed",
    "setTextSize", "setTextColour", "setHighlightColour",
    "constrain", "mapToRange", "dist", "say", "talk",
]


def install():
    """Bind everything into builtins, as Skulpt registers them globally."""
    import builtins
    g = globals()
    for name in _NAMES:
        setattr(builtins, name, g[name])
    # KEY_A .. KEY_Z, which are event.code values.
    for letter in _LETTERS:
        setattr(builtins, "KEY_" + letter, "Key" + letter)
    # loadImage is the older name for the Image constructor.
    builtins.loadImage = Image
    builtins.width = 0
    builtins.height = 0
    builtins.mouseX = 0
    builtins.mouseY = 0
    builtins.mouseIsPressed = False
