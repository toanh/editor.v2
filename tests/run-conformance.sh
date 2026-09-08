#!/usr/bin/env bash
# Runs the whole conformance corpus headlessly, in chunks, and aggregates.
#
#   tests/run-conformance.sh [compare|record] [chunk-size]
#
# Chunking is not optional. Each file is run in its own iframe carrying a full
# editor - Skulpt, Monaco, babylon, tf.js - and one browser process reliably
# falls over somewhere past ~50 of them. 40 files complete in about 14s; 60 in
# a single process hang indefinitely. Each chunk therefore gets a fresh browser
# and a fresh profile. 20 is the safe default; 40 works most of the time.

#   TOTAL=136 FILTER='&exclude=classroom' EXTRA='runtime=pyodide' \
#     tests/run-conformance.sh compare 10
#
# FILTER is appended to the query string verbatim (exclude=/only=/all=).
# EXTRA is appended to every editor.html URL, so the corpus can be run against
# a non-default backend. A run with EXTRA containing "runtime=" is treated as a
# cross-interpreter comparison: error *text* is then expected to differ, so a
# file whose golden raised is checked for still raising rather than for wording.
# TOTAL must match the filtered file count or the completeness check will fail.

set -u
MODE="${1:-compare}"
CHUNK="${2:-20}"
PORT="${PORT:-8731}"
TOTAL="${TOTAL:-226}"
FILTER="${FILTER:-}"
EXTRA="${EXTRA:-}"

CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if ! curl -s -o /dev/null "http://localhost:$PORT/editor.html"; then
    echo "No server on :$PORT - run 'python -m http.server $PORT' from the repo root." >&2
    exit 1
fi

run_chunk() {  # off attempt -> writes chunk-$off.html, returns chrome's status
    timeout 300 "$CHROME" --headless --disable-gpu --no-sandbox \
        --user-data-dir="$WORK/profile-$1-$2" \
        --virtual-time-budget=1800000 --dump-dom \
        "http://localhost:$PORT/tests/conform-cli.html?mode=$MODE&offset=$1&limit=$CHUNK$FILTER${EXTRA:+&with=$(printf %s "$EXTRA" | sed 's/=/%3D/g')}" \
        > "$WORK/chunk-$1.html" 2>/dev/null
}

echo "mode=$MODE  chunk=$CHUNK  total=$TOTAL${FILTER:+  filter=$FILTER}${EXTRA:+  with=$EXTRA}"
off=0
while [ "$off" -lt "$TOTAL" ]; do
    printf "  %3d-%-3d  " "$off" "$((off + CHUNK - 1))"
    start=$(date +%s)
    run_chunk "$off" 1
    rc=$?
    # The browser dies on a chunk now and then - resource pressure, not a real
    # failure. One retry with a fresh profile clears it in practice.
    if [ $rc -ne 0 ]; then
        printf "retrying... "
        run_chunk "$off" 2
        rc=$?
    fi
    el=$(( $(date +%s) - start ))
    if [ $rc -ne 0 ]; then
        echo "FAILED TWICE (${el}s) - these files were NOT checked"
    else
        node -e '
const fs = require("fs");
const h = fs.readFileSync(process.argv[1], "utf8");
const m = h.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m) { console.log(process.argv[2] + "s  no report"); process.exit(0); }
const r = JSON.parse(m[1].replace(/&quot;/g,"\"").replace(/&lt;/g,"<")
                         .replace(/&gt;/g,">").replace(/&amp;/g,"&"));
const bad = r.results.filter(x => ["fail","error","new"].includes(x.verdict));
console.log(process.argv[2] + "s  " + JSON.stringify(r.tally) +
            (bad.length ? "   BAD: " + bad.map(x => x.path + "(" + x.verdict + ")").join(", ")
                        : ""));
fs.writeFileSync(process.argv[3], JSON.stringify(r.results));
' "$WORK/chunk-$off.html" "$el" "$WORK/res-$off.json"
    fi
    off=$((off + CHUNK))
done

echo
node -e '
const fs = require("fs"), path = require("path");
const dir = process.argv[1], expected = parseInt(process.argv[2], 10);
let all = [];
for (const f of fs.readdirSync(dir).filter(f => /^res-\d+\.json$/.test(f))) {
    all = all.concat(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}
const tally = {};
all.forEach(r => tally[r.verdict] = (tally[r.verdict] || 0) + 1);
console.log("TOTAL " + all.length + " files   " + JSON.stringify(tally));
const bad = all.filter(r => ["fail","error","new"].includes(r.verdict));
if (!bad.length) console.log("0 failures");
else bad.forEach(r => console.log("  " + r.verdict.toUpperCase() + "  " + r.path + "  " + (r.note||"")));

// A dropped chunk shows up as a smaller total, not as a failure. Without this
// check "0 failures" can quietly mean "0 failures among the files we managed
// to run", which is not the same claim at all.
if (all.length !== expected) {
    console.log("\nINCOMPLETE: expected " + expected + " files, got " + all.length +
                ". " + (expected - all.length) + " were not checked.");
    process.exit(1);
}
if (bad.length) process.exit(1);
' "$WORK" "$TOTAL"
