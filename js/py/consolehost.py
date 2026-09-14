"""Pyodide versions of the console.js classroom functions that only worked under Skulpt.

console.js declares these into the Host registry. Under Skulpt each is wrapped
by sk_method, which applies the declared defaults and hands the body Skulpt
values to unwrap. Pyodide binds the bare JavaScript function
(prelude.bind_host_names), and a body built from Sk.ffi.remapToJs,
Sk.builtin.pyCheckType and Sk.misceval.Suspension cannot work on plain values.
Measured under Pyodide before this module existed:

  * getURLParam raised - Skulpt's type check rejects a JavaScript string
  * showIFrame and showGoogleVideo returned a Skulpt Suspension object, did not
    wait for the page, and ignored the 600x480 defaults
  * getWebCamImage returned a JavaScript object instead of a str
  * inputnumber, the Philips Hue functions and setWebCamCallback depend on
    Skulpt's suspension machinery or Skulpt builtins by name

No curriculum file calls any of these, which is why no gate noticed.

install() rebinds every name in builtins *after* console.js's names are bound,
with the fork's defaults, argument handling and blocking behaviour. The browser
work stays in JavaScript - runtime-pyodide.js's host bridge - and reuses
console.js's own DOM helpers and globals, so there is still one implementation
of "put an iframe in the console" and stopAllHue() still stops Hue timelines.
"""

import builtins

import _host
import js
from prelude import block
from pyodide.ffi import create_proxy

try:
    from pyodide.ffi import jsnull as _jsnull
except ImportError:          # older Pyodide: null arrived as None
    _jsnull = None


def _missing(value):
    """JavaScript null arrives as JsNull, not None - and undefined as None."""
    return value is None or value is _jsnull


def _py(value):
    return value.to_py() if hasattr(value, "to_py") else value


# ------------------------------------------------------------------ URL params

def getURLParam(param):
    """The value of a parameter in the editor's URL.

    Preserved fork behaviour: a parameter that is not there returns the *string*
    "None", not None. The fork wrapped JavaScript's null in Sk.builtin.str, and a
    program written against it compares with "None".
    """
    if not isinstance(param, str):
        raise TypeError("param must be a str")
    value = js.URLSearchParams.new(js.window.location.search).get(param)
    return "None" if _missing(value) else str(value)


# ---------------------------------------------------------------------- console

def setConsoleFontSize(size):
    """Font size, in points, for console text printed after this call."""
    if isinstance(size, bool) or not isinstance(size, int):
        raise TypeError("size must be an integer")
    _host.setConsoleFontSize(size)


# ---------------------------------------------------------------------- iframes

def showIFrame(url, width=600, height=480, x=-1, y=-1):
    """Show a web page in the console. Blocks until it has loaded, as the
    fork's suspension did. A negative x or y leaves it in the flow of text."""
    block(_host.showIFrame(str(url), width, height, x, y))


def showGoogleVideo(url, width=600, height=480, x=-1, y=-1):
    file_id = js.getGoogleDriveFileId(str(url))
    if _missing(file_id):
        raise Exception("The url is not a google drive link.")
    showIFrame("https://drive.google.com/file/d/" + str(file_id) + "/preview",
               width, height, x, y)


# ----------------------------------------------------------------------- webcam

def getWebCamImage():
    """The current webcam frame as a data URL, or "" without a webcam."""
    data = js.getImageFromWebCam()
    return "" if _missing(data) else str(data)


_webcam_callback = [None]


def setWebCamCallback(f):
    """Call f() on every webcam frame.

    JavaScript calls it later, from an animation frame, so it needs a proxy that
    outlives this call - a plain function passed across is destroyed as soon as
    the call returns (the trap that once left pyangelo's mouse callback dead).
    The previous proxy is released when a new callback replaces it.
    """
    old = _webcam_callback[0]
    _webcam_callback[0] = create_proxy(f) if f is not None else None
    _host.setWebCamCallback(_webcam_callback[0])
    if old is not None:
        old.destroy()


# ----------------------------------------------------------------- inputnumber

def inputnumber(prompt=""):
    """input(), read as a number - the fork's readlineasfloat."""
    return float(builtins.input(prompt))


# ------------------------------------------------------------- Philips Hue

_HUE_BRIDGE_USER = "3Lq6V7ZuY7pxl5vbivXanTQqe1XDllV8lHFEOhhP"


def setHueBridgeIP(IP=None, user=None, hueUserName=_HUE_BRIDGE_USER, useHttps=True):
    """Point the Hue functions at a bridge. Checks that `user` is enabled via
    the school's cloud variables, then that the bridge answers. Blocks."""
    if IP is None:
        raise Exception("Must supply an IP address for the hue bridge.")
    if user is None:
        raise Exception("Must supply a student username.")
    return _py(block(_host.hueSetBridge(str(IP), str(user), str(hueUserName), bool(useHttps))))


def setLight(light=None, on=None, bright=-1, x=-1, y=-1):
    """Change a light's state; does not wait for the bridge.

    Two fork bugs fixed: setLight(1, False) silently did nothing, because the
    fork tested `on ? on : null`; and a brightness over 254 raised, because the
    fork clamped it by assigning to a const.
    """
    if light is None:
        return
    _host.hueSetLight(light, on, bright, x, y)


def huelight(light, on):
    _host.hueLight(light, on)


def huebright(light, brightness):
    _host.hueBright(light, brightness)


def huecolour(light, x, y):
    _host.hueColour(light, x, y)


def getlight(light):
    return _py(block(_host.hueGetLight(light)))


def getButton(button):
    return _py(block(_host.hueGetButton(button)))


def waitForSmartButtonClick(button):
    """Block until the smart button is pressed (not released). Stop ends the
    wait - the fork's 800 ms poll kept running after Stop."""
    return _py(block(_host.hueWaitForButton(button)))


def queueHueCommand(time, light, on=-1, bright=-1, colourx=-1, coloury=-1):
    _host.hueQueue(time, light, on, bright, colourx, coloury)


def executeHueCommands(loopTimes=1):
    """Play the queued commands on a timeline; 0 or less loops for ever."""
    _host.hueExecute(loopTimes)


# ---------------------------------------------------------------------- install

_NAMES = [
    "getURLParam", "setConsoleFontSize", "showIFrame", "showGoogleVideo",
    "getWebCamImage", "setWebCamCallback", "inputnumber",
    "setHueBridgeIP", "setLight", "huelight", "huebright", "huecolour",
    "getlight", "getButton", "waitForSmartButtonClick",
    "queueHueCommand", "executeHueCommands",
]

_ALIASES = {
    "input_number": "inputnumber", "inputNumber": "inputnumber",
    "inputnum": "inputnumber", "input_num": "inputnumber", "inputNum": "inputnumber",
    "runHueCommands": "executeHueCommands", "setHueCommand": "queueHueCommand",
}


def install():
    g = globals()
    for name in _NAMES:
        setattr(builtins, name, g[name])
    for alias, target in _ALIASES.items():
        setattr(builtins, alias, g[target])
