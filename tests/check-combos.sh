#!/usr/bin/env bash
# Checks all four editor x runtime combinations still boot and run.
#
#   tests/check-combos.sh [files]        # default 20 files per combination
#
# Phase 4 - deleting Skulpt and Ace - is on hold by decision, so `?editor=ace`
# and `?runtime=skulpt` are supported product features rather than transitional
# scaffolding. Being able to switch back and compare the two runtimes is the
# point of keeping them, and that only works if it is checked.
#
# The full conformance run exercises exactly one combination (whichever is
# default). This runs a sample of the corpus through the other three as well, so
# a change that quietly breaks the fallback path is caught by something other
# than a person trying it months later.
#
# The `runtime=` combinations report `unchecked` verdicts, which is expected:
# passing that parameter puts conform.js into cross-runtime mode, where a
# truncated run is not asked whether it still raises. What matters here is that
# nothing errors and nothing fails.

set -u
LIMIT="${1:-20}"
PORT="${PORT:-8731}"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"

if ! curl -s -o /dev/null "http://localhost:$PORT/editor.html"; then
    echo "No server on :$PORT - run 'python tests/serve.py $PORT' first." >&2
    exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fail=0

check() {   # label  with-param
    printf '%-28s ' "$1"
    timeout 300 "$CHROME" --headless --disable-gpu --no-sandbox \
        --user-data-dir="$WORK/p$RANDOM" \
        --virtual-time-budget=1800000 --dump-dom \
        "http://localhost:$PORT/tests/conform-cli.html?mode=compare&offset=0&limit=$LIMIT${2:+&with=$2}" \
        > "$WORK/out.html" 2>/dev/null

    node -e '
const fs = require("fs");
const h = fs.readFileSync(process.argv[1], "utf8");
const m = h.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m) { console.log("NO REPORT - the page never finished"); process.exit(1); }
const r = JSON.parse(m[1].replace(/&quot;/g,"\"").replace(/&lt;/g,"<")
                         .replace(/&gt;/g,">").replace(/&amp;/g,"&"));
const bad = r.results.filter(x => ["fail","error","new"].includes(x.verdict));
console.log(JSON.stringify(r.tally) +
            (bad.length ? "   BAD: " + bad.map(x => x.path+"("+x.verdict+")").join(", ") : ""));
process.exit(bad.length ? 1 : 0);
' "$WORK/out.html" || fail=$((fail + 1))
}

echo "$LIMIT files per combination"
check "monaco + skulpt (default)" ""
check "ace + skulpt"              "editor%3Dace"
check "monaco + pyodide"          "runtime%3Dpyodide"
check "ace + pyodide"             "editor%3Dace%26runtime%3Dpyodide"

echo
if [ "$fail" -eq 0 ]; then echo "all four combinations OK"; else echo "$fail combination(s) broken"; fi
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
