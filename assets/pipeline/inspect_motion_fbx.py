# Report the raw root translation of native Mixamo motion FBXs so ROOT_MODE can
# be chosen from measurements instead of guesses. Axis mapping for the Mixamo
# Hips under a 0.01-scaled armature: local X and Z are world horizontal, local Y
# is world vertical (values are centimetres).
#
# Also reports the start/end pose delta of every bone, which is what decides
# whether a cyclic clip can loop seamlessly.
#
# Run:
#   blender --background --python inspect_motion_fbx.py -- clip [clip ...]
import bpy
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1 :]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = os.path.join(ROOT, "source", "mixamo")
AXIS = {0: "X(horiz)", 1: "Y(vert)", 2: "Z(horiz)"}


def fcurves(action):
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


for clip in argv:
    path = clip if os.path.isabs(clip) else os.path.join(ANIMS, clip + ".fbx")
    label = os.path.splitext(os.path.basename(path))[0]
    if not os.path.exists(path):
        print(f"MISSING {label}")
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True)
    rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    action = rig.animation_data.action if rig and rig.animation_data else None
    if action is None:
        print(f"NO_ACTION {label}")
        continue
    start, end = action.frame_range
    frames = int(end - start) + 1
    print(f"\n=== {label}  frames={frames}  duration={frames / 30:.2f}s")
    curves = fcurves(action)
    for curve in curves:
        if "Hips" not in curve.data_path or not curve.data_path.endswith("location"):
            continue
        keys = [k.co[1] for k in curve.keyframe_points]
        if not keys:
            continue
        print(
            f"  hips {AXIS[curve.array_index]:9s} span={max(keys) - min(keys):8.2f}cm "
            f"start={keys[0]:8.2f} end={keys[-1]:8.2f} netTravel={keys[-1] - keys[0]:8.2f}"
        )
    # Loop seam: how far every rotation channel has to jump from last frame back
    # to first. A seamless cycle is near zero; a one-shot clip is expected large.
    worst = []
    total = 0.0
    for curve in curves:
        if not curve.data_path.endswith("rotation_quaternion"):
            continue
        keys = [k.co[1] for k in curve.keyframe_points]
        if len(keys) < 2:
            continue
        delta = abs(keys[-1] - keys[0])
        total += delta
        bone = curve.data_path.split('"')[1].replace("mixamorig:", "")
        worst.append((delta, f"{bone}[{curve.array_index}]"))
    worst.sort(reverse=True)
    print(f"  loopSeam totalQuatDelta={total:.4f} worst={[f'{name}={d:.3f}' for d, name in worst[:4]]}")
