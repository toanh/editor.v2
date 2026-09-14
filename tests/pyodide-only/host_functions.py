# The console.js classroom functions that only worked under Skulpt, as rebound
# for Pyodide by js/py/consolehost.py - see that file for what each one did
# before. None of them appears in a curriculum file, so nothing else calls them.
#
# fetch is intercepted for the Philips Hue bridge and the school's cloud
# variables, so no bridge, network or school account is needed; every request is
# logged with its method, path and body and printed at the end.
import builtins
import js

# ------------------------------------------------------------------ URL params
print("getURLParam(runtime):", getURLParam("runtime"))
print("getURLParam(missing):", repr(getURLParam("no_such_param")))

# --------------------------------------------------------------------- console
setConsoleFontSize(16)
print("console font size:", js.fontSize)
setConsoleFontSize(14)


def last(selector):
    found = js.document.querySelectorAll(selector)
    return found.item(found.length - 1)


# --------------------------------------------------------------------- iframes
showIFrame("about:blank")
frame = last("#console iframe")
print("default iframe:", frame.getAttribute("width"), frame.getAttribute("height"),
      "absolute" if frame.style.position == "absolute" else "in flow")
showIFrame("about:blank", 300, 200, 10, 20)
frame = last("#console iframe")
print("placed iframe:", frame.getAttribute("width"), frame.getAttribute("height"),
      frame.style.position, frame.style.left, frame.style.top)

try:
    showGoogleVideo("https://example.com/not-a-drive-link")
    print("non-drive link did not raise")
except Exception as exc:
    print("non-drive link raises:", exc)

# ---------------------------------------------------------------------- webcam
print("getWebCamImage without a webcam:", repr(getWebCamImage()))

# ---------------------------------------------------------------- inputnumber
real_input = builtins.input
builtins.input = lambda prompt="": "42"
try:
    print("inputnumber:", inputnumber("n? "), inputNum("n? "))
finally:
    builtins.input = real_input

# ----------------------------------------------------------------- Philips Hue
js.eval("""
window.__hueLog = [];
window.__presses = [1002, 1002, 1002, 34];
window.__realFetch = window.fetch;
window.fetch = function (url, opts) {
  url = String(url);
  var method = (opts && opts.method) || "GET";
  window.__hueLog.push(method + " " + url.replace(/^https?:\\/\\/[^/]+/, "") +
                       (opts && opts.body ? " " + opts.body : ""));
  var body = {};
  if (url.indexOf("cloudvars/get") > -1) { body = {status: 200, value: "True"}; }
  else if (url.indexOf("/sensors/") > -1) { body = {state: {buttonevent: window.__presses.shift()}}; }
  else if (/\\/lights\\/\\d+$/.test(url)) { body = {state: {on: true, bri: 100}}; }
  return Promise.resolve({ json: function () { return Promise.resolve(body); } });
};
""")

try:
    setHueBridgeIP("192.168.1.50", "student")
    setLight(3, False, 300, 0.5, 0.4)
    huelight(1, True)
    huebright(1, 200)
    huecolour(1, 0.3, 0.3)
    print("getlight brightness:", getlight(1)["state"]["bri"])
    print("getButton:", getButton(7))
    print("waitForSmartButtonClick:", waitForSmartButtonClick(7))
    queueHueCommand(0, 2, True)
    setHueCommand(0.1, 2, -1, 50)
    runHueCommands(1)
    sleep(0.6)
    print("Hue requests:")
    for entry in js.window.__hueLog:
        print("  " + entry)
finally:
    js.eval("window.fetch = window.__realFetch;")
