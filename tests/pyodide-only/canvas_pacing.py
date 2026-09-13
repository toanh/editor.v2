# A canvas program's loops are NOT rate-limited, and the browser still paints.
#
# A 1500-iterations-a-second cap for canvas programs was tried, on the theory
# that Skulpt throttled its loops and games were tuned to it. Measurement
# disproved it: Skulpt runs this very loop at ~80,000 a second. The cap made
# light loops 30-50x slower than Skulpt and halved tictactoe_ml's training
# speed. See the pacing notes in js/py/prelude.py.
#
# The bound is deliberately loose - it separates "capped" (~1500) from "not
# capped" (tens of thousands), not one machine's speed from another's.
import js
import time
from pyangelo import *

js.eval("window.pyFrameCount = 0; (function tick() { window.pyFrameCount++; requestAnimationFrame(tick); })();")
frames_before = js.window.pyFrameCount

n = 0
start = time.perf_counter()
while time.perf_counter() - start < 2:
    n = n + 1
elapsed = time.perf_counter() - start
frames = js.window.pyFrameCount - frames_before
print("while loop not rate-limited:", n / elapsed > 8000)
print("browser kept painting:", frames > 0.8 * 60 * elapsed)
