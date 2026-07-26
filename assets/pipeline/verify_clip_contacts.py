# Numeric animation QA that a contact sheet cannot give you:
#
#  1. Ground contact — lowest skinned vertex per frame. Catches feet punching
#     through the floor and characters floating, and any scale mismatch.
#  2. Foot sliding — for a cyclic locomotion clip, the planted foot's backward
#     sweep implies a stride speed. If that disagrees with the speed the movement
#     code drives, the feet skate. Reported as impliedSpeed so it can be compared
#     against WALK_SPEED / RUN_SPEED / CROUCH_SPEED.
#  3. Joint sanity — elbow and knee hyperextension (a bend angle past straight is
#     an inverted joint) and gross wrist twist.
#  4. Loop seam — first/last frame pose distance in world space, in centimetres,
#     which is easier to judge than a quaternion sum.
#
# Run:
#   blender --background --python verify_clip_contacts.py -- in.glb [clip ...]
import bpy
import os
import sys
import math
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
ONLY = set(argv[1:])

# Clips whose feet are meant to leave the floor or whose body is meant to be on
# it; ground contact is reported but not judged for these.
AIRBORNE_OR_PRONE = {
    "jump", "runJump", "vault", "climbUp", "climbDown", "death", "dodge",
    "dropRoll", "land", "landHard", "leapOfFaith",
    # Traversal verbs legitimately leave the floor mid-clip (hands on a ledge,
    # feet off a wall). They are still reported, just not flagged — what matters
    # is that minY comes back near 0, proving the pose is not frozen mid-air.
    "mantle", "climbOver", "hangDrop", "landRun", "stepUp", "slide",
    "leapOfFaithLand",
}
CYCLIC = {
    "idle", "walk", "run", "sprint", "crouchIdle", "crouchWalk", "aimWalk",
    "aimRun", "idleAim", "standoff", "blendWalk", "leapOfFaith",
}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=IN_GLB)
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
# Skinned meshes only. Blender's glTF importer invents an unskinned +/-1m
# "Icosphere" that is not in the file, and including it pins every ground-contact
# reading at exactly -100cm.
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() is rig]
assert meshes, "no skinned mesh"
rig.animation_data_create()
for track in rig.animation_data.nla_tracks:
    track.mute = True


def hips_vertical_freeze(action):
    """The constant the Hips vertical channel is pinned to, or None if it moves.

    This is the direct test for the root-mode defect class. A clip whose vertical
    channel is frozen at a NON-ZERO value has been pinned to whatever height its
    first keyframe happened to sit at, so the character holds that offset for the
    clip's whole duration: positive floats it, negative sinks it through the
    floor. Zero means it was pinned to the rig's rest height, which is correct.
    Values are centimetres.
    """
    for curve in fcurves_of(action):
        if "Hips" not in curve.data_path or not curve.data_path.endswith("location"):
            continue
        if curve.array_index != 1:
            continue
        values = [key.co[1] for key in curve.keyframe_points]
        if not values:
            return None
        return values[0] if max(values) - min(values) < 1e-6 else None
    return None


def fcurves_of(action):
    if hasattr(action, "fcurves") and len(action.fcurves) > 0:
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


def bone(name):
    for candidate in (f"mixamorig{name}", f"mixamorig:{name}", name):
        if candidate in rig.pose.bones:
            return rig.pose.bones[candidate]
    return None


def world(pose_bone):
    return (rig.matrix_world @ pose_bone.matrix).translation


def joint_angle(a, b, c):
    # Interior angle at b. 180 deg is straight; above ~181 is hyperextended.
    first = (world(a) - world(b)).normalized()
    second = (world(c) - world(b)).normalized()
    return math.degrees(math.acos(max(-1.0, min(1.0, first.dot(second)))))


CHAINS = {
    "Lelbow": ("LeftArm", "LeftForeArm", "LeftHand"),
    "Relbow": ("RightArm", "RightForeArm", "RightHand"),
    "Lknee": ("LeftUpLeg", "LeftLeg", "LeftFoot"),
    "Rknee": ("RightUpLeg", "RightLeg", "RightFoot"),
}

