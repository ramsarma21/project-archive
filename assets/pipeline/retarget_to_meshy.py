# Bake all Mixamo clips onto the shared Meshy auto-rig skeleton, once, offline.
# Standard constraint-bake retarget (world-space copy-rotation per mapped bone,
# scripted hips translation), producing meshy-anim-library.glb whose clips play
# directly on every Meshy-rigged character with zero runtime retargeting.
#
# Run: blender --background --python assets/pipeline/retarget_to_meshy.py
import bpy
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIXAMO_DIR = os.path.join(ROOT, "source", "mixamo")
REF_RIG = os.path.join(ROOT, "build", "characters", "abigail-rigged.glb")
OUT = os.path.join(ROOT, "build", "anims", "meshy-anim-library.glb")

CLIPS = [
    "idle", "walk", "run", "leftTurn", "rightTurn",
    "reach", "search", "carry", "carryWalk", "handoff",
    "crouchIdle", "crouchWalk", "crouchLeft", "crouchRight", "crouchToStand",
    "climbUp", "climbDown", "vault",
    "work1", "work2", "cheer1", "cheer2",
    "talk", "talk2", "talk3", "talk4", "argu1", "argue2",
    "circleWalk1", "circleWalk2",
]

# mixamorig:* -> Meshy auto-rig bone names
BONE_MAP = {
    "mixamorig:Hips": "Hips",
    "mixamorig:Spine": "Spine",
    "mixamorig:Spine1": "Spine01",
    "mixamorig:Spine2": "Spine02",
    "mixamorig:Neck": "neck",
    "mixamorig:Head": "Head",
    "mixamorig:LeftShoulder": "LeftShoulder",
    "mixamorig:LeftArm": "LeftArm",
    "mixamorig:LeftForeArm": "LeftForeArm",
    "mixamorig:LeftHand": "LeftHand",
    "mixamorig:RightShoulder": "RightShoulder",
    "mixamorig:RightArm": "RightArm",
    "mixamorig:RightForeArm": "RightForeArm",
    "mixamorig:RightHand": "RightHand",
    "mixamorig:LeftUpLeg": "LeftUpLeg",
    "mixamorig:LeftLeg": "LeftLeg",
    "mixamorig:LeftFoot": "LeftFoot",
    "mixamorig:LeftToeBase": "LeftToeBase",
    "mixamorig:RightUpLeg": "RightUpLeg",
    "mixamorig:RightLeg": "RightLeg",
    "mixamorig:RightFoot": "RightFoot",
    "mixamorig:RightToeBase": "RightToeBase",
}


def find_armature(objs):
    for o in objs:
        if o.type == "ARMATURE":
            return o
    return None


def get_fcurves(act):
    # Blender 5 layered actions: fcurves live in per-slot channelbags.
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for slot in act.slots:
                try:
                    cb = strip.channelbag(slot)
                except Exception:
                    cb = None
                if cb is not None:
                    out.extend(cb.fcurves)
    return out


def import_new(filepath, importer):
    before = set(bpy.data.objects)
    importer(filepath)
    return [o for o in bpy.data.objects if o not in before]


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

# ---- Target: the shared Meshy skeleton (from Abigail's rigged export) ----
ref_objs = import_new(REF_RIG, lambda p: bpy.ops.import_scene.gltf(filepath=p))
target = find_armature(ref_objs)
assert target, "no armature in reference rig"
target.name = "MeshyRig"
# Drop meshes; keep the bare skeleton.
for o in ref_objs:
    if o.type == "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
target.animation_data_clear()

bpy.context.view_layer.objects.active = target
target_rest_hips_world = (target.matrix_world @ target.pose.bones["Hips"].matrix).translation.copy()

baked_actions = []

for clip in CLIPS:
    path = os.path.join(MIXAMO_DIR, clip + ".fbx")
    if not os.path.exists(path):
        print("MISSING", path)
        continue
    new_objs = import_new(path, lambda p: bpy.ops.import_scene.fbx(filepath=p, use_anim=True))
    source = find_armature(new_objs)
    if source is None or source.animation_data is None or source.animation_data.action is None:
        print("NO SOURCE ACTION", clip)
        for o in new_objs:
            bpy.data.objects.remove(o, do_unlink=True)
        continue

    src_action = source.animation_data.action
    frame_start = int(src_action.frame_range[0])
    frame_end = max(frame_start + 1, int(src_action.frame_range[1]))

    # Uniformly scale the source armature so both rigs share hip height in
    # world space; world-space constraints then transfer motion 1:1 (this is
    # the "make the rigs the same size before retargeting" step).
    bpy.context.view_layer.update()
    src_hips_rest_world = (source.matrix_world @ source.data.bones["mixamorig:Hips"].matrix_local).translation
    if src_hips_rest_world.y > 0.0001:
        source.scale = source.scale * (target_rest_hips_world.y / src_hips_rest_world.y)
    bpy.context.view_layer.update()

    # Constraints: world-space rotation copy for every mapped bone, plus a
    # world-space location copy on the hips. Visual keying converts world
    # transforms into correct pose-local keys during the bake.
    for src_name, dst_name in BONE_MAP.items():
        pb = target.pose.bones.get(dst_name)
        if pb is None or src_name not in source.pose.bones:
            continue
        c = pb.constraints.new("COPY_ROTATION")
        c.target = source
        c.subtarget = src_name
        c.mix_mode = "REPLACE"
        c.target_space = "WORLD"
        c.owner_space = "WORLD"
    hips_pb = target.pose.bones.get("Hips")
    if hips_pb is not None:
        cl = hips_pb.constraints.new("COPY_LOCATION")
        cl.target = source
        cl.subtarget = "mixamorig:Hips"
        cl.target_space = "WORLD"
        cl.owner_space = "WORLD"

    # Bake visual keying over the clip range.
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.nla.bake(
        frame_start=frame_start,
        frame_end=frame_end,
        only_selected=True,
        visual_keying=True,
        clear_constraints=True,
        use_current_action=False,
        bake_types={"POSE"},
        channel_types={"ROTATION", "LOCATION"},
    )
    bpy.ops.object.mode_set(mode="OBJECT")

    act = target.animation_data.action
    act.name = clip
    act.use_fake_user = True
    baked_actions.append(act)
    target.animation_data.action = None

    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a not in baked_actions:
            bpy.data.actions.remove(a)
    print("BAKED", clip, f"({frame_end - frame_start + 1} frames)")

# NLA-stash every action so glTF exports each as a named animation.
if target.animation_data is None:
    target.animation_data_create()
target.animation_data.action = None
for act in baked_actions:
    tr = target.animation_data.nla_tracks.new()
    tr.name = act.name
    tr.strips.new(act.name, int(act.frame_range[0]), act)
    tr.mute = True

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_yup=True,
    export_skins=True,
)
print("WROTE", OUT, "clips:", len(baked_actions))
