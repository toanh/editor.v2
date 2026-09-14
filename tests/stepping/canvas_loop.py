from pyangelo import *
frames = 0
label .top
clearScreen(BLACK)
drawText("frame " + str(frames), 10, 100, "20px monospace", WHITE)
frames = frames + 1
if frames < 3:
    goto .top
print("drew", frames, "frames")
