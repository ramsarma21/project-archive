# Bind an exact T-pose static character directly to the canonical Mixamo
# skeleton, then attach the supplied Mixamo actions by name. There is no
# retargeting: target and animation source use the same armature definition.
#
# Usage:
#   blender --background --python rig_with_mixamo_skeleton.py -- input.glb output.glb
import bpy
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
INPUT = os.path.abspath(argv[0])
OUTPUT = os.path.abspath(argv[1])
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = os.path.join(ROOT, "source", "mixamo")

CLIPS = [
    "idle", "walk", "run", "leftTurn", "rightTurn",
    "reach", "search", "carry", "carryWalk", "handoff",
    "crouchIdle", "crouchWalk", "crouchLeft", "crouchRight", "crouchToStand",
    "climbUp", "climbDown", "vault", "work1", "work2",
    "cheer1", "cheer2", "talk", "talk2", "talk3", "talk4",
    "argu1", "argue2", "circleWalk1", "circleWalk2",
]


def imported_new(filepath, kind):
    before = set(bpy.data.objects)
    if kind == "glb":
        bpy.ops.import_scene.gltf(filepath=filepath)
    else:
        bpy.ops.import_scene.fbx(filepath=filepath, use_anim=True)
    return [o for o in bpy.data.objects if o not in before]


def armature(objs):
    return next((o for o in objs if o.type == "ARMATURE"), None)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30

# Static Meshy T-pose.
char_objs = imported_new(INPUT, "glb")
meshes = [o for o in char_objs if o.type == "MESH"]
assert meshes, "no character mesh"

# Character bounds in world space.
mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i])
            mx[i] = max(mx[i], w[i])
height = mx.z - mn.z
center = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
for o in meshes:
    o.location -= center
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# Canonical Mixamo armature from the user's walk FBX.
walk_path = os.path.join(ANIMS, "walk.fbx")
src_objs = imported_new(walk_path, "fbx")
rig = armature(src_objs)
assert rig, "walk FBX has no Mixamo armature"
rig.name = "MixamoRig"
rig.animation_data_clear()
for o in list(src_objs):
    if o != rig:
        bpy.data.objects.remove(o, do_unlink=True)

# The canonical skeleton spans toe-base z=0 to HeadTop_End z≈1.82m after FBX
# object transforms. Uniformly fit it to the generated character height.
toe = rig.data.bones.get("mixamorig:LeftToeBase")
top = rig.data.bones.get("mixamorig:HeadTop_End")
assert toe and top
toe_w = rig.matrix_world @ toe.head_local
top_w = rig.matrix_world @ top.head_local
rig_height = top_w.z - toe_w.z
factor = height / rig_height
rig.scale *= factor
bpy.context.view_layer.update()
toe_w = rig.matrix_world @ toe.head_local
rig.location.z -= toe_w.z

# Center skeleton on character.
hips = rig.data.bones["mixamorig:Hips"]
hips_w = rig.matrix_world @ hips.head_local
rig.location.x -= hips_w.x
rig.location.y -= hips_w.y
bpy.context.view_layer.update()

# Bind every character mesh to the canonical skeleton. Automatic weights work
# reliably here because the reference is an exact fitted T-pose.
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")

# Import each motion-only FBX and retain its native Mixamo action unchanged.
baked = []
for clip in CLIPS:
    path = os.path.join(ANIMS, clip + ".fbx")
    if not os.path.exists(path):
        continue
    objs = imported_new(path, "fbx")
    src = armature(objs)
    if not src or not src.animation_data or not src.animation_data.action:
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
        continue
    action = src.animation_data.action.copy()
    action.name = clip
    action.use_fake_user = True
    baked.append(action)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)

# Store every native action as an NLA track on the Mixamo rig.
rig.animation_data_create()
rig.animation_data.action = None
for action in baked:
    track = rig.animation_data.nla_tracks.new()
    track.name = action.name
    track.strips.new(action.name, int(action.frame_range[0]), action)
    track.mute = True

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUTPUT,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_yup=True,
    export_skins=True,
    export_image_format="JPEG",
    export_jpeg_quality=82,
)
print("WROTE", OUTPUT, os.path.getsize(OUTPUT), "clips", len(baked))
