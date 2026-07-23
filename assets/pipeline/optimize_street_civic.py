# Optimize the STREET & CIVIC batch of Meshy GLBs in assets/build/world-v3:
# decimate to Bible section 12 budgets (buildings 40k tris, props 15k),
# shrink textures to 1024 JPEG, re-export into assets/build/world-v3-opt.
# Owned by the street-civic factory; processes ONLY the keys listed below so
# it never touches wharf/interior batches that share the world-v3 folders.
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
#        --python assets/pipeline/optimize_street_civic.py
import bpy
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "world-v3")
OUT = os.path.join(ROOT, "build", "world-v3-opt")
MAX_TEX = 1024

# key -> triangle target. Buildings/landmarks 40k; props + background 15k.
TARGETS = {
    "church-meetinghouse.glb": 40000,
    "bldg-townhouse-civic.glb": 40000,
    "bldg-tavern.glb": 40000,
    "bldg-row-clapboard-a.glb": 40000,
    "bldg-row-clapboard-b.glb": 40000,
    "bldg-row-clapboard-c.glb": 40000,
    "bldg-row-brick-a.glb": 40000,
    "bldg-row-brick-b.glb": 40000,
    "bldg-row-shop.glb": 40000,
    "bldg-warehouse-street.glb": 40000,
    "bldg-scaffold.glb": 40000,
    "town-gate.glb": 15000,
    "skyline-cluster-a.glb": 15000,
    "skyline-cluster-b.glb": 15000,
    "skyline-cluster-c.glb": 15000,
    "street-lantern-bracket.glb": 15000,
    "hitching-post.glb": 15000,
    "firewood-stack.glb": 15000,
    "hay-cart.glb": 15000,
    "market-awning.glb": 15000,
    "churchyard-fence.glb": 15000,
    "stone-steps.glb": 15000,
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
print("STREET CIVIC OPT DONE")
