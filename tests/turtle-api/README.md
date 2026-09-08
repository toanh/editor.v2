# turtle API micro-suite

Hand-written programs for the parts of `turtle` that **no curriculum file
touches** - `circle`, `dot`, `stamp`, `home`, `setheading`, `goto`, `pensize`,
`fillcolor` separate from `pencolor`, `write(move=True)`, the shape table,
`tracer`/`update`, `degrees`/`radians`, and multiple turtles.

The port decision was "port the whole fork surface, because teachers have code
in the wild". These files are how that surface is checked: 12 of `turtle`'s
functions appear in `projects/`, and the module exposes about 70.

They are not `projects/` files on purpose - they are not curriculum, and they
must not appear in the manifest or the goldens. `canvas-probe.html` loads them
with `?codeurl=`, which fetches the source and hands it to `editor.html?code=`.

Each one is compared between Skulpt and Pyodide on two axes: the pixels it
paints, and the text it prints. Anything printed is rounded, because CPython
and Skulpt disagree about float repr and that difference is already an accepted
divergence - it is not what these files are for.

    tests/compare-canvas.sh 30 api
