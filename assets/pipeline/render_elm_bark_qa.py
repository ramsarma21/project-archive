# Studio close-up of the Liberty Elm bark, to judge the bark material itself apart
# from the pre-dawn mission scene (which is too dark to read furrow depth). Points
# a camera at the lower bole under even daylight and renders a tight crop, so a
# tuning pass on contrast / normal strength / roughness can be judged in seconds
# without the dev server.
#
#   blender --background --python assets/pipeline/render_elm_bark_qa.py -- in.glb out.png
import bpy
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_PNG = os.path.abspath(argv[1])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN_GLB)

scene = bpy.context.scene
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.film_transparent = False
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"
scene.view_settings.view_transform = "Standard"

# Even daylight: a key sun plus a soft fill, so bark depth reads honestly.
sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 4.0
sun = bpy.data.objects.new("sun", sun_data)
sun.rotation_euler = (0.9, 0.2, 0.5)
scene.collection.objects.link(sun)
fill_data = bpy.data.lights.new("fill", "AREA")
fill_data.energy = 800
fill_data.size = 10
fill = bpy.data.objects.new("fill", fill_data)
fill.location = (6, -6, 5)
scene.collection.objects.link(fill)
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.55, 0.6, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
scene.world = world

# Camera on the lower bole, ~2.5m up, a couple of metres out, looking at the trunk.
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 55
cam = bpy.data.objects.new("cam", cam_data)
# The tree is placed at world origin here (single imported object, base at 0).
target = Vector((0.0, -1.0, 3.2))   # blender: trunk surface, ~3.2m up
cam.location = Vector((2.6, -3.2, 3.6))
direction = target - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(cam)
scene.camera = cam

scene.render.image_settings.file_format = "PNG"
scene.render.filepath = OUT_PNG
bpy.ops.render.render(write_still=True)
print("[bark-qa] wrote", OUT_PNG)
