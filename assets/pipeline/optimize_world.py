# Optimize Meshy world/building GLBs: decimate, shrink textures, re-export.
# Buildings keep more triangles than small props.
# Run: blender --background --python assets/pipeline/optimize_world.py
import bpy
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "world")
OUT = os.path.join(ROOT, "build", "world-opt")
MAX_TEX = 1024

os.makedirs(OUT, exist_ok=True)
if not os.path.isdir(SRC):
    raise SystemExit("no world dir yet")

for name in sorted(os.listdir(SRC)):
    if not name.endswith(".glb"):
        continue
    src = os.path.join(SRC, name)
    dst = os.path.join(OUT, name)
    if os.path.exists(dst) and os.path.getmtime(dst) > os.path.getmtime(src):
        print("SKIP", name)
        continue
    target = 40000 if name.startswith("bldg-") or name == "liberty-elm.glb" else 15000

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        tri = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if total > target and tri > 1500:
            mod = obj.modifiers.new("dec", "DECIMATE")
            mod.ratio = max(0.04, target / total)
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
print("WORLD OPT DONE")
