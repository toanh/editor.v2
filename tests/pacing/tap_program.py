from pyangelo import *
import time as _t

# A snake-shaped frame loop - goto, a clearScreen, a few drawText calls inside
# a for loop - that counts how many distinct key presses it notices. The page
# injects short taps of "w"; the difference between taps injected and taps
# seen is what "controls feel unresponsive" means in numbers.
#
# Runs under both interpreters, so the same loop shape is compared.
seen = 0
held = False
t0 = _t.time()

label .loop
clearScreen(BLACK)
drawText("tap test", 10, 400, "20px consolas", WHITE)
for i in range(3):
    drawText("x", 40 + 20 * i, 360, "20px consolas", WHITE)
now = isKeyPressed('w')
if now and not held:
    seen = seen + 1
held = now
if _t.time() - t0 > 12:
    goto .done
goto .loop

label .done
print("taps seen", seen)
