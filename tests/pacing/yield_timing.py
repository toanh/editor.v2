# Does a bare frame yield under JSPI come back within one animation frame?
#
# block(_host.frameYield()) is what every Pyodide yield comes down to - the loop
# back-edge hook, goto's label, pyangelo, turtle. If this alone regularly takes
# two or more frames, the problem is below the programs entirely.
#
# The loop-yield hook is neutralised so the only yields measured are these.
import time

import _host
import yielding
from prelude import block

yielding.maybe_yield = lambda: None
yielding.check_stop = lambda: None

samples = []
for i in range(260):
    a = time.perf_counter()
    block(_host.frameYield())
    samples.append((time.perf_counter() - a) * 1000)
samples = samples[20:]          # skip warm-up

s = sorted(samples)


def pct(p):
    return s[min(len(s) - 1, int(len(s) * p))]


print("frameYield ms  p50 %.1f  p95 %.1f  p99 %.1f  max %.1f" % (pct(0.5), pct(0.95), pct(0.99), s[-1]))
print("yields over 20ms: %d, over 34ms: %d, of %d" % (
    len([x for x in samples if x > 20]), len([x for x in samples if x > 34]), len(samples)))
