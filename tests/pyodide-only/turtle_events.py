# Turtle's event handlers are Python callbacks that JavaScript calls *later*,
# from a real DOM event. That is exactly the shape Pyodide breaks by default:
# a proxy passed as an argument is destroyed when the call returns, so a
# handler registered with onkey() is dead before the first key press - and
# the failure is silent, because the host catches it.
#
# Real events are dispatched here. No curriculum file uses these, so nothing
# else would notice.
import js
from pyodide.ffi import to_js
from turtle import *

speed(0)
hideturtle()
got = []

def up():
    got.append("up")

def space():
    got.append("space")

def clicked(x, y):
    got.append("click")

onkey(up, "Up")
onkeypress(space, "space")
onscreenclick(clicked)
listen()

def fire(target, ctor, kind, **props):
    init = to_js(dict(props, bubbles=True), dict_converter=js.Object.fromEntries)
    target.dispatchEvent(ctor.new(kind, init))

canvas = js.document.getElementById("turtleCanvas")
fire(canvas, js.KeyboardEvent, "keyup", key="ArrowUp")
fire(canvas, js.KeyboardEvent, "keydown", key=" ")
box = canvas.getBoundingClientRect()
fire(canvas, js.MouseEvent, "mousedown", clientX=box.left + 250, clientY=box.top + 250)

print("handlers fired:", got)
