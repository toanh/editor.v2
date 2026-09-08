# Code for Schools Editor
Run Python in the browser.

Learn more at https://csinschools.com.

# Build and Installation
There is no build step. Clone the repository and serve the root folder over
HTTP — the curriculum files under `projects/` are fetched with XHR, so opening
`editor.html` straight off the filesystem will not load them.

```sh
python tests/serve.py 8731
# then open http://localhost:8731/editor.html
```

`tests/serve.py` is a plain static server with two extra MIME types. Use it
rather than `python -m http.server`, which sends `.mjs` as `text/plain` —
browsers refuse to execute an ES module with a non-JavaScript MIME type, so the
`?runtime=pyodide` interpreter silently fails to start. **Whatever hosts this in
production must serve `.mjs` as JavaScript and `.wasm` as `application/wasm`.**

# Tests
`tests/run-conformance.sh compare` runs every curriculum file and diffs the
console output against a recorded baseline. See [tests/README.md](tests/README.md).

# Contributing
`CLAUDE.md` documents the architecture, the Skulpt fork this depends on, and
the in-progress migration to Monaco and Pyodide.
