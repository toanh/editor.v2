# Pen width, and fill colour held separately from pen colour.
from turtle import *
speed(0)
hideturtle()

for w in (1, 3, 8, 15):
    pensize(w)
    forward(60)
    left(90)
print("pensize", pensize())

pensize(2)
penup(); setpos(-150, -150); pendown()
pencolor("blue")
fillcolor("orange")         # distinct from the pen: outline blue, inside orange
begin_fill()
for _ in range(3):
    forward(80)
    left(120)
end_fill()
print("pencolor", pencolor(), "fillcolor", fillcolor())

# A fill that lifts the pen part-way through: the polygon still closes, but
# the lifted edge is not stroked.
penup(); setpos(60, -150); pendown()
color("black", "yellow")
begin_fill()
forward(70); left(90)
penup(); forward(70); pendown()
left(90); forward(70)
end_fill()
