# degrees(n) / radians(), and more than one turtle on the canvas.
from turtle import *
import math

speed(0)
hideturtle()

left(90)
print("heading degrees", round(heading(), 3))
radians()
print("heading radians", round(heading(), 6), "expected", round(math.pi / 2, 6))
degrees()
print("back to degrees", round(heading(), 3))
degrees(400)                # a 400-unit circle, as the turtle docs allow
print("heading in 400ths", round(heading(), 3))
degrees()

a = Turtle("circle")
a.color("red")
a.pensize(3)
for _ in range(4):
    a.forward(70)
    a.left(90)

b = a.clone()               # same state, independent from here on
b.color("blue")
b.left(45)
for _ in range(4):
    b.forward(70)
    b.left(90)
print("turtles", len(turtles()))
print("a", round(a.xcor(), 3), round(a.ycor(), 3), "b", round(b.xcor(), 3), round(b.ycor(), 3))
