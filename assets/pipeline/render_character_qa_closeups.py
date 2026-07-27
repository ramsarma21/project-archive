# Headless QA renders for a character GLB, with FACE CLOSE-UPS.
#
# The stock render_character_qa.py samples animation clips from a single 3/4
# camera, which is right for catching rest-pose/skinning artifacts but cannot
# show whether a FACE survived generation. This adds the shots that matter for a
# hero/presenter model: full-body front, full-body 3/4, and tight face close-ups
# from front and 3/4. It renders a static mesh (unrigged base) or a rigged GLB at
# rest; it never bakes lighting into the model.
#
# Run:
#   blender --background --python render_character_qa_closeups.py -- in.glb outDir [prefix]
import bpy
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_DIR = os.path.abspath(argv[1])
PREFIX = argv[2] if len(argv) > 2 else os.path.splitext(os.path.basename(IN_GLB))[0]
os.makedirs(OUT_DIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("qa")
scene.world.color = (0.72, 0.72, 0.74)

bpy.ops.import_scene.gltf(filepath=IN_GLB)
rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
all_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
assert all_meshes, "no meshes"

# Blender's glTF importer can spawn a helper primitive (e.g. a 42-vertex
# Icosphere) for a rigged file that is NOT present in the GLB itself. Restrict
# QA to the actual character geometry - meshes bound to the armature or carrying
# skin weights - and hide anything else from the render so a phantom cannot skew
# the framing or appear in a shot. (The shipped GLB is verified separately to
# contain exactly one mesh.)
character = [o for o in all_meshes if (o.parent and o.parent.type == "ARMATURE") or len(o.vertex_groups) > 0]
meshes = character or all_meshes
for o in all_meshes:
    o.hide_render = o not in meshes
    if o not in meshes:
        print("HIDE stray mesh", o.name)

# Render in the AS-IMPORTED bind pose. A Meshy rig's bind pose (from its
# inverseBindMatrices) is the neutral T-pose the runtime actually shows; forcing
# every pose bone's basis to identity instead snaps to Blender's edit-bone rest,
# which for these rigs diverges and inflates the bounds. So only silence any NLA
# and clear the active action, then measure/render what the runtime would.
if rig is not None:
    rig.animation_data_create()
    for tr in rig.animation_data.nla_tracks:
        tr.mute = True
    rig.animation_data.action = None
bpy.context.view_layer.update()


def bounds():
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    deps = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        ev = o.evaluated_get(deps)
        m = ev.to_mesh()
        for v in m.vertices:
            w = ev.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
        ev.to_mesh_clear()
    return mn, mx


mn, mx = bounds()
height = mx.z - mn.z
center = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))
print(f"BOUNDS height={height:.4f} center=({center.x:.3f},{center.y:.3f},{center.z:.3f})")

cam_data = bpy.data.cameras.new("qa_cam")
cam = bpy.data.objects.new("qa_cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.lens = 55


def shoot(name, res_x, res_y, target, cam_loc):
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    cam.location = cam_loc
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    out = os.path.join(OUT_DIR, f"{PREFIX}-{name}.png")
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("SHOT", out)


# glTF import is Z-up; -Y is "front".
# Face target: near the crown. Head is roughly the top ~13% of a standing figure.
head = Vector((center.x, center.y, mn.z + height * 0.90))

full_dist = max(2.2, height * 1.9)
shoot("full-front", 640, 900, center,
      center + Vector((0.0, -full_dist, height * 0.06)))
shoot("full-3q", 640, 900, center,
      center + Vector((full_dist * 0.55, -full_dist * 0.85, height * 0.10)))

# Rest / neutral full-body from a slightly higher eye line for a clean read.
shoot("rest", 640, 900, center,
      center + Vector((0.0, -full_dist, height * 0.02)))

face_dist = max(0.35, height * 0.42)
shoot("face-front", 720, 720, head,
      head + Vector((0.0, -face_dist, height * 0.02)))
shoot("face-3q", 720, 720, head,
      head + Vector((face_dist * 0.6, -face_dist * 0.8, height * 0.03)))

print("QA CLOSEUP RENDERS DONE", OUT_DIR)
