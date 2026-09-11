"""Editor-side Python prelude, executed once when the Pyodide runtime boots.

Everything here is about making CPython behave the way the curriculum expects
of Skulpt:

  * `input()` and `sleep()` are *blocking* calls that yield to the browser,
    built on JSPI via pyodide.ffi.run_sync. 173 curriculum files call input().
  * `sleep()` and `clear()` are global builtins that are never imported.
  * A stop request raised from JavaScript surfaces as KeyboardInterrupt.

Kept as a real .py file, not a JS string, so a SyntaxError points somewhere.
"""

import builtins
import io
import sys
import time
import warnings

import _host
from pyodide.ffi import run_sync


# --- output ---------------------------------------------------------------
# With isatty() false, CPython block-buffers stdout at 8 KB, so csinsc's
# slowPrint - which writes one character at a time with end="" and no flush -
# would arrive in bursts instead of typing itself out. Measured, not assumed:
# see tests/spike-pyodide.html.
def _unbuffer_streams():
    sys.stdout = io.TextIOWrapper(
        open(1, "wb", buffering=0), encoding="utf-8",
        errors="replace", write_through=True,
    )
    sys.stderr = io.TextIOWrapper(
        open(2, "wb", buffering=0), encoding="utf-8",
        errors="replace", write_through=True,
    )


# --- blocking calls -------------------------------------------------------
def check_stop():
    """Raise if the Stop button was pressed."""
    if _host.isStopped():
        raise KeyboardInterrupt()


# Backwards-compatible alias used inside this module.
_check_stop = check_stop


# Yield to the browser at most once per animation frame. Both the loop-back-edge
# hook and `label` call this; a program hitting it thousands of times a second
# must not spend a frame on each.
_FRAME_MS = 16
_last_yield = [0.0]


def maybe_yield():
    now = time.monotonic() * 1000.0
    if now - _last_yield[0] < _FRAME_MS:
        return
    _last_yield[0] = now
    block(_host.frameYield())


def reset_yield_clock():
    _last_yield[0] = 0.0


def block(promise):
    """The single chokepoint for every blocking call.

    run_sync suspends the WebAssembly stack, so the browser keeps painting and
    handling clicks while Python waits. Every blocking builtin goes through
    here, which means stop-checking lives in exactly one place.
    """
    try:
        result = run_sync(promise)
    except BaseException:
        # Stop rejects every in-flight promise, which arrives here as a
        # JsException. Without this the student would get a raw JavaScript
        # traceback instead of "Stopped!" every time they press the button.
        _check_stop()
        raise
    _check_stop()
    return result


def _input(prompt=""):
    # CPython's input() writes the prompt to stdout, and so did Skulpt when
    # inputfunTakesPrompt was false - which is every non-canvas program. Leaving
    # it out silently dropped the prompt from 173 files' output.
    if prompt:
        sys.stdout.write(str(prompt))
        sys.stdout.flush()
    line = block(_host.readLine(str(prompt)))
    if line is None:
        raise EOFError("EOF when reading a line")
    return str(line)


def _sleep(seconds):
    block(_host.sleep(float(seconds) * 1000))


def _clear():
    _host.clearConsole()


# --- install ---------------------------------------------------------------
def install():
    _unbuffer_streams()

    # sys.stdin is never used: input() is overridden above. Left in error mode
    # so a stray sys.stdin.read() raises instead of silently opening a native
    # browser prompt (Pyodide's default handler).
    builtins.input = _input

    # These two are globals in the fork - never imported - and between them
    # they appear in 113 curriculum files.
    builtins.sleep = _sleep
    builtins.clear = _clear

    # time.sleep would busy-block the main thread and freeze the page. csinsc
    # does `from time import sleep`, so this has to be patched before any
    # classroom module is imported.
    import time
    time.sleep = _sleep

    # The two y-axis modes, and only those.
    #
    # Builtin PyAngelo installs its whole constant set when a program opens a
    # canvas - which leaves setCanvasSize(600, 400, CARTESIAN) unable to name
    # the constant its own documentation tells you to use, because it is what
    # defines it. The fork has the same hole and students work around it by
    # taking the default.
    #
    # These two are safe to hoist because nothing else defines them. The colour
    # constants deliberately are NOT hoisted: RED, BLUE and friends mean
    # integers there and escape strings in console.js, and installing them
    # early would break every program that prints in colour.
    builtins.CARTESIAN = 1
    builtins.JAVASCRIPT = 2


