# Builtin PyAngelo's functions and classes exist in every program, before and
# without setCanvasSize(), because the fork registers them at load. Its
# constants must NOT exist yet: RED has to stay the console's colour escape
# until a program asks for a canvas.
#
# demos/pong.py calls loadSound() and stopAllSounds() beside
# `from pyangelo import *` and never opens a builtin canvas. Under Pyodide it
# died with "NameError: name 'loadSound' is not defined" while these waited for
# setCanvasSize(). Point was missing from the port altogether.
import builtins

names = ["loadSound", "playSound", "stopSound", "pauseSound", "stopAllSounds",
         "background", "circle", "text", "constrain", "dist", "mapToRange",
         "Colour", "Point", "Image", "loadImage", "isKeyPressed", "say", "talk"]
print("missing:", [name for name in names if not hasattr(builtins, name)])
print("RED is still the console escape:", isinstance(RED, str))
print("constrain:", constrain(15, 0, 10))
print(Point(3, 4))
stopAllSounds()
