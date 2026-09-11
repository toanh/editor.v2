# Builtin PyAngelo, which no curriculum file uses - so this is the only thing
# that will ever exercise it.
#
# The API is a set of *builtins* installed when a program opens a canvas, so
# the test opens one. Drawing goes to a real canvas inside a JSFrame; what is
# checked here is the arithmetic and the wiring, not the pixels.
setCanvasSize(400, 300, CARTESIAN)

print("size:", width, "x", height)
print("mouse starts at:", mouseX, mouseY, mouseIsPressed)

# The colour constants are integers here, and shadow console.js's escape
# strings. That collision is deliberate and only happens once a canvas is open.
print("RED is", repr(RED), "and BLACK is", repr(BLACK))

# Maths helpers are pure functions.
print("constrain:", constrain(15, 0, 10), constrain(-5, 0, 10), constrain(5, 0, 10))
print("dist:", dist(0, 0, 3, 4))
print("mapToRange:", mapToRange(5, 0, 10, 0, 100))
print("mapToRange clamped:", mapToRange(50, 0, 10, 0, 100, True))
print("PI:", round(PI, 5), "TWO_PI:", round(TWO_PI, 5))

# Keys are event.code values, not characters.
print("KEY_A:", KEY_A, "KEY_SPACE:", KEY_SPACE, "KEY_LEFT:", KEY_LEFT)
print("no key pressed:", isKeyPressed(KEY_A), wasKeyPressed(KEY_A))

# Drawing calls must not raise. Every shape, both fill modes, the matrix stack.
background(0, 0, 0)
fill(255, 0, 0)
stroke(0, 255, 0)
strokeWeight(2)
rect(10, 10, 50, 40)
circle(100, 100, 25)
ellipse(150, 100, 30, 20)
arc(200, 100, 30, 20, 0, 3.14159)
triangle(10, 200, 60, 200, 35, 250)
quad(100, 200, 150, 200, 150, 250, 100, 250)
line(0, 0, 400, 300)
point(5, 5)
noFill()
rect(200, 10, 40, 40)
noStroke()
circle(300, 100, 20)

beginShape()
vertex(300, 200)
vertex(350, 200)
vertex(325, 250)
endShape(CLOSE)

saveState()
translate(50, 50)
rotate(0.5)
angleMode(DEGREES)
rotate(45)
shearX(10)
shearY(10)
applyMatrix(1, 0, 0, 1, 0, 0)
restoreState()

rectMode(CENTER)
rect(200, 150, 20, 20)
rectMode(CORNERS)
rect(10, 10, 30, 30)
rectMode(CORNER)
circleMode(CORNER)
circle(50, 50, 10)
circleMode(CENTER)

text("hello", 10, 280)
m = measureText("hello", 20, "Arial")
print("measureText keys:", sorted(m.keys()))
print("measureText width is a number:", isinstance(m["width"], float))

c = getPixelColour(1, 1)
print("getPixelColour ->", type(c).__name__, "with r,g,b,a:",
      isinstance(c.r, int), isinstance(c.a, int))

setTextSize(20)
setTextColour(DRACULA_GREEN)
setHighlightColour(BLACK)

for bad, fn in (("setTextSize(200)", lambda: setTextSize(200)),
                ("setConsoleSize(50)", lambda: setConsoleSize(50))):
    try:
        fn()
        print(bad, "did not raise")
    except TypeError as exc:
        print(bad, "raises TypeError:", exc)

# vector and sprite sit on top of these builtins.
from vector import Vector
v = Vector(3, 4)
print("vector mag:", v.mag())
print("vector add:", Vector(1, 2) + Vector(3, 4))
print("vector truediv:", Vector(10, 20) / 2)
print("vector radd (sum):", sum([Vector(1, 1), Vector(2, 2)]))
v.limit(1)
print("vector limited mag:", round(v.mag(), 6))

from sprite import RectangleSprite, CircleSprite, TextSprite
r1 = RectangleSprite(0, 0, 10, 10)
r2 = RectangleSprite(5, 5, 10, 10)
r3 = RectangleSprite(50, 50, 10, 10)
print("rect overlaps:", r1.overlaps(r2), r1.overlaps(r3))
r1.draw()
CircleSprite(100, 100, 20).draw()
TextSprite("sprite text", 10, 10).draw()
# --- the live wiring: DOM events calling back into Python ---------------------
# mouseX/mouseY/mouseIsPressed are plain names a student reads, so the host has
# to push new values into builtins from inside an event handler. Real events
# are dispatched here rather than trusting that the callback is reachable.
import js
from pyodide.ffi import to_js

def fire(target, kind, **props):
    init = to_js(dict(props, bubbles=True), dict_converter=js.Object.fromEntries)
    ctor = js.KeyboardEvent if kind.startswith("key") else js.MouseEvent
    target.dispatchEvent(ctor.new(kind, init))

cv = js.document.getElementById("canvas")
box = cv.getBoundingClientRect()
fire(cv, "mousemove", clientX=box.left + 40, clientY=box.top + 10)
# CARTESIAN flips y: canvas height 300, 10px down from the top is y = 289.
print("after mousemove:", mouseX, mouseY, mouseIsPressed)
fire(cv, "mousedown", clientX=box.left + 40, clientY=box.top + 10)
print("after mousedown:", mouseIsPressed)
fire(cv, "mouseup", clientX=box.left + 40, clientY=box.top + 10)
print("after mouseup:", mouseIsPressed)

fire(js.document, "keydown", code="KeyA", key="a")
print("KeyA held:", isKeyPressed(KEY_A))
print("wasKeyPressed latches:", wasKeyPressed(KEY_A), wasKeyPressed(KEY_A))
fire(js.document, "keyup", code="KeyA", key="a")
print("KeyA released:", isKeyPressed(KEY_A))
print("done")
