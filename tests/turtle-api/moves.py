# Absolute positioning and heading. projects/ only ever uses forward/left/right.
#
# NOTE: every setpos() here would read more naturally as goto(), and that is
# what the turtle documentation uses - but `goto` is a KEYWORD in the Skulpt
# fork's grammar (it added `goto <label>` as a real statement), so `goto(100,
# 100)` is a SyntaxError there. It works fine under Pyodide. Written with
# setpos so the file runs on both; the divergence itself is noted in CLAUDE.md.
from turtle import *
speed(0)

setpos(100, 100)
setpos(-100, 100)
setposition(-100, -100)
setx(100)
sety(-50)
setheading(90)
forward(60)
setheading(225)
forward(60)
backward(30)
home()                      # back to origin AND back to heading 0
forward(40)

print("pos", round(xcor(), 3), round(ycor(), 3))
print("heading", round(heading(), 3))
print("towards", round(towards(0, 100), 3))
print("distance", round(distance(0, 0), 3))
print("isdown", isdown(), "isvisible", isvisible())
