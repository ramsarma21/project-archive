# Fill the Town House cupola drum, after build_m1_civic.py has warped and authored
# the rest of the building.
#
# Why this is a separate step, and why it is not in build_m1_civic.py
# ------------------------------------------------------------------
# build_m1_civic.py is the shared civic builder — it also makes the Hollis Street
# meeting house — and is owned by another lane. This defect is the Town House's
# alone, so the repair lives in a Town-House-owned script and the shared builder
# is left exactly as it was. Run after it, on its output.
#
# What it repairs, with the evidence that named it
# ------------------------------------------------
# verify_m1_townhouse.mjs reports the shipped mesh as MESH OK: one draw, scale
# 1.0000, natural bbox exactly the declared 15.0 x 17.6 x 16.2, every walkable
# deck 100% on-plane. So the float the owner photographed is neither a scale
# error nor a cluster gap — the box is perfect and every ledge has stone.
#
# probe_townhouse_slabs.mjs found where it is: the mesh is COMPLETELY EMPTY from
# 12.5m to 13.9m — zero vertices, no facade on any of the four faces — a 1.4m
# band of sky between the leads slab authored at 12.40m and the cupola, whose own
# geometry only begins at ~14.1m. The build log shows the mechanism: the two-band
# height warp maps the raw generation's [0.76 .. 1.00] of height onto
# [12.40 .. 17.10], and the generator drew its cupola on a thin neck with a void
# beneath it. A monotonic linear remap stretches that void; it cannot fill it,
# and cull_over_decks clears whatever thin neck survived over the leads. So the
# cupola floats, and the nine-ladder set's clock-to-cornice ladder leans on the
# underside of a slab whose wall the mesh never drew.
#
# The collision already says what belongs there. GEOMETRY authors TOWNHOUSE_TOWER
# as a SOLID 4 x 4 mass from the leads at 12.40m to the lookout at 17.10m — a
# masonry drum the cupola sits on, exactly what a 1713 town house cupola stood on.
# So the drum is drawn solid to match the collision, the same rule the pediment
# hood already follows and the rule this whole level runs on: the art moves to
# meet the collision, never the reverse. This is a mesh repair, not a re-fit (the
# box is already 1.0000) and not new art (the generator's void is the defect, as
# Meshy's own output was on the elm; procedural masonry filling an authored solid
# is the honest answer for a building).
#
# It touches nothing walkable: the drum is the x +/-2 tower core, which is where
# the leads/plinth decks are non-standable anyway (the collision solid stands
# there), so no deck probe, headroom check or route node is affected.
#
# Run:
#   blender --background --python assets/pipeline/build_townhouse_drum.py \
#     -- in.glb hull.json out.glb
import bpy
import bmesh
import json
import math
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
HULL_JSON = os.path.abspath(argv[1])
OUT_GLB = os.path.abspath(argv[2])

with open(HULL_JSON) as handle:
    HULL = json.load(handle)
KEY = HULL["key"]
ENV = HULL["envelope"]


def log(*parts):
    print(f"[{KEY}]", *parts)


# glTF is Y-up and Blender is Z-up: a hull-local (x, y, z) arrives at (x, -z, y).
def to_blender_rect(source):
    return (source["minX"], source["maxX"], -source["maxZ"], -source["minZ"])


EX0, EX1, EY0, EY1 = to_blender_rect(ENV)
EZ0, EZ1 = ENV["minY"], ENV["maxY"]

# The solids this asset owns that stand above the body as a tower. There is one —
# TOWNHOUSE_TOWER — but reading it off the tag keeps this honest if the level
# authors another, and it is the level's word for the thing rather than a name
# hard-coded here.
towers = []
for raw in HULL["blockers"]:
    if raw.get("mine") and "tower" in raw.get("tags", []):
        x0, x1, y0, y1 = to_blender_rect(raw)
        towers.append({"id": raw["id"], "x0": x0, "x1": x1, "y0": y0, "y1": y1,
                       "z0": raw["baseY"], "z1": raw["topY"]})
if not towers:
    raise SystemExit("no `mine` tower blocker in the hull; nothing to fill")


# ---------------------------------------------------------------------------
# Import the built building
# ---------------------------------------------------------------------------

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN_GLB)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
assert meshes, "no mesh in the input GLB"
bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
building = bpy.context.view_layer.objects.active
building.name = KEY
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
material = building.data.materials[0] if building.data.materials else None


