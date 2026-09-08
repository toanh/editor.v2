# The five built-in cursor shapes, and what an unknown one does.
from turtle import *
speed(0)
pensize(1)

penup()
for name in ("classic", "arrow", "turtle", "circle", "square"):
    setpos(-180 + 90 * ("classic arrow turtle circle square".split().index(name)), 0)
    shape(name)
    setheading(45)
    stamp()
print("shape", shape())

# An unknown name is ignored and the current shape returned: the fork checks
# the shape table in the Turtle() constructor but not in shape().
print("unknown shape ->", shape("dinosaur"))
