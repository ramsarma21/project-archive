import bpy
import os
import math
import mathutils

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = os.path.join(ROOT, "build", "world-v3-opt", "printshop-hanging-sign.glb")
OUT = os.path.join(ROOT, "build", "world-v3-opt", "printshop-hanging-sign.qa.png")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

scene = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scene.render.engine = eng
        break
    except Exception:
        continue
scene.render.resolution_x = 1024
scene.render.resolution_y = 768
scene.render.film_transparent = False

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
box_min = mathutils.Vector((1e9, 1e9, 1e9))
box_max = mathutils.Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        for i in range(3):
            box_min[i] = min(box_min[i], w[i])
            box_max[i] = max(box_max[i], w[i])
center = (box_min + box_max) / 2
size = (box_max - box_min).length

world = bpy.data.worlds.new("qa")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.62, 0.64, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
scene.world = world

def add_cam(name, offset):
    cam_data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, cam_data)
    scene.collection.objects.link(cam)
    loc = center + mathutils.Vector(offset) * size
    cam.location = loc
    d = (center - loc).normalized()
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return cam

cam = add_cam("qa_cam", (0.85, -1.1, 0.35))
scene.camera = cam

light_data = bpy.data.lights.new("key", type="SUN")
light_data.energy = 3.5
light = bpy.data.objects.new("key", light_data)
light.rotation_euler = (math.radians(55), math.radians(20), math.radians(35))
scene.collection.objects.link(light)

fill = bpy.data.lights.new("fill", type="SUN")
fill.energy = 1.3
fill_o = bpy.data.objects.new("fill", fill)
fill_o.rotation_euler = (math.radians(60), 0, math.radians(200))
scene.collection.objects.link(fill_o)

scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("QA_WROTE", OUT)
