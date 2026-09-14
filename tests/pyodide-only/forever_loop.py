# The fork's `forever:` statement, which is a SyntaxError on CPython unless the
# runtime rewrites it (runtime-pyodide.js, rewriteForever). No curriculum file
# uses it; teachers' code might. The error at the end also proves the rewrite is
# line-preserving: CPython must report the line it is really on.
n = 0
forever:
    n = n + 1
    if n == 3:
        break
print("forever ran", n, "times")

count = 0
forever :   # the fork's grammar allowed a space before the colon
    count = count + 1
    if count > 1:
        break
print("spaced forever ran", count, "times")

try:
    undefined_name
except NameError as exc:
    import sys
    print("error reported on line", sys.exc_info()[2].tb_lineno)
