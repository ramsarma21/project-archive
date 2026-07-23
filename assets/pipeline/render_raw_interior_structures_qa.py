# Render every direct Meshy raw structural asset before modular fallback /
# optimization. Used to explicitly accept floor meshes and reject malformed
# single-image shell geometry before the canonical Blender assembly replaces it.
import bpy
import json
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "build", "world-v3-structures")
QA = os.path.join(RAW, "qa-raw")
SPEC_PATH = os.path.join(ROOT, "pipeline", "interior_structures_spec.json")
os.makedirs(QA, exist_ok=True)
with open(SPEC_PATH) as fh:
    KEYS = [
        a["key"] for a in json.load(fh)["assets"]
        if a["key"].startswith("int-shell-") or a["key"].startswith("int-floor-")
    ]


def bounds():
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], world[i])
                hi[i] = max(hi[i], world[i])
    return lo, hi


for key in KEYS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(RAW, key + ".glb"))
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = True
    lo, hi = bounds()
    center = (lo + hi) * 0.5
    size = hi - lo
    radius = max(size)
    camera_data = bpy.data.cameras.new("qa_camera")
    camera = bpy.data.objects.new("qa_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.location = center + Vector((radius * 1.2, -radius * 1.5, radius * 0.9))
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 42
    scene.render.filepath = os.path.join(QA, key + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED RAW", key, tuple(round(v, 3) for v in size))
