# Decide whether a baked character GLB can accept a DIRECT native Mixamo action
# copy (no retargeting) the way bake_native_mixamo_character.py does from a
# skinned FBX. Reports the two things that decide it: bone naming and the unit
# scale of the Hips location channels.
#
# Run:
#   blender --background --python probe_rig_space.py -- character.glb motion.fbx
import bpy
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1 :]
GLB = os.path.abspath(argv[0])
FBX = os.path.abspath(argv[1])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30


def armature(objs):
    return next((o for o in objs if o.type == "ARMATURE"), None)


def import_new(op, path):
    before = set(bpy.data.objects)
    op(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


glb_objs = import_new(lambda filepath: bpy.ops.import_scene.gltf(filepath=filepath), GLB)
glb_rig = armature(glb_objs)
print("GLB_RIG", glb_rig.name)
print("GLB_RIG_SCALE", tuple(round(v, 6) for v in glb_rig.scale))
print("GLB_RIG_MATRIX_WORLD")
for row in glb_rig.matrix_world:
    print("   ", tuple(round(v, 6) for v in row))
glb_bones = [b.name for b in glb_rig.data.bones]
print("GLB_BONE_COUNT", len(glb_bones))
print("GLB_BONES_SAMPLE", glb_bones[:6])
hips = next((b for b in glb_rig.data.bones if "Hips" in b.name), None)
print("GLB_HIPS", hips.name if hips else None)
print("GLB_HIPS_REST_LOCAL_TRANSLATION", tuple(round(v, 6) for v in hips.matrix_local.translation))
print("GLB_HIPS_REST_WORLD", tuple(round(v, 6) for v in (glb_rig.matrix_world @ hips.matrix_local.translation)))

# Existing baked action on the GLB: what units are its Hips location values in?
glb_actions = list(bpy.data.actions)
print("GLB_ACTION_COUNT", len(glb_actions))


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


for action in glb_actions:
    if action.name not in {"walk", "run", "idle"}:
        continue
    for curve in fcurves(action):
        if "Hips" in curve.data_path and curve.data_path.endswith("location"):
            values = [k.co[1] for k in curve.keyframe_points]
            if not values:
                continue
            print(
                f"GLB_ACTION {action.name} {curve.data_path}[{curve.array_index}] "
                f"min={min(values):.4f} max={max(values):.4f} span={max(values)-min(values):.4f}"
            )

fbx_objs = import_new(lambda filepath: bpy.ops.import_scene.fbx(filepath=filepath, use_anim=True), FBX)
fbx_rig = armature(fbx_objs)
print("FBX_RIG", fbx_rig.name)
print("FBX_RIG_SCALE", tuple(round(v, 6) for v in fbx_rig.scale))
fbx_bones = [b.name for b in fbx_rig.data.bones]
print("FBX_BONE_COUNT", len(fbx_bones))
print("FBX_BONES_SAMPLE", fbx_bones[:6])
fbx_hips = next((b for b in fbx_rig.data.bones if "Hips" in b.name), None)
print("FBX_HIPS", fbx_hips.name if fbx_hips else None)
print("FBX_HIPS_REST_LOCAL_TRANSLATION", tuple(round(v, 6) for v in fbx_hips.matrix_local.translation))
fbx_action = fbx_rig.animation_data.action if fbx_rig.animation_data else None
print("FBX_ACTION", fbx_action.name if fbx_action else None)
if fbx_action:
    for curve in fcurves(fbx_action):
        if "Hips" in curve.data_path and curve.data_path.endswith("location"):
            values = [k.co[1] for k in curve.keyframe_points]
            if not values:
                continue
            print(
                f"FBX_ACTION {curve.data_path}[{curve.array_index}] "
                f"min={min(values):.4f} max={max(values):.4f} span={max(values)-min(values):.4f}"
            )

overlap = set(glb_bones) & set(fbx_bones)
print("BONE_NAME_OVERLAP", len(overlap))
print("DIRECT_COPY_VIABLE", len(overlap) > 20)