def bind_host_names(entries):
    """Bind the names console.js declared into the Host registry.

    `entries` is the registry list, converted from JS. Constants are plain
    strings; functions are JS callables that Pyodide will hand native
    arguments.
    """
    bound = {"constant": 0, "function": 0, "alias": 0, "skipped": []}
    for entry in entries:
        kind = entry["kind"]
        name = entry["name"]
        try:
            if kind == "constant":
                setattr(builtins, name, entry["value"])
                bound["constant"] += 1
            elif kind == "alias":
                setattr(builtins, name, getattr(builtins, entry["target"]))
                bound["alias"] += 1
            else:
                setattr(builtins, name, entry["fn"])
                bound["function"] += 1
        except Exception as exc:  # noqa: BLE001 - report, never abort the boot
            bound["skipped"].append("%s (%s)" % (name, exc))
    return bound


def _report(exc):
    """Print a traceback with this file's frames removed.

    A student's error should not be buried under run_user_code/exec frames from
    the editor's own prelude. Everything from the first `<stdin>.py` frame
    onwards is theirs; anything above it is ours.
    """
    import traceback

    tb = exc.__traceback__
    while tb is not None and tb.tb_frame.f_code.co_filename != USER_FILENAME:
        tb = tb.tb_next
    # tb is None for a SyntaxError (no frames) or an error raised entirely
    # inside the prelude - in the latter case the full traceback is the honest
    # thing to show, because it is our bug, not theirs.
    if tb is None and not isinstance(exc, SyntaxError):
        tb = exc.__traceback__
    sys.stderr.write("".join(traceback.format_exception(type(exc), exc, tb)))


USER_FILENAME = "<stdin>.py"


def run_user_code(src):
    """Entry point, called from JS with callPromising so run_sync works.

    Compiled as "<stdin>.py" so tracebacks carry the filename the editor
    reports line numbers against.

    Errors are reported here rather than propagating to JavaScript: CPython's
    own traceback is more useful than anything the JS side could reconstruct,
    and letting it escape would print it twice.
    """
    import gotolabel
    import yielding

    module = {"__name__": "__main__", "__builtins__": builtins}
    builtins.goto = gotolabel._Goto()
    builtins.label = gotolabel._Label()

    traced = False
    yielded = False
    try:
        with warnings.catch_warnings():
            # CPython 3.12+ warns about invalid escape sequences such as the
            # "\ " and "\:" inside the curriculum's ASCII art. The warning goes
            # to stderr, so a student would see red text above their drawing
            # about behaviour that changes in some future Python. Skulpt said
            # nothing. Suppressed here; the handful of affected .py files should
            # be corrected to raw strings separately.
            warnings.simplefilter("ignore", SyntaxWarning)
            code = compile(src, USER_FILENAME, "exec")
            # Inside the same suppression: install() parses the source again to
            # find the labels, and ast.parse emits the very same warnings.
            # Duplicate or undefined labels are compile-time errors in Skulpt
            # too, so they are raised here alongside real SyntaxErrors.
            traced = gotolabel.install(src)
        # Every program gets loop yielding, matching Skulpt's
        # killableWhile: true. Without it a `while True:` game loop holds
        # the main thread and the tab stops responding entirely.
        reset_yield_clock()
        yielded = yielding.install(code)
    except SyntaxError as exc:
        _report(exc)
        return
    try:
        exec(code, module)
    except KeyboardInterrupt:
        # The Stop button. Matches what the Skulpt path printed.
        sys.stderr.write("Stopped!\n")
    except SystemExit:
        pass
    except BaseException as exc:  # noqa: BLE001 - this is the top of the stack
        _report(exc)
    finally:
        if yielded:
            yielding.uninstall()
        if traced:
            gotolabel.uninstall()
