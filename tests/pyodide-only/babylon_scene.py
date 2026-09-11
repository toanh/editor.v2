# What babylon.py actually ports is the *description* that crosses to
# JavaScript: editor.js builds the scene from it in two passes, so if the shape
# is wrong the scene comes out empty and nothing says why.
#
# This builds the demos/vr.py scene and intercepts the handover instead of
# starting a render loop, so the whole thing is checkable without WebGL.
import js
import json
import babylon
from babylon import (Sphere, DirectionalLight, Material, Texture, Skybox,
                     Animation, Colour)

captured = []
js.resetBabylon = lambda: captured.append("<reset>")
js.startBabylon = lambda: captured.append("<start>")
js.addObject = lambda o: captured.append(json.loads(js.JSON.stringify(o)))

# --- exactly the scene demos/vr.py builds --------------------------------
sphere = Sphere()
sphere.position = [0, 0, 5]
sphere.radius = 2

light = DirectionalLight()
light.direction = [-0.25, -1, 0.25]

sphereMaterial = Material()
sphereMaterial.ambientColour = Colour.white
sphereMaterial.ambientTexture = Texture("babylon/textures/wood.jpg")
sphere.material = sphereMaterial

skybox = Skybox("babylon/textures/skybox")

rotateOnY = Animation("rotation.y", 10)
rotateOnY.keys = [{"frame": 0, "value": 0}, {"frame": 20, "value": 3.14159}]
sphere.animations = [rotateOnY]

babylon._ship_scene()

for item in captured:
    if isinstance(item, str):
        print(item)
    else:
        # Sorted, so the report does not depend on dict ordering.
        print(item.get("bObjName"), item.get("bObjType"),
              json.dumps({k: v for k, v in sorted(item.items())
                          if k not in ("bObjName", "bObjType")}))
