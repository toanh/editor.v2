"""`from babylon import *` - build a 3D scene, then hand it to Babylon.js.

The shape of this is unusual and worth understanding before changing it: the
Python code does not talk to Babylon at all. It builds plain objects that
describe what is wanted, and `startBabylon()` ships the whole description over
in one go. The scene does not exist while the student's code is running, which
is why `editor.js` builds it in two passes - create everything, then resolve the
references between them.

That is also why references are turned into *names* here rather than being sent
as nested objects: `sphere.material = someMaterial` becomes the string
"BObj3" before it crosses over, and `babylonCreateScene()` looks it up.

Ported from the fork's src/lib/babylon.py. The fork's babylonjsWrapper.js was
five one-line functions forwarding to globals in editor.js, so it has no
counterpart here - the calls go straight to `js.*`.
"""

import js

import _host
from prelude import block
from pyodide.ffi import to_js

babylonObjects = {}


def _to_plain(d):
    """A Python dict as a plain JS object, not a Map.

    to_js() produces a Map by default, and `bObj.bObjType` on a Map is
    undefined - the scene builder would silently create nothing.
    """
    return to_js(d, dict_converter=js.Object.fromEntries)


class BabylonObject:
    __counter = 0
    __name = "BObj"

    def __init__(self):
        self.bObjType = "Object"
        self.bObjName = BabylonObject.__name + str(BabylonObject.__counter)
        self._animations = []
        babylonObjects[self.bObjName] = self
        BabylonObject.__counter += 1

    @property
    def animations(self):
        return self._animations

    @animations.setter
    def animations(self, value):
        # Stored by name, because the Animation objects themselves cannot cross
        # to JavaScript intact.
        self._animations = [animation.bObjName for animation in value]

    def beginAnimation(self, startFrame=0, endFrame=-1, loop=True):
        js.beginAnimation(self.bObjName, startFrame, endFrame, loop)


class Animation(BabylonObject):
    def __init__(self, property="", frameRate=10):
        super().__init__()
        self.property = property
        self.frameRate = frameRate
        self.bObjType = "Animation"
        self.keys = []


class Texture(BabylonObject):
    def __init__(self, url=""):
        super().__init__()
        self.url = url
        self.bObjType = "Texture"


class DirectionalLight(BabylonObject):
    def __init__(self):
        super().__init__()
        self.direction = [1, -1, 1]
        self.diffuse = [0.7, 0.7, 0.7]
        self.specular = [1, 1, 1]
        self.bObjType = "DirectionalLight"


class Skybox(BabylonObject):
    def __init__(self, texture):
        super().__init__()
        self.size = 1000
        self.texture = texture
        self.bObjType = "Skybox"


class Mesh(BabylonObject):
    def __init__(self):
        super().__init__()
        self.position = [0, 0, 0]
        self.orientation = [0, 0, 0]
        self.meshType = None
        self.material = None
        self.bObjType = "Mesh"


class Sphere(Mesh):
    def __init__(self):
        super().__init__()
        self.radius = 1
        self.segments = 16
        self.meshType = "sphere"
        # bObjType stays "Mesh", deliberately: editor.js dispatches on bObjType
        # first and meshType second, so this is load-bearing, not an oversight.


class Material(BabylonObject):
    def __init__(self):
        super().__init__()
        self.type = "standard"
        self.ambientColour = [1, 1, 1]
        self.ambientTexture = None
        self.bObjType = "Material"


class Colour:
    black = [0, 0, 0]
    white = [1, 1, 1]
    grey = [0.5, 0.5, 0.5]
    darkGrey = [0.25, 0.25, 0.25]
    lightGrey = [0.75, 0.75, 0.75]
    red = [1, 0, 0]
    green = [0, 1, 0]
    blue = [0, 0, 1]
    cyan = [0, 1, 1]
    yellow = [1, 1, 0]
    magenta = [1, 0, 1]
    orange = [1, 0.65, 0]
    purple = [0.5, 0, 1]
    pink = [1, 0.75, 0.8]
    violet = [0.5, 0, 1]
    indigo = [0.29, 0, 0.51]
    brown = [0.59, 0.29, 0]


def _ship_scene():
    """Resolve references and hand every object over. Split out of
    startBabylon() so it can be checked without a WebGL context - see
    tests/pyodide-only/babylon_scene.py."""
    js.resetBabylon()

    for name in babylonObjects:
        obj = babylonObjects[name]
        # Resolve object references to names, in place, before shipping. The
        # scene does not exist yet, so a nested object would mean nothing on the
        # other side.
        for attribute in list(obj.__dict__):
            value = obj.__dict__[attribute]
            if isinstance(value, BabylonObject):
                obj.__dict__[attribute] = value.bObjName
        js.addObject(_to_plain(obj.__dict__))

    js.startBabylon()


def startBabylon():
    _ship_scene()

    # The fork ends with `while True: pass`, which Skulpt made survivable by
    # injecting a suspension into every loop. Here the wait has to be explicit:
    # the program must not return, or the editor would treat it as finished and
    # tear the scene down, but it must also let the browser run Babylon's render
    # loop. block() raises when Stop is pressed, which ends it.
    while True:
        block(_host.frameYield())


def endBabylon():
    # A no-op in the fork too - kept so existing code still imports cleanly.
    pass


def resetBabylon():
    js.resetBabylon()
