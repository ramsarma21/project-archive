# Turn the raw Meshy flintlock into a runtime weapon asset.
#
# Meshy returns props normalised to roughly 2 units with the origin at the mesh
# centre. A scene prop can live with that because ImportedPivotAsset rescales by
# a declared real-world size and bottom-centres it, but a weapon is parented to a
# HAND BONE: it needs true scale and its origin on the grip, or every consumer
# re-derives the same offset by trial and error.
#
# Output convention (documented because nothing else in the repo establishes one):
#   scale   real, 0.40m muzzle-to-butt (a Queen Anne officer's pistol)
#   origin  on the grip, where the palm closes
#   +X      muzzle direction
#   +Z      up, the sighting plane
#
# Run:
#   blender --background --python finish_flintlock.py -- raw.glb out.glb
import bpy
import os
import sys
import math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_GLB = os.path.abspath(argv[1])
TARGET_LENGTH_M = 0.40
TARGET_TRIS = 8000
MAX_TEX = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN_GLB)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
assert meshes, "no mesh"

# Single object to work with.
bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
pistol = bpy.context.view_layer.objects.active

# Bake the import transform in so later maths is in object space.
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

tris = sum(len(p.vertices) - 2 for p in pistol.data.polygons)
if tris > TARGET_TRIS:
    mod = pistol.modifiers.new("dec", "DECIMATE")
    mod.ratio = TARGET_TRIS / tris
    bpy.ops.object.modifier_apply(modifier=mod.name)
print("TRIS", tris, "->", sum(len(p.vertices) - 2 for p in pistol.data.polygons))

for image in bpy.data.images:
    if image.size[0] > MAX_TEX or image.size[1] > MAX_TEX:
        image.scale(min(image.size[0], MAX_TEX), min(image.size[1], MAX_TEX))


def local_bounds():
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for vertex in pistol.data.vertices:
        for axis in range(3):
            lo[axis] = min(lo[axis], vertex.co[axis])
            hi[axis] = max(hi[axis], vertex.co[axis])
    return lo, hi


lo, hi = local_bounds()
size = hi - lo
print(f"RAW_SIZE x={size.x:.4f} y={size.y:.4f} z={size.z:.4f}")

# The longest axis is the barrel; the shallowest is the lock-plate thickness. Map
# barrel -> X and thickness -> Y, leaving the stock's depth on Z as "up".
order = sorted(range(3), key=lambda axis: size[axis], reverse=True)
barrel_axis, up_axis, thin_axis = order[0], order[1], order[2]
rotation = {(0, 2): (0, 0, 0), (0, 1): (math.radians(90), 0, 0),
            (1, 2): (0, 0, math.radians(-90)), (1, 0): (0, math.radians(90), math.radians(-90)),
            (2, 0): (0, math.radians(-90), 0), (2, 1): (math.radians(90), math.radians(-90), 0)}
key = (barrel_axis, up_axis)
assert key in rotation, f"unexpected axis order {key}"
pistol.rotation_euler = rotation[key]
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

lo, hi = local_bounds()
size = hi - lo
scale = TARGET_LENGTH_M / size.x
pistol.scale = (scale, scale, scale)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# Which end is the muzzle? The barrel end is thin and even; the butt end is the
# bulky stock. Compare cross-sectional extent in the first and last 15% of X.
lo, hi = local_bounds()
span = hi.x - lo.x
front = [v.co for v in pistol.data.vertices if v.co.x > hi.x - span * 0.15]
back = [v.co for v in pistol.data.vertices if v.co.x < lo.x + span * 0.15]


def bulk(points):
    if not points:
        return 0.0
    zs = [p.z for p in points]
    ys = [p.y for p in points]
    return (max(zs) - min(zs)) * (max(ys) - min(ys))


if bulk(front) > bulk(back):
    # Butt is at +X: flip so the muzzle points +X.
    pistol.rotation_euler = (0, 0, math.radians(180))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    lo, hi = local_bounds()
print(f"MUZZLE_BULK front={bulk(front):.5f} back={bulk(back):.5f}")

# Grip origin: centre of the rear 22% of the barrel axis, biased to the lower
# half of that slice, which is where the palm closes on the stock.
span = hi.x - lo.x
grip = [v.co for v in pistol.data.vertices if v.co.x < lo.x + span * 0.30]
mid_z = (min(p.z for p in grip) + max(p.z for p in grip)) / 2
lower = [p for p in grip if p.z <= mid_z] or grip
origin = Vector((
    sum(p.x for p in lower) / len(lower),
    sum(p.y for p in lower) / len(lower),
    sum(p.z for p in lower) / len(lower),
))
for vertex in pistol.data.vertices:
    vertex.co -= origin
pistol.data.update()

lo, hi = local_bounds()
print(f"FINAL_SIZE x={hi.x - lo.x:.4f} y={hi.y - lo.y:.4f} z={hi.z - lo.z:.4f}")
print(f"FINAL_ORIGIN_AT_GRIP muzzleX={hi.x:.4f} buttX={lo.x:.4f} "
      f"topZ={hi.z:.4f} bottomZ={lo.z:.4f}")

pistol.name = "flintlock-pistol"
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_yup=True,
    export_animations=False,
    export_image_format="JPEG",
    export_jpeg_quality=82,
)
print("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
