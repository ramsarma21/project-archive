# Optimize the last three fallback-shell props (scaffold-low, roof-ramp-cart,
# tankard-cluster) from assets/build/world-v3 into assets/build/world-v3-opt.
# Scoped to only these keys so it never touches the factory batches.
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
#        --python assets/pipeline/optimize_missing_props.py
import bpy
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "world-v3")
OUT = os.path.join(ROOT, "build", "world-v3-opt")
MAX_TEX = 1024

TARGETS = {
    "scaffold-low.glb": 15000,
    "roof-ramp-cart.glb": 15000,
    "tankard-cluster.glb": 8000,
}

os.makedirs(OUT, exist_ok=True)

for name, target in sorted(TARGETS.items()):
    src = os.path.join(SRC, name)
    if not os.path.exists(src):
        print("MISSING", name)
        continue
    dst = os.path.join(OUT, name)

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
    print("WROTE", dst, os.path.getsize(dst), "target", target, "srcTris", total)
print("MISSING PROPS OPT DONE")
