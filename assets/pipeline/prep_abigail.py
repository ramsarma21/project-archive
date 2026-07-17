# Prepare Abigail for rigging: decimate the 297k-tri single mesh to a game
# LOD, shrink textures, export a compact GLB suitable for the Meshy rig API.
# Run: blender --background --python assets/pipeline/prep_abigail.py
import bpy
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "source", "characters", "abigail.glb")
OUT = os.path.join(ROOT, "build", "characters", "abigail-prepped.glb")

TARGET_TRIS = 55000
MAX_TEX = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
assert meshes, "no mesh imported"

for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    tri_count = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tri_count > TARGET_TRIS:
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.ratio = TARGET_TRIS / tri_count
        bpy.ops.object.modifier_apply(modifier=mod.name)
    print("mesh", obj.name, "tris after:", sum(len(p.vertices) - 2 for p in obj.data.polygons))

# Downscale embedded textures.
for img in bpy.data.images:
    if img.size[0] > MAX_TEX or img.size[1] > MAX_TEX:
        img.scale(min(img.size[0], MAX_TEX), min(img.size[1], MAX_TEX))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_image_format="JPEG",
    export_jpeg_quality=85,
)
print("WROTE", OUT, os.path.getsize(OUT), "bytes")
