# Render a 3/4 QA thumbnail for each optimized density-kit GLB so the geometry
# (not just bounds) can be eyeballed: ground-fit, rope survival, no baked slabs.
# Output: assets/build/world-v3-opt/qa/<key>.png
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
#        --python assets/pipeline/render_density_qa.py
import bpy
import os
import json
import math
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPT = os.path.join(ROOT, "build", "world-v3-opt")
QA = os.path.join(OPT, "qa")
KIT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "density_kit.json")
os.makedirs(QA, exist_ok=True)

with open(KIT) as fh:
    keys = [a["key"] for a in json.load(fh)["assets"]]


def render(key):
    src = os.path.join(OPT, key + ".glb")
    if not os.path.exists(src):
        print("MISSING", key)
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    mins = Vector((1e18, 1e18, 1e18))
    maxs = Vector((-1e18, -1e18, -1e18))
    for obj in meshes:
        for c in obj.bound_box:
            w = obj.matrix_world @ Vector(c)
            for i in range(3):
                mins[i] = min(mins[i], w[i])
                maxs[i] = max(maxs[i], w[i])
    center = (mins + maxs) / 2.0
    dim = max((maxs - mins))

    # ground grid so a baked floor slab / floating is obvious
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
    grid = bpy.context.active_object
    m = grid.data.materials
    mat = bpy.data.materials.new("grid"); mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (0.15, 0.15, 0.17, 1)
    m.append(mat)

    cam_data = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    r = dim * 1.7
    cam.location = center + Vector((r, -r, r * 0.8))
    direction = (center - cam.location).normalized()
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam

    sun_data = bpy.data.lights.new("s", 'SUN'); sun_data.energy = 4
    sun = bpy.data.objects.new("s", sun_data)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(55), math.radians(20), math.radians(40))
    world = bpy.data.worlds.new("w"); bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.2

    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    sc.render.resolution_x = 480
    sc.render.resolution_y = 480
    sc.render.filepath = os.path.join(QA, key + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDER", key)


for k in keys:
    try:
        render(k)
    except Exception as e:
        print("FAIL", k, e)
print("DENSITY QA DONE")
