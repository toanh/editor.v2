# circle(): the arc decomposition, partial extents and negative radii.
# Nothing in projects/ calls circle() at all.
from turtle import *
speed(0)
hideturtle()

circle(40)                  # full circle, default step count
penup(); setpos(120, 0); pendown()
circle(40, 180)             # half circle
penup(); setpos(-120, 0); pendown()
circle(-40)                 # negative radius turns the other way
penup(); setpos(0, 120); pendown()
circle(40, 360, 6)          # explicit steps: a hexagon
penup(); setpos(0, -120); pendown()
color("red")
circle(30, 270)             # three quarters, coloured

print("heading", round(heading(), 3))
print("pos", round(xcor(), 3), round(ycor(), 3))
