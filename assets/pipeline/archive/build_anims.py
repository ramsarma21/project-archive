# Build a single GLB animation library from the Mixamo motion-only FBX clips.
# All clips share the mixamorig skeleton, so their actions can be stashed onto
# one master armature and exported together. three.js reads them by name.
#
# Run: blender --background --python assets/pipeline/build_anims.py
import bpy
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "source", "mixamo")
OUT = os.path.join(ROOT, "build", "anims", "anim-library.glb")

# Clips exported in-place (loops driven by the game's own movement).
# Root motion clips keep hip translation for authored traversal markers.
CLIPS = [
    "idle", "walk", "run", "leftTurn", "rightTurn",
    "reach", "search", "carry", "carryWalk", "handoff",
    "crouchIdle", "crouchWalk", "crouchLeft", "crouchRight", "crouchToStand",
    "climbUp", "climbDown", "vault",
    "work1", "work2", "cheer1", "cheer2",
    "talk", "talk2", "talk3", "talk4", "argu1", "argue2",
    "circleWalk1", "circleWalk2",
]


def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    before = set(bpy.data.objects)
    try:
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False,
                                 ignore_leaf_bones=False, use_anim=True)
    except AttributeError:
        bpy.ops.wm.fbx_import(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def main():
    clean_scene()
    bpy.context.scene.render.fps = 30

    master = None
    kept_actions = []

    for name in CLIPS:
        path = os.path.join(SRC, name + ".fbx")
        if not os.path.exists(path):
            print("MISSING", path)
            continue
        new_objs = import_fbx(path)
        arms = [o for o in new_objs if o.type == "ARMATURE"]
        if not arms:
            print("NO ARMATURE", name)
            continue
        arm = arms[0]
        act = arm.animation_data.action if arm.animation_data else None
        if act is None:
            print("NO ACTION", name)
            continue
        act.name = name
        act.use_fake_user = True
        kept_actions.append(act)

        if master is None:
            master = arm
            master.name = "MixamoRig"
        else:
            # Same skeleton; the action transfers directly. Drop the extra rig.
            for o in new_objs:
                bpy.data.objects.remove(o, do_unlink=True)

    if master is None:
        print("FATAL: no master armature")
        sys.exit(1)

    # Stash every action as an NLA strip so the glTF exporter writes each as a
    # named animation.
    if master.animation_data is None:
        master.animation_data_create()
    master.animation_data.action = None
    for act in kept_actions:
        track = master.animation_data.nla_tracks.new()
        track.name = act.name
        track.strips.new(act.name, int(act.frame_range[0]), act)
        track.mute = True

    # Remove any imported meshes; the library is skeleton + clips only.
    for o in list(bpy.data.objects):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)

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
        export_apply=False,
        export_skins=True,
        export_morph=False,
    )
    print("WROTE", OUT, "clips:", len(kept_actions))


main()
