# Append NEW Mixamo clips to an already-baked character GLB without touching
# its existing animations. This is the safe incremental path the full-rebake
# scripts (bake_character_anims.py / retarget_native_mixamo_rest_delta.py)
# don't offer: they clear animation data, and re-deriving physics clips (jump,
# vault, climbs) risks reintroducing root motion the world controller owns.
#
# Rig family is auto-detected:
#   - native Mixamo rigs (mixamorig* bones): per-bone name map, all bones
#   - Meshy rigs (Hips/Spine01/...): the 22-bone BONE_MAP from
#     bake_character_anims.py (Meshy rigs have no finger chains)
# Both use the same rest-delta transfer:
#   world_rot_target(t) = (world_rot_source(t) @ world_rot_source_rest^-1)
#                         @ world_rot_target_rest
#
# Run:
#   blender --background --python append_clips.py -- <in.glb> <out.glb> clipsCsv
import bpy
import os
import sys
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_GLB = os.path.abspath(argv[1])
CLIPS = argv[2].split(",")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIXAMO_DIR = os.path.join(ROOT, "source", "mixamo")

# Stationary performances: the world controller owns horizontal placement, so
# freeze ground-plane hip drift (vertical stays: sitting, stumbling, leaning).
IN_PLACE_HORIZONTAL = {
    "shout", "satchelSearch", "scolded", "ropePull", "read",
    "sitIdle", "sitTalk",
}

