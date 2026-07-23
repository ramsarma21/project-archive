# Optimize the WHARF & SHIPS world-v3 Meshy GLBs: decimate, shrink textures,
# re-export. Bible SS12 budgets: buildings <=40k tris, hero ship <=60k,
# props <=15k, textures <=1024 JPEG.
# Scoped to the wharf worker's asset list (build/world-v3 is shared with other
# overnight workers) and always reprocesses its keys so a generic 15k pass from
# another worker's optimizer cannot silently win via mtime-skips.
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background --python assets/pipeline/optimize_world_v3_wharf.py
import bpy
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "world-v3")
OUT = os.path.join(ROOT, "build", "world-v3-opt")
MAX_TEX = 1024

WHARF_KEYS = [
    "ship-brig-hero",
    "ship-snow-background",
    "ship-sloop",
    "rowboat",
    "gangplank",
    "buoy",
    "wharf-pier-module",
    "wharf-boardwalk-plank",
    "bldg-warehouse-wharf-a",
    "bldg-warehouse-wharf-b",
    "timber-crane",
    "bollard",
    "rope-coil-large",
    "cargo-net-bundle",
    "crate-mound",
    "fish-flakes-rack",
]


def budget(name):
    if name.startswith("ship-brig-hero"):
        return 60000
    if name.startswith("bldg-"):
        return 40000
    return 15000


os.makedirs(OUT, exist_ok=True)
if not os.path.isdir(SRC):
    raise SystemExit("no world-v3 dir yet")

for key in WHARF_KEYS:
    name = key + ".glb"
    src = os.path.join(SRC, name)
    if not os.path.exists(src):
        print("MISSING", name)
        continue
    dst = os.path.join(OUT, name)
    target = budget(name)

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
    print("WROTE", dst, os.path.getsize(dst), "srcTris", total, "target", target)
print("WHARF OPT DONE")
