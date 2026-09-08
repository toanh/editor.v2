# dot() and stamp() - neither appears anywhere in projects/.
from turtle import *
speed(0)

dot()                       # default size, derived from pensize
penup(); setpos(-150, 100); pendown()
dot(20)                     # explicit size
penup(); setpos(-100, 100); pendown()
dot(30, "red")              # explicit size and colour
penup(); setpos(-50, 100); pendown()
pensize(9)
dot()                       # default size follows the larger pen
pensize(1)

# stamp leaves the cursor behind permanently, on the drawing layer
penup()
for angle in (0, 45, 90, 135, 180):
    setpos(-150 + angle, -100)
    setheading(angle)
    stamp()
print("stamped 5")
