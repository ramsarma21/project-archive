# Turntable QA render for a single prop GLB: four yaw angles on one strip, with a
# metre-scaled ground grid so real-world size is readable, not guessed.
#
# Run:
#   blender --background --python render_prop_qa.py -- prop.glb outDir [label]
import bpy
import os
import sys
import math
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_DIR = os.path.abspath(argv[1])
LABEL = argv[2] if len(argv) > 2 else os.path.splitext(os.path.basename(IN_GLB))[0]
TILE = 520
os.makedirs(OUT_DIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = TILE
scene.render.resolution_y = TILE
scene.render.image_settings.file_format = "PNG"
scene.world = bpy.data.worlds.new("qa")
scene.world.color = (0.55, 0.57, 0.60)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=IN_GLB)
imported = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
assert imported, "no mesh in prop"

lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for obj in imported:
    for corner in obj.bound_box:
        world = obj.matrix_world @ Vector(corner)
        for axis in range(3):
            lo[axis] = min(lo[axis], world[axis])
            hi[axis] = max(hi[axis], world[axis])
size = hi - lo
center = (lo + hi) / 2
print(f"PROP_SIZE_M x={size.x:.4f} y={size.y:.4f} z={size.z:.4f} longest={max(size):.4f}")

pivot = bpy.data.objects.new("pivot", None)
scene.collection.objects.link(pivot)
pivot.location = center
for obj in imported:
    if obj.parent is None:
        obj.parent = pivot
        obj.matrix_parent_inverse = pivot.matrix_world.inverted()

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
dist = max(size) * 1.9
cam.location = center + Vector((dist * 0.1, -dist, dist * 0.42))
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
cam_data.lens = 60

tmp = os.path.join(OUT_DIR, "_t.png")
strip = np.zeros((TILE, TILE * 4, 4), dtype=np.float32)
for index, yaw in enumerate((0, 90, 180, 270)):
    pivot.rotation_euler = (0, 0, math.radians(yaw))
    bpy.context.view_layer.update()
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(tmp)
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    strip[:, index * TILE : (index + 1) * TILE, :] = pixels.reshape(TILE, TILE, 4)

out = bpy.data.images.new(LABEL, width=TILE * 4, height=TILE)
out.pixels.foreach_set(strip.reshape(-1))
out.filepath_raw = os.path.join(OUT_DIR, f"{LABEL}.png")
out.file_format = "PNG"
out.save()
os.remove(tmp)
print("WROTE", os.path.join(OUT_DIR, f"{LABEL}.png"))