def tris_of(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def coords_of(obj):
    return np.array([v.co[:] for v in obj.data.vertices], dtype=np.float64)


placed = coords_of(building)
size_before = placed.max(axis=0) - placed.min(axis=0)
log(f"imported {tris_of(building)} tris, bbox "
    f"x={size_before[0]:.4f} y={size_before[1]:.4f} z={size_before[2]:.4f}")


# ---------------------------------------------------------------------------
# A quiet patch of the shipped atlas, so the drum is painted stone, not sky.
# Ported from build_m1_civic.flat_atlas_uv: the lowest-variance block whose mean
# brightness is in a band, with saturation priced in so a grey lead/paint face
# asks for grey and not the calmest patch of red brick.
# ---------------------------------------------------------------------------

def flat_atlas_uv(low, high, fallback, grey=0.6):
    images = [i for i in bpy.data.images if i.size[0] >= 16]
    if not images:
        return fallback
    source = images[0]
    thumb = source.copy()
    grid = 48
    thumb.scale(grid, grid)
    pixels = np.empty(grid * grid * 4, dtype=np.float32)
    thumb.pixels.foreach_get(pixels)
    bpy.data.images.remove(thumb)
    rgb = pixels.reshape(grid, grid, 4)[:, :, :3]
    luma = rgb.mean(axis=2)
    chroma = (rgb.max(axis=2) - rgb.min(axis=2)) / np.maximum(rgb.max(axis=2), 1e-4)
    block = 4
    best = None
    for row in range(0, grid - block + 1):
        for col in range(0, grid - block + 1):
            patch = luma[row : row + block, col : col + block]
            mean = float(patch.mean())
            if not (low <= mean <= high):
                continue
            score = float(patch.std()) + grey * float(
                chroma[row : row + block, col : col + block].mean()
            )
            if best is None or score < best[0]:
                best = (score, row, col, mean)
    if best is None:
        return fallback
    _, row, col, _ = best
    pad = 0.1 * block / grid
    return (col / grid + pad, (col + block) / grid - pad,
            row / grid + pad, (row + block) / grid - pad)


LEAD_UV = flat_atlas_uv(0.26, 0.60, (0.45, 0.55, 0.45, 0.55))
PAINT_UV = flat_atlas_uv(0.56, 0.94, LEAD_UV)
log(f"paint uv u {PAINT_UV[0]:.3f}..{PAINT_UV[1]:.3f} v {PAINT_UV[2]:.3f}..{PAINT_UV[3]:.3f}")


def ping_pong(value):
    t = math.fmod(abs(value), 2.0)
    return t if t <= 1.0 else 2.0 - t


def atlas_uv(box, u_raw, v_raw):
    u0, u1, v0, v1 = box
    return (u0 + ping_pong(u_raw) * (u1 - u0), v0 + ping_pong(v_raw) * (v1 - v0))


# ---------------------------------------------------------------------------
# The drum
# ---------------------------------------------------------------------------

built = bmesh.new()
uv_layer = built.loops.layers.uv.new("UVMap")


def add_box(x0, x1, y0, y1, z0, z1, uv_box, uv_scale=0.5):
    corners = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    verts = [built.verts.new(Vector(point)) for point in corners]
    quads = (
        (4, 5, 6, 7), (3, 2, 1, 0),
        (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
    )
    for quad in quads:
        try:
            face = built.faces.new([verts[i] for i in quad])
        except ValueError:
            continue
        face.smooth = False
        for loop, index in zip(face.loops, quad):
            point = corners[index]
            if quad in ((4, 5, 6, 7), (3, 2, 1, 0)):
                u, v = point[0], point[1]
            elif quad in ((0, 1, 5, 4), (2, 3, 7, 6)):
                u, v = point[0], point[2]
            else:
                u, v = point[1], point[2]
            loop[uv_layer].uv = atlas_uv(uv_box, u * uv_scale, v * uv_scale)


# Inset a hair so the generated louvred cupola that shares this footprint above
# ~14.1m sits just proud of the drum rather than z-fighting it: the drum is the
# solid backing the louvres show against, and the wall the empty band becomes.
INSET = 0.03
report = []
for tower in towers:
    add_box(
        tower["x0"] + INSET, tower["x1"] - INSET,
        tower["y0"] + INSET, tower["y1"] - INSET,
        tower["z0"], tower["z1"], PAINT_UV,
    )
    log(f"drum {tower['id']}: solid {tower['x1'] - tower['x0']:.2f} x "
        f"{tower['y1'] - tower['y0']:.2f}m core, z {tower['z0']:.2f}..{tower['z1']:.2f}")
    report.append({"id": f"{tower['id']}__DRUM", "z0": tower["z0"], "z1": tower["z1"]})

bmesh.ops.remove_doubles(built, verts=list(built.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(built, faces=list(built.faces))
drum_mesh = bpy.data.meshes.new(f"{KEY}-drum")
built.to_mesh(drum_mesh)
built.free()
drum = bpy.data.objects.new(f"{KEY}-drum", drum_mesh)
bpy.context.scene.collection.objects.link(drum)
if material:
    drum.data.materials.append(material)
log("drum", tris_of(drum), "tris")


# ---------------------------------------------------------------------------
# Join and export, without re-touching the atlas
# ---------------------------------------------------------------------------

bpy.ops.object.select_all(action="DESELECT")
building.select_set(True)
drum.select_set(True)
bpy.context.view_layer.objects.active = building
bpy.ops.object.join()
final = bpy.context.view_layer.objects.active
final.name = KEY

placed = coords_of(final)
size_after = placed.max(axis=0) - placed.min(axis=0)
base = placed[:, 2].min()
log(f"FINAL_SIZE x={size_after[0]:.4f} y={size_after[1]:.4f} z={size_after[2]:.4f}")
log(f"FINAL_WANT x={EX1 - EX0:.4f} y={EY1 - EY0:.4f} z={EZ1 - EZ0:.4f}")
log(f"FINAL_BASE z={base:+.5f} (want 0)")
log("FINAL_TRIS", tris_of(final))
log("FINAL_DRUM", json.dumps(report))
# The bounding box is the draw box; the drum must not have moved it.
for name, before, after, want in (
    ("x", size_before[0], size_after[0], EX1 - EX0),
    ("y", size_before[1], size_after[1], EY1 - EY0),
    ("z", size_before[2], size_after[2], EZ1 - EZ0),
):
    if abs(after - want) > 0.002 or abs(after - before) > 0.002:
        raise SystemExit(
            f"drum moved the bounding box on {name}: {before:.4f} -> {after:.4f} "
            f"(want {want:.4f}); it must fit strictly inside the envelope"
        )

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
final.select_set(True)
# The atlas is already 2048 and clean from build_m1_civic; keep_originals passes
# its bytes straight through so this second export does not re-encode the JPEG.
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_yup=True,
    export_animations=False,
    export_image_format="AUTO",
    export_keep_originals=False,
    use_selection=True,
)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
