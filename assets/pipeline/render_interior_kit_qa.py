# Render quick QA thumbnails of the optimized interior kit GLBs so the final
# imported geometry (not just the concept art) can be eyeballed. Workbench
# engine with textured shading -> no GPU required.
# Run:
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#     --python assets/pipeline/render_interior_kit_qa.py -- [key key ...]
import bpy
import os
import sys
import math
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPT = os.path.join(ROOT, "build", "interior-kit-opt")
OUTDIR = "/tmp/ik_renders"
os.makedirs(OUTDIR, exist_ok=True)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
keys = argv or [f[:-4] for f in sorted(os.listdir(OPT)) if f.endswith(".glb")]


def frame_and_render(key):
    src = os.path.join(OPT, key + ".glb")
    if not os.path.exists(src):
        print("MISSING", key)
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        print("NO_MESH", key)
        return

    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for obj in meshes:
        for c in obj.bound_box:
            w = obj.matrix_world @ Vector(c)
            mins = Vector((min(mins[i], w[i]) for i in range(3)))
            maxs = Vector((max(maxs[i], w[i]) for i in range(3)))
    center = (mins + maxs) / 2.0
    radius = (maxs - mins).length / 2.0 or 1.0

    cam_data = bpy.data.cameras.new("qa")
    cam = bpy.data.objects.new("qa", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    d = radius * 3.0
    cam.location = center + Vector((d, -d, d * 0.7))
    dirv = (center - cam.location).normalized()
    cam.rotation_euler = dirv.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "TEXTURE"
    scene.render.film_transparent = False
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.filepath = os.path.join(OUTDIR, key + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", key)


for k in keys:
    frame_and_render(k)
print("QA RENDER DONE", len(keys))