MESHY_BONE_MAP = {
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


def import_new(importer, filepath):
    before = set(bpy.data.objects)
    importer(filepath=filepath)
    return [o for o in bpy.data.objects if o not in before]


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

# ---- Target character; existing actions are PRESERVED. ----
tgt_objs = import_new(lambda filepath: bpy.ops.import_scene.gltf(filepath=filepath), IN_GLB)
target = find_armature(tgt_objs)
assert target, "no armature in " + IN_GLB
existing_actions = [a for a in bpy.data.actions]
existing_names = {a.name for a in existing_actions}
for a in existing_actions:
    a.use_fake_user = True
# New clips replace same-named existing ones (idempotent re-runs).
for a in list(existing_actions):
    if a.name in CLIPS:
        bpy.data.actions.remove(a, do_unlink=True)
        existing_actions = [x for x in existing_actions if x is not a]
existing_actions = [a for a in bpy.data.actions if a.name not in CLIPS]
target.animation_data_clear()
bpy.context.view_layer.update()

TW = target.matrix_world.copy()
TW_rot = TW.to_quaternion()
tgt_rest_arm = {b.name: b.matrix_local.copy() for b in target.data.bones}
tgt_rest_world_rot = {n: (TW_rot @ m.to_quaternion()) for n, m in tgt_rest_arm.items()}
tgt_parent = {b.name: (b.parent.name if b.parent else None) for b in target.data.bones}

NATIVE = any(b.startswith("mixamorig") for b in tgt_rest_arm)
if NATIVE:
    HIPS = "mixamorig:Hips" if "mixamorig:Hips" in tgt_rest_arm else "mixamorigHips"
else:
    HIPS = "Hips"
assert HIPS in tgt_rest_arm, "unrecognized rig: no hips bone"
hips_rest_world = TW @ tgt_rest_arm[HIPS].translation

order = []


def walk(name):
    order.append(name)
    for b in target.data.bones:
        if b.parent and b.parent.name == name:
            walk(b.name)


for b in target.data.bones:
    if b.parent is None:
        walk(b.name)

baked = []
for clip in CLIPS:
    path = os.path.join(MIXAMO_DIR, clip + ".fbx")
    if not os.path.exists(path):
        print("MISSING", clip)
        continue
    src_objs = import_new(lambda filepath: bpy.ops.import_scene.fbx(filepath=filepath, use_anim=True), path)
    source = find_armature(src_objs)
    if source is None or not source.animation_data or not source.animation_data.action:
        print("NO ACTION", clip)
        for o in src_objs:
            bpy.data.objects.remove(o, do_unlink=True)
        continue

    act = source.animation_data.action
    f0 = int(act.frame_range[0])
    f1 = max(f0 + 1, int(act.frame_range[1]))

    # Source->target bone map for this rig family.
    if NATIVE:
        name_map = {}
        for sb in source.data.bones:
            for candidate in (sb.name, sb.name.replace(":", "")):
                if candidate in tgt_rest_arm:
                    name_map[sb.name] = candidate
                    break
    else:
        name_map = {s: d for s, d in MESHY_BONE_MAP.items() if d in tgt_rest_arm}
    src_hips_name = next((n for n in name_map if name_map[n] == HIPS), None)
    assert src_hips_name, "source clip has no hips bone"

    bpy.context.view_layer.update()
    src_hips_rest_w = (source.matrix_world @ source.data.bones[src_hips_name].matrix_local).translation
    if src_hips_rest_w.z > 1e-4:
        source.scale = source.scale * (hips_rest_world.z / src_hips_rest_w.z)
    bpy.context.view_layer.update()

    SW_rot = source.matrix_world.to_quaternion()
    src_rest_world_rot = {sb.name: SW_rot @ sb.matrix_local.to_quaternion() for sb in source.data.bones}
    src_hips_rest_w = (source.matrix_world @ source.data.bones[src_hips_name].matrix_local).translation

    frames = list(range(f0, f1 + 1))
    samples = []
    for f in frames:
        scene.frame_set(f)
        bpy.context.view_layer.update()
        SWm = source.matrix_world
        SW_rot_f = SWm.to_quaternion()
        rec = {"rot": {}, "hips": None}
        for s_name, d_name in name_map.items():
            spb = source.pose.bones.get(s_name)
            if spb is None:
                continue
            world_rot = SW_rot_f @ spb.matrix.to_quaternion()
            delta = world_rot @ src_rest_world_rot[s_name].inverted()
            rec["rot"][d_name] = delta @ tgt_rest_world_rot[d_name]
        hips_w = SWm @ source.pose.bones[src_hips_name].matrix.translation
        hips_delta = hips_w - src_hips_rest_w
        if clip in IN_PLACE_HORIZONTAL:
            hips_delta.x = 0
            hips_delta.y = 0
        rec["hips"] = hips_rest_world + hips_delta
        samples.append(rec)

    new_act = bpy.data.actions.new(clip)
    new_act.use_fake_user = True
    target.animation_data_create()
    target.animation_data.action = new_act

    TW_inv = TW.inverted()
    TW_inv_rot = TW_inv.to_quaternion()

    for fi, f in enumerate(frames):
        arm_pose = {}
        for name in order:
            if name not in tgt_rest_arm:
                continue
            rest = tgt_rest_arm[name]
            parent = tgt_parent[name]
            desired_world_rot = samples[fi]["rot"].get(name)
            if parent is None:
                parent_m = Matrix.Identity(4)
                parent_rest = Matrix.Identity(4)
            else:
                parent_m = arm_pose[parent]
                parent_rest = tgt_rest_arm[parent]
            local_rest = parent_rest.inverted() @ rest
            if desired_world_rot is None:
                m = parent_m @ local_rest
            else:
                rot_arm = (TW_inv_rot @ desired_world_rot).to_matrix().to_4x4()
                if name == HIPS:
                    trans = TW_inv @ samples[fi]["hips"]
                else:
                    trans = (parent_m @ local_rest).translation
                m = Matrix.Translation(trans) @ rot_arm
            pb = target.pose.bones[name]
            pb.rotation_mode = "QUATERNION"
            pb.matrix = m
            bpy.context.view_layer.update()
            arm_pose[name] = pb.matrix.copy()
            pb.keyframe_insert("rotation_quaternion", frame=f)
            if name == HIPS:
                pb.keyframe_insert("location", frame=f)

    baked.append(new_act)
    target.animation_data.action = None
    for o in src_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    print("BAKED", clip, len(frames), "frames")

# Stash EVERYTHING (existing + new) to NLA for export.
target.animation_data_create()
target.animation_data.action = None
for a in list(existing_actions) + baked:
    tr = target.animation_data.nla_tracks.new()
    tr.name = a.name
    tr.strips.new(a.name, max(0, int(a.frame_range[0])), a)
    tr.mute = True

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
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
print("WROTE", OUT_GLB, os.path.getsize(OUT_GLB), "existing:", len(existing_actions), "new:", len(baked))
