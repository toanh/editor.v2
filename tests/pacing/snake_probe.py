from pyangelo import *
from random import *
import time as _t
_moves = []
_iters = [0]
_t0 = _t.time()

blockSize = 20
font = str(blockSize) + "px consolas"

progress = -1
start = 0
gameState = 'intro'

speed = 4

# Initial snake co-ordinates
snake = [[3 * blockSize, 17 * blockSize], \
         [2 * blockSize ,17 * blockSize], \
         [1 * blockSize, 17 * blockSize]]
food = [7 * blockSize, 19 * blockSize]    
dx = 1
dy = 0
progress = 0     
played = False


label .here
_iters[0] += 1
if _t.time() - _t0 > 8:
    goto .finish
clearScreen(BLACK)
drawText("=== SNAKE ===", 80, 460, font, WHITE)
drawText("Score: " + str(start), 18, 410, font, WHITE)

# draw the border
drawRect(18, 35, \
         290, 365, 1, WHITE)    

if gameState == 'intro':
    if played:
        font = str(blockSize * 1.5) + "px consolas"
        drawText("YOU DIED!", 85, 310, font, RED)
    font = str(blockSize) + "px consolas"
    drawText("Controls:", 105, 270, font, WHITE)
    drawText("'W' moves up", 75, 235, font, WHITE)
    drawText("'S' moves down", 75, 205, font, WHITE)
    drawText("'A' moves left", 75, 175, font, WHITE)
    drawText("'D' moves right", 75, 145, font, WHITE)
    
    drawText("Press 'ENTER' to play"\
                        , 45, 85, font, WHITE)
                        
    progress = progress + speed * timeElapsed()
    if progress >= 1.0:
        progress = 0
        _moves.append(_t.time())
        # move the snake body
        for n in range(len(snake) - 1, 0, -1):
          snake[n][0] = snake[n - 1][0]
          snake[n][1] = snake[n - 1][1]      
        snake[0][0] = snake[0][0] + dx * blockSize
        snake[0][1] = snake[0][1] + dy * blockSize

    # draw food
    drawText("🍓", food[0], food[1], font)
    # draw head
    drawText("😀", snake[0][0], snake[0][1], font)
    # draw body
    for n, body in enumerate(snake[1:]):
        drawText("📀", body[0], body[1], font)

    if snake[0][0] <= 18 or snake[0][1] >= 400 or snake[0][0] >= 300 or snake[0][1] <= 20: 
        snake = [[3 * blockSize, 17 * blockSize], \
         [2 * blockSize ,17 * blockSize], \
         [1 * blockSize, 17 * blockSize]]
        food = [7 * blockSize, 19 * blockSize]     
        dx = 1
        dy = 0                   


    if isKeyReleased('Enter'):
        gameState = 'play'
        # Initializing values
        start = 0
        speed = 4
        
        # Initial snake co-ordinates
        snake = [[4 * blockSize, 15 * blockSize], \
                 [3 * blockSize ,15 * blockSize], \
                 [2 * blockSize, 15 * blockSize]]
        food = [7 * blockSize, 13 * blockSize]    
        dx = 1
        dy = 0
        progress = 0   
        played = True
elif gameState == 'play':
    # check for keys
    if isKeyPressed('d'):
        dx = 1
        dy = 0
    elif isKeyPressed('a'):
        dx = -1
        dy = 0
    elif isKeyPressed('s'):
        dx = 0
        dy = -1
    elif isKeyPressed('w'):
        dx = 0
        dy = 1

    progress = progress + speed * timeElapsed()
    if progress >= 1.0:
        progress = 0
        # move the snake body
        for n in range(len(snake) - 1, 0, -1):
          snake[n][0] = snake[n - 1][0]
          snake[n][1] = snake[n - 1][1]      
        snake[0][0] = snake[0][0] + dx * blockSize
        snake[0][1] = snake[0][1] + dy * blockSize

    # draw food
    drawText("🍓", food[0], food[1], font)
    # draw head
    drawText("😀", snake[0][0], snake[0][1], font)
    # draw body
    for n, body in enumerate(snake[1:]):
        drawText("📀", body[0], body[1], font)

    if snake[0][0] <= 18 or snake[0][1] >= 400 or snake[0][0] >= 300 or snake[0][1] <= 20: 
        gameState = 'intro'            

    # did the snake eat itself?
    if snake[0] in snake[1:]:
        gameState = 'intro'
    
    # snake eats food
    if snake[0] == food:
      # grow snake
      snake.append([snake[-1][0], snake[-1][1]])
      start += 100
      speed += 0.25
      # generate new food
      # can't be located in the snake
      while food in snake:
        foodX = randint(1, 14) * blockSize
        foodY = randint(2, 19) * blockSize
        food = [foodX, foodY]         
goto .here
label .finish
def _stats(title, xs):
    if not xs:
        print(title, "none")
        return
    s = sorted(xs)
    def p(q):
        return s[min(len(s) - 1, int(len(s) * q))]
    print(title, "n", len(s), "p50", round(p(0.5)), "p95", round(p(0.95)), "max", round(s[-1]))
_gaps = [(_moves[i] - _moves[i - 1]) * 1000 for i in range(2, len(_moves))]
print("iterations per second", round(_iters[0] / 8.0))
_stats("ms between moves (want 250):", _gaps)
