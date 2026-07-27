# Make a MODULE's collision-facing surface cover the collision it dresses.
#
# The defect this exists to close
# ------------------------------
# `moduleRunPlacements` in packages/mission-m1/src/runtime.ts draws a canopy, a
# walkway or a wall as a run of tiles FILLED onto their boxes — scaled per axis,
# not contain-fitted — and the box is the collision. So the mesh's bounding box is
# the collision exactly, on all three axes, wherever it is placed.
#
# A bounding box is not a surface. Two of M1's module assets have a bounding box
# that meets the collision and a SURFACE that does not, and the player runs on the
# surface:
#
#   market-awning, infill-lean-to   pitched. The bounding box top is the ridge,
#                                   so only the ridge line reaches the deck plane
#                                   and every one of the eleven pentices and stall
#                                   canopies drawn from them reported about 20% of
#                                   its footprint with anything under it. The
#                                   player ran along a plane that touched the art
#                                   on one line.
#   roof-walk-board-long            the boards are in the middle of the module and
#                                   the rope rails are at its edges, so a plank
#                                   walk filled onto a 1.60m tie beam draws 0.88m
#                                   of board and 0.72m of rail: the outer fifth of
#                                   the beam either side is rail and air.
#
# The owner's ruling is the same one the building roofs were rebuilt under: the ART
# moves to meet the collision, never the reverse. The route's leap arcs and its
# 180-second budget were tuned against the authored planes and nothing here may
# move them.
#
# The two operations
# -----------------
#   flat-top   Compress the roof's PITCH towards the module's own ceiling, so the
#              whole roof surface arrives within a boot's height of the plane
#              instead of touching it along the ridge alone. Everything below the
#              eaves — posts, stall, boarding, hanging goods — is not touched at
#              all: a flat-enough top the route can use, and the period read kept
#              where a period read is actually looked at, from below and the side.
#
#              COMPRESS, NOT COLLAPSE, and the difference is the whole of why this
#              was rewritten. The first version of this mode snapped every vertex
#              above the eaves to a single Z. That is monotonic, and it preserves
#              the bounding box and the triangle count, and it scored 100% — and
#              it is not injective. A canvas has two sides and a thickness, and
#              sending its top face, its underside and every fold between them to
#              one plane leaves thousands of coincident double-sided triangles.
#              The market shipped as white shredded slabs z-fighting with
#              themselves, which is what the owner saw. `--flatten` scales the
#              pitch instead, so every distinct height stays distinct, no two
#              faces become coplanar, and the awning keeps its section.
#
#   wide-deck  Remap the module's short plan axis so its WALKING surface spans the
#              whole width and the rails are squeezed into a band at each edge. A
#              rail at the edge of the boards is where a rail belongs; a rail a
#              fifth of the way in, with bare air outboard of it, is nothing.
#
# Why both are vertex remaps rather than rebuilds
# -----------------------------------------------
# `MODULE_RUNS.naturalM` carries each module's measured bounding size and
# `moduleRunPlacements` divides a run by it to decide the tile count, so a mesh
# that came back a fraction smaller would silently re-tile the market, the arcade
# and both pentice lines. Every operation here is a MONOTONIC function of one
# coordinate applied to EVERY vertex, so the topology cannot tear, the endpoints
# map to themselves, the bounding box is preserved to the micron, and the triangle
# count and the texture atlas come out byte-identical to what went in. The final
# assertion is on the bounding box, and it is fatal.
#
# Run:
#   blender --background --python assets/pipeline/build_m1_module_surface.py -- \
#     in.glb out.glb --mode flat-top [--apron 0.14] [--eaves 0.0]
#   blender --background --python assets/pipeline/build_m1_module_surface.py -- \
#     in.glb out.glb --mode wide-deck --deckat 0.511 [--rail 0.08]
#
# --flatten  what fraction of the roof's pitch survives. The residual fall has to
#            stay inside `TOL_BELOW` (0.35m) at the DEEPEST-scaled draw of the
#            module, because that draw multiplies the module's own fall the most:
#            for `market-awning` that is LANE_PENTICE at 2.95x, so the awning's
#            0.443 of local pitch may keep about a quarter of itself. 0.10 is used
#            rather than that ceiling so the fall lands near 0.13m at the worst
#            eave — a boot's height the player steps over, not a shin's.
# --eaves    fraction of the module's height above which geometry is roof. 0 reads
#            it off the top surface itself.
# --deckat   fraction of the module's height at which the walking surface sits, the
#            same measurement `MODULE_RUNS.deckAtM` declares.
# --rail     fraction of the width each rail band is compressed into.
import bmesh
import bpy
import math
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC_GLB = os.path.abspath(argv[0])
OUT_GLB = os.path.abspath(argv[1])

