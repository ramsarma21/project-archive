# Optimize the world-v3 INTERIOR KIT GLBs only (prop budget: <=15k tris,
# 1024 textures, JPEG85) - same rules as optimize_world.py. Scoped to an
# explicit key list because assets/build/world-v3 is shared with the
# buildings/wharf factory whose assets use the 40k building budget.
# Run: blender --background --python assets/pipeline/optimize_interiors_v3.py
import bpy
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "world-v3")
OUT = os.path.join(ROOT, "build", "world-v3-opt")
MAX_TEX = 1024
TARGET = 15000

KEYS = [
    "hearth-mantel", "bed-fourpost", "table-chairs-set", "dresser-shelves",
    "shop-counter-long", "storage-chest", "spinning-wheel", "church-pew-block",
    "church-pulpit", "tavern-table-set", "candle-sconce", "drying-line-rack",
    "bookshelf-ledgers", "iron-stove", "washbasin-stand", "tavern-bar-barrels",
]

os.makedirs(OUT, exist_ok=True)

for key in KEYS:
    name = key + ".glb"
    src = os.path.join(SRC, name)
    dst = os.path.join(OUT, name)
    if not os.path.exists(src):
        print("MISSING", name)
        continue
    if os.path.exists(dst) and os.path.getmtime(dst) > os.path.getmtime(src):
        print("SKIP", name)
        continue

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        tri = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if total > TARGET and tri > 1500:
            mod = obj.modifiers.new("dec", "DECIMATE")
            mod.ratio = max(0.04, TARGET / total)
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
    )
    print("WROTE", dst, os.path.getsize(dst))
print("INTERIORS V3 OPT DONE")
