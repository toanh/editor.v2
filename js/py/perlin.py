"""`from perlin import noise, noiseSeed, noiseDetail` - Perlin noise.

Ported from the fork's src/lib/perlin.js, which is p5.js's implementation,
which came from PApplet.java by way of toxi and farbrausch. It is pure
arithmetic with no browser in it, so unlike the rest of the classroom modules
this one is Python all the way down - no host bridge, and exactly reproducible.

Two details had to survive the move from JavaScript, and neither is optional:

  * `<<` on a JavaScript number is a *32-bit signed* shift, so `xi <<= 1`
    wraps at 2**31. Python integers do not, and after enough octaves the index
    arithmetic would drift apart. `_i32()` puts the wrap back.
  * `Math.floor` and Python's `int()` disagree for negatives - but the inputs
    are made positive first, so `int()` is safe here. Kept as `math.floor`
    anyway, to stay readable next to the original.
"""

import math
import random

_PERLIN_YWRAPB = 4
_PERLIN_YWRAP = 1 << _PERLIN_YWRAPB
_PERLIN_ZWRAPB = 8
_PERLIN_ZWRAP = 1 << _PERLIN_ZWRAPB
_PERLIN_SIZE = 4095

_octaves = 4          # medium smooth
_amp_falloff = 0.5    # 50% reduction per octave
_perlin = None        # built lazily by noise() or noiseSeed()


def _scaled_cosine(i):
    return 0.5 * (1.0 - math.cos(i * math.pi))


def _i32(n):
    """JavaScript's 32-bit signed shift semantics, which Python's ints lack."""
    n &= 0xFFFFFFFF
    return n - 0x100000000 if n >= 0x80000000 else n


def noise(x, y=0, z=0):
    """Perlin noise at the given coordinates, always between 0.0 and 1.0."""
    global _perlin
    if _perlin is None:
        _perlin = [random.random() for _ in range(_PERLIN_SIZE + 1)]

    x = -x if x < 0 else x
    y = -y if y < 0 else y
    z = -z if z < 0 else z

    xi, yi, zi = math.floor(x), math.floor(y), math.floor(z)
    xf, yf, zf = x - xi, y - yi, z - zi

    r = 0.0
    ampl = 0.5

    for _ in range(_octaves):
        of = xi + _i32(yi << _PERLIN_YWRAPB) + _i32(zi << _PERLIN_ZWRAPB)

        rxf = _scaled_cosine(xf)
        ryf = _scaled_cosine(yf)

        n1 = _perlin[of & _PERLIN_SIZE]
        n1 += rxf * (_perlin[(of + 1) & _PERLIN_SIZE] - n1)
        n2 = _perlin[(of + _PERLIN_YWRAP) & _PERLIN_SIZE]
        n2 += rxf * (_perlin[(of + _PERLIN_YWRAP + 1) & _PERLIN_SIZE] - n2)
        n1 += ryf * (n2 - n1)

        of += _PERLIN_ZWRAP
        n2 = _perlin[of & _PERLIN_SIZE]
        n2 += rxf * (_perlin[(of + 1) & _PERLIN_SIZE] - n2)
        n3 = _perlin[(of + _PERLIN_YWRAP) & _PERLIN_SIZE]
        n3 += rxf * (_perlin[(of + _PERLIN_YWRAP + 1) & _PERLIN_SIZE] - n3)
        n2 += ryf * (n3 - n2)

        n1 += _scaled_cosine(zf) * (n2 - n1)

        r += n1 * ampl
        ampl *= _amp_falloff
        xi = _i32(xi << 1)
        yi = _i32(yi << 1)
        zi = _i32(zi << 1)
        xf *= 2
        yf *= 2
        zf *= 2

        if xf >= 1.0:
            xi += 1
            xf -= 1
        if yf >= 1.0:
            yi += 1
            yf -= 1
        if zf >= 1.0:
            zi += 1
            zf -= 1

    return r


def noiseDetail(lod, falloff):
    """Number of octaves, and how fast their amplitude falls off."""
    global _octaves, _amp_falloff
    if lod > 0:
        _octaves = lod
    if falloff > 0:
        _amp_falloff = falloff


def noiseSeed(seed):
    """Reseeds the noise table, so a sketch can be reproduced exactly."""
    global _perlin
    # The same linear congruential generator p5.js uses - constants from
    # Numerical Recipes. Reproduced rather than swapped for random.seed()
    # because the sequence, and therefore every picture drawn from it, would
    # otherwise differ from the fork's.
    m = 4294967296
    a = 1664525
    c = 1013904223
    z = (int(random.random() * m) if seed is None else int(seed)) & 0xFFFFFFFF

    table = []
    for _ in range(_PERLIN_SIZE + 1):
        z = (a * z + c) % m
        table.append(z / m)
    _perlin = table
