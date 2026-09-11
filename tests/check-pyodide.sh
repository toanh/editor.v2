#!/usr/bin/env bash
# Runs each tests/pyodide-only/*.py under Pyodide and diffs its console output
# against the matching .expected file.
#
#   tests/check-pyodide.sh [name ...]     # default: all of them
#
# Why this exists rather than another cross-runtime comparison: some of the
# ported modules cannot be compared against Skulpt at all.
#
#   * micro:bit and speech need hardware or permissions that headless Chrome
#     does not have, so the only thing either runtime can do is fail - and the
#     two fail differently on purpose, because the port reports a clear message
#     where the fork threw whatever the browser threw.
#   * some fork behaviour is deliberately corrected (Microbit.getCompass
#     answered "NW" for north), so matching Skulpt would mean keeping the bug.
#
# The expectation is checked in beside the program, so a change of behaviour
# shows up as a diff rather than as a number that moved.

set -u
PORT="${PORT:-8731}"
DIR=tests/pyodide-only

if ! curl -s -o /dev/null "http://localhost:$PORT/editor.html"; then
    echo "No server on :$PORT - run 'python tests/serve.py $PORT' first." >&2
    exit 1
fi

NAMES="${*:-$(ls "$DIR"/*.py 2>/dev/null | sed 's|.*/||; s|\.py$||')}"
fail=0

for name in $NAMES; do
    printf '%-24s ' "$name"
    got=$(timeout 180 node tests/cdp-run.js \
        "http://localhost:$PORT/tests/canvas-probe.html?codeurl=$DIR/$name.py&runtime=pyodide&target=console&timeout=150000" \
        "#out" 160000 2>/dev/null | tail -1 \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
              try { const j=JSON.parse(s||"{}");
                    process.stdout.write(j.error ? "PROBE ERROR: "+j.error : (j.text||"")); }
              catch (e) { process.stdout.write("PROBE ERROR: unparseable report"); } })')

    # Browser error text is not ours and changes between Chrome versions -
    # "Must be handling a user gesture to show a permission request" is a
    # sentence Chrome owns. Assert that the line is there, not what it says.
    got=$(printf '%s\n' "$got" | sed 's/^Error: .*/Error: <browser message>/')

    if [ "$got" = "$(cat "$DIR/$name.expected")" ]; then
        echo "ok"
    else
        echo "DIFFERS"
        diff <(cat "$DIR/$name.expected") <(printf '%s\n' "$got") | sed 's/^/    /'
        fail=$((fail + 1))
    fi
done

echo
if [ "$fail" -eq 0 ]; then echo "all pyodide-only checks passed"; else echo "$fail failed"; fi
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
