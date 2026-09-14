"""`goto` and `label` on real CPython.

Skulpt implements these as compiler features: `label` becomes a basic block and
`goto` a patched `$blk = N; continue`. CPython has no such statement, but it
does have the mechanism debuggers use to move the execution point - assigning
`frame.f_lineno` from a trace function - and that is enough.

The pieces:

  * js/pygmi.js rewrites `goto .foo` and `goto foo` into `goto.foo`, which is
    already valid Python: an attribute access on a name.
  * scan() reads the module with `ast` and builds {goto_line: label_line},
    raising the same SyntaxErrors Skulpt raised for a duplicate or undefined
    label - at compile time, before anything runs.
  * A trace function watches for those goto lines and jumps *before* the line
    executes. Jumping at the goto's own line rather than recording an intent
    for the next line matters: projects/demos/snake.py ends with `goto .here`
    as its final line, so there is no next line event to act on.

CPython's rules, measured on 3.10 and again on 3.14 in
tests/spike-pyodide.html: the target's value stack must be a prefix of the
source's. Jumping into an if/elif/else body is therefore fine - those push
nothing - while a `for` or `with` body is refused. The corpus never jumps into
a loop: all 1258 goto/label tokens sit at module level or inside module-level
if-chains.
"""

import ast
import sys
import time
import warnings

import stepper
from prelude import maybe_yield

USER_FILENAME = "<stdin>.py"

# A jump that leaves a local unbound makes CPython warn, on stderr, in red:
# "RuntimeWarning: assigning None to 1 unbound local". At module level the
# locals in question are the hidden iteration variables of comprehensions,
# which 3.12+ inlines into the enclosing frame - so any goto program with a
# list comprehension could print it, about a detail the student never wrote and
# Skulpt never mentioned. The jump itself is correct. Scoped to this module and
# this message, so no warning a student's own code raises is affected.
warnings.filterwarnings(
    "ignore", message=r"assigning None to \d+ unbound local",
    category=RuntimeWarning, module="gotolabel")

# Statements that introduce a new scope. Skulpt scoped labels per compiler
# unit, and the curriculum never puts a goto inside one, so a clear error beats
# silently misbehaving.
_SCOPES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)


def _marker(node):
    """Return ('goto'|'label', name) if this statement is one of ours."""
    if not isinstance(node, ast.Expr):
        return None
    value = node.value
    if not isinstance(value, ast.Attribute):
        return None
    if not isinstance(value.value, ast.Name):
        return None
    if value.value.id in ("goto", "label"):
        return value.value.id, value.attr
    return None


def _walk(body, labels, gotos, in_scope):
    for node in body:
        found = _marker(node)
        if found is not None:
            kind, name = found
            if in_scope:
                raise SyntaxError(
                    "%s %s is only supported at the top level of a program, "
                    "not inside a function or class" % (kind, name),
                    (USER_FILENAME, node.lineno, 1, ""))
            if kind == "label":
                if name in labels:
                    raise SyntaxError(
                        "label %s has already been defined" % name,
                        (USER_FILENAME, node.lineno, 1, ""))
                labels[name] = node.lineno
            else:
                gotos.append((name, node.lineno))
            continue
        nested = in_scope or isinstance(node, _SCOPES)
        for field in ("body", "orelse", "finalbody"):
            child = getattr(node, field, None)
            if child:
                _walk(child, labels, gotos, nested)
        for handler in getattr(node, "handlers", []) or []:
            _walk(handler.body, labels, gotos, nested)


def scan(src):
    """Build {goto_lineno: target_lineno}. Empty dict if the program has none.

    Raises SyntaxError for a duplicate or undefined label, matching what
    Skulpt's compiler did.
    """
    tree = ast.parse(src, USER_FILENAME)
    labels = {}
    gotos = []
    _walk(tree.body, labels, gotos, False)
    if not gotos and not labels:
        return {}

    table = {}
    for name, lineno in gotos:
        if name not in labels:
            raise SyntaxError(
                "label %s is not defined" % name,
                (USER_FILENAME, lineno, 1, ""))
        table[lineno] = labels[name]
    return table


class _Goto:
    """`goto.foo` - a no-op.

    The jump happens in the trace function before this line runs, so reaching
    here means tracing was not installed. Say so rather than failing silently.
    """
    __slots__ = ()

    def __getattr__(self, name):
        raise RuntimeError(
            "goto %s did not jump - the goto/label support is not active" % name)


class _Label:
    """`label.foo` - a no-op, and the program's chance to breathe.

    Skulpt emitted a suspension at every label, which is the only reason
    goto-driven frame loops such as demos/snake.py animate at all rather than
    locking the tab. The yield lives here, in ordinary Python, rather than in
    the trace function, where calling run_sync would be on much less certain
    ground.

    It also tells the step debugger the label was reached: a goto lands on this
    line without CPython reporting it (see stepper.py), so without this a
    student stepping through a goto loop would never see the label highlighted,
    and a breakpoint on a label would only fire the first time.
    """
    __slots__ = ()

    def __getattr__(self, name):
        if stepper.active():
            stepper.label_reached(sys._getframe(1))
        maybe_yield()
        return None




def _tracer_for(table):
    def tracer(frame, event, arg):
        if frame.f_code.co_filename != USER_FILENAME:
            return None
        if event == "line":
            target = table.get(frame.f_lineno)
            if target is not None:
                # The step debugger cannot see this jump arrive (see
                # stepper.py), so it is told where execution is going.
                if stepper.active():
                    stepper.goto_jumped(target)
                frame.f_lineno = target
        return tracer
    return tracer


def install(src):
    """Prepare goto/label for this program. Returns True if tracing was armed.

    Tracing costs real time, so it is only installed for programs that actually
    contain a goto - which is 87 of 345 curriculum files.
    """
    table = scan(src)
    if not table:
        return False
    sys.settrace(_tracer_for(table))
    return True


def uninstall():
    sys.settrace(None)
