# Combine a Mixamo auto-rigged character-with-skin FBX with the user's native
# Mixamo motion-only FBXs. Skeleton and actions are canonical Mixamo, so no
# retargeting or rotation conversion is performed.
#
# Usage:
#   blender --background --python bake_native_mixamo_character.py -- in.fbx out.glb
import bpy
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1 :]
INPUT = os.path.abspath(argv[0])
OUTPUT = os.path.abspath(argv[1])
NPC_MODE = len(argv) > 2 and argv[2] == "npc"
MATERIAL_SOURCE = os.path.abspath(argv[3]) if len(argv) > 3 else None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = os.path.join(ROOT, "source", "mixamo")

CLIPS = [
    "idle", "walk", "run", "leftTurn", "rightTurn", "reach", "search",
    "carry", "carryWalk", "handoff", "crouchIdle", "crouchWalk",
    "crouchLeft", "crouchRight", "crouchToStand", "climbUp",
    "climbDown", "vault", "work1", "work2", "cheer1", "cheer2",
    "talk", "talk2", "talk3", "talk4", "argu1", "argue2",
    "circleWalk1", "circleWalk2",
    # v5 locomotion physics clips + humanoid door-handling performances.
    "jump", "runJump", "knock", "doorOpenInward", "doorOpenOutward",
]
if NPC_MODE:
    CLIPS = [
        "idle", "walk", "run", "carryWalk", "work1", "work2",
        "talk", "talk2", "argu1", "argue2",
    ]

# Per-clip root-motion handling:
#   "horizontal" - freeze Hips bone-local X/Z, keep local Y. The Mixamo Hips
#                  parent/rest transform maps local Y to world vertical;
#                  validate this with inspect_glb.mjs worldRoot output.
#                  and interaction performances the world controller drives).
#   "all"        - freeze Hips X/Y/Z entirely (root-neutral): the physics layer
#                  and authored anchors own ALL displacement, so the clip never
#                  double-moves the body (jumps, vault, climbs).
# Anything not listed keeps its authored root untouched (already in-place clips
# such as reach/work/talk have no meaningful root translation).
ROOT_MODE = {
    "idle": "horizontal",
    "walk": "horizontal",
    "run": "horizontal",
    "carryWalk": "horizontal",
    "leftTurn": "horizontal",
    "rightTurn": "horizontal",
    "knock": "horizontal",
    "doorOpenInward": "horizontal",
    "doorOpenOutward": "horizontal",
    "jump": "all",
    "runJump": "all",
    "vault": "all",
    "climbUp": "all",
    "climbDown": "all",
}


def get_fcurves(action):
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for slot in action.slots:
                try:
                    bag = strip.channelbag(slot)
                except Exception:
                    bag = None
                if bag:
                    out.extend(bag.fcurves)
    return out


def remove_root_motion(action, mode):
    # Mixamo Hips location channels are bone-local under a rotated armature:
    # local X/Z map to world horizontal while local Y maps to world vertical.
    # "horizontal" freezes local X/Z and keeps vertical bounce; "all" freezes
    # every axis so physics/authored anchors own all displacement.
    axes = {0, 2} if mode == "horizontal" else {0, 1, 2}
    for curve in get_fcurves(action):
        if "Hips" not in curve.data_path or not curve.data_path.endswith("location"):
            continue
        if curve.array_index not in axes or len(curve.keyframe_points) == 0:
            continue
        base = curve.keyframe_points[0].co[1]
        for key in curve.keyframe_points:
            key.co[1] = base
            key.handle_left[1] = base
            key.handle_right[1] = base


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True)
    return [o for o in bpy.data.objects if o not in before]


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30

character = import_fbx(INPUT)
rig = next(o for o in character if o.type == "ARMATURE")
meshes = [o for o in character if o.type == "MESH"]
assert meshes and any(o.find_armature() == rig for o in meshes), "input FBX is not skinned"

if MATERIAL_SOURCE:
    before_material_objects = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=MATERIAL_SOURCE)
    material_meshes = [
        o for o in bpy.data.objects
        if o not in before_material_objects and o.type == "MESH" and o.data.materials
    ]
    if material_meshes:
        materials = list(material_meshes[0].data.materials)
        for mesh in meshes:
            mesh.data.materials.clear()
            for material in materials:
                mesh.data.materials.append(material)
    for o in list(bpy.data.objects):
        if o not in before_material_objects and o not in character:
            bpy.data.objects.remove(o, do_unlink=True)

actions = []
# Discard the arbitrary Idle used only to download the skinned character.
# Curated locomotion actions below are the production clips.
rig.animation_data_clear()

for clip in CLIPS:
    filename = "idleGrounded" if clip == "idle" else "runGrounded" if clip == "run" else clip
    path = os.path.join(ANIMS, filename + ".fbx")
    if not os.path.exists(path):
        continue
    objs = import_fbx(path)
    src = next((o for o in objs if o.type == "ARMATURE"), None)
    if src and src.animation_data and src.animation_data.action:
        action = src.animation_data.action.copy()
        action.name = clip
        action.use_fake_user = True
        mode = ROOT_MODE.get(clip)
        if mode:
            remove_root_motion(action, mode)
        actions.append(action)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)

rig.animation_data_create()
rig.animation_data.action = None
for action in actions:
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
print("WROTE", OUTPUT, os.path.getsize(OUTPUT), "clips", len(actions))
