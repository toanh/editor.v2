# Every colour form `from pyangelo import *` accepts, drawn once and held still,
# so tests/compare-canvas.sh pyangelo-api can compare the pixels against Skulpt.
#
# The Pyodide port ignored numeric colours completely until this file existed:
# fillRect(x, y, w, h, 0, 255, 0, 1) painted white and clearScreen(0, 0, 0, 1)
# cleared to white. The one pixel-compared curriculum file that used a numeric
# colour also animated it, so the mismatch read as animation timing.
#
# The quirks below are the fork's, reproduced on purpose - see colour() in
# js/pyangelo-host.js.
from pyangelo import *

clearScreen(0, 0, 64, 1)                           # four numbers
fillRect(10, 440, 60, 40, 0, 255, 0, 1)            # rgba fill
fillRect(80, 440, 60, 40, 255, 128, 0, 0.5)        # translucent fill
drawRect(150, 440, 60, 40, 3, 255, 0, 255, 1)      # rgba stroke
drawLine(10, 420, 310, 420, 4, 0, 200, 255, 1)     # rgba line
fillRect(220, 440, 40, 40, RED)                    # named colour
fillRect(270, 440, 40, 40, 25, 0, 0, 1)            # a number that is also a table key: DARK_RED
fillRect(10, 360, 60, 40)                          # omitted colour: grey
drawText("named", 10, 320, "20px monospace", YELLOW)
drawText("number keeps previous", 10, 290, "20px monospace", 255, 0, 0, 1)
drawText("no colour", 10, 260, "20px monospace")
printAt("printAt", 1, 11, GREEN)
refresh()

# Hold the picture while the probe samples it.
sleep(5)
