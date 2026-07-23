# Prepare a static Meshy T-pose as Mixamo's OBJ+MTL+textures ZIP input.
# Mixamo's FBX parser can silently fail after marker placement on Blender FBX;
# the ZIP path is its documented fallback.
#
# Run: blender --background --python prepare_mixamo_obj.py -- playerboy-v4
import bpy
import os
import shutil
import sys
import zipfile
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "characters")
OUT_ROOT = os.path.join(ROOT, "build", "mixamo-upload")
args = sys.argv[sys.argv.index("--") + 1 :]
name = args[0]
src = os.path.abspath(args[1]) if len(args) > 1 else os.path.join(SRC, f"{name}-refined.glb")
work = os.path.join(OUT_ROOT, f"{name}-obj")
zip_path = os.path.join(OUT_ROOT, f"{name}.zip")
TARGET_TRIS = 30000

shutil.rmtree(work, ignore_errors=True)
os.makedirs(work, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]

total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
ratio = min(1.0, TARGET_TRIS / max(1, total))
for o in meshes:
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    if ratio < 1:
        mod = o.modifiers.new("mixamo_decimate", "DECIMATE")
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)

# Center XY and ground Z.
mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i])
            mx[i] = max(mx[i], w[i])
offset = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
for o in meshes:
    o.location -= offset
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)

obj_path = os.path.join(work, f"{name}.obj")
bpy.ops.wm.obj_export(
    filepath=obj_path,
    export_selected_objects=True,
    export_materials=True,
    path_mode="COPY",
    forward_axis="NEGATIVE_Z",
    up_axis="Y",
    export_triangulated_mesh=True,
)

# OBJ exporter may leave images at original absolute paths. Pack every used
# image into the ZIP and rewrite MTL map paths to basenames.
images = []
for image in bpy.data.images:
    raw = bpy.path.abspath(image.filepath_raw or image.filepath)
    if raw and os.path.isfile(raw):
        dst = os.path.join(work, os.path.basename(raw))
        if not os.path.exists(dst):
            shutil.copy2(raw, dst)
        images.append(dst)

for f in os.listdir(work):
    if f.endswith(".mtl"):
        p = os.path.join(work, f)
        text = open(p, encoding="utf8").read()
        for image in images:
            # Replace any path ending in this image's basename.
            base = os.path.basename(image)
            lines = []
            for line in text.splitlines():
                if line.startswith(("map_", "bump ")) and base in line:
                    line = line.split()[0] + " " + base
                lines.append(line)
            text = "\n".join(lines) + "\n"
        open(p, "w", encoding="utf8").write(text)

with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for f in os.listdir(work):
        z.write(os.path.join(work, f), arcname=f)
print("WROTE", zip_path, os.path.getsize(zip_path))
