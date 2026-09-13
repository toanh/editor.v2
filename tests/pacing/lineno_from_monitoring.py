# Spike: can a sys.monitoring LINE callback move execution by assigning
# frame.f_lineno?
#
# If it can, goto no longer needs a global sys.settrace hook. A monitoring
# callback may return DISABLE for every line that is NOT a goto, after which
# CPython never reports those lines again - so the per-line cost that currently
# dominates a goto frame loop would fall to almost nothing.
#
# The shapes tested are the ones the curriculum uses: a forward jump out of an
# if body, and a backward jump that forms a loop, both in a module-level code
# object (compiled exactly as run_user_code compiles a student's program).
import sys

M = sys.monitoring
TOOL = 3            # a free tool id; the editor uses PROFILER_ID for yielding

SRC = """
out.append("start")
n = 0
if True:
    out.append("forward-from")
    out.append("SKIPPED 1")
    out.append("SKIPPED 2")
out.append("forward-landed")
n = n + 1
out.append("loop body %d" % n)
if n < 3:
    out.append("backward-from")
out.append("end")
"""
FORWARD_FROM, FORWARD_TO = 5, 8
BACKWARD_FROM, BACKWARD_TO = 12, 9

code = compile(SRC, "<stdin>.py", "exec")
out = []
events = []


def on_line(c, line):
    if c is not code:
        return M.DISABLE
    frame = sys._getframe(1)
    target = {FORWARD_FROM: FORWARD_TO, BACKWARD_FROM: BACKWARD_TO}.get(line)
    if target is None:
        return M.DISABLE            # never report this line again
    try:
        frame.f_lineno = target
        events.append("jump %d->%d ok" % (line, target))
    except Exception as exc:        # noqa: BLE001
        events.append("jump %d->%d refused: %s: %s" % (line, target, type(exc).__name__, exc))
    return None


M.use_tool_id(TOOL, "lineno-spike")
M.register_callback(TOOL, M.events.LINE, on_line)
M.set_local_events(TOOL, code, M.events.LINE)
try:
    exec(code, {"out": out})
except Exception as exc:            # noqa: BLE001
    events.append("exec raised %s: %s" % (type(exc).__name__, exc))
finally:
    M.set_local_events(TOOL, code, 0)
    M.register_callback(TOOL, M.events.LINE, None)
    M.free_tool_id(TOOL)

print("python", sys.version.split()[0])
for e in events:
    print("event:", e)
for line in out:
    print("out:  ", line)
