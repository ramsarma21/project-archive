# Headless QA thumbnails of the OPTIMIZED interior structural GLBs, so the 3D
# geometry (not just the concept) can be eyeballed for warping/missing walls.
# Renders a 3/4 view of each key into build/world-v3-structures/qa/<key>.png.
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
#        --python assets/pipeline/render_interior_structures_qa.py
import bpy
import os
import json
import math
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPT = os.path.join(ROOT, "build", "world-v3-structures-opt")
QA = os.path.join(ROOT, "build", "world-v3-structures", "qa")
SPEC_PATH = os.path.join(ROOT, "pipeline", "interior_structures_spec.json")
os.makedirs(QA, exist_ok=True)

with open(SPEC_PATH) as fh:
    KEYS = [a["key"] for a in json.load(fh)["assets"]]

def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.film_transparent = False
    try:
        shading = scene.display.shading
        shading.light = "STUDIO"
        shading.color_type = "TEXTURE"
        shading.show_shadows = True
    except Exception as exc:
        print("shading setup warn", exc)
    return scene


def bbox_all():
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in bpy.data.objects:
        if o.type == "MESH":
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
                hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


for key in KEYS:
    src = os.path.join(OPT, key + ".glb")
    if not os.path.exists(src):
        print("MISSING", key)
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = setup_scene()
    bpy.ops.import_scene.gltf(filepath=src)

    lo, hi = bbox_all()
    center = (lo + hi) / 2.0
    size = (hi - lo)
    radius = max(size.x, size.y, size.z)

    cam_data = bpy.data.cameras.new("qa_cam")
    cam = bpy.data.objects.new("qa_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam_data.lens = 40

    # Exterior 3/4 reference thumbnail.
    d = radius * 2.1
    cam.location = center + Vector((d * 0.85, -d * 0.95, d * 0.75))
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(QA, key + ".png")
    bpy.ops.render.render(write_still=True)

    # INSIDE viewpoint (the failure mode Sol's audit flagged only shows from
    # inside): stand near the -Z entrance at eye height and look across the room
    # toward +Z so walls, ceiling, and any open-side/void or embedded floor are
    # visible. Skip flat floor/partition tiles where an interior view is moot.
    if key.startswith("int-shell-"):
        # Blender scene is Z-up (X=width, Y=depth, Z=height). Stand inside near
        # the -Y end at ~40% height and look across + slightly up toward +Y.
        eye = Vector((center.x, lo.y + size.y * 0.22, lo.z + size.z * 0.40))
        target = Vector((center.x, hi.y - size.y * 0.15, lo.z + size.z * 0.55))
        cam.location = eye
        cam.rotation_euler = (target - eye).to_track_quat("-Z", "Y").to_euler()
        cam_data.lens = 20  # wide so the enclosed room + ceiling fill the frame
        scene.render.filepath = os.path.join(QA, key + "-inside.png")
        bpy.ops.render.render(write_still=True)
    print("RENDERED", key)

print("QA RENDER DONE")
