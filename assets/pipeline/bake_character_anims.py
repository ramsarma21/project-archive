# Bake Mixamo clips onto ONE Meshy-rigged character with proper rest-delta
# retargeting, producing a single self-contained GLB (mesh + skeleton + named
# animations). This is the standard "same-family humanoid retarget":
#
#   world_rot_target(t) = ( world_rot_source(t) @ world_rot_source_rest^-1 )
#                         @ world_rot_target_rest
#
# i.e. transfer the CHANGE from rest, never the absolute orientation, so
# differing bone rolls / rest poses between the rigs cannot deform the mesh.
# Hips also receive scaled world translation deltas.
#
# Run:
#   blender --background --python bake_character_anims.py -- <rigged.glb> <out.glb> [clipsCsv]
import bpy
import os
import sys
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
IN_GLB = argv[0]
OUT_GLB = argv[1]
CLIPS = argv[2].split(",") if len(argv) > 2 else [
    "idle", "walk", "run", "leftTurn", "rightTurn",
    "reach", "search", "carry", "carryWalk", "handoff",
    "crouchIdle", "crouchWalk", "crouchLeft", "crouchRight", "crouchToStand",
    "climbUp", "climbDown", "vault",
    "work1", "work2", "cheer1", "cheer2",
    "talk", "talk2", "talk3", "talk4", "argu1", "argue2",
    "circleWalk1", "circleWalk2",
]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIXAMO_DIR = os.path.join(ROOT, "source", "mixamo")

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


def import_new(importer, filepath):
    before = set(bpy.data.objects)
    importer(filepath=filepath)
    return [o for o in bpy.data.objects if o not in before]


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

# ---- Target character ----
tgt_objs = import_new(lambda filepath: bpy.ops.import_scene.gltf(filepath=filepath), IN_GLB)
target = find_armature(tgt_objs)
assert target, "no armature in " + IN_GLB
target.animation_data_clear()
bpy.context.view_layer.update()

TW = target.matrix_world.copy()
TW_rot = TW.to_quaternion()

# Target rest data (armature space).
tgt_rest_arm = {b.name: b.matrix_local.copy() for b in target.data.bones}
tgt_rest_world_rot = {n: (TW_rot @ m.to_quaternion()) for n, m in tgt_rest_arm.items()}
tgt_parent = {b.name: (b.parent.name if b.parent else None) for b in target.data.bones}
hips_rest_world = TW @ tgt_rest_arm["Hips"].translation
baked = []
IN_PLACE_CLIPS = {
    "idle", "walk", "run", "leftTurn", "rightTurn",
    "reach", "search", "carry", "carryWalk", "handoff",
    "crouchIdle", "crouchWalk", "crouchLeft", "crouchRight", "crouchToStand",
    "work1", "work2", "cheer1", "cheer2",
    "talk", "talk2", "talk3", "talk4", "argu1", "argue2",
}
HANDS = {"LeftHand", "RightHand"}

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

    # Scale source so hips rest heights match in world space.
    bpy.context.view_layer.update()
    src_hips_rest_w = (source.matrix_world @ source.data.bones["mixamorig:Hips"].matrix_local).translation
    # Blender is Z-up. Previous builds accidentally used Y, leaving source
    # rigs at unrelated scales and corrupting root/hip motion.
    if src_hips_rest_w.z > 1e-4:
        source.scale = source.scale * (hips_rest_world.z / src_hips_rest_w.z)
    bpy.context.view_layer.update()

    # Source rest world rotations (after scaling; scale does not change rot).
    SW_rot = source.matrix_world.to_quaternion()
    src_rest_world_rot = {}
    for sb in source.data.bones:
        src_rest_world_rot[sb.name] = SW_rot @ sb.matrix_local.to_quaternion()
    src_hips_rest_w = (source.matrix_world @ source.data.bones["mixamorig:Hips"].matrix_local).translation

    # Collect per-frame samples.
    frames = list(range(f0, f1 + 1))
    samples = []  # frame -> {dstBone: world quat}, plus hips world pos
    for f in frames:
        scene.frame_set(f)
        bpy.context.view_layer.update()
        SWm = source.matrix_world
        SW_rot_f = SWm.to_quaternion()
        rec = {"rot": {}, "hips": None}
        for s_name, d_name in BONE_MAP.items():
            spb = source.pose.bones.get(s_name)
            if spb is None or d_name not in tgt_rest_arm:
                continue
            # Meshy rigs have no finger chains. Holding the wrist at target
            # rest for locomotion avoids exaggerated Mixamo wrist/finger
            # gestures collapsing into the single hand bone.
            if d_name in HANDS and clip in {"idle", "walk", "run", "leftTurn", "rightTurn"}:
                continue
            world_rot = SW_rot_f @ spb.matrix.to_quaternion()
            delta = world_rot @ src_rest_world_rot[s_name].inverted()
            rec["rot"][d_name] = delta @ tgt_rest_world_rot[d_name]
        hips_w = SWm @ source.pose.bones["mixamorig:Hips"].matrix.translation
        hips_delta = hips_w - src_hips_rest_w
        if clip in IN_PLACE_CLIPS:
            # X/Y are Blender's ground plane; the world controller owns them.
            hips_delta.x = 0
            hips_delta.y = 0
        rec["hips"] = hips_rest_world + hips_delta
        samples.append(rec)

    # Solve pose-local bases top-down in armature space and write keyframes.
    new_act = bpy.data.actions.new(clip)
    new_act.use_fake_user = True
    target.animation_data_create()
    target.animation_data.action = new_act

    order = []
    def walk(name):
        order.append(name)
        for b in target.data.bones:
            if b.parent and b.parent.name == name:
                walk(b.name)
    roots = [b.name for b in target.data.bones if b.parent is None]
    for r in roots:
        walk(r)

    TW_inv = TW.inverted()
    TW_inv_rot = TW_inv.to_quaternion()

    for fi, f in enumerate(frames):
        arm_pose = {}  # boneName -> final matrix in target armature space
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
                # Unmapped bone: hold rest offset under animated parent.
                m = parent_m @ local_rest
            else:
                rot_arm = (TW_inv_rot @ desired_world_rot).to_matrix().to_4x4()
                if name == "Hips":
                    trans = TW_inv @ samples[fi]["hips"]
                else:
                    trans = (parent_m @ local_rest).translation
                m = Matrix.Translation(trans) @ rot_arm
            pb = target.pose.bones[name]
            # Assign the final armature-space pose matrix and let Blender
            # compute matrix_basis using its own rest/parent conversion. The
            # previous handwritten basis formula was the source of the bent
            # shoulders and wrists visible in-game.
            pb.rotation_mode = "QUATERNION"
            pb.matrix = m
            bpy.context.view_layer.update()
            arm_pose[name] = pb.matrix.copy()
            pb.keyframe_insert("rotation_quaternion", frame=f)
            if name == "Hips":
                pb.keyframe_insert("location", frame=f)

    baked.append(new_act)
    target.animation_data.action = None
    for o in src_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    print("BAKED", clip, len(frames), "frames")

# Stash actions to NLA for export.
target.animation_data_create()
target.animation_data.action = None
for a in baked:
    tr = target.animation_data.nla_tracks.new()
    tr.name = a.name
    tr.strips.new(a.name, int(a.frame_range[0]), a)
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
    export_jpeg_quality=80,
)
print("WROTE", OUT_GLB, os.path.getsize(OUT_GLB), "clips:", len(baked))
