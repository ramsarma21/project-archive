# Render imported colonial-door-kit key states for visual QA. The floor, camera
# and lights are QA-only diagnostics; every production door surface remains the
# imported GLB. Run with Blender in background mode.
import bpy
import math
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "build", "door-kit-opt", "colonial-door-kit.glb")
OUT = os.path.join(ROOT, "build", "door-kit-qa")
os.makedirs(OUT, exist_ok=True)


def look_at(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=SOURCE)
leaf = bpy.data.objects.get("Door_Leaf")
if leaf is None:
    raise RuntimeError("Door_Leaf missing")

# Neutral QA floor.
bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, -0.01))
floor = bpy.context.object
floor.name = "QA_Floor"
mat = bpy.data.materials.new("QA_Floor_Mat")
mat.diffuse_color = (0.18, 0.18, 0.16, 1.0)
floor.data.materials.append(mat)

# Camera from the street-facing side (glTF +Z maps to Blender -Y).
bpy.ops.object.camera_add(location=(2.8, -4.2, 2.25))
camera = bpy.context.object
look_at(camera, (0, 0, 1.05))
bpy.context.scene.camera = camera
camera.data.lens = 55

for location, energy, size in [
    ((-2.2, -2.8, 4.0), 850, 3.0),
    ((2.8, -1.2, 2.2), 450, 2.0),
    ((0.0, 2.0, 3.2), 650, 2.5),
]:
    bpy.ops.object.light_add(type="AREA", location=location)
    light = bpy.context.object
    light.data.energy = energy
    light.data.shape = "DISK"
    light.data.size = size
    look_at(light, (0, 0, 1.0))

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 640
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.world.color = (0.035, 0.04, 0.045)

# Blender positive Z rotation exports as glTF inward (-Z); negative is outward.
states = [
    ("closed", 0.0),
    ("inward-half", math.radians(39)),
    ("inward-full", math.radians(78)),
    ("outward-half", math.radians(-39)),
    ("outward-full", math.radians(-78)),
]
for name, angle in states:
    leaf.rotation_mode = "XYZ"
    leaf.rotation_euler[2] = angle
    bpy.context.view_layer.update()
    scene.render.filepath = os.path.join(OUT, f"colonial-door-kit-{name}.png")
    bpy.ops.render.render(write_still=True)
    print("WROTE", scene.render.filepath)
