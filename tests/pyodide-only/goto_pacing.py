# A goto frame loop must run many times per animation frame, and must still let
# the browser paint. Both halves have been wrong:
#
#   * The yield clock was stamped *before* waiting for the frame. The wait
#     itself lasts about a frame, so the budget had always expired by the time
#     the program resumed, and nearly every label and loop back-edge yielded
#     again. demos/snake.py polled its keys 81 times a second instead of
#     thousands, moved late and unevenly (267-301 ms for a 250 ms step), and
#     missed a quarter of quick key taps. demos/pong.py, which moves a fixed
#     step per loop, slowed to a crawl.
#   * Without any yield at all, the tab freezes.
#
# The comprehension is here on purpose. CPython warns when a jump finds an
# unbound local, and at module level a comprehension's hidden loop variable is
# one - so every goto program containing a comprehension printed
# "RuntimeWarning: assigning None to 1 unbound local" on its first jump. The
# expected output has no such line.
import js
import time

js.eval("window.pyFrameCount = 0; (function tick() { window.pyFrameCount++; requestAnimationFrame(tick); })();")

squares = [n * n for n in range(5)]
hits = 0
frames_before = js.window.pyFrameCount
start = time.perf_counter()

label .top
hits = hits + 1
if time.perf_counter() - start < 2:
    goto .top

elapsed = time.perf_counter() - start
frames = js.window.pyFrameCount - frames_before
print("squares", squares)
print("loops per frame above 5:", hits / max(frames, 1) > 5)
print("browser kept painting:", frames > 0.8 * 60 * elapsed)
