# Headless QA renders for a baked character GLB: rest pose plus chosen clip
# frames from a 3/4 front camera. Catches rest-pose mismatch artifacts
# (shrugged arms, palms-up), broken skinning, and texture loss without the
# live world.
#
# Run:
#   blender --background --python render_character_qa.py -- in.glb outDir [clip:frame ...]
# Default samples: rest, idle:20, walk:15, work1:30, talk:30.
import bpy
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_DIR = os.path.abspath(argv[1])
SAMPLES = [s.split(":") for s in argv[2:]] or [
    ["rest", "0"], ["idle", "20"], ["walk", "15"], ["work1", "30"], ["talk", "30"],
]
os.makedirs(OUT_DIR, exist_ok=True)
NAME = os.path.splitext(os.path.basename(IN_GLB))[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.resolution_x = 640
scene.render.resolution_y = 900
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("qa")
scene.world.color = (0.72, 0.72, 0.74)

bpy.ops.import_scene.gltf(filepath=IN_GLB)
rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
assert meshes, "no meshes"

def bounds():
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    deps = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        ev = o.evaluated_get(deps)
        for v in ev.to_mesh().vertices:
            w = ev.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
        ev.to_mesh_clear()
    return mn, mx

mn, mx = bounds()
height = mx.z - mn.z
center = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))

cam_data = bpy.data.cameras.new("qa_cam")
cam = bpy.data.objects.new("qa_cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
dist = max(2.2, height * 1.9)
# glTF import is Z-up; -Y is "front" for characters exported facing +Z in glTF.
cam.location = center + Vector((dist * 0.42, -dist, height * 0.12))
direction = center - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
cam_data.lens = 55

actions = {a.name: a for a in bpy.data.actions}
print("ACTIONS", sorted(actions.keys()))

if rig is not None:
    rig.animation_data_create()
    # Mute any NLA tracks so only the explicitly assigned action plays.
    for tr in rig.animation_data.nla_tracks:
        tr.mute = True

for clip, frame in SAMPLES:
    frame = int(frame)
    if rig is not None:
        if clip == "rest":
            rig.animation_data.action = None
            for pb in rig.pose.bones:
                pb.matrix_basis.identity()
        elif clip in actions:
            rig.animation_data.action = actions[clip]
            try:
                rig.animation_data.action_slot = actions[clip].slots[0]
            except Exception:
                pass
        else:
            print("SKIP missing clip", clip)
            continue
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    out = os.path.join(OUT_DIR, f"{NAME}-{clip}-{frame}.png")
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("SHOT", out)
print("QA RENDERS DONE", OUT_DIR)
