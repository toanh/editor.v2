#!/usr/bin/env bash
# The step debugger and breakpoints, compared pause by pause across runtimes.
#
#   tests/check-stepping.sh
#
# Each scenario runs a program from tests/stepping/ through tests/stepping.html -
# the real Step/Run code path, the real Next and Continue buttons - under Skulpt
# and then Pyodide, and compares every pause: the highlighted line, the watch
# table's contents, and the console output. Skulpt is the reference.
#
# None of this is reachable by the conformance corpus, which never presses a
# button: before this existed the Step button under Pyodide ran the program
# straight through with no highlighting at all, and nothing noticed.
#
# Fields: name | program | mode (step|run) | breakpoints | button script |
#         extra editor param | expected Pyodide pause lines, when they differ |
#         lines whose watch table is not compared
#
# The last two fields record ONE accepted difference, and are narrow on
# purpose - the expected lines are checked exactly, and only the named lines skip
# the table. CPython pauses on a `for` line *before* taking the next item; Skulpt
# paused after. So on a `for` line Pyodide's watch table shows the loop
# variable's current value where Skulpt showed the next one (Pyodide matches
# what every other line shows: the state before the highlighted line runs), and
# CPython reports the `for` line once more when the loop runs out - as Skulpt
# already did for `while`. Watch tables are compared on the pauses both share.
#
# The watch table is compared as a set: the order of names within a frame is
# JavaScript property order under Skulpt and definition order under CPython,
# and means nothing to a student.

set -u
PORT="${PORT:-8731}"

if ! curl -s -o /dev/null "http://localhost:$PORT/editor.html"; then
    echo "No server on :$PORT - run 'python tests/serve.py $PORT' first." >&2
    exit 1
fi

SCENARIOS="
step-basics|basics|step||next||1 2 3 4 7 8 7 8 7 8 7 9 12 10 11 13|7
step-while|while_loop|step||next|||
step-goto|goto_loop|step||next|||
step-functions|functions|step||next|||
breakpoint-in-loop|basics|run|8|continue|||
breakpoint-then-next|basics|run|8|next,next,continue|||7
step-then-continue|basics|step|12|next,next,continue|||
breakpoint-in-while|while_loop|run|3|continue|||
breakpoint-in-function|functions|run|2,6|continue|||
breakpoint-on-label|goto_loop|run|2|continue|||
ace-breakpoint-in-loop|basics|run|8|continue|editor%3Dace||
"

probe() {  # runtime program mode breakpoints script with
    local with=""
    [ -n "$6" ] && with="&with=$6"
    timeout 150 node tests/cdp-run.js \
        "http://localhost:$PORT/tests/stepping.html?codeurl=tests/stepping/$2.py&runtime=$1&mode=$3&breakpoints=$4&script=$5$with" \
        "#out" 120000 2>/dev/null | tail -1
}

fail=0
while IFS='|' read -r name program mode breakpoints script with expected notable; do
    [ -z "$name" ] && continue
    sk=$(probe skulpt "$program" "$mode" "$breakpoints" "$script" "$with")
    py=$(probe pyodide "$program" "$mode" "$breakpoints" "$script" "$with")
    line=$(SK="$sk" PY="$py" NAME="$name" EXPECTED="$expected" NOTABLE="$notable" node -e '
const parse = (s) => { try { return JSON.parse(s || "{}"); } catch (e) { return { error: "unparseable report" }; } };
const sk = parse(process.env.SK), py = parse(process.env.PY), name = process.env.NAME.padEnd(24);
const expected = process.env.EXPECTED;
const notable = (process.env.NOTABLE || "").split(" ").filter(Boolean).map(Number);
if (sk.error || py.error || !sk.pauses || !py.pauses) {
  console.log(name + " ERROR skulpt=" + (sk.error || "") + " pyodide=" + (py.error || ""));
  process.exit(0);
}
const lines = (r) => r.pauses.map((p) => p[0]).join(" ");
const table = (t) => t == null ? "null" : t.split(";").sort().join(";");
let problem = "";

if (lines(py) !== (expected || lines(sk))) {
  problem = "lines differ\n    skulpt : " + lines(sk) + "\n    pyodide: " + lines(py) +
            (expected ? "\n    expected pyodide: " + expected : "");
}

// Walk the Pyodide pauses, matching each Skulpt pause in order; any Pyodide
// pause left unmatched is one of the accepted extras checked above.
if (!problem) {
  let j = 0;
  for (let i = 0; i < py.pauses.length && !problem; i++) {
    if (j < sk.pauses.length && sk.pauses[j][0] === py.pauses[i][0]) {
      if (notable.indexOf(sk.pauses[j][0]) < 0 && table(sk.pauses[j][1]) !== table(py.pauses[i][1])) {
        problem = "watch table differs at line " + sk.pauses[j][0] + " (Skulpt pause " + (j + 1) + ")" +
                  "\n    skulpt : " + table(sk.pauses[j][1]) + "\n    pyodide: " + table(py.pauses[i][1]);
      }
      j++;
    }
  }
  if (!problem && j !== sk.pauses.length) {
    problem = "could not align the pauses (" + j + " of " + sk.pauses.length + " matched)";
  }
}

if (!problem && sk.text !== py.text) {
  problem = "console differs\n    skulpt : " + JSON.stringify(sk.text) + "\n    pyodide: " + JSON.stringify(py.text);
}
console.log(problem ? name + " DIFFERS " + problem
                    : name + " ok  (" + py.pauses.length + " pauses: " + lines(py) + ")" +
                      (expected || notable.length ? "  [accepted: for-loop pause timing]" : ""));
')
    echo "$line"
    case "$line" in *DIFFERS*|*ERROR*) fail=$((fail + 1));; esac
done <<< "$SCENARIOS"

echo
if [ "$fail" -eq 0 ]; then echo "all stepping scenarios match"; else echo "$fail scenario(s) differ"; fi
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
