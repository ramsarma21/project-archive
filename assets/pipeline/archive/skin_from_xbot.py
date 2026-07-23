# Skin a fitted T-pose character to Mixamo's native skeleton by transferring
# the proven XBot vertex weights (nearest-face interpolated), then attach native
# Mixamo animation actions unchanged. This avoids custom retargeting and avoids
# Blender's unreliable bone-heat automatic weighting.
#
# Usage:
#   blender --background --python skin_from_xbot.py -- input.glb output.glb
import bpy
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
INPUT = os.path.abspath(argv[0])
OUTPUT = os.path.abspath(argv[1])
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XBOT = os.path.join(ROOT, "build", "mixamo-rigged", "xbot-idle.fbx")
ANIMS = os.path.join(ROOT, "source", "mixamo")

CLIPS = [
    "walk", "run", "leftTurn", "rightTurn", "reach", "search",
    "carry", "carryWalk", "handoff", "crouchIdle", "crouchWalk",
    "crouchLeft", "crouchRight", "crouchToStand", "climbUp",
    "climbDown", "vault", "work1", "work2", "cheer1", "cheer2",
    "talk", "talk2", "talk3", "talk4", "argu1", "argue2",
    "circleWalk1", "circleWalk2",
]


def new_objects(filepath, kind):
    before = set(bpy.data.objects)
    if kind == "glb":
        bpy.ops.import_scene.gltf(filepath=filepath)
    else:
        bpy.ops.import_scene.fbx(filepath=filepath, use_anim=True)
    return [o for o in bpy.data.objects if o not in before]


def bounds(objects):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objects:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
    return mn, mx


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30

# Target textured T-pose.
target_objs = new_objects(INPUT, "glb")
targets = [o for o in target_objs if o.type == "MESH"]
assert targets
tmin, tmax = bounds(targets)
tcenter = (tmin + tmax) * 0.5

# Native Mixamo XBot skin + skeleton + Idle action.
xobjs = new_objects(XBOT, "fbx")
rig = next(o for o in xobjs if o.type == "ARMATURE")
sources = [o for o in xobjs if o.type == "MESH" and len(o.vertex_groups) > 0]
assert sources, "XBot contains no weighted mesh"
source = max(sources, key=lambda o: len(o.data.vertices))

# Align XBot proxy to target by height and center.
smin, smax = bounds(sources)
factor = (tmax.z - tmin.z) / max(0.0001, smax.z - smin.z)
rig.scale *= factor
bpy.context.view_layer.update()
smin, smax = bounds(sources)
scenter = (smin + smax) * 0.5
rig.location.x += tcenter.x - scenter.x
rig.location.y += tcenter.y - scenter.y
rig.location.z += tmin.z - smin.z
bpy.context.view_layer.update()

# Transfer XBot's known-good Mixamo weights to every target mesh.
for target in targets:
    for group in source.vertex_groups:
        if target.vertex_groups.get(group.name) is None:
            target.vertex_groups.new(name=group.name)
    bpy.context.view_layer.objects.active = target
    target.select_set(True)
    mod = target.modifiers.new("MixamoWeightTransfer", "DATA_TRANSFER")
    mod.object = source
    mod.use_vert_data = True
    mod.data_types_verts = {"VGROUP_WEIGHTS"}
    mod.vert_mapping = "POLYINTERP_NEAREST"
    mod.layers_vgroup_select_src = "ALL"
    mod.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.modifier_apply(modifier=mod.name)

    arm = target.modifiers.new("MixamoArmature", "ARMATURE")
    arm.object = rig
    arm.use_deform_preserve_volume = True
    target.parent = rig
    target.matrix_parent_inverse = rig.matrix_world.inverted()

# Keep XBot's bundled Idle action, discard proxy mesh.
actions = []
if rig.animation_data and rig.animation_data.action:
    idle = rig.animation_data.action
    idle.name = "idle"
    idle.use_fake_user = True
    actions.append(idle)
rig.animation_data_clear()
for o in sources:
    bpy.data.objects.remove(o, do_unlink=True)

# Native Mixamo motion-only FBXs: same skeleton, direct action assignment.
for clip in CLIPS:
    path = os.path.join(ANIMS, clip + ".fbx")
    if not os.path.exists(path):
        continue
    objs = new_objects(path, "fbx")
    src_rig = next((o for o in objs if o.type == "ARMATURE"), None)
    if src_rig and src_rig.animation_data and src_rig.animation_data.action:
        action = src_rig.animation_data.action.copy()
        action.name = clip
        action.use_fake_user = True
        actions.append(action)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)

rig.animation_data_create()
rig.animation_data.action = None
for action in actions:
    tr = rig.animation_data.nla_tracks.new()
    tr.name = action.name
    tr.strips.new(action.name, int(action.frame_range[0]), action)
    tr.mute = True

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
print("WROTE", OUTPUT, os.path.getsize(OUTPUT), "clips", len(actions))
