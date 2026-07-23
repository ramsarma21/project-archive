# Render the imported Gemini -> Meshy modular fallback components for visual QA.
# These images prove the visible source geometry used by canonical shell
# assembly is generated/imported, not Blender primitives.
import bpy
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "build", "world-v3-structures")
QA = os.path.join(RAW, "qa-modules")
os.makedirs(QA, exist_ok=True)

KEYS = [
    "int-wall-plaster-panel",
    "int-wall-board-panel",
    "int-wall-civic-panel",
    "int-ceiling-beamed-panel",
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
    camera.location = center + Vector((radius * 1.45, -radius * 1.75, radius * 1.1))
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 48
    scene.render.filepath = os.path.join(QA, key + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED MODULE", key, tuple(round(v, 3) for v in size))