opts = {"mode": "flat-top", "flatten": 0.10, "eaves": 0.0, "deckat": 0.0, "rail": 0.08}
rest = argv[2:]
for index in range(0, len(rest) - 1, 2):
    name = rest[index].lstrip("-")
    if name not in opts:
        raise SystemExit(f"unknown option {rest[index]}")
    opts[name] = rest[index + 1] if name == "mode" else float(rest[index + 1])

KEY = os.path.splitext(os.path.basename(OUT_GLB))[0]


def log(*parts):
    print(f"[{KEY}]", *parts)


# ---------------------------------------------------------------------------
# 1. Import, join, and measure
# ---------------------------------------------------------------------------
# glTF is Y-up and Blender is Z-up; the importer converts on the way in and
# `export_yup` converts back, so everything below is Blender space: Z is height
# and X/Y are the plan.

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC_GLB)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
assert meshes, f"no mesh in {SRC_GLB}"
bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
module = bpy.context.view_layer.objects.active
module.name = KEY
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def coords_of(obj):
    return np.array([v.co[:] for v in obj.data.vertices], dtype=np.float64)


def tris_of(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


SOURCE = coords_of(module)
LO, HI = SOURCE.min(axis=0), SOURCE.max(axis=0)
SIZE = HI - LO
SOURCE_TRIS = tris_of(module)
log(f"source {SIZE[0]:.4f} x {SIZE[1]:.4f} x {SIZE[2]:.4f} (blender xyz), {SOURCE_TRIS} tris")


def top_surface(samples=17):
    """The height of the first thing a falling foot meets, over a plan grid.

    The same question `verify_m1_placements.mjs` asks, asked here in the module's
    own space so that what is measured is what the probe will measure. Rays are
    cast from above the ceiling; a column that meets nothing is a hole in the plan
    and is reported rather than counted.
    """
    hits = np.full((samples, samples), np.nan)
    for i in range(samples):
        for j in range(samples):
            x = LO[0] + (i + 0.5) / samples * SIZE[0]
            y = LO[1] + (j + 0.5) / samples * SIZE[1]
            found, location, _, _ = module.ray_cast(
                Vector((x, y, HI[2] + SIZE[2])), Vector((0.0, 0.0, -1.0))
            )
            if found:
                hits[i, j] = location.z
    return hits


BEFORE = top_surface()
covered = np.count_nonzero(~np.isnan(BEFORE))
at_top = np.count_nonzero(BEFORE >= HI[2] - 0.02 * SIZE[2])
log(
    f"top surface before: {covered}/{BEFORE.size} columns hit something, "
    f"{at_top} of them within 2% of the ceiling"
)
if covered:
    finite = BEFORE[~np.isnan(BEFORE)]
    log(
        f"  height fraction min {(finite.min() - LO[2]) / SIZE[2]:.3f} "
        f"median {(np.median(finite) - LO[2]) / SIZE[2]:.3f} "
        f"max {(finite.max() - LO[2]) / SIZE[2]:.3f}"
    )


def remap(fn):
    for vertex in module.data.vertices:
        vertex.co = fn(vertex.co)
    module.data.update()


# The plane this module is being made to carry. The ceiling for a canopy, whose
# collision IS its roof; the boards for a walkway, which has rails above them.
deck_z = HI[2]


def field(grid, axis):
    """Plan extent of the carrying surface on one axis, to the outside of its cells."""
    at_plane = np.abs(grid - deck_z) <= 0.03 * SIZE[2]
    if not at_plane.any():
        raise SystemExit(f"nothing's top surface is near {deck_z:.4f}")
    live = np.where(at_plane.any(axis=1 - axis))[0]
    samples = grid.shape[axis]
    return (
        LO[axis] + live.min() / samples * SIZE[axis],
        LO[axis] + (live.max() + 1) / samples * SIZE[axis],
    )


def field_dense(axis, samples=601, tol=None):
    """Plan extent of the carrying surface on one axis, measured finely.

    `field` reads a 17-cell grid, and a cell is six per cent of the module: it
    cannot tell a surface that reaches the box from one that stops twenty-four
    millimetres short of it, and twenty-four millimetres is exactly the size of the
    defect this measurement exists to close. So the run axis is scanned at
    sub-millimetre resolution.

    EVERY line across the surface has to reach, not any of them. Asking for one was
    not enough by a whole grid column: the awning's roof plan is not a rectangle and
    its middle reaches further along the length than its edges do, so a scan down
    the centre reported a surface that met the box while the probe's own outer rows
    still fell into the seam. Taking the extent where all the lines agree pushes the
    short ones out with the long ones.
    """
    other = 1 - axis
    # How far under the ceiling a hit still counts as the carrying surface. The
    # default suits a surface that is meant to be dead flat; a compressed pitch is
    # deliberately not, and a mono-pitch reaches its full residual fall on the scan
    # line furthest down the slope, so `flat-top` passes its own fall in. Left at
    # 3% the lean-to's slope fell outside it and no x position carried the plane
    # on all seven lines.
    if tol is None:
        tol = 0.03 * SIZE[2]
    lines = [0.10, 0.20, 0.30, 0.50, 0.70, 0.80, 0.90]
    lo, hi = None, None
    for i in range(samples):
        value = LO[axis] + (i / (samples - 1)) * SIZE[axis]
        found = 0
        for share in lines:
            point = [0.0, 0.0, HI[2] + SIZE[2]]
            point[axis] = value
            point[other] = LO[other] + share * SIZE[other]
            ok, location, _, _ = module.ray_cast(Vector(point), Vector((0.0, 0.0, -1.0)))
            if ok and abs(location.z - deck_z) <= tol:
                found += 1
        if found < len(lines):
            continue
        lo = value if lo is None else lo
        hi = value
    assert lo is not None, (
        f"no position on {'xyz'[axis]} carries the plane on all {len(lines)} scan lines"
    )
    return lo, hi


def spread(axis, band_fraction, label, extent=None):
    """Push the carrying surface out to the box on one axis, compressing the rest.

    Monotonic and piecewise-linear in that one coordinate, applied to every vertex,
    with the endpoints mapping to themselves — so the topology cannot tear and the
    bounding box is untouched.
    """
    f0, f1 = extent
    band = band_fraction * SIZE[axis]
    keep0, keep1 = LO[axis] + band, HI[axis] - band
    assert f1 > f0 and keep1 > keep0, f"degenerate surface field on {label}"
    log(f"  {label}: surface spans {f0:.4f}..{f1:.4f} "
        f"({(f1 - f0) / SIZE[axis] * 100:.1f}% of {SIZE[axis]:.4f}) "
        f"-> {keep0:.4f}..{keep1:.4f} ({(keep1 - keep0) / SIZE[axis] * 100:.1f}%)")

    def moved(co):
        value = co[axis]
        if value <= f0:
            t = (value - LO[axis]) / max(f0 - LO[axis], 1e-9)
            out = LO[axis] + t * band
        elif value >= f1:
            t = (HI[axis] - value) / max(HI[axis] - f1, 1e-9)
            out = HI[axis] - t * band
        else:
            t = (value - f0) / (f1 - f0)
            out = keep0 + t * (keep1 - keep0)
        point = [co.x, co.y, co.z]
        point[axis] = out
        return Vector(point)

    remap(moved)


# Along the run the carrying surface has to reach the box EXACTLY, and that is a
# measured requirement rather than tidiness. `moduleRunPlacements` divides a run
# into tiles that butt along the module's local X, so every millimetre of the box
# the surface does not reach is a millimetre of open seam between two tiles: the
# plank walk's boards stopped 0.5% of the module short of each end, which on the
# ropewalk's 4.85m tiles is a 24mm slot in the drawn floor at 64.45, 69.30 and
# 74.15, and the probe's middle sample column lands on one of them.
RUN_BAND = 0.0


# ---------------------------------------------------------------------------
# 2a. flat-top
# ---------------------------------------------------------------------------

if opts["mode"] == "flat-top":
    # Where the wall stops and the roof starts. Read off the top surface rather
    # than off a silhouette: a mono-pitch lean-to has no ridge to find and its
    # eaves is simply the lowest point of its own roof plane. The 5th percentile
    # keeps one stray column — a gap between two boards of the stall below —
    # from dragging the threshold down into the posts.
    finite = BEFORE[~np.isnan(BEFORE)]
    if opts["eaves"] > 0.0:
        eaves_z = LO[2] + opts["eaves"] * SIZE[2]
    else:
        eaves_z = float(np.percentile(finite, 5.0))
    log(f"eaves at {(eaves_z - LO[2]) / SIZE[2]:.3f} of height ({eaves_z:.4f})")

    keep = float(opts["flatten"])
    assert 0.0 < keep <= 1.0, "--flatten is the fraction of the pitch that survives"
    ceiling = HI[2]

    # Two affine pieces on Z, and the join between them is the whole point.
    #
    # The roof band [eaves_z, ceiling] is compressed onto [eaves, ceiling] where
    # `eaves` is the eaves line lifted to just under the ridge. Everything BELOW
    # is then stretched from [LO, eaves_z] onto [LO, eaves] so that it still
    # arrives exactly where the roof now starts.
    #
    # That second piece is not tidiness, it is the bug. Leaving the body alone and
    # only moving the roof makes the map DISCONTINUOUS at eaves_z: a vertex a
    # tenth of a millimetre under the line stays, its neighbour a tenth over jumps
    # four tenths of the module, and the mesh is torn along the eaves into a comb.
    # That cliff — not the flattening — is what shredded the canvas, and it was in
    # the collapse version too, which is why its own top-surface profile came back
    # as a sawtooth along both edge rows. Continuous, monotonic, endpoints fixed:
    # LO and the ceiling map to themselves, so the bounding box cannot move, and
    # no two distinct heights are ever sent to one.
    #
    # What it looks like is a stall whose posts now reach its canvas: the body
    # comes up by the same amount the roof came down, and the awning reads as
    # taut sailcloth over a frame instead of a tent pitched under a plane.
    fall_before = ceiling - eaves_z
    eaves = ceiling - fall_before * keep
    rise = (eaves - LO[2]) / max(eaves_z - LO[2], 1e-9)

    def taut(co):
        if co.z <= eaves_z:
            return Vector((co.x, co.y, LO[2] + (co.z - LO[2]) * rise))
        return Vector((co.x, co.y, ceiling - (ceiling - co.z) * keep))

    roof = sum(1 for v in module.data.vertices if v.co.z > eaves_z)
    remap(taut)
    log(f"pitch {fall_before:.4f} -> {fall_before * keep:.4f} of the module "
        f"({fall_before * keep / SIZE[2]:.3f} of its height) over {roof} roof "
        f"vertices; the {len(module.data.vertices) - roof} below the eaves rise "
        f"by {rise:.4f}x to meet them, so the map is continuous at {eaves_z:.4f}")

    # Along the run the surface has to reach the box or every tile joint is an
    # open seam — but the spread that guarantees it compresses everything outside
    # the surface's own extent into a band, and at RUN_BAND=0 that band is a
    # plane. That is the same collapse again, applied to the gable ends. So it is
    # asked for only when the surface actually falls short.
    f0, f1 = field_dense(0, tol=max(0.03 * SIZE[2], 1.25 * fall_before * keep))
    if (f0 - LO[0]) > 1e-3 or (HI[0] - f1) > 1e-3:
        log("flat has to be pushed out to the run's ends:")
        spread(0, RUN_BAND, "length", extent=(f0, f1))
    else:
        log(f"  length: surface already spans {f0:.4f}..{f1:.4f} of "
            f"{LO[0]:.4f}..{HI[0]:.4f}; no spread, so the ends keep their section")

# ---------------------------------------------------------------------------
# 2b. wide-deck
# ---------------------------------------------------------------------------

elif opts["mode"] == "wide-deck":
    assert opts["deckat"] > 0.0, "--deckat is required for wide-deck"
    deck_z = LO[2] + opts["deckat"] * SIZE[2]  # noqa: F841 — read by the probe below
    # The board field, measured: the plan extent over which the top surface IS the
    # walking surface. Everything outside it is rail.
    log(f"boards at {opts['deckat']:.3f} of height ({deck_z:.4f}):")
    spread(0, RUN_BAND, "length", extent=field_dense(0))
    # Across the run, the rails: squeezed into a band at each edge of the boards,
    # which is where a rail on a staging stands. Measured after the length pass,
    # because that pass moved the geometry the measurement reads.
    spread(1, float(opts["rail"]), "width", extent=field(top_surface(), 1))

else:
    raise SystemExit(f"unknown mode {opts['mode']}")


# ---------------------------------------------------------------------------
# 3. Prove it, and export
# ---------------------------------------------------------------------------

AFTER = top_surface()
covered_after = np.count_nonzero(~np.isnan(AFTER))
at_top_after = np.count_nonzero(AFTER >= HI[2] - 0.02 * SIZE[2])
log(
    f"top surface after: {covered_after}/{AFTER.size} columns hit something, "
    f"{at_top_after} of them within 2% of the ceiling"
)

# The probe's own grid, so this build reports the number the pipeline will report.
# 5x5 sampled at the cell centres is exactly `verify_m1_placements.mjs`.
PROBE = 5
ok = 0
for i in range(PROBE):
    for j in range(PROBE):
        x = LO[0] + (i + 0.5) / PROBE * SIZE[0]
        y = LO[1] + (j + 0.5) / PROBE * SIZE[1]
        found, location, _, _ = module.ray_cast(
            Vector((x, y, HI[2] + SIZE[2])), Vector((0.0, 0.0, -1.0))
        )
        # A surface within 35% of the module's height of the plane it carries is
        # the reader's own step-down at the scale these are drawn.
        if found and abs(location.z - deck_z) <= 0.35 * SIZE[2]:
            ok += 1
log(f"PROBE {ok}/{PROBE * PROBE} of a 5x5 grid carries the plane "
    f"({ok / (PROBE * PROBE) * 100:.0f}%)")

FINAL = coords_of(module)
lo, hi = FINAL.min(axis=0), FINAL.max(axis=0)
size = hi - lo
log(f"FINAL {size[0]:.4f} x {size[1]:.4f} x {size[2]:.4f}, {tris_of(module)} tris")
for axis, name in enumerate("xyz"):
    assert abs(size[axis] - SIZE[axis]) < 5e-4, (
        f"bounding box moved on {name}: {size[axis]:.5f} was {SIZE[axis]:.5f}. "
        f"MODULE_RUNS.naturalM would have to change with it and every run this "
        f"module tiles would re-tile."
    )
assert tris_of(module) == SOURCE_TRIS, "triangle count changed; this is a vertex remap"
log("bounding box and triangle count preserved")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
module.select_set(True)
bpy.context.view_layer.objects.active = module
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_yup=True,
    export_animations=False,
    use_selection=True,
)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