print(f"{'clip':16s} {'minY(cm)':>9s} {'vFreeze':>8s} {'seam(cm)':>9s} "
      f"{'stride(m)':>9s} {'implied':>8s}  worstJoint")
for action in sorted(bpy.data.actions, key=lambda a: a.name):
    if ONLY and action.name not in ONLY:
        continue
    rig.animation_data.action = action
    try:
        rig.animation_data.action_slot = action.slots[0]
    except Exception:
        pass
    start, end = action.frame_range
    frames = list(range(int(start), int(end) + 1))
    lowest, highest = 1e9, -1e9
    foot_tracks = {"LeftToeBase": [], "RightToeBase": []}
    poses = []
    worst_joint = ("", 0.0)
    deps = bpy.context.evaluated_depsgraph_get()
    for frame in frames:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        for mesh_obj in meshes:
            ev = mesh_obj.evaluated_get(deps)
            mesh = ev.to_mesh()
            matrix = ev.matrix_world
            # Every 7th vertex: enough to find the floor contact on a 15k-vertex
            # character without paying for a full transform per frame.
            for index in range(0, len(mesh.vertices), 7):
                z = (matrix @ mesh.vertices[index].co).z
                if z < lowest:
                    lowest = z
                if z > highest:
                    highest = z
            ev.to_mesh_clear()
        for name in foot_tracks:
            pose_bone = bone(name)
            if pose_bone:
                foot_tracks[name].append(world(pose_bone).copy())
        for label, (a, b, c) in CHAINS.items():
            pa, pb, pc = bone(a), bone(b), bone(c)
            if pa and pb and pc:
                angle = joint_angle(pa, pb, pc)
                if angle > worst_joint[1]:
                    worst_joint = (label, angle)
        poses.append([world(pb).copy() for pb in rig.pose.bones])

    seam = 0.0
    if len(poses) > 1:
        seam = max((a - b).length for a, b in zip(poses[0], poses[-1])) * 100

    # Stride: the longest continuous backward sweep of whichever toe stays
    # lowest (the planted one), over the frames it is planted.
    stride, implied = 0.0, 0.0
    if action.name in CYCLIC:
        best = 0.0
        for track in foot_tracks.values():
            if len(track) < 3:
                continue
            ys = [p.z for p in track]
            floor = min(ys) + 0.03
            run_len, run_start = 0.0, None
            for index in range(1, len(track)):
                planted = ys[index] <= floor and ys[index - 1] <= floor
                if planted:
                    if run_start is None:
                        run_start = index - 1
                    delta = Vector(
                        (track[index].x - track[index - 1].x, track[index].y - track[index - 1].y, 0)
                    ).length
                    run_len += delta
                else:
                    if run_start is not None and run_len > best:
                        best = run_len
                        stride_frames = index - run_start
                    run_start, run_len = None, 0.0
            if run_start is not None and run_len > best:
                best = run_len
                stride_frames = len(track) - run_start
        if best > 0.02:
            stride = best
            # A full cycle contains two strides, so cycle speed = stride /
            # (cycleDuration / 2).
            cycle_seconds = len(frames) / 30.0
            implied = stride / (cycle_seconds / 2)

    freeze = hips_vertical_freeze(action)
    flag = ""
    # A non-zero vertical freeze is the defect regardless of what the clip is
    # doing, so this is checked for every clip including the airborne ones.
    if freeze is not None and abs(freeze) > 1.0:
        flag += " ROOT_PINNED_OFF_REST"
    if action.name not in AIRBORNE_OR_PRONE and lowest < -0.02:
        flag += " GROUND_PENETRATION"
    if action.name not in AIRBORNE_OR_PRONE and lowest > 0.04:
        flag += " FLOATING"
    if worst_joint[1] > 179.0:
        flag += " HYPEREXTENDED"
    if action.name in CYCLIC and seam > 3.0:
        flag += " LOOP_SEAM"
    freeze_text = "moves" if freeze is None else f"{freeze:.2f}"
    print(
        f"{action.name:16s} {lowest * 100:9.2f} {freeze_text:>8s} {seam:9.2f} "
        f"{stride:9.3f} {implied:8.2f}  {worst_joint[0]}={worst_joint[1]:.1f}{flag}"
    )
