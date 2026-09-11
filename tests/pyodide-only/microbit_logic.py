# The parts of the micro:bit module that can be checked without a board:
# the compass arithmetic, and what happens when pairing cannot succeed.
#
# getCompass is called unbound, so no connection is attempted for that half.
from microbit import Microbit

for bearing in (0, 10, 22, 23, 45, 67, 68, 90, 112, 113, 157, 180,
                202, 247, 292, 337, 338, 350, 359, 360, -1):
    print(bearing, Microbit.getCompass(None, bearing))

# Headless Chrome exposes navigator.bluetooth but refuses requestDevice without
# a user gesture, so this exercises the failed-pairing path. As in the fork, the
# constructor reports the problem and returns - it does not raise - so a lesson
# that carries on will find an unconnected board rather than a traceback.
board = Microbit(timeout=2)
print("constructor returned, connected =", bool(board.uBit.isConnected()))
