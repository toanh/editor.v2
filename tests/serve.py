#!/usr/bin/env python3
"""Static dev server with the MIME types this app actually needs.

    python tests/serve.py [port]        # default 8731, serves the repo root

`python -m http.server` is not sufficient: it serves .mjs as text/plain, and
browsers refuse to execute an ES module with a non-JavaScript MIME type. Pyodide's
loader dynamically imports pyodide.asm.mjs, so Pyodide will not start at all.

This is a deployment requirement too, not just a local convenience. Whatever
hosts this site must serve:

    .mjs   -> text/javascript      (Pyodide's runtime module)
    .wasm  -> application/wasm     (streaming compilation; otherwise slower)

Check a deployment with:

    curl -sI https://<host>/js/pyodide/pyodide.asm.mjs | grep -i content-type
"""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

EXTRA_TYPES = {
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".wasm": "application/wasm",
    ".json": "application/json",
    ".zip": "application/zip",
}


class Handler(SimpleHTTPRequestHandler):
    """Stock handler, with only the MIME map changed.

    Do NOT add Cache-Control here. The conformance harness opens one iframe per
    curriculum file, each pulling several MB of Monaco, Skulpt and Pyodide, and
    it relies on the browser cache to do that once rather than 226 times. Both
    `no-store` and `no-cache` were measured at roughly 40x slower - 10 files
    went from 5 seconds to over 200. The app already cache-busts by hand with
    the ?t= query parameters in editor.html; use those when you change a file.
    """

    # Keep-alive. Each harness iframe pulls dozens of assets and a fresh TCP
    # connection per asset is most of the cost. SimpleHTTPRequestHandler always
    # sends Content-Length, so HTTP/1.1 is safe here.
    protocol_version = "HTTP/1.1"


for ext, ctype in EXTRA_TYPES.items():
    Handler.extensions_map[ext] = ctype

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
    print("serving the repo root on http://localhost:%d" % port)
    ThreadingHTTPServer(("", port), Handler).serve_forever()
