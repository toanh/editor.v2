# tracer(0) suppresses painting until update(), and the speed() name table.
from turtle import *
hideturtle()

print("default speed", speed())
for name in ("fastest", "fast", "normal", "slow", "slowest"):
    speed(name)
    print(name, speed())
speed(0)

tracer(0)                   # draw with no intermediate frames at all
for i in range(36):
    forward(100)
    left(170)
update()
print("tracer", tracer())

# Deliberately not testing speed(<not a number>): Skulpt's argument bridge
# remaps an arbitrary object to undefined, which $speed reads as "no argument"
# and answers as a getter, so the fork raises nothing. Matching that would mean
# making a type error silently succeed, which is not worth it.
