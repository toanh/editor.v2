"""`from pyangelo import *` - the CS in Schools 2D canvas API.

A thin Python face over js/pyangelo-host.js, which owns the canvas, the command
queue and the animation-frame loop. Splitting it that way keeps the retained-
mode architecture the curriculum depends on: drawing calls queue, refresh()
flushes, and a frame paints. clearScreen() flushes for you, which is why
programs that never call refresh() still animate.

Coordinates are Cartesian - y grows upwards - as in the fork.
"""

import js

import _host
from prelude import block

_canvas = js.PyAngeloHost

# Set when the module is imported, matching the fork: `width` and `height` are
# module attributes frozen at import time, not live values.
_size = _canvas.start()
width = int(_size.width)
height = int(_size.height)

# Colours, placed where the fork places them - in builtins, NOT as attributes of
# this module. The fork's pyangelo.js does `Sk.builtins.INDIGO = 23` at import,
# and its base colours are console.js's escape strings, already builtins.
#
# Defining them here as module attributes made `from pyangelo import *` copy all
# nineteen into the student's own variables, so the step debugger's watch table
# listed BLACK, WHITE, INDIGO and the rest on every pause. Skulpt shows none of
# them. tests/check-stepping.sh's canvas scenarios caught it.
#
# The base colours are re-set on every import, not only left to console.js: a
# builtin PyAngelo program (setCanvasSize) earlier in the same page replaces
# RED, BLUE and friends with integers, and the fork never put them back - so a
# pyangelo program run next drew with the wrong colours until a reload.
import builtins as _builtins

for _name, _value in (
    ("BLACK", "[ 38;2;0;0;0 m"),
    ("WHITE", "[ 38;2;255;255;255 m"),
    ("RED", "[ 38;2;255;0;0 m"),
    ("GREEN", "[ 38;2;0;255;0 m"),
    ("YELLOW", "[ 38;2;255;255;0 m"),
    ("BLUE", "[ 38;2;0;0;255 m"),
    ("ORANGE", "[ 38;2;255;165;0 m"),
    ("CYAN", "[ 38;2;0;255;255 m"),
    ("INDIGO", 23),
    ("DARK_GREY", 24),
    ("DARK_GRAY", 24),
    ("DARK_RED", 25),
    ("DARK_BLUE", 26),
    ("DARK_GREEN", 27),
    ("LIGHT_RED", 28),
    ("LIGHT_BLUE", 29),
    ("LIGHT_GREEN", 30),
    ("LIGHT_GREY", 31),
    ("PINK", 32),
):
    setattr(_builtins, _name, _value)


def timeElapsed():
    """Seconds since the previous call. Stateful, as in the fork."""
    return float(_canvas.timeElapsed())


def refresh():
    _canvas.refresh()


def clearScreen(color=None, g=None, b=None, a=None):
    _canvas.clearScreen(color, g, b, a)


# drawText and printAt accept g, b, a and then ignore them - so does the fork,
# which passes only the first colour argument on. A numeric colour there keeps
# the previous fill colour; see colour() in js/pyangelo-host.js.
def drawText(text, x, y, font=None, color=None, g=None, b=None, a=None):
    _canvas.drawText(text, x, y, font, color)


def printAt(text, col, row, color=None, g=None, b=None, a=None):
    _canvas.printAt(text, col, row, color)


# These three do take a full r, g, b, a colour. They used to drop g, b and a
# here, and the host painted every numeric colour white.
def drawLine(x1, y1, x2, y2, lineWidth=1, color=None, g=None, b=None, a=None):
    _canvas.drawLine(x1, y1, x2, y2, lineWidth, color, g, b, a)


def drawRect(x, y, width, height, lineWidth=1, color=None, g=None, b=None, a=None):
    _canvas.drawRect(x, y, width, height, lineWidth, color, g, b, a)


def fillRect(x, y, width, height, color=None, g=None, b=None, a=None):
    _canvas.fillRect(x, y, width, height, color, g, b, a)


def drawImage(imageURL, x, y, width=None, height=None, opacity=1.0):
    # Blocks until the image has decoded, which is what Skulpt's suspension
    # amounted to. Subsequent calls for the same URL hit the host's cache.
    block(_canvas.drawImage(imageURL, x, y, width, height, opacity))


def isKeyPressed(key):
    # Note: keyed on event.key, not event.code - so " " for the space bar,
    # matching the fork and the curriculum.
    return bool(_canvas.isKeyPressed(key))


def isKeyReleased(key):
    return bool(_canvas.isKeyReleased(key))


def isMouseClicked():
    return bool(_canvas.isMouseClicked())


def isMousePressed():
    return bool(_canvas.isMousePressed())


def getMouseDownPosition():
    pos = _canvas.getMouseDownPosition()
    # Belt and braces: the host returns undefined (-> None) when nothing is
    # pressed, but a JS null would arrive as JsNull, which is not None.
    if pos is None or not pos:
        return None
    return (int(pos[0]), int(pos[1]))


def getMousePosition():
    pos = _canvas.getMousePosition()
    return (int(pos[0]), int(pos[1]))


def overlaps(x1, y1, w1, h1, x2, y2, w2, h2):
    return bool(_canvas.overlaps(x1, y1, w1, h1, x2, y2, w2, h2))


def getStringWidth(text, font):
    return int(_canvas.getStringWidth(text, font))
