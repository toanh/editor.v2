"""Let long-running loops breathe, and let the Stop button reach them.

Skulpt compiled every `while` into a suspension point (`killableWhile: true`),
which is the only reason a `while True:` game loop did not freeze the tab. Real
CPython has no such thing: a loop that never calls input() or sleep() holds the
main thread until it finishes. demos/endless_runner locks the browser solid
without this - measured, not theorised.

PEP 669 gives the exact equivalent: a JUMP event on every loop back-edge. It is
far cheaper than Skulpt's version, which cost a full macrotask per iteration.

  * Forward jumps return DISABLE, so they are never reported again.
  * Back-edges ask the prelude's maybe_yield() whether to give the browser a
    turn (see the pacing notes there), and check whether Stop was pressed.
  * Events are set per code object with set_local_events, so the stdlib,
    csinsc and everything else the program imports run at full speed.

Uses PROFILER_ID rather than DEBUGGER_ID because goto/label installs a
sys.settrace hook, and legacy tracing occupies the debugger slot.
"""

import sys

from prelude import check_stop, maybe_yield

_TOOL = sys.monitoring.PROFILER_ID
_TOOL_NAME = "pyeditor-yield"
_installed = []
_active = False


def _on_jump(code, instruction_offset, destination_offset):
    if destination_offset > instruction_offset:
        # A forward jump is an if/break/continue-past, not a loop back-edge.
        # Disabling means this location is never reported again.
        return sys.monitoring.DISABLE
    maybe_yield()
    check_stop()


def _code_objects(code, seen):
    """The program's own code objects, including nested functions."""
    if id(code) in seen:
        return
    seen.add(id(code))
    yield code
    for const in code.co_consts:
        if hasattr(const, "co_code"):
            yield from _code_objects(const, seen)


def install(code):
    """Arm loop yielding for one compiled program."""
    global _active
    if _active:
        uninstall()
    try:
        sys.monitoring.use_tool_id(_TOOL, _TOOL_NAME)
    except ValueError:
        # Someone else holds the slot - better to run without yielding than to
        # refuse to run at all.
        return False
    sys.monitoring.register_callback(_TOOL, sys.monitoring.events.JUMP, _on_jump)
    _installed.clear()
    for co in _code_objects(code, set()):
        sys.monitoring.set_local_events(_TOOL, co, sys.monitoring.events.JUMP)
        _installed.append(co)
    _active = True
    return True


def uninstall():
    global _active
    if not _active:
        return
    for co in _installed:
        try:
            sys.monitoring.set_local_events(_TOOL, co, 0)
        except Exception:
            pass
    _installed.clear()
    try:
        sys.monitoring.register_callback(_TOOL, sys.monitoring.events.JUMP, None)
        sys.monitoring.free_tool_id(_TOOL)
    except Exception:
        pass
    _active = False
