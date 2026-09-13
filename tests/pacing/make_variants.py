"""Generate instrumented copies of demos/snake.py and demos/pong.py.

    python tests/pacing/make_variants.py

Writes snake_probe.py and pong_probe.py beside this file. Both run unchanged
under either runtime, so the same program can be measured under Skulpt and
Pyodide with tests/pacing/pacing.html:

    node tests/cdp-run.js "http://localhost:8731/tests/pacing/pacing.html?runtime=skulpt&codeurl=tests/pacing/snake_probe.py" "#out" 115000

What each reports, and why it is the number that matters:

  snake_probe  loops per second, and the wall-clock gap between moves. speed=4
               means one move every 250 ms; a player feels late or uneven moves
               long before any frame-rate metric moves.
  pong_probe   loops per second on the intro screen, and what that makes of the
               ball speed and the "Press [space]!" delay. pong moves a fixed step
               per loop, so for pong the loop rate *is* the game speed.

The generated files are scratch output: regenerate rather than edit them, and
do not commit them.

`label` is a keyword in the Skulpt fork's grammar, so nothing generated here may
use it as a name.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

STATS = '''
def _stats(title, xs):
    if not xs:
        print(title, "none")
        return
    s = sorted(xs)
    def p(q):
        return s[min(len(s) - 1, int(len(s) * q))]
    print(title, "n", len(s), "p50", round(p(0.5)), "p95", round(p(0.95)), "max", round(s[-1]))
'''


def read(rel):
    src = open(os.path.join(ROOT, rel), encoding="utf-8").read().split("\n")
    while src and not src[-1].strip():
        src.pop()
    return src


def snake():
    src = read("projects/demos/snake.py")
    assert src[23].strip() == "label .here"
    assert src[48].strip() == "progress = 0" and src[48].startswith("        ")
    assert src[-1].strip() == "goto .here"

    head = ["import time as _t", "_moves = []", "_iters = [0]", "_t0 = _t.time()"]
    after_label = [
        "_iters[0] += 1",
        "if _t.time() - _t0 > 8:",
        "    goto .finish",
    ]
    # line 49 is the intro screen's `progress = 0`: the snake has just moved
    on_move = ["        _moves.append(_t.time())"]
    tail = ["label .finish"] + STATS.strip("\n").split("\n") + [
        "_gaps = [(_moves[i] - _moves[i - 1]) * 1000 for i in range(2, len(_moves))]",
        'print("iterations per second", round(_iters[0] / 8.0))',
        '_stats("ms between moves (want 250):", _gaps)',
    ]
    out = src[:2] + head + src[2:24] + after_label + src[24:49] + on_move + src[49:] + tail
    return "\n".join(out) + "\n"


def pong():
    src = read("projects/demos/pong.py")
    assert src[7].startswith("useMicrobit = True")
    assert src[61] == "while True:"
    assert src[259].startswith("stopAllSounds()")
    src[7] = "useMicrobit = False"      # no board needed; the intro screen is enough

    head = ["import time as _t", "_iters = 0", "_t0 = _t.time()"]
    in_loop = [
        "    _iters = _iters + 1",
        "    if _t.time() - _t0 > 8:",
        "        break",
    ]
    tail = [
        'print("iterations per second", round(_iters / 8.0))',
        'print("intro ball px per second", round(0.08 * _iters / 8.0))',
        'print("seconds until Press [space]! first shows", round(5000 / (_iters / 8.0), 1))',
    ]
    out = src[:3] + head + src[3:62] + in_loop + src[62:260] + tail
    return "\n".join(out) + "\n"


def write(name, text):
    with open(os.path.join(HERE, name), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("wrote", os.path.join("tests", "pacing", name))


write("snake_probe.py", snake())
write("pong_probe.py", pong())
