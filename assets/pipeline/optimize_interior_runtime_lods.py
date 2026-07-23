# Build interior-only LOD copies of legacy production props. Source geometry is
# always an existing imported GLB; Blender only cleans/decimates/re-exports.
# Exterior keys remain untouched.
import bpy
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "..", "apps", "web", "public", "world", "props")
OUT = os.path.join(ROOT, "build", "interior-runtime-opt")
MAX_TEX = 1024

TARGETS = {
    "hearth-mantel": 8000,
    "bed-fourpost": 8000,
    "table-chairs-set": 8000,
    "storage-chest": 6000,
    "dresser-shelves": 8000,
    "washbasin-stand": 6000,
    "candle-sconce": 4000,
    "firewood-stack": 6000,
    "crate-stack": 6000,
    "spinning-wheel": 8000,
    "shop-counter-long": 8000,
    "clerk-desk": 8000,
    "barrel-group": 6000,
    "bookshelf-ledgers": 8000,
    "paper-satchel": 5000,
    "type-cases": 8000,
    "tankard-cluster": 5000,
    "tavern-bar-barrels": 8000,
    "notice-board": 8000,
    "cargo-net-bundle": 8000,
    "rope-coil-large": 6000,
}

os.makedirs(OUT, exist_ok=True)


def tris(obj):
    return sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)


for key, target in TARGETS.items():
    src = os.path.join(SRC, key + ".glb")
    dst = os.path.join(OUT, key + "-interior-lod.glb")
    if not os.path.exists(src):
        raise RuntimeError("missing deployed source " + src)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    total = sum(tris(obj) for obj in meshes)
    if total > target:
        ratio = target / total
        for obj in meshes:
            count = tris(obj)
            if count <= 80:
                continue
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            modifier = obj.modifiers.new("InteriorRuntimeLOD", "DECIMATE")
            modifier.ratio = max(0.02, ratio)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            obj.select_set(False)
    for image in bpy.data.images:
        width, height = image.size
        if width > MAX_TEX or height > MAX_TEX:
            scale = min(MAX_TEX / max(width, 1), MAX_TEX / max(height, 1))
            image.scale(max(1, round(width * scale)), max(1, round(height * scale)))
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=80,
        export_animations=False,
    )
    final_total = sum(tris(obj) for obj in meshes)
    print("WROTE", os.path.basename(dst), final_total, "/", target)

print("INTERIOR RUNTIME LODS DONE", len(TARGETS))

