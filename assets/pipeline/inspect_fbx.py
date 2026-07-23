# Read-only inspector for a motion FBX. Reports scene FPS, per-action frame
# range/duration, armature/bone inventory, mesh presence, object transforms/
# units, and Hips (root) translation on all axes. Does not modify or export.
#
# Usage:
#   blender --background --python inspect_fbx.py -- in.fbx
import bpy
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1 :]
INPUT = os.path.abspath(argv[0])

bpy.ops.wm.read_factory_settings(use_empty=True)

print("=== INSPECT", INPUT, os.path.getsize(INPUT), "bytes ===")
bpy.ops.import_scene.fbx(filepath=INPUT, use_anim=True)

scene = bpy.context.scene
print("scene.fps", scene.render.fps, "fps_base", scene.render.fps_base)
print("unit_system", scene.unit_settings.system, "scale_length", scene.unit_settings.scale_length)


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


for obj in bpy.data.objects:
    print(
        f"object '{obj.name}' type={obj.type} "
        f"loc={tuple(round(v, 4) for v in obj.location)} "
        f"rot_euler={tuple(round(v, 4) for v in obj.rotation_euler)} "
        f"scale={tuple(round(v, 5) for v in obj.scale)}"
    )
    if obj.type == "ARMATURE":
        bones = obj.data.bones
        print(f"  armature bones={len(bones)}")
        print("  bone_names:", ", ".join(b.name for b in bones))
        roots = [b.name for b in bones if b.parent is None]
        print("  root_bones:", ", ".join(roots))
    if obj.type == "MESH":
        print(f"  mesh verts={len(obj.data.vertices)} materials={len(obj.data.materials)}")

for action in bpy.data.actions:
    fr = action.frame_range
    fps = scene.render.fps / scene.render.fps_base
    n = int(round(fr[1] - fr[0]))
    dur = (fr[1] - fr[0]) / fps
    print(f"action '{action.name}' frame_range={tuple(round(v,2) for v in fr)} frames={n} duration={dur:.4f}s")
    # Report Hips location channel deltas (root translation) on each axis.
    for curve in get_fcurves(action):
        if "Hips" not in curve.data_path or not curve.data_path.endswith("location"):
            continue
        if len(curve.keyframe_points) == 0:
            continue
        vals = [k.co[1] for k in curve.keyframe_points]
        axis = "XYZ"[curve.array_index] if curve.array_index < 3 else str(curve.array_index)
        print(
            f"  Hips.location[{axis}] first={vals[0]:.4f} last={vals[-1]:.4f} "
            f"min={min(vals):.4f} max={max(vals):.4f} range={max(vals)-min(vals):.4f}"
        )

print("=== INSPECT DONE ===")
