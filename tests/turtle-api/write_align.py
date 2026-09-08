# write(): fonts, alignment, and move=True advancing the turtle.
from turtle import *
speed(0)
hideturtle()

penup(); setpos(-200, 150); pendown()
write("default font")                                  # no font: canvas default
penup(); setpos(-200, 100); pendown()
write("Arial 20 normal", font=("Arial", 20, "normal"))
penup(); setpos(-200, 50); pendown()
write("bold 16", font=("Arial", 16, "bold"))
penup(); setpos(-200, 0); pendown()
write("size as string", font=("Arial", "18pt", "italic"))

# move=True advances the turtle by the text width, so the arrow butts up to it
penup(); setpos(-200, -60); pendown()
write("moved->", move=True, font=("Arial", 16, "normal"))
forward(40)
print("after move x", round(xcor(), 3))

penup(); setpos(0, -140); pendown()
write("centre", align="center", font=("Arial", 16, "normal"))
penup(); setpos(0, -180); pendown()
write("right", align="right", font=("Arial", 16, "normal"))
