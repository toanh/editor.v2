#!/usr/bin/env bash
# Compares what drawing programs paint under Skulpt and under Pyodide.
#
#   tests/compare-canvas.sh [frames] [group]   group: all | pyangelo | turtle | api
#
# The conformance harness diffs console text, so it is blind to the files that
# draw instead of printing. This runs each one under both interpreters and
# compares the pixels - and, for the groups that print, the console text too.
#
#   pyangelo  15 curriculum files, ~4 min. Endless game loops: sampled after
#             `frames` animation frames.
#   turtle    14 curriculum files, ~15 min. These finish, and are sampled when
#             they do.
#   api       8 hand-written files from tests/turtle-api/, ~3 min. The turtle
#             functions no curriculum file calls.
#
# A turtle picture is drawn at the program's own speed, so the turtle group is
# slow by construction, not because something has hung - the rainbow in
# inquisitive/turtle/y5l3d1 is 5000 animation frames, about 90 seconds per
# runtime. Watch the per-file lines; do not wait on the timeout.
#
# One browser per file per runtime, driven over CDP by tests/cdp-run.js. The
# --dump-dom + --virtual-time-budget approach the rest of the harness uses does
# not work here: a drawing program keeps requesting animation frames, so virtual
# time races ahead burning the whole budget on real painting and the dump never
# arrives.
#
# Programs driven by random or timeElapsed() are not expected to match exactly.
# The signal that matters is a canvas that is blank under one runtime and not
# the other.
#
# This exits non-zero on any problem, so it works as a gate - but note that
# `compare-canvas.sh ... | tee log` throws that away, because a pipeline's
# status is the status of its LAST command. Use `set -o pipefail` in the caller
# or check ${PIPESTATUS[0]}.

set -u
FRAMES="${1:-30}"
GROUP="${2:-all}"
PORT="${PORT:-8731}"

PYANGELO_FILES="${PYANGELO_FILES:-
demos/endless_runner
demos/landing_game
demos/snake
demos/tictactoe
demos/tictactoe_ml
inquisitive/jamiegame_buggy
inquisitive/playerSelection
intro.v2/0105e
intro.v2/0404e
intro.v2/0504e
intro.v2/0606e
introduction/0104e
introduction/0404e
introduction/0504e
introduction/0604e
}"

# Derived from the sources rather than listed, because a hand-written list
# drifts: an earlier one was built by grepping for "turtle" and picked up two
# text adventures whose menu has a `goto .turtle` branch. Those block on input()
# and cost the run 20 minutes of timeouts. The import is the definition.
#
# Two files are then excluded on purpose: demos/turtle_starter and
# inquisitive/turtle/y5l2q1 are each a single `from turtle import *` with
# nothing after it - empty scaffolds for a student to fill in. There is no
# picture to compare, and Skulpt allocates its canvases lazily so neither even
# leaves a layer to sample.
TURTLE_FILES="${TURTLE_FILES:-$(
    grep -rlE '^[[:space:]]*(from|import)[[:space:]]+turtle\b' projects --include='*.py' |
    sed 's|^projects/||; s|\.py$||' |
    grep -vE '(demos/turtle_starter|inquisitive/turtle/y5l2q1)$' |
    sort
)}"

if ! curl -s -o /dev/null "http://localhost:$PORT/editor.html"; then
    echo "No server on :$PORT - run 'python tests/serve.py $PORT' first." >&2
    exit 1
fi

probe() {  # source-param runtime target -> one line of JSON
    # $1 is a whole query parameter: "project=demos/snake" for curriculum files,
    # "codeurl=tests/turtle-api/circle.py" for the micro-suite, which is not
    # curriculum and so does not live in projects/.
    timeout "$PROBE_TIMEOUT" node tests/cdp-run.js \
        "http://localhost:$PORT/tests/canvas-probe.html?$1&runtime=$2&frames=$FRAMES&target=$3&timeout=$((PROBE_TIMEOUT * 1000 - 15000))" \
        "#out" $((PROBE_TIMEOUT * 1000 - 5000)) 2>/dev/null | tail -1
}

fail=0

run_group() {  # target kind files...
    local target="$1" kind="$2"; shift 2
    printf "%-32s %-10s %-10s %s\n" "FILE ($target)" SKULPT PYODIDE VERDICT
    for f in $*; do
        if [ "$kind" = "codeurl" ]; then src="codeurl=tests/turtle-api/$f.py"; else src="project=$f"; fi
        sk=$(probe "$src" skulpt "$target")
        py=$(probe "$src" pyodide "$target")
        line=$(SK="$sk" PY="$py" F="$f" node -e '
const sk = JSON.parse(process.env.SK || "{}");
const py = JSON.parse(process.env.PY || "{}");
let verdict;
// Printed output is compared before the pixels: a program that reports
// heading() or pencolor() has no picture that could show the difference, and a
// traceback in the console is the loudest possible failure.
const text = (sk.text || py.text) && sk.text !== py.text;
if (sk.error || py.error) verdict = "ERROR " + (sk.error || "") + (py.error || "");
else if (text) verdict = "differs (printed output)";
else if (py.ink === 0 && sk.ink > 0) verdict = "PYODIDE-BLANK";
else if (sk.ink === 0 && py.ink > 0) verdict = "skulpt-blank";
else if (sk.ink === 0 && py.ink === 0) verdict = "both-blank";
else if (sk.hash === py.hash) verdict = "identical";
else {
  // Two independent ratios, because either alone has a blind spot: ink misses
  // a wrong colour over the same shape, intensity misses a shape moved onto
  // equally bright pixels.
  const r = Math.min(sk.ink, py.ink) / Math.max(sk.ink, py.ink);
  const l = Math.min(sk.lum, py.lum) / Math.max(sk.lum, py.lum);
  const worst = Math.min(r, l);
  verdict = (worst > 0.9 ? "close " : "differs ") +
            "(ink " + r.toFixed(3) + ", light " + l.toFixed(4) + ")";
}
console.log([process.env.F, sk.ink === undefined ? "-" : sk.ink,
             py.ink === undefined ? "-" : py.ink, verdict].join("\t"));
')
        IFS=$'\t' read -r p a b v <<< "$line"
        printf "%-32s %-10s %-10s %s\n" "$p" "$a" "$b" "$v"
        # "differs" counts too - this script is used as a gate, and a verdict
        # that prints in red but exits 0 is worse than no gate at all.
        case "$v" in ERROR*|PYODIDE-BLANK*|both-blank*|differs*) fail=$((fail + 1));; esac
    done
    echo
}

API_FILES="${API_FILES:-$(ls tests/turtle-api/*.py 2>/dev/null | sed 's|.*/||; s|\.py$||' | sort)}"

if [ "$GROUP" = "all" ] || [ "$GROUP" = "pyangelo" ]; then
    PROBE_TIMEOUT=180
    run_group pyangelo project $PYANGELO_FILES
fi

if [ "$GROUP" = "all" ] || [ "$GROUP" = "turtle" ]; then
    # These wait for the whole picture to be drawn at the program's own speed.
    PROBE_TIMEOUT="${TURTLE_TIMEOUT:-300}"
    run_group turtle project $TURTLE_FILES
fi

if [ "$GROUP" = "all" ] || [ "$GROUP" = "api" ]; then
    # The hand-written micro-suite: turtle functions the curriculum never calls.
    # Every one of them sets speed(0), so these are quick.
    PROBE_TIMEOUT="${API_TIMEOUT:-120}"
    run_group turtle codeurl $API_FILES
fi

if [ "$fail" -eq 0 ]; then echo "no blank or errored canvases"; else echo "$fail problem(s)"; fi
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
