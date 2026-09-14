"""The step debugger and breakpoints, on real CPython.

Skulpt compiled a suspension before every statement while `debugging` was on,
and runtime-skulpt.js turned those into pauses: find the deepest frame running
the student's file and, whenever its line number changes, hand {lineno, locals}
to the editor and wait for a button.

CPython has that hook natively. sys.monitoring's LINE event fires each time
execution reaches a new line, and set_local_events scopes it to the program's
own code objects - so the stdlib and the classroom modules are never reported,
and every pause is on a line the student wrote.

The pause itself is the prelude's block() on a promise the editor resolves with
"step" (Next) or "continue" (Continue). Blocking from inside a sys.monitoring
callback is the same thing yielding.py does on every loop back-edge. Stop
rejects that promise, so pressing Stop while paused raises KeyboardInterrupt at
the paused line, exactly like Stop during input().

Breakpoints without stepping cost next to nothing. A line that is not a
breakpoint returns DISABLE, and CPython never reports that location again. When
the student presses Next at a breakpoint, restart_events() brings every line
back; Continue lets them fall silent again as they are reached.

One line CPython does not report: a `label` reached by a goto. gotolabel.py
jumps by assigning frame.f_lineno, and execution then resumes *on* the label
line without ever "arriving" at it, so no LINE event fires. Skulpt paused there,
and a breakpoint on a label has to work after a jump too. So the goto tracer
records where it jumped (goto_jumped), and `label` pauses through
label_reached() when - and only when - it was that jump's target.

That is deliberately not inferred from "the last line LINE reported": while
running to a breakpoint, lines disable their own LINE events after the first
pass, so that record goes stale and the second jump onto a label looked like
ordinary flow. tests/check-stepping.sh's breakpoint-on-label caught it.

Measured against Skulpt pause by pause in tests/check-stepping.sh. One accepted
difference, with two faces: CPython reports a `for` line *before* taking the
next item, where Skulpt paused after it. So the watch table on a `for` line
shows the loop variable's current value rather than the next one - which is
what every other line shows, the state before the highlighted line runs - and
the `for` line is reported once more when the loop runs out, as Skulpt already
did for `while`.
"""

import sys

import _host
from prelude import USER_FILENAME, block
from pyodide.ffi import to_js
from yielding import _code_objects

_M = sys.monitoring
_TOOL_NAME = "pyeditor-step"

_state = {
    "tool": None,
    "stepping": False,
    "autostep": False,
    "breakpoints": frozenset(),
    "codes": [],
    "jumped_to": None,
}

# The watch table shows plain data. Skulpt's listed only objects carrying a
# primitive `.v`, which left out functions, classes, modules and instances;
# this keeps the same boundary.
_SHOWN = (bool, int, float, complex, str, list, tuple, dict, set, frozenset, type(None))


def _show(value):
    if isinstance(value, str):
        return value
    text = repr(value)
    return text if len(text) <= 200 else text[:197] + "..."


def _locals(frame):
    """[[name, value], ...] from the paused frame outwards, innermost first -
    the order Skulpt's collectLocals produced."""
    rows = []
    seen = set()
    while frame is not None:
        if frame.f_code.co_filename == USER_FILENAME:
            for name, value in list(frame.f_locals.items()):
                if name in seen or (name.startswith("__") and name.endswith("__")):
                    continue
                if not isinstance(value, _SHOWN):
                    continue
                seen.add(name)
                rows.append([name, _show(value)])
        frame = frame.f_back
    return rows


def _pause(frame, line):
    """Pause at `line` if stepping or on a breakpoint. Returns True if it did."""
    state = _state
    at_breakpoint = line in state["breakpoints"]
    if not state["stepping"] and not at_breakpoint:
        return False

    # ?autostep is slow-motion playback with no table, as it was under Skulpt -
    # unless it has stopped at a breakpoint, where the student is looking.
    rows = None
    if at_breakpoint or not state["autostep"]:
        rows = to_js(_locals(frame))

    command = block(_host.debugPause(line, rows, "breakpoint" if at_breakpoint else "step"))

    if command == "continue":
        state["stepping"] = False
    elif not state["stepping"]:
        state["stepping"] = True
        # Lines silenced with DISABLE while running to this breakpoint must be
        # reported again now that every line is a pause.
        _M.restart_events()
    return True


def _on_line(code, line):
    state = _state
    if state["jumped_to"] == line:
        # CPython did report the jump target after all; label must not pause
        # a second time.
        state["jumped_to"] = None
    if not state["stepping"] and line not in state["breakpoints"]:
        return _M.DISABLE
    _pause(sys._getframe(1), line)


def active():
    return _state["tool"] is not None


def goto_jumped(target_line):
    """Called by the goto tracer just before it moves execution."""
    _state["jumped_to"] = target_line


def label_reached(frame):
    """Called by `label`. Pauses on the label line when a goto jumped onto it,
    which CPython does not report as reaching a new line."""
    if frame.f_code.co_filename != USER_FILENAME:
        return
    line = frame.f_lineno
    if _state["jumped_to"] != line:
        return          # ordinary flow: LINE reported this line itself
    _state["jumped_to"] = None
    _pause(frame, line)


def install(code, stepping, autostep, breakpoints):
    """Arm the debugger for one compiled program. Returns False when there is
    nothing to do, so an ordinary Run pays nothing at all."""
    lines = frozenset(int(n) for n in (breakpoints or ()))
    if not stepping and not lines:
        return False

    tool = None
    for candidate in (_M.DEBUGGER_ID, 3, 4):
        try:
            _M.use_tool_id(candidate, _TOOL_NAME)
            tool = candidate
            break
        except ValueError:
            continue
    if tool is None:
        return False

    _state.update(tool=tool, stepping=bool(stepping), autostep=bool(autostep),
                  breakpoints=lines, codes=[], jumped_to=None)
    _M.register_callback(tool, _M.events.LINE, _on_line)
    for co in _code_objects(code, set()):
        _M.set_local_events(tool, co, _M.events.LINE)
        _state["codes"].append(co)
    return True


def uninstall():
    tool = _state["tool"]
    if tool is None:
        return
    for co in _state["codes"]:
        try:
            _M.set_local_events(tool, co, 0)
        except Exception:
            pass
    try:
        _M.register_callback(tool, _M.events.LINE, None)
        _M.free_tool_id(tool)
    except Exception:
        pass
    _state.update(tool=None, codes=[], stepping=False, breakpoints=frozenset(), jumped_to=None)
