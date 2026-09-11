"""`from vector import Vector` - a 2D vector, for builtin-PyAngelo sketches.

Ported from the fork's src/lib/vector.py, which is pure Python. Two things in it
are broken and are fixed here rather than reproduced, because neither can be
something a working program relies on:

  * `__radd__` referenced an undefined name `other`, so `0 + v` raised
    NameError. Used by sum().
  * `__div__` is the Python 2 spelling; Python 3 dispatches `/` to
    `__truediv__`, so `v / 2` never reached it. Both names now work.

`TWO_PI` comes from builtin PyAngelo, which installs it into builtins when a
program opens a canvas. Imported lazily inside random2D() so that this module
can be imported before that happens.
"""

import math
import random


class Vector:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __repr__(self):
        return "Vector (" + str(self.x) + ", " + str(self.y) + ")"

    __str__ = __repr__

    def __add__(self, v):
        return Vector(self.x + v.x, self.y + v.y)

    def add(self, v):
        self.x += v.x
        self.y += v.y

    def __radd__(self, v):
        # sum() starts from 0, which is why this exists at all. The fork tested
        # a name that did not exist here.
        if v == 0:
            return self
        return self.__add__(v)

    def __sub__(self, v):
        return Vector(self.x - v.x, self.y - v.y)

    def sub(self, v):
        self.x -= v.x
        self.y -= v.y

    def __mul__(self, n):
        return Vector(self.x * n, self.y * n)

    def mult(self, n):
        self.x *= n
        self.y *= n

    def __truediv__(self, n):
        return Vector(self.x / n, self.y / n)

    # The fork's Python 2 spelling, kept so any code that called it directly
    # still works.
    __div__ = __truediv__

    def div(self, n):
        self.x /= n
        self.y /= n

    def mag(self):
        return math.sqrt(self.x ** 2 + self.y ** 2)

    def normalise(self):
        m = self.mag()
        if m != 0:
            self.div(m)

    def limit(self, limit):
        if self.mag() > limit:
            self.normalise()
            self.mult(limit)

    @staticmethod
    def random2D():
        angleRadians = random.random() * (2 * math.pi)
        return Vector(math.cos(angleRadians), math.sin(angleRadians))
