# Perlin noise is pure arithmetic, so it can be checked exactly rather than
# approximately. The expected values were computed by running the fork's
# src/lib/perlin.js algorithm in Node with the same seed.
#
# The seeded generator is reproduced rather than replaced with random.seed()
# precisely so this comparison is possible - and so a sketch drawn from noise
# looks the same under both runtimes.
from perlin import noise, noiseSeed, noiseDetail

noiseSeed(42)
for x, y, z in [(0, 0, 0), (0.5, 0, 0), (1.25, 2.5, 0), (10.125, 0.3, 7.7),
                (100, 100, 100), (0.005, 0, 0), (3.7, 1.2, 0.9)]:
    print("noise(%s, %s, %s) = %.12f" % (x, y, z, noise(x, y, z)))

# Negative coordinates are mirrored, not clamped.
print("mirrored:", noise(-1.25, -2.5, 0) == noise(1.25, 2.5, 0))

# Fewer octaves is a different, smoother sequence.
noiseDetail(1, 0.5)
noiseSeed(42)
print("one octave = %.12f" % noise(1.25, 2.5, 0))
