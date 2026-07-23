# Render 3/4 QA thumbnails for the M4 batch (props + constable) so geometry can
# be eyeballed for warping/anachronism, not just bounds. Scoped output:
# assets/build/world-m4-opt/qa/<key>.png
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
#        --python assets/pipeline/m4/render_m4_qa.py
import bpy
import os
import math
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OPT = os.path.join(ROOT, "build", "world-m4-opt")
QA = os.path.join(OPT, "qa")
os.makedirs(QA, exist_ok=True)

TARGETS = [
    ("roof-walk-board", os.path.join(OPT, "roof-walk-board.glb")),
    ("roof-walk-board-long", os.path.join(OPT, "roof-walk-board-long.glb")),
    ("effigy-oliver", os.path.join(OPT, "effigy-oliver.glb")),
    ("effigy-boot", os.path.join(OPT, "effigy-boot.glb")),
    ("organizer-crate-perch", os.path.join(OPT, "organizer-crate-perch.glb")),
    ("protest-torch", os.path.join(OPT, "protest-torch.glb")),
    ("protest-banner", os.path.join(OPT, "protest-banner.glb")),
    ("coin-paper-set", os.path.join(OPT, "coin-paper-set.glb")),
    ("street-dog", os.path.join(OPT, "street-dog.glb")),
    ("constable", os.path.join(ROOT, "build", "characters-final", "constable-rigged.glb")),
]


def render(key, src):
    if not os.path.exists(src):
        print("MISSING", key)
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        print("NO MESH", key)
        return
    mins = Vector((1e18, 1e18, 1e18))
    maxs = Vector((-1e18, -1e18, -1e18))
    for obj in meshes:
        for c in obj.bound_box:
            w = obj.matrix_world @ Vector(c)
            for i in range(3):
                mins[i] = min(mins[i], w[i])
                maxs[i] = max(maxs[i], w[i])
    center = (mins + maxs) / 2.0
    dim = max((maxs - mins)) or 1.0

    bpy.ops.mesh.primitive_plane_add(size=dim * 4, location=(center.x, center.y, mins.z))
    grid = bpy.context.active_object
    mat = bpy.data.materials.new("grid"); mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (0.16, 0.16, 0.18, 1)
    grid.data.materials.append(mat)

    cam_data = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    r = dim * 1.7
    cam.location = center + Vector((r, -r, r * 0.7))
    direction = (center - cam.location).normalized()
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam

    sun_data = bpy.data.lights.new("s", 'SUN'); sun_data.energy = 4
    sun = bpy.data.objects.new("s", sun_data)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(55), math.radians(20), math.radians(40))
    world = bpy.data.worlds.new("w"); bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.15

    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    sc.render.resolution_x = 512
    sc.render.resolution_y = 512
    sc.render.filepath = os.path.join(QA, key + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDER", key)


for key, src in TARGETS:
    try:
        render(key, src)
    except Exception as e:
        print("FAIL", key, e)
print("M4 QA DONE")
