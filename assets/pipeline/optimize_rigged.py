# Optimize Meshy-rigged character GLBs for the web: decimate skinned meshes,
# downscale textures, re-export compact GLBs (weights + skeleton preserved).
# Run: blender --background --python assets/pipeline/optimize_rigged.py
import bpy
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "characters")
OUT = os.path.join(ROOT, "build", "characters-opt")
TARGET_TRIS = 30000
MAX_TEX = 1024

os.makedirs(OUT, exist_ok=True)

names = [f for f in os.listdir(SRC) if f.endswith("-rigged.glb")]
for name in names:
    src = os.path.join(SRC, name)
    dst = os.path.join(OUT, name)
    if os.path.exists(dst) and os.path.getmtime(dst) > os.path.getmtime(src):
        print("SKIP", name)
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    total = 0
    for obj in meshes:
        total += sum(len(p.vertices) - 2 for p in obj.data.polygons)
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        tri = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if total > TARGET_TRIS and tri > 2000:
            mod = obj.modifiers.new("dec", "DECIMATE")
            mod.ratio = max(0.05, TARGET_TRIS / total)
            bpy.ops.object.modifier_apply(modifier=mod.name)

    for img in bpy.data.images:
        if img.size[0] > MAX_TEX or img.size[1] > MAX_TEX:
            img.scale(min(img.size[0], MAX_TEX), min(img.size[1], MAX_TEX))

    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=80,
        export_animations=False,
        export_skins=True,
    )
    print("WROTE", dst, os.path.getsize(dst))

print("DONE", len(names))
