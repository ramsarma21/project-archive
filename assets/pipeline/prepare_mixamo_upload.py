# Convert static Meshy T-pose GLBs to FBX files ready for Mixamo auto-rigging.
# Characters are centered, feet grounded, transforms applied, and textures
# embedded. No Meshy armature is used; Mixamo creates the production skeleton.
#
# Run:
#   blender --background --python prepare_mixamo_upload.py -- [name ...]
import bpy
import os
import sys
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "characters")
OUT = os.path.join(ROOT, "build", "mixamo-upload")
TARGET_TRIS = 30000
MAX_TEXTURE = 2048
os.makedirs(OUT, exist_ok=True)

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
names = argv or [
    "abigail", "thomas", "pike", "clarke", "rider",
    "officer", "townsman", "townswoman", "playerboy-v2",
]

for name in names:
    src = os.path.join(SRC, f"{name}-refined.glb")
    if not os.path.exists(src):
        print("SKIP", name, "(no refined GLB)")
        continue

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        print("SKIP", name, "(no mesh)")
        continue

    # Mixamo's auto-rigger fails silently on Meshy's ~300k-triangle refined
    # outputs. Reduce the upload mesh to a clean 30k-triangle body first.
    total_tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    if total_tris > TARGET_TRIS:
        ratio = TARGET_TRIS / total_tris
        for o in meshes:
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            mod = o.modifiers.new("mixamo_decimate", "DECIMATE")
            mod.ratio = ratio
            bpy.ops.object.modifier_apply(modifier=mod.name)

    for image in bpy.data.images:
        if image.size[0] > MAX_TEXTURE or image.size[1] > MAX_TEXTURE:
            image.scale(min(MAX_TEXTURE, image.size[0]), min(MAX_TEXTURE, image.size[1]))

    # Ground and center the full character as one group.
    for o in meshes:
        o.select_set(True)
    box_min = Vector((1e9, 1e9, 1e9))
    box_max = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            box_min.x = min(box_min.x, w.x)
            box_min.y = min(box_min.y, w.y)
            box_min.z = min(box_min.z, w.z)
            box_max.x = max(box_max.x, w.x)
            box_max.y = max(box_max.y, w.y)
            box_max.z = max(box_max.z, w.z)
    center_xy = Vector(((box_min.x + box_max.x) / 2, (box_min.y + box_max.y) / 2, box_min.z))
    for o in meshes:
        o.location -= center_xy
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # Export just the visible meshes; embed all referenced textures.
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    out = os.path.join(OUT, f"{name}.fbx")
    bpy.ops.export_scene.fbx(
        filepath=out,
        use_selection=True,
        object_types={"MESH"},
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Z",
        axis_up="Y",
        add_leaf_bones=False,
        bake_anim=False,
        path_mode="COPY",
        embed_textures=True,
    )
    print("WROTE", out, os.path.getsize(out))
