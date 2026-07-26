# Turn a raw Meshy steeple into steeple-meetinghouse-climbable.glb: the Hollis
# Street tower, and the take-off for both of M1's leaps of faith.
#
# Why this is not the generic civic build
# ---------------------------------------
# build_m1_civic.py fits a generated building to a hull in two bands — a wide
# body and a narrow tower — and lays a slab at each walkable height. That is the
# right shape of answer for the Town House, which is a block with a cupola on it.
# It is the wrong one here, and the first attempt showed why: a steeple's whole
# character lives ABOVE the topmost solid the level declared, so the two-band
# warp put a plain shaft under three naked slabs and the result read as a pagoda
# with trays bolted to a mast. The probe agreed — 0% of the louvre sill and 49%
# of the dive gallery had stone under the foot.
#
# The difference is that a steeple is a STACK OF DIMINISHING STAGES, and the
# level authored the setbacks: four ring ledges at 14.0 / 15.8 / 17.6 / 19.4, a
# 4m shaft solid to 15.3 and a 2m lantern from 15.8 to 18.9. Those are the real
# building's stage cornices, which is why the route can climb it in six moves. So
# the stages are authored from the hull, in order, with the cornice under each
# ring carried on courses that step back to the stage below — because the reason
# the first attempt looked like trays is that a 1.7m oversail with nothing under
# it IS a tray.
#
# Two sources, as with the elm:
#   Meshy   the single texture atlas, the brickwork of the shaft, and the arched
#           louvre detail on the stage bodies. Everything that has to look built.
#   here    every surface a foot meets, plus the stage bodies and cornices those
#           surfaces need in order to read as carried rather than floating.
#
# The authored cores sit 60mm inside the collision faces so the generated skin
# stays the outermost surface and the two never z-fight; the core is what a probe
# finds if the generator left a hole, which on the first attempt it did — a whole
# band at 10.6m with no faces at all.
#
# Which rings are galleries and which are cornices is measured, not assumed, and
# it is the whole silhouette. The first version of this level authored four
# walkable rings 5.4 to 7.4m wide at 1.8m centres on a 2.0m core; every one of
# them got a balustrade, and the result was a pagoda — a brick-and-white tower
# with its spire missing. The level then narrowed the upper core to a 1.2m lantern
# with a 2.8m cornice on it and declared a spire above the top ring, so there is
# now one broad gallery, a tall open lantern, and somewhere for a spire to be
# drawn into. `walkway_width` is what keeps that: a ring wide enough to walk on
# gets a rail, a narrow ledge round a lantern gets a moulding.
#
# What the hull still governs, and why it is obeyed rather than fudged: FittedGlb
# contain-fits the mesh into the box sceneryPlacements() asks for, so the drawn
# object can never exceed that box on any axis, and everything the finial carries
# has to sit inside the spire's own declared footprint — outside it the vane
# balcony is a surface the player stands on.
#
# Run:
#   blender --background --python assets/pipeline/build_m1_steeple.py \
#     -- raw.glb hull.json out.glb [--tris 30000] [--tex 2048] [--brick 0.55]
import bpy
import bmesh
import json
import math
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
RAW_GLB = os.path.abspath(argv[0])
HULL_JSON = os.path.abspath(argv[1])
OUT_GLB = os.path.abspath(argv[2])

opts = {"tris": 30000, "tex": 2048, "jpeg": 88, "brick": None}
rest = argv[3:]
for index in range(0, len(rest) - 1, 2):
    name = rest[index].lstrip("-")
    if name not in opts:
        raise SystemExit(f"unknown option {rest[index]}")
    opts[name] = float(rest[index + 1]) if name == "brick" else int(rest[index + 1])

with open(HULL_JSON) as handle:
    HULL = json.load(handle)

KEY = HULL["key"]
ENV = HULL["envelope"]
STAND_H = HULL["capsule"]["standHeight"]
HEADROOM_M = STAND_H + 0.20
TRI_BUDGET = int(opts["tris"])
MAX_TEX = int(opts["tex"])

# How far inside the collision face an authored core sits, so the generated skin
# is the visible surface and nothing z-fights.
CORE_INSET = 0.06
# The last of the brick, authored rather than generated. Reaching fourteen metres
# stretches the generated shaft eighteenfold, and what stretches worst is the
# boundary between its brick and its paint — a moulding 90mm tall in the raw mesh
# becomes 1.6m of smeared zigzag, and it lands directly under the tower's biggest
# cornice, which is where the eye goes. Two metres of authored brick frieze with a
# string course under it is cleaner, and it is what carries a cornice on the real
# thing. The string course also hides the seam.
FRIEZE = 2.0


def log(*parts):
    print(f"[{KEY}]", *parts)


# glTF is Y-up and Blender is Z-up, so a hull-local offset (x, y, z) arrives at
# (x, -z, y). Every rect below is converted once, here, and never inline. The
# consequence worth stating: the elm stands at a LOWER game z than the steeple,
# so the direction both dives travel is Blender +y.
def to_blender_rect(source):
    return (source["minX"], source["maxX"], -source["maxZ"], -source["minZ"])


EX0, EX1, EY0, EY1 = to_blender_rect(ENV)
EZ0, EZ1 = ENV["minY"], ENV["maxY"]
log(f"envelope  x {EX0:.2f}..{EX1:.2f}  y {EY0:.2f}..{EY1:.2f}  z {EZ0:.2f}..{EZ1:.2f}")
if HULL.get("proposedSizeM"):
    log(
        f"built against a PROPOSED box {HULL['proposedSizeM']}; "
        f"assets.ts declares {HULL['declaredSizeM']}"
    )


# ---------------------------------------------------------------------------
# 1. The hull, in Blender's frame
# ---------------------------------------------------------------------------

class Blocker:
    def __init__(self, raw):
        self.id = raw["id"]
        self.x0, self.x1, self.y0, self.y1 = to_blender_rect(raw)
        self.z0, self.z1 = raw["baseY"], raw["topY"]
        self.mine = raw["mine"]
        self.tags = raw.get("tags") or []

    @property
    def plan_area(self):
        return max(0.0, self.x1 - self.x0) * max(0.0, self.y1 - self.y0)

    @property
    def centre(self):
        return ((self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0)

    def contains(self, x, y, shrink=0.0):
        return (
            self.x0 + shrink < x < self.x1 - shrink
            and self.y0 + shrink < y < self.y1 - shrink
        )


blockers = [Blocker(b) for b in HULL["blockers"]]
mine = [b for b in blockers if b.mine]
if not mine:
    raise SystemExit("the hull has no blocker owned by this asset; nothing to fit")
mine.sort(key=lambda b: b.z0)
shaft = max(mine, key=lambda b: b.plan_area)
# A spire's box is not a wall, it is a conservative bound on something that
# tapers to a point, so it is built and probed differently from every other
# solid. The level says which one it is; guessing from the numbers would work
# today and break the first time a tower gets two tapered stages.
spire = next((b for b in mine if "spire" in b.tags), None)
lanterns = [b for b in mine if b is not shaft and b is not spire]
for solid in mine:
    log(
        f"solid  {solid.id} x {solid.x0:.2f}..{solid.x1:.2f} y {solid.y0:.2f}..{solid.y1:.2f}"
        f"  z {solid.z0:.2f}..{solid.z1:.2f}"
    )


class Deck:
    """A walkable plane inside the envelope, with the part of it that is really
    standable held as the mask the hull exporter computed."""

    def __init__(self, raw):
        self.id = raw["id"]
        self.asset = raw["asset"]
        self.mine = raw["mine"]
        self.z = raw["y"]
        self.n = raw["mask"]["n"]
        self.rows = list(raw["mask"]["rows"])
        clipped = raw["clipped"]
        self.x0, self.x1, self.y0, self.y1 = to_blender_rect(clipped)
        self.local = clipped
        self.fraction = raw["standableFraction"]
        # A ring lands on whatever solid is directly beneath it where there is
        # one within a step, so the slab reads as the head of that stage rather
        # than as a tray hovering over it.
        support = [
            b.z1
            for b in blockers
            if b.z1 < self.z - 1e-6
            and b.z1 > self.z - 0.75
            and b.x1 > self.x0
            and b.x0 < self.x1
            and b.y1 > self.y0
            and b.y0 < self.y1
        ]
        self.thickness = round(self.z - max(support), 3) if support else 0.34

    def cell_bounds(self, i0, i1, j0, j1):
        """Half-open mask cell range -> Blender x/y bounds."""
        span_x = (self.local["maxX"] - self.local["minX"]) / self.n
        span_z = (self.local["maxZ"] - self.local["minZ"]) / self.n
        x_lo = self.local["minX"] + i0 * span_x
        x_hi = self.local["minX"] + i1 * span_x
        z_lo = self.local["minZ"] + j0 * span_z
        z_hi = self.local["minZ"] + j1 * span_z
        return x_lo, x_hi, -z_hi, -z_lo

    def standable_at(self, x, y):
        """Is this Blender x/y point on the standable part of the deck?"""
        if not (self.x0 <= x <= self.x1 and self.y0 <= y <= self.y1):
            return False
        span_x = self.local["maxX"] - self.local["minX"]
        span_z = self.local["maxZ"] - self.local["minZ"]
        i = min(max(int((x - self.local["minX"]) / span_x * self.n), 0), self.n - 1)
        j = min(max(int((-y - self.local["minZ"]) / span_z * self.n), 0), self.n - 1)
        return self.rows[i][j] == "1"


all_decks = [Deck(d) for d in HULL["decks"] if d.get("mask")]
all_decks.sort(key=lambda d: d.z)
# Only this asset's own rings are authored here. The meeting house roof and the
# ridge walk fall inside the steeple's envelope because the tower rises through
# them, but they are drawn by church-meetinghouse and roof-ridge-walk; authoring
# a second copy would push a 7.4m slab of stone out of the tower at eaves height.
# They still cull, because filling the space over someone else's walkway is this
# mesh's fault wherever it happens.
decks = [d for d in all_decks if d.mine]
for deck in all_decks:
    log(
        f"deck   {deck.id} z={deck.z:.2f} t={deck.thickness:.2f}"
        f"  standable {deck.fraction * 100:.0f}%"
        f"  {'authored here' if deck.mine else f'drawn by {deck.asset}'}"
    )
if not decks:
    raise SystemExit("no ring of this asset's own has standable area; nothing to author")


# ---------------------------------------------------------------------------
# 2. The stage schedule
# ---------------------------------------------------------------------------
# The real building's setbacks and the route's climb are the same list of
# numbers, so the schedule is read rather than chosen: each ring is the cornice
# of the stage below it, and the stage body between two rings is whichever solid
# the level put there.

RINGS = [d.z for d in decks]
SHAFT_TOP = shaft.z1
BRICK_TOP = RINGS[0]          # 14.0: the brick gives way to painted timber here


def solid_at(z):
    """The stage body the level declared at this height, if any."""
    for solid in mine:
        if solid.z0 - 0.01 <= z <= solid.z1 + 0.01:
            return solid
    return None


log(f"stage schedule: rings at {[round(r, 2) for r in RINGS]}")
log(f"  brick to {BRICK_TOP:.2f}, shaft solid to {SHAFT_TOP:.2f}")
for solid in lanterns:
    log(
        f"  lantern {solid.id} {solid.z0:.2f}..{solid.z1:.2f}, "
        f"{solid.x1 - solid.x0:.2f}m across, {solid.z1 - solid.z0:.2f}m tall"
    )
if spire:
    log(
        f"  spire   {spire.id} {spire.z0:.2f}..{spire.z1:.2f}, "
        f"{spire.x1 - spire.x0:.2f}m base, {spire.z1 - spire.z0:.2f}m tall"
    )
else:
    log("  no spire declared: the tower ends at its topmost ring")

# Headroom above the topmost ring, which is what decides whether the crown can be
# finished at all. Nothing may stand over the top ring's own footprint, so the
# balustrade and the vane go in the ring of plan the level left outboard of it.
TOP_RING = decks[-1]
log(f"  {EZ1 - TOP_RING.z:.2f}m of box above the top ring at {TOP_RING.z:.2f}")


# ---------------------------------------------------------------------------
# 3. Import and normalise the generated steeple
# ---------------------------------------------------------------------------

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=RAW_GLB)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
assert meshes, "no mesh in the raw GLB"
bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
generated = bpy.context.view_layer.objects.active
generated.name = KEY
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
material = generated.data.materials[0] if generated.data.materials else None


def tris_of(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def coords_of(obj):
    return np.array([v.co[:] for v in obj.data.vertices], dtype=np.float64)


log("raw tris", tris_of(generated))
coords = coords_of(generated)
lo, hi = coords.min(axis=0), coords.max(axis=0)
coords[:, 2] -= lo[2]
height = hi[2] - lo[2]
# The tower axis, not the bounding-box centre: a generated steeple's spire wanders
# and its cornices are asymmetric, but the shaft is the one part reliably plumb.
shaft_band = coords[coords[:, 2] < 0.35 * height]
axis_x = float(np.median(shaft_band[:, 0]))
axis_y = float(np.median(shaft_band[:, 1]))
coords[:, 0] -= axis_x
coords[:, 1] -= axis_y
log(f"raw bbox {hi[0] - lo[0]:.3f} x {hi[1] - lo[1]:.3f} x {height:.3f}, axis recentred")


# ---------------------------------------------------------------------------
# 4. Atlas sampling, before anything is deleted
# ---------------------------------------------------------------------------
# The authored stages share Meshy's atlas, so they need UVs that land on brick,
# on white paint, on lead and on gilding rather than on sky. Sampling the UVs of
# the faces that already are a material sounds right and is not: a Meshy atlas is
# a patchwork of islands, and the interquartile box of the tower's faces straddled
# several of them, which is what drew the first attempt's galleries as dark
# streaks with bits of louvre in them. What an authored surface wants is a quiet
# patch of the right colour, so that is what this looks for.

ATLAS = None
for image in bpy.data.images:
    if image.size[0] >= 16 and (ATLAS is None or image.size[0] > ATLAS.size[0]):
        ATLAS = image

THUMB = 64
_thumb_rgb = None
if ATLAS is not None:
    thumb = ATLAS.copy()
    thumb.scale(THUMB, THUMB)
    pixels = np.empty(THUMB * THUMB * 4, dtype=np.float32)
    thumb.pixels.foreach_get(pixels)
    bpy.data.images.remove(thumb)
    _thumb_rgb = pixels.reshape(THUMB, THUMB, 4)[:, :, :3]
    log(f"atlas {ATLAS.size[0]}x{ATLAS.size[1]}")


def atlas_patch(target, fallback=(0.45, 0.55, 0.45, 0.55)):
    """The calmest patch of the atlas closest to a target colour.

    Asked for by colour, not by a brightness band. A band plus a warmth bias is
    what the first attempt used and it painted the tower's widest gallery — the
    one surface that has to tie the white steeple to the brick below it — in
    brick, because a shadowed white island and a lit brick one sit in the same
    band and the tie-break went the wrong way. Naming the colour cannot make that
    mistake: it is looking for something the size of a fingernail that is
    genuinely the colour of lead, or of white lead paint, or of gilding.
    """
    if _thumb_rgb is None:
        return fallback
    want = np.array(target, dtype=np.float32)
    block = 5
    best = None
    for row in range(0, THUMB - block + 1):
        for col in range(0, THUMB - block + 1):
            patch = _thumb_rgb[row : row + block, col : col + block, :]
            mean = patch.reshape(-1, 3).mean(axis=0)
            # Colour first, flatness second. A patch of exactly the right colour
            # with a seam through it still reads as that material; a flat patch of
            # the wrong colour is a differently coloured building.
            score = float(np.linalg.norm(mean - want)) + 0.35 * float(
                patch.reshape(-1, 3).std(axis=0).mean()
            )
            if best is None or score < best[0]:
                best = (score, row, col, mean)
    _, row, col, mean = best
    # Blender's pixel rows run bottom-up, which is also how UV v runs. Pulled in a
    # tenth of a block on every side so a bilinear fetch cannot reach into the
    # neighbouring island.
    pad = 0.1 * block / THUMB
    log(
        f"  matched ({mean[0]:.2f}, {mean[1]:.2f}, {mean[2]:.2f}) against "
        f"({target[0]:.2f}, {target[1]:.2f}, {target[2]:.2f})"
    )
    return (
        col / THUMB + pad, (col + block) / THUMB - pad,
        row / THUMB + pad, (row + block) / THUMB - pad,
    )


# The four materials a 1760s Boston meeting-house tower is made of, as colours
# rather than as luma bands.
BRICK_UV = atlas_patch((0.34, 0.16, 0.13))
PAINT_UV = atlas_patch((0.87, 0.86, 0.83))
LEAD_UV = atlas_patch((0.53, 0.54, 0.56))
GOLD_UV = atlas_patch((0.74, 0.57, 0.19))
# A louvred opening reads by the shadow behind its slats, and that shadow has to
# come from the recess rather than from the atlas: the darkest patch a Meshy albedo
# offers is the brickwork, so asking for black returns dark red — which drew the
# belfry as red bars across a white stage. Grey slats set back into the face let
# the sun make the shadow instead, which is also how the real ones work.
for name, uv in (("brick", BRICK_UV), ("paint", PAINT_UV), ("lead", LEAD_UV), ("gold", GOLD_UV)):
    log(f"{name:5s} uv u {uv[0]:.3f}..{uv[1]:.3f} v {uv[2]:.3f}..{uv[3]:.3f}")


def ping_pong(value):
    t = math.fmod(abs(value), 2.0)
    return t if t <= 1.0 else 2.0 - t


def atlas_uv(box, u_raw, v_raw):
    u0, u1, v0, v1 = box
    return (u0 + ping_pong(u_raw) * (u1 - u0), v0 + ping_pong(v_raw) * (v1 - v0))


# ---------------------------------------------------------------------------
# 5. Warp the generated steeple onto the stage schedule
# ---------------------------------------------------------------------------
# Height first, as a monotonic piecewise-linear stretch: it only opens and closes
# the gaps between knots, so nothing shears and nothing folds. The knot that
# matters is where the brick stops, because that is the one place the generated
# tower and the authored schedule have to agree — the brick shaft is the whole
# lower two thirds and the stages are everything above it.
#
# The transition is found on colour rather than on silhouette. A width test looks
# obvious and fails: the belfry stage of a real steeple oversails the brick, so
# the plan gets WIDER at exactly the height being looked for. Brick is dark and
# warm, paint is light, and that never reverses.

uv_layer_in = generated.data.uv_layers.active
brick_fraction = opts["brick"]
if brick_fraction is None and uv_layer_in is not None and _thumb_rgb is not None:
    luma = _thumb_rgb.mean(axis=2)
    uv_data = uv_layer_in.data
    heights = []
    brightness = []
    for poly in generated.data.polygons:
        us, vs = 0.0, 0.0
        for loop_index in poly.loop_indices:
            uv = uv_data[loop_index].uv
            us += uv[0]
            vs += uv[1]
        count = len(poly.loop_indices)
        col = min(max(int(ping_pong(us / count) * THUMB), 0), THUMB - 1)
        row = min(max(int(ping_pong(vs / count) * THUMB), 0), THUMB - 1)
        centre_z = float(np.mean([coords[v][2] for v in poly.vertices]))
        heights.append(centre_z / height)
        brightness.append(float(luma[row, col]))
    heights = np.array(heights)
    brightness = np.array(brightness)
    # The transition is the split that best separates dark below from light above.
    best = None
    for candidate in np.arange(0.30, 0.80, 0.01):
        below = brightness[heights < candidate]
        above = brightness[heights >= candidate]
        if len(below) < 64 or len(above) < 64:
            continue
        score = float(above.mean() - below.mean())
        if best is None or score > best[0]:
            best = (score, float(candidate))
    if best and best[0] > 0.06:
        brick_fraction = best[1]
        log(f"brick/paint transition found at {brick_fraction:.3f} of height (contrast {best[0]:.3f})")
    else:
        log("no clear brick/paint contrast in the atlas")

if brick_fraction is None:
    brick_fraction = 0.58
    log(f"falling back to a brick transition at {brick_fraction:.3f} of height")

# Three knots: the ground, the brick head, and the top of the box. The generated
# spire above the top ring is culled anyway, so its exact landing does not matter
# — what matters is that the brick meets the first ring and the stages spread
# across the band the rings occupy instead of being crushed into it.
knots_from = [0.0, brick_fraction * height, height]
knots_to = [0.0, BRICK_TOP, EZ1]
for i in range(1, len(knots_from)):
    if knots_from[i] <= knots_from[i - 1]:
        raise SystemExit(f"height remap is not monotonic: {knots_from}")
log("height remap", [round(v, 3) for v in knots_from], "->", [round(v, 3) for v in knots_to])

is_upper = coords[:, 2] > brick_fraction * height


def fit_axis(values, target_lo, target_hi):
    """Affine map of a robust extent of `values` onto a target span."""
    source_lo, source_hi = np.percentile(values, (1.5, 98.5))
    if source_hi - source_lo < 1e-6:
        return 1.0, (target_lo + target_hi) / 2.0 - (source_lo + source_hi) / 2.0
    scale = (target_hi - target_lo) / (source_hi - source_lo)
    return scale, target_lo - source_lo * scale


def fit_band(mask, x0, x1, y0, y1, label):
    if mask.sum() < 24:
        log(f"{label}: too few vertices to fit; left alone")
        return (1.0, 0.0), (1.0, 0.0)
    members = coords[mask]
    fit_x = fit_axis(members[:, 0], x0, x1)
    fit_y = fit_axis(members[:, 1], y0, y1)
    log(
        f"{label}: {int(mask.sum())} verts, plan x*{fit_x[0]:.3f}{fit_x[1]:+.3f}"
        f" y*{fit_y[0]:.3f}{fit_y[1]:+.3f}"
    )
    return fit_x, fit_y


# The shaft extent is measured clear of the ground and of the brick head: a
# generated plinth spreads wider than the wall and a generated cornice wider
# still, and letting either set the scale draws the shaft thinner than its own
# collision with a skirt sticking out of it.
brick_z = brick_fraction * height
lower_band = (~is_upper) & (coords[:, 2] > 0.12 * brick_z) & (coords[:, 2] < 0.88 * brick_z)
if lower_band.sum() < 24:
    lower_band = ~is_upper
lower_fit_x, lower_fit_y = fit_band(
    lower_band, shaft.x0, shaft.x1, shaft.y0, shaft.y1, "brick shaft"
)
# The stages are fitted to the widest ring rather than to a solid, because that is
# what they physically are: the cornices the rings sit on. Fitting them to the 2m
# lantern is what crushed the first attempt's whole white steeple into a toy.
widest = max(decks, key=lambda d: (d.x1 - d.x0) * (d.y1 - d.y0))
upper_fit_x, upper_fit_y = fit_band(
    is_upper, widest.x0, widest.x1, widest.y0, widest.y1, f"stages (onto {widest.id})"
)

warped = coords.copy()
warped[:, 2] = np.interp(coords[:, 2], knots_from, knots_to)
for axis, (low_fit, high_fit) in ((0, (lower_fit_x, upper_fit_x)), (1, (lower_fit_y, upper_fit_y))):
    scale = np.where(is_upper, high_fit[0], low_fit[0])
    offset = np.where(is_upper, high_fit[1], low_fit[1])
    warped[:, axis] = coords[:, axis] * scale + offset

for vertex, point in zip(generated.data.vertices, warped):
    vertex.co = Vector(point)
generated.data.update()
placed = coords_of(generated)
log(
    f"warped bbox x {placed[:, 0].min():.2f}..{placed[:, 0].max():.2f}"
    f"  y {placed[:, 1].min():.2f}..{placed[:, 1].max():.2f}"
    f"  z {placed[:, 2].min():.2f}..{placed[:, 2].max():.2f}"
)


# ---------------------------------------------------------------------------
# 6. Clear the space the authored surfaces and the player will occupy
# ---------------------------------------------------------------------------

def clip_to_envelope(obj):
    """Square the steeple off at the envelope on all six sides.

    FittedGlb contain-fits on the bounding box and then centres it, so an
    overhang does not make the tower bigger — it shrinks the whole tower until
    the overhang fits, which drops every authored ring below its plane. Anything
    outside the box is therefore not decoration, it is a scale error.
    """
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    for normal, offset in (
        ((1, 0, 0), EX1), ((-1, 0, 0), -EX0),
        ((0, 1, 0), EY1), ((0, -1, 0), -EY0),
        ((0, 0, 1), EZ1), ((0, 0, -1), -EZ0),
    ):
        mesh.faces.ensure_lookup_table()
        bmesh.ops.bisect_plane(
            mesh,
            geom=list(mesh.faces) + list(mesh.edges) + list(mesh.verts),
            plane_co=Vector(normal) * offset,
            plane_no=Vector(normal),
            clear_outer=True,
        )
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()


def cull_generated(obj, precise):
    """Drop generated faces that stand in a walkable surface, in its headroom, or
    deep inside an authored core.

    `precise` tests every vertex rather than the centroid. A centroid test is
    enough before decimation and much cheaper; afterwards the triangles are large
    enough to reach a long way in from a centroid that is safely outside, and one
    spar through the gallery is what turns a deck probe into a failure.
    """
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    mesh.faces.ensure_lookup_table()
    doomed = []
    for face in mesh.faces:
        points = [v.co for v in face.verts] if precise else [face.calc_center_median()]
        gone = False
        # Every deck inside the envelope, not only this asset's own: filling the
        # space over the meeting house ridge walk is this mesh's fault wherever
        # it happens.
        for deck in all_decks:
            low = deck.z - deck.thickness + 0.02
            high = deck.z + HEADROOM_M
            if any(
                low < point.z < high and deck.standable_at(point.x, point.y)
                for point in points
            ):
                doomed.append(face)
                gone = True
                break
        if gone:
            continue
        # Everything above the brick is authored outright, so the generated half
        # is cut off there. Keeping a generated sleeve over the stages sounds like
        # free detail and is not: the stages are 1.3m tall, four cornices and two
        # lanterns deep, and a sleeve whose own cornices land even 150mm off the
        # authored ones doubles every moulding and shimmers between them. Below
        # the brick head there is one plain 14m shaft and no ring to disagree
        # with, which is exactly where a generated skin pays.
        if any(point.z > BRICK_TOP - FRIEZE for point in points):
            doomed.append(face)
            continue
        # Anything well inside an authored core is invisible weight, and it is
        # also the first thing an inward probe finds — which reads as a stage
        # narrower than the one the player is stopped by.
        for solid in mine:
            if any(
                solid.z0 - 0.05 < point.z < solid.z1 + 0.05
                and solid.contains(point.x, point.y, shrink=CORE_INSET + 0.10)
                for point in points
            ):
                doomed.append(face)
                gone = True
                break
    log(f"culling {len(doomed)} generated faces ({'precise' if precise else 'coarse'})")
    bmesh.ops.delete(mesh, geom=doomed, context="FACES")
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()


clip_to_envelope(generated)
log("after clip", tris_of(generated), "tris")
cull_generated(generated, precise=False)
log("after coarse cull", tris_of(generated), "tris")

# Decimate the generated half only, and before the authored surfaces exist, so a
# collapse pass can never round off the ring the player stands on.
tris = tris_of(generated)
if tris > TRI_BUDGET:
    bpy.context.view_layer.objects.active = generated
    modifier = generated.modifiers.new("dec", "DECIMATE")
    modifier.ratio = TRI_BUDGET / tris
    bpy.ops.object.modifier_apply(modifier=modifier.name)
log("generated half", tris_of(generated), "tris")

# Re-pin AFTER decimating. Quadric collapse moves vertices, and on the elm it
# pushed a root 151mm below the floor — which FittedGlb, since it bottom-aligns
# on the bounding box, turns into every walkable surface sitting 151mm over its
# deck.
placed = coords_of(generated)
drop = placed[:, 2].min()
if abs(drop) > 1e-4:
    for vertex in generated.data.vertices:
        vertex.co.z -= drop
    generated.data.update()
    log(f"re-zeroed generated half: base was {drop:+.4f}")
clip_to_envelope(generated)
cull_generated(generated, precise=True)
log("after precise cull", tris_of(generated), "tris")


# ---------------------------------------------------------------------------
# 7. The authored steeple
# ---------------------------------------------------------------------------

built = bmesh.new()
uv_layer = built.loops.layers.uv.new("UVMap")


def add_box(x0, x1, y0, y1, z0, z1, uv_box, uv_scale=0.5, smooth=False):
    if x1 - x0 <= 1e-4 or y1 - y0 <= 1e-4 or z1 - z0 <= 1e-4:
        return
    corners = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    verts = [built.verts.new(Vector(point)) for point in corners]
    quads = (
        (4, 5, 6, 7),  # top
        (3, 2, 1, 0),  # bottom
        (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
    )
    for quad in quads:
        try:
            face = built.faces.new([verts[i] for i in quad])
        except ValueError:
            continue
        face.smooth = smooth
        for loop, index in zip(face.loops, quad):
            point = corners[index]
            # Project on whichever pair of axes the face is broadest in, so the
            # grain of the atlas runs along the surface instead of across it.
            if quad in ((4, 5, 6, 7), (3, 2, 1, 0)):
                u, v = point[0], point[1]
            elif quad in ((0, 1, 5, 4), (2, 3, 7, 6)):
                u, v = point[0], point[2]
            else:
                u, v = point[1], point[2]
            loop[uv_layer].uv = atlas_uv(uv_box, u * uv_scale, v * uv_scale)


def add_prism(cx, cy, rings, uv_box, sides=8, cap_top=True, cap_bottom=False, smooth=True):
    """A stack of regular n-gon rings, stitched into a tube.

    `rings` is a list of (z, radius) pairs. Eight sides is not decoration: the
    documented lantern of both Boston houses is octagonal, and an octagon
    inscribed on the collision face still measures its full half-width at the
    face centres, which is where the probe looks.
    """
    step = 2.0 * math.pi / sides
    # Rotated half a facet so a flat face, not a corner, points down each axis:
    # that is what puts masonry on the collision plane the player is stopped by.
    phase = step / 2.0
    loops = []
    for z, radius in rings:
        loops.append([
            Vector((
                cx + math.cos(phase + i * step) * radius,
                cy + math.sin(phase + i * step) * radius,
                z,
            ))
            for i in range(sides)
        ])
    verts = [[built.verts.new(point) for point in ring] for ring in loops]
    for j in range(len(loops) - 1):
        for i in range(sides):
            k = (i + 1) % sides
            quad = (verts[j][i], verts[j][k], verts[j + 1][k], verts[j + 1][i])
            if len(set(quad)) < 3:
                continue
            try:
                face = built.faces.new(quad)
            except ValueError:
                continue
            face.smooth = smooth
            for loop, (ring_index, angle_index) in zip(
                face.loops, ((j, i), (j, k), (j + 1, k), (j + 1, i))
            ):
                loop[uv_layer].uv = atlas_uv(
                    uv_box, angle_index / sides * 2.0, loops[ring_index][angle_index].z * 0.35
                )
    for wanted, ring, upward in ((cap_top, verts[-1], True), (cap_bottom, verts[0], False)):
        if not wanted:
            continue
        try:
            face = built.faces.new(ring if upward else list(reversed(ring)))
            face.smooth = False
            for loop, vert in zip(face.loops, ring if upward else list(reversed(ring))):
                loop[uv_layer].uv = atlas_uv(uv_box, vert.co.x * 0.5, vert.co.y * 0.5)
        except ValueError:
            pass


def greedy_rectangles(deck):
    """Cover the standable mask with as few axis-aligned rectangles as possible.

    Few big rectangles rather than a quad per cell: the cover is what becomes
    geometry, and a 48x48 grid of quads is 4,600 triangles for one ring.
    """
    n = deck.n
    taken = [[deck.rows[i][j] != "1" for j in range(n)] for i in range(n)]
    rects = []
    for i in range(n):
        for j in range(n):
            if taken[i][j]:
                continue
            width = 0
            while j + width < n and not taken[i][j + width]:
                width += 1
            depth = 1
            while i + depth < n and all(not taken[i + depth][j + k] for k in range(width)):
                depth += 1
            for di in range(depth):
                for dk in range(width):
                    taken[i + di][j + dk] = True
            rects.append((i, i + depth, j, j + width))
    return rects


def free_sides(deck, rect):
    """Which of a rectangle's four sides are the outside edge of the mask.

    Only those may be moulded. The greedy cover cuts one ring into several
    rectangles, and stepping a shared edge would saw a groove up the middle of a
    continuous floor.
    """
    i0, i1, j0, j1 = rect
    n = deck.n

    def free(i_range, j_range):
        for i in i_range:
            for j in j_range:
                if 0 <= i < n and 0 <= j < n and deck.rows[i][j] == "1":
                    return False
        return True

    # Mask index j runs along local +Z, and Blender y is -Z, so the j0 side of the
    # rectangle is its y1 edge and the j1 side is its y0 edge.
    return {
        "x0": free([i0 - 1], range(j0, j1)),
        "x1": free([i1], range(j0, j1)),
        "y1": free(range(i0, i1), [j0 - 1]),
        "y0": free(range(i0, i1), [j1]),
    }


# How deep a cornice hangs under the ring it carries, and how the courses step
# back. This is the whole difference between a moulded cornice and a tray: three
# thin courses under a 1.7m oversail read as a plate, and no amount of texture
# fixes it. The courses below carry the eye from the ring's outer edge back to
# the stage face, which is what a real one does.
CORNICE_COURSES = ((0.00, 0.20), (0.12, 0.26), (0.30, 0.30), (0.55, 0.24))


def add_cornice(x0, x1, y0, y1, top, depth, uv_box, sides, oversail):
    """A walkable ring's underside, as a stepped and bracketed cornice."""
    remaining = depth
    cursor = top
    for inset_share, height_share in CORNICE_COURSES:
        course = min(remaining, max(0.04, depth * height_share))
        remaining -= course
        inset = inset_share * oversail
        cut_x0 = x0 + (inset if sides["x0"] else 0.0)
        cut_x1 = x1 - (inset if sides["x1"] else 0.0)
        cut_y0 = y0 + (inset if sides["y0"] else 0.0)
        cut_y1 = y1 - (inset if sides["y1"] else 0.0)
        add_box(cut_x0, cut_x1, cut_y0, cut_y1, cursor - course, cursor, uv_box)
        cursor -= course
        if remaining <= 0.01:
            break


MODILLION = 0.14        # a bracket this wide, at this spacing, under a cornice
MODILLION_GAP = 0.44


def add_modillions(x0, x1, y0, y1, top, drop, uv_box, sides, oversail):
    """Brackets under the outer edge of a cornice, on its free sides only.

    Cheap and load-bearing to the eye: from the ridge below, from the street and
    from the elm, these are what say the gallery is carried.
    """
    reach = min(oversail * 0.72, 0.5)
    if reach < 0.08 or drop < 0.08:
        return
    for side, along, fixed in (
        ("x0", (y0, y1), x0), ("x1", (y0, y1), x1),
        ("y0", (x0, x1), y0), ("y1", (x0, x1), y1),
    ):
        if not sides[side]:
            continue
        span = along[1] - along[0]
        count = max(1, int(span / MODILLION_GAP))
        for index in range(count):
            centre = along[0] + span * (index + 0.5) / count
            a, b = centre - MODILLION / 2.0, centre + MODILLION / 2.0
            if side == "x0":
                add_box(fixed, fixed + reach, a, b, top - drop, top, uv_box)
            elif side == "x1":
                add_box(fixed - reach, fixed, a, b, top - drop, top, uv_box)
            elif side == "y0":
                add_box(a, b, fixed, fixed + reach, top - drop, top, uv_box)
            else:
                add_box(a, b, fixed - reach, fixed, top - drop, top, uv_box)


# A cornice hangs into somebody's headroom, and on this tower that somebody is
# usually the ring 1.8m below. A 1.55m runner plus a margin leaves 220mm of
# architecture between two rings, which is the hull's decision and not
# negotiable: the alternative to a thin lip there is a ledge the player has to
# crouch on, and they cannot sprint off a crouch. So the depth is worked out per
# rectangle against whatever it actually oversails — which is also why the
# rings the level widened to the east get the bold cornice and the stacked ones
# do not.
HEAD_MARGIN = 0.03
# Deep enough that the widest gallery — 1.7m of oversail at the head of fourteen
# metres of plain brick — reads as a moulded and bracketed cornice rather than a
# shelf. The budget below still governs; this is only the ceiling.
CORNICE_MAX = 1.15


def depth_budget(deck, x0, x1, y0, y1):
    """How far below `deck.z` anything may hang over this footprint."""
    below = [
        d
        for d in all_decks
        if d.z < deck.z - 0.05 and d.x1 > x0 + 0.02 and d.x0 < x1 - 0.02
        and d.y1 > y0 + 0.02 and d.y0 < y1 - 0.02
        and any(
            d.standable_at(
                x0 + (x1 - x0) * (i + 0.5) / 6.0, y0 + (y1 - y0) * (j + 0.5) / 6.0
            )
            for i in range(6)
            for j in range(6)
        )
    ]
    if not below:
        return CORNICE_MAX, None
    highest = max(below, key=lambda d: d.z)
    return (
        max(0.06, deck.z - highest.z - STAND_H - HEAD_MARGIN),
        highest,
    )


authored_report = []
for deck in decks:
    rects = greedy_rectangles(deck)
    # The first ring is the head of the brick and the foot of the painted timber
    # steeple, and in both surviving houses that cornice is white. Painting it
    # brick, which is what a naive "below the brick head" test does, cuts the
    # steeple off from the tower and reads as a separate object dropped on top.
    uv_box = LEAD_UV if deck.z < BRICK_TOP - 0.01 else PAINT_UV
    body = solid_at(deck.z - 0.02) or shaft
    covered = 0.0
    depths = []
    for rect in rects:
        x0, x1, y0, y1 = deck.cell_bounds(*rect)
        sides = free_sides(deck, rect)
        # How far this rectangle reaches past the stage body underneath it. That
        # is the oversail the cornice has to explain.
        oversail = max(
            0.0,
            max(x1 - body.x1, body.x0 - x0, y1 - body.y1, body.y0 - y0),
        )
        budget, pinched_by = depth_budget(deck, x0, x1, y0, y1)
        # Deep enough to read as carried where there is room, thin where there is
        # not, and never thinner than the seam it has to close against the stage.
        depth = min(max(deck.thickness, oversail * 0.55), min(CORNICE_MAX, budget))
        # The cornice's first course IS the walking surface: it runs the full
        # extent of the mask and its top is the deck plane. Everything below it
        # steps back.
        add_cornice(x0, x1, y0, y1, deck.z, depth, uv_box, sides, max(oversail, 0.12))
        # Where the ring beds onto the stage that carries it, it may be as thick
        # as it likes: that footprint is inside a solid, so there is no headroom
        # under it to spend. Without this the slab stops short of the stage head
        # and a 300mm strip of daylight opens under a gallery.
        if deck.thickness > depth + 0.01:
            bed_x0, bed_x1 = max(x0, body.x0 - 0.12), min(x1, body.x1 + 0.12)
            bed_y0, bed_y1 = max(y0, body.y0 - 0.12), min(y1, body.y1 + 0.12)
            add_box(bed_x0, bed_x1, bed_y0, bed_y1, deck.z - deck.thickness, deck.z, uv_box)
        spare = budget - depth
        if oversail > 0.25 and spare > 0.10:
            add_modillions(
                x0, x1, y0, y1, deck.z - depth, min(0.34, spare, oversail * 0.5),
                uv_box, sides, oversail,
            )
        depths.append((depth, pinched_by.id if pinched_by else "open air"))
        covered += (x1 - x0) * (y1 - y0)
    log(
        f"authored {deck.id} at z={deck.z:.2f}: {len(rects)} rectangles, "
        f"{covered:.1f} m2 walkable, beds {deck.thickness:.2f}m"
    )
    for depth, pinched in sorted(set(depths)):
        log(f"    cornice {depth:.2f}m deep, held off by {pinched}")
    authored_report.append(
        {"id": deck.id, "y": deck.z, "rects": len(rects), "areaM2": round(covered, 2)}
    )


# ---- the balustrades --------------------------------------------------------
# What makes a wide walkway round a slender tower read as a gallery, and not as a
# plate, is the railing on its edge. The hull looks at first as though it forbids
# one everywhere — every ring's own rect is standable to its outer edge — and then
# gives it back: each ring is narrower than the one below, so the strip of plan
# between a ring's edge and the edge of the ring beneath it is over nothing this
# ring owns, and it is 1.8m up, which clears a standing runner. That strip is
# exactly where a balustrade goes on a real one.
#
# Two things it must never do: stand where a downward probe on the walkway would
# find it instead of the floor, and cross an edge the route dives over.

BALUSTER_PITCH = 0.26
OUTWARD = {"x0": (-1.0, 0.0), "x1": (1.0, 0.0), "y0": (0.0, -1.0), "y1": (0.0, 1.0)}


MOTION = HULL.get("motion") or {"gravity": 10.8, "runningJumpVy": 5.2, "runSpeedMps": 4.6}
CAPSULE_R = HULL["capsule"]["radius"]


def blocks_a_dive(x0, x1, y0, y1, z0, z1):
    """Would a box here stand in any take-off arc off this building?

    EVERY take-off, not only the one leaving the ring this box belongs to. The
    rings are 1.8m apart and the player is airborne within a stride, so a rail on
    the ring ABOVE a leap point is squarely in that leap's arc — which is how a
    balustrade the level never asked for ends up being the wall the mission's
    signature move dies against. Flown rather than reasoned about, with the
    engine's own gravity, jump velocity and run speed.
    """
    gravity = MOTION["gravity"]
    vy = MOTION["runningJumpVy"]
    speed = MOTION["runSpeedMps"]
    for takeoff in HULL.get("takeoffs", []):
        # `at` is hull-local (x, height, z); Blender wants (x, -z) in plan and the
        # height on its own axis. Getting that wrong once put a rail straight
        # across both dives while reporting them clear.
        ax, ay = takeoff["at"][0], -takeoff["at"][2]
        top_of_arc = takeoff["at"][1]
        dx, dy = takeoff["bearing"][0], -takeoff["bearing"][1]
        t = 0.0
        while t < 2.5:
            travelled = speed * t
            px = ax + dx * travelled
            py = ay + dy * travelled
            feet = top_of_arc + vy * t - 0.5 * gravity * t * t
            if feet < top_of_arc - 12.0:
                break
            # The capsule, not the centre line: a rail a hand's width to the side
            # still takes a shoulder off.
            if (
                px > x0 - CAPSULE_R and px < x1 + CAPSULE_R
                and py > y0 - CAPSULE_R and py < y1 + CAPSULE_R
                and feet < z1 and feet + STAND_H > z0
            ):
                return True
            t += 0.03
    return False


def outboard_room(deck, side):
    """Plan available outboard of this ring's edge, inside the envelope.

    Measured to the box rather than to the ring below, because the ring below is
    not always the wider one: the level pushes the upper stages east, so the
    crockets gallery reaches a metre further that way than the gallery under it.
    Taking the ring below as the bound left that gallery with a rail on one side
    and a fence reading as a mistake.
    """
    return {
        "x0": deck.x0 - EX0, "x1": EX1 - deck.x1,
        "y0": deck.y0 - EY0, "y1": EY1 - deck.y1,
    }[side]


def headroom_under(x0, x1, y0, y1, z):
    """Clearance from a footprint at height `z` down to whatever is walkable."""
    below = [
        d
        for d in all_decks
        if d.z < z - 0.05 and d.x1 > x0 and d.x0 < x1 and d.y1 > y0 and d.y0 < y1
        and any(
            d.standable_at(x0 + (x1 - x0) * (i + 0.5) / 4.0, y0 + (y1 - y0) * (j + 0.5) / 4.0)
            for i in range(4)
            for j in range(4)
        )
    ]
    return (z - max(d.z for d in below)) if below else 99.0


def add_balustrade(deck, height, pedestal=0.34, urns=True):
    """A railing round a ring, standing entirely outboard of its walkway."""
    # Clear of the walkway by a hair, so the outermost probe sample on the floor
    # cannot find the rail instead.
    foot = deck.z + 0.05
    # A parapet may not hide what it surrounds. On a broad gallery with a 4.8m
    # lantern rising out of it a full-height rail is right; on the balcony at the
    # lantern head, where a 1.6m spire springs, a 0.9m rail leaves 0.65m of spire
    # showing and the tower reads as having no spire at all — which is the exact
    # thing this level change was made to fix. So the rail is held to a third of
    # whatever stands above the ring.
    rising = [s for s in mine if s.z0 < deck.z + 0.10 and s.z1 > deck.z + 0.20]
    if rising:
        tallest = max(s.z1 for s in rising) - deck.z
        if tallest / 3.0 < height:
            log(
                f"balustrade {deck.id}: held to {tallest / 3.0:.2f}m, not {height:.2f}m — "
                f"{tallest:.2f}m stands above this ring and a rail must not hide it"
            )
        height = min(height, tallest / 3.0)
    rail_top = min(EZ1 - 0.62, foot + height)
    urn_top = min(EZ1 - 0.42, rail_top + 0.52)
    cap = 0.08
    # No rail unless the box has the height for one. Without this guard the top
    # ring of a box that stops at the ring itself got a balustrade whose cap was
    # 670mm BELOW its own foot — an inverted run whose bottom rail was the only
    # thing that got built, 150mm proud of the ceiling, which crushed the whole
    # tower by 150mm on the contain-fit and put every ring under its plane.
    if rail_top - foot < 0.50:
        log(
            f"balustrade {deck.id}: only {max(0.0, EZ1 - 0.62 - foot):.2f}m of box above "
            f"the ring; no rail"
        )
        return []

    # Corners first, because they decide whether there is a balustrade at all. A
    # run of balusters turns against a pedestal; with nothing at the corner it has
    # nothing to stop against and reads as a fence someone left on a roof. The
    # middle ring of this tower is the case in point — the level pushes it a metre
    # east, so it reaches the box on that side and can only carry two corners, and
    # a two-sided rail there made three galleries read as three pagoda tiers.
    corners = []
    for sx, cx in (("x0", deck.x0), ("x1", deck.x1)):
        for sy, cy in (("y0", deck.y0), ("y1", deck.y1)):
            room_x = min(pedestal, outboard_room(deck, sx))
            room_y = min(pedestal, outboard_room(deck, sy))
            if room_x < 0.10 or room_y < 0.10:
                continue
            px = cx - room_x / 2.0 if sx == "x0" else cx + room_x / 2.0
            py = cy - room_y / 2.0 if sy == "y0" else cy + room_y / 2.0
            bx0, bx1 = px - room_x / 2, px + room_x / 2
            by0, by1 = py - room_y / 2, py + room_y / 2
            if headroom_under(bx0, bx1, by0, by1, foot) < STAND_H + HEAD_MARGIN:
                continue
            if blocks_a_dive(bx0, bx1, by0, by1, foot, urn_top if urns else rail_top):
                log(
                    f"balustrade {deck.id}: pedestal at ({px:.2f}, {py:.2f}) dropped — "
                    f"a take-off arc passes through it"
                )
                continue
            corners.append((px, py, bx0, bx1, by0, by1))
    if len(corners) < 3:
        log(
            f"balustrade {deck.id}: only {len(corners)} corners can carry a pedestal, "
            f"so no rail — this ring is a moulded cornice, not a gallery"
        )
        return []

    done = []
    for side in ("x0", "x1", "y0", "y1"):
        room = outboard_room(deck, side)
        thickness = min(0.24, room)
        if thickness < 0.10:
            continue
        if side == "x0":
            x0, x1 = deck.x0 - thickness, deck.x0
        elif side == "x1":
            x0, x1 = deck.x1, deck.x1 + thickness
        else:
            x0, x1 = deck.x0 - pedestal / 2.0, deck.x1 + pedestal / 2.0
        if side == "y0":
            y0, y1 = deck.y0 - thickness, deck.y0
        elif side == "y1":
            y0, y1 = deck.y1, deck.y1 + thickness
        else:
            y0, y1 = deck.y0 - pedestal / 2.0, deck.y1 + pedestal / 2.0
        # The returns at the ends of a run sit outboard of the adjacent side, so
        # clamp them back to whatever plan is actually available there.
        if side in ("y0", "y1"):
            x0 = max(x0, deck.x0 - max(0.0, min(pedestal / 2.0, outboard_room(deck, "x0"))))
            x1 = min(x1, deck.x1 + max(0.0, min(pedestal / 2.0, outboard_room(deck, "x1"))))
        else:
            y0 = max(y0, deck.y0 - max(0.0, min(pedestal / 2.0, outboard_room(deck, "y0"))))
            y1 = min(y1, deck.y1 + max(0.0, min(pedestal / 2.0, outboard_room(deck, "y1"))))
        horizontal = side in ("y0", "y1")
        run = (x1 - x0) if horizontal else (y1 - y0)
        if run < 0.2:
            continue
        clear = headroom_under(x0, x1, y0, y1, foot)
        if clear < STAND_H + HEAD_MARGIN:
            log(
                f"balustrade {deck.id}: {side} dropped — only {clear:.2f}m over the "
                f"walkway beneath it"
            )
            continue
        if blocks_a_dive(x0, x1, y0, y1, foot, rail_top):
            log(f"balustrade {deck.id}: {side} left open — a take-off arc passes through it")
            continue
        add_box(x0, x1, y0, y1, foot, foot + 0.10, PAINT_UV)
        # The cap oversails the rail, but never the box: FittedGlb contain-fits on
        # the bounding box, so 20mm of moulding past the envelope is not a detail,
        # it is every authored ring drawn 56mm low.
        add_box(
            max(x0 - 0.02, EX0), min(x1 + 0.02, EX1),
            max(y0 - 0.02, EY0), min(y1 + 0.02, EY1),
            rail_top - cap, rail_top, PAINT_UV,
        )
        count = max(2, int(run / BALUSTER_PITCH))
        for index in range(count):
            centre = (x0 if horizontal else y0) + run * (index + 0.5) / count
            a, b = centre - 0.062, centre + 0.062
            if horizontal:
                add_box(a, b, y0 + 0.035, y1 - 0.035, foot + 0.10, rail_top - cap, PAINT_UV)
            else:
                add_box(x0 + 0.035, x1 - 0.035, a, b, foot + 0.10, rail_top - cap, PAINT_UV)
        done.append(side)

    # The pedestals themselves, and the urns on them: both surviving houses carry
    # turned urns on the gallery pedestals, and white lead is what they are painted.
    heads = []
    for px, py, bx0, bx1, by0, by1 in corners:
        add_box(bx0, bx1, by0, by1, foot, rail_top + 0.09, PAINT_UV)
        if urns:
            add_prism(px, py, [
                (rail_top + 0.09, pedestal * 0.42),
                (rail_top + 0.19, pedestal * 0.55),
                (rail_top + 0.35, pedestal * 0.26),
                (urn_top, pedestal * 0.09),
            ], PAINT_UV, sides=8)
        heads.append((px, py, rail_top))
    log(
        f"balustrade {deck.id} at z={foot:.2f}..{rail_top:.2f}: "
        f"{'/'.join(done) or 'no'} runs, {len(heads)} pedestals"
    )
    return heads


# Which rings are galleries and which are cornices.
#
# This is the distinction the whole silhouette turns on, and it has to be measured
# rather than assumed. Railing every ring is what made this tower a pagoda: four
# balustraded walks stacked up a slender core reads as tiers, and the reference
# buildings carry exactly one gallery, then a tall open lantern, then a spire.
#
# The measure is the width of the walkway itself — the ring's edge to the face of
# whatever solid actually rises through it. Something you can stand on and walk
# along wants a rail; a narrow ledge round a lantern is a cornice, and a rail on
# it is a fence in the sky. Note it has to be the solid that SPANS the ring, not
# the one below it: the gallery's own shaft stops half a metre under it, and
# measuring against that made a 2.1m walk-around look like a 0.7m ledge.
GALLERY_WALKWAY_M = 1.0


def walkway_width(deck):
    """Narrowest walking surface on this ring, outboard of what rises through it."""
    body = None
    for solid in mine:
        if solid.z0 < deck.z + 0.02 < solid.z1:
            if body is None or solid.plan_area > body.plan_area:
                body = solid
    if body is None:
        return max(deck.x1 - deck.x0, deck.y1 - deck.y0) / 2.0
    return min(
        body.x0 - deck.x0, deck.x1 - body.x1,
        body.y0 - deck.y0, deck.y1 - body.y1,
    )


rails = {}
for deck in decks:
    walkway = walkway_width(deck)
    if walkway < GALLERY_WALKWAY_M:
        log(
            f"balustrade {deck.id}: {walkway:.2f}m of walkway round the solid that rises "
            f"through it — a cornice, not a gallery, so it gets a moulding and no rail"
        )
        continue
    if max(outboard_room(deck, side) for side in OUTWARD) < 0.10:
        log(f"balustrade {deck.id}: fills the box in plan, so no rail is possible")
        continue
    log(f"balustrade {deck.id}: {walkway:.2f}m of walkway — a gallery")
    rails[deck.id] = add_balustrade(deck, height=0.90)


# ---- the stage bodies -------------------------------------------------------
# The core of every solid the level declared, set 60mm inside its collision face
# so the generated skin stays outermost. A square brick shaft, then painted
# timber, then the octagonal lantern the documented houses both carry.

def add_stage_core(solid, z0, z1, uv_box, octagon=False):
    if z1 - z0 <= 0.02:
        return
    x0, x1 = solid.x0 + CORE_INSET, solid.x1 - CORE_INSET
    y0, y1 = solid.y0 + CORE_INSET, solid.y1 - CORE_INSET
    if octagon:
        cx, cy = solid.centre
        radius = min(x1 - x0, y1 - y0) / 2.0
        add_prism(cx, cy, [(z0, radius), (z1, radius)], uv_box, cap_top=False)
    else:
        add_box(x0, x1, y0, y1, z0, z1, uv_box)


# The brick shaft, in two lifts with a moulded belt where the tower leaves the
# meeting house roof. The belt is not ornament: it is the one horizontal line on
# fourteen metres of plain brick, and without it the shaft reads as a chimney.
BELT_Z = None
roof_decks = [d for d in all_decks if not d.mine and d.z < BRICK_TOP - 1.5]
if roof_decks:
    BELT_Z = max(d.z for d in roof_decks) + 0.55
add_stage_core(shaft, 0.0, BRICK_TOP, BRICK_UV)
# The frieze runs out to the collision face, not to the inset core: the generated
# skin has been cut away here, so this is the visible brick, and it has to be
# where the player is stopped.
add_box(shaft.x0, shaft.x1, shaft.y0, shaft.y1, BRICK_TOP - FRIEZE, BRICK_TOP, BRICK_UV)
courses = [(BRICK_TOP - FRIEZE, 0.09)]
# The belt where the tower leaves the roof, unless the frieze's own course has
# already landed there. Two string courses 250mm apart read as a mistake.
if BELT_Z and abs(BELT_Z - (BRICK_TOP - FRIEZE)) > 0.8:
    courses.append((BELT_Z, 0.10))
for course_z, course in courses:
    # A string course stands proud of the wall by design. 35mm is well inside the
    # margin the player is stopped at, and it is the only thing that breaks
    # fourteen metres of plain brick into storeys.
    add_box(
        shaft.x0 - 0.035, shaft.x1 + 0.035, shaft.y0 - 0.035, shaft.y1 + 0.035,
        course_z - course, course_z, LEAD_UV,
    )
    log(f"brick string course at z={course_z:.2f}")

# The belfry stage: painted timber from the first ring to the head of the shaft,
# with the tall arched louvred openings that make a belfry a belfry.
add_stage_core(shaft, BRICK_TOP, SHAFT_TOP, PAINT_UV)

LOUVRE_SLATS = 7


def add_louvred_arch(solid, z0, z1, uv_box, width_share=0.46):
    """A recessed round-headed opening with slats, on each free face of a stage.

    Recessed, never applied: the collision face is where the player is stopped,
    so an architrave standing proud of it is a hand passing through stone. The
    reveal cuts inward instead, which is also how the real ones are built.
    """
    if z1 - z0 < 0.5:
        return
    cx, cy = solid.centre
    half_x = (solid.x1 - solid.x0) / 2.0
    half_y = (solid.y1 - solid.y0) / 2.0
    sill = z0 + (z1 - z0) * 0.16
    head = z0 + (z1 - z0) * 0.94
    reveal = 0.09
    for axis, half, other_half in ((0, half_x, half_y), (1, half_y, half_x)):
        opening = other_half * 2.0 * width_share
        for sign in (-1, 1):
            face = (cx if axis == 0 else cy) + sign * half
            a = (cy if axis == 0 else cx) - opening / 2.0
            b = (cy if axis == 0 else cx) + opening / 2.0
            # The slats. Spaced so the gap between them is the shadow line; the
            # arch is stepped from the same boxes, which at this distance reads
            # as round-headed and costs nothing.
            for index in range(LOUVRE_SLATS):
                t0 = index / LOUVRE_SLATS
                t1 = (index + 1) / LOUVRE_SLATS
                s0 = sill + (head - sill) * t0
                s1 = sill + (head - sill) * (t1 - 0.22 / LOUVRE_SLATS)
                # Narrow the top two courses so the head reads as an arch.
                taper = 0.0
                if t0 > 0.72:
                    taper = opening * 0.5 * (1.0 - math.cos((t0 - 0.72) / 0.28 * math.pi / 2.0))
                inner = face - sign * reveal
                lo, hi = a + taper, b - taper
                if hi - lo < 0.05:
                    continue
                if axis == 0:
                    add_box(min(face, inner), max(face, inner), lo, hi, s0, s1, uv_box)
                else:
                    add_box(lo, hi, min(face, inner), max(face, inner), s0, s1, uv_box)


add_louvred_arch(shaft, BRICK_TOP, SHAFT_TOP, LEAD_UV)

# The lantern stages, octagonal, one per solid the level put above the shaft, cut
# at every ring that crosses them so each stage sits under its own cornice.
for solid in lanterns:
    cuts = [solid.z0] + [r for r in RINGS if solid.z0 + 0.1 < r < solid.z1 - 0.1] + [solid.z1]
    for index in range(len(cuts) - 1):
        z0, z1 = cuts[index], cuts[index + 1]
        add_stage_core(solid, z0, z1, PAINT_UV, octagon=True)
        add_louvred_arch(solid, z0, z1, LEAD_UV, width_share=0.52)
        # A slender column on each angle, which is the documented lantern. Set on
        # the octagon's own vertices: those bear away from the axes, so a column
        # standing proud there is still well inside the collision face the player
        # is stopped by, while on an axis it would be a hand through masonry.
        cx, cy = solid.centre
        radius = (min(solid.x1 - solid.x0, solid.y1 - solid.y0) / 2.0) - CORE_INSET
        for angle_index in range(8):
            angle = math.pi / 8.0 + angle_index * math.pi / 4.0
            px = cx + math.cos(angle) * radius
            py = cy + math.sin(angle) * radius
            add_prism(px, py, [
                (z0, 0.075), (z0 + 0.10, 0.060), (z1 - 0.12, 0.060), (z1, 0.080),
            ], PAINT_UV, sides=6, cap_top=False)
        log(f"lantern stage {solid.id} {z0:.2f}..{z1:.2f} octagonal r={radius:.2f}, 8 angle columns")


# ---- the crown --------------------------------------------------------------
# Nothing may stand over the top ring: the level made it a 3.4m leap platform
# with no solid declared above it, so a centred spire there would be art in the
# air the player runs through. What the level DID leave is the ring of plan
# outboard of that platform, over a ring 1.8m below — which is exactly where a
# balustrade, its corner pinnacles and a weathervane standard belong anyway.

if spire is None:
    log(
        f"no spire authored: nothing is declared above the top ring at {TOP_RING.z:.2f}, "
        f"so a spire there would be art in air the player sprints through."
    )
else:
    # The spire, and the ball and vane on top of it where they belong.
    #
    # Everything here lives inside the spire's own declared footprint, and that is
    # not tidiness. The vane balcony is a walkable ring round the spire's foot, so
    # anything that reaches out past the footprint hangs over a surface the player
    # stands on — and at this height the clearance is nowhere near a standing body.
    # Inside the footprint the collision already says solid, so the probe excludes
    # it and a runner can never be there. The finial is therefore a slender thing
    # by construction, which is also what a finial is.
    cx, cy = spire.centre
    half = min(spire.x1 - spire.x0, spire.y1 - spire.y0) / 2.0
    rise = spire.z1 - spire.z0

    # The finial is a fixed physical object, so its height is absolute rather than
    # a fraction of the spire. Taking a share of the rise was fine when the spire
    # was 1.6m and would have put a two-metre gilt ball on a nine-metre one.
    FINIAL_H = 1.30
    DRUM_H = min(0.62, rise * 0.10)
    PLINTH_H = 0.13
    plinth_top = spire.z0 + PLINTH_H
    drum_top = plinth_top + DRUM_H
    cone_top = spire.z1 - FINIAL_H
    spring = half * 0.94

    # Plinth, then a short vertical drum, then the taper. The drum is not
    # decoration: a cone springing straight off the balcony floor reads as a
    # traffic bollard, and on the real thing the spire rises out of a base storey
    # at the lantern head. It also gives the lead somewhere to start.
    add_prism(cx, cy, [
        (spire.z0 - 0.08, half),
        (plinth_top - 0.04, half),
        (plinth_top, spring),
    ], LEAD_UV, sides=8, cap_top=False, smooth=False)
    add_prism(cx, cy, [
        (plinth_top, spring),
        (drum_top - 0.07, spring * 0.985),
        (drum_top, spring * 0.95),
    ], PAINT_UV, sides=8, cap_top=False, smooth=False)
    # The cone, faceted rather than smooth: eight flat faces with hard edges is
    # what sheet over timber looks like, and it costs nothing to say so. White,
    # not lead grey — the concept plate this was generated from is Old South, whose
    # whole steeple above the brick is white-painted timber, and a grey needle
    # against a grey sky is a spire nobody sees from the street.
    tip = 0.035
    rings = []
    STEPS = 7
    for step in range(STEPS + 1):
        t = step / STEPS
        rings.append((drum_top + (cone_top - drum_top) * t, spring * 0.95 * (1.0 - t) + tip * t))
    add_prism(cx, cy, rings, PAINT_UV, sides=8, cap_top=False, smooth=False)
    # Lead courses up the taper. On a spire this size these bands are the only
    # thing that gives the eye a scale to read the height against.
    for step in range(1, STEPS):
        z, radius = rings[step]
        add_prism(cx, cy, [
            (z - 0.05, radius + 0.012),
            (z + 0.05, radius + 0.012),
        ], LEAD_UV, sides=8, cap_top=False, smooth=False)

    ball_z = cone_top + 0.34
    vane_z = cone_top + 0.62
    add_prism(cx, cy, [
        (cone_top, tip),
        (ball_z - 0.20, tip * 1.2),
        (ball_z - 0.16, 0.115),
        (ball_z, 0.145),
        (ball_z + 0.16, 0.115),
        (ball_z + 0.20, 0.035),
        (vane_z, 0.026),
    ], GOLD_UV, sides=8, cap_top=False)
    # The standard, the cardinal cross-bars and the banner. Now that the spire is
    # tall, the finial is far above the balcony's headroom and the vane can be the
    # size a vane on a thirty-metre steeple actually is — when the spire was 1.6m
    # every arm had to hide inside a 1.0m footprint or it hung over a surface the
    # player stands on.
    reach = 0.78
    add_box(cx - 0.024, cx + 0.024, cy - 0.024, cy + 0.024, vane_z, EZ1, LEAD_UV)
    add_box(cx - 0.016, cx + 0.016, cy - reach, cy + reach, vane_z + 0.06, vane_z + 0.10, LEAD_UV)
    add_box(cx - reach, cx + reach, cy - 0.016, cy + 0.016, vane_z + 0.06, vane_z + 0.10, LEAD_UV)
    for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        # The letter arms. Small blocks on the diagonals read as the cardinals
        # without four alphabet glyphs.
        px, py = cx + sx * reach * 0.62, cy + sy * reach * 0.62
        add_box(px - 0.035, px + 0.035, py - 0.035, py + 0.035,
                vane_z + 0.04, vane_z + 0.12, LEAD_UV)
    # The banner streams south, away from the elm, so it never reads as pointing
    # at the thing the player is about to dive into.
    add_box(cx - 0.018, cx + 0.018, cy - reach, cy - 0.06, vane_z + 0.20, EZ1 - 0.03, LEAD_UV)
    add_box(cx - 0.018, cx + 0.018, cy + 0.06, cy + reach * 0.42, vane_z + 0.30, EZ1 - 0.10, LEAD_UV)
    log(
        f"spire at ({cx:.2f}, {cy:.2f}): {spring * 2:.2f}m springing, drum to "
        f"{drum_top:.2f}, taper to {cone_top:.2f}, gilt ball at {ball_z:.2f}, vane to {EZ1:.2f}"
    )
    log(
        f"  spire is {rise:.2f}m of a {EZ1:.2f}m tower — {rise / EZ1 * 100:.0f}% of its "
        f"height, base to height about 1:{(cone_top - spire.z0) / (spring * 2):.1f}"
    )

# The envelope's plan and ceiling are pinned by the authored surfaces where they
# reach them, and by a corner stud where they do not. Without this the bounding
# box is whatever survived decimation, the contain-fit scale drifts off 1.0, and
# every ring lands a few centimetres low. Measured first, so a steeple that
# already fills its box gets no floating specks at twenty metres.
bmesh.ops.remove_doubles(built, verts=list(built.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(built, faces=list(built.faces))
authored_mesh = bpy.data.meshes.new(f"{KEY}-authored")
built.to_mesh(authored_mesh)
built.free()
authored = bpy.data.objects.new(f"{KEY}-authored", authored_mesh)
bpy.context.scene.collection.objects.link(authored)
if material:
    authored.data.materials.append(material)
log("authored", tris_of(authored), "tris")


# ---------------------------------------------------------------------------
# 8. Join, pin the box, shrink the texture, export
# ---------------------------------------------------------------------------

bpy.ops.object.select_all(action="DESELECT")
generated.select_set(True)
authored.select_set(True)
bpy.context.view_layer.objects.active = generated
bpy.ops.object.join()
final = bpy.context.view_layer.objects.active
final.name = KEY

placed = coords_of(final)
gaps = {
    "x0": placed[:, 0].min() - EX0, "x1": EX1 - placed[:, 0].max(),
    "y0": placed[:, 1].min() - EY0, "y1": EY1 - placed[:, 1].max(),
    "z0": placed[:, 2].min() - EZ0, "z1": EZ1 - placed[:, 2].max(),
}
log("box gaps " + "  ".join(f"{k} {v:+.4f}" for k, v in gaps.items()))
short = {k: v for k, v in gaps.items() if v > 0.005}
if short:
    pin = bmesh.new()
    uv_layer = pin.loops.layers.uv.new("UVMap")
    built = pin  # add_box writes into `built`
    PIN = 0.02
    for x0, x1 in ((EX0, EX0 + PIN), (EX1 - PIN, EX1)):
        for y0, y1 in ((EY0, EY0 + PIN), (EY1 - PIN, EY1)):
            if "z0" in short:
                add_box(x0, x1, y0, y1, EZ0, EZ0 + PIN, BRICK_UV)
            if "z1" in short:
                add_box(x0, x1, y0, y1, EZ1 - PIN, EZ1, PAINT_UV)
    if not {"z0", "z1"} & set(short):
        # Only the plan is short, so pin it at the height something already
        # reaches rather than in mid-air at the top of the box.
        at = float(np.median(placed[:, 2]))
        for x0, x1 in ((EX0, EX0 + PIN), (EX1 - PIN, EX1)):
            for y0, y1 in ((EY0, EY0 + PIN), (EY1 - PIN, EY1)):
                add_box(x0, x1, y0, y1, at, at + PIN, PAINT_UV)
    pin_mesh = bpy.data.meshes.new(f"{KEY}-pin")
    pin.to_mesh(pin_mesh)
    pin.free()
    pin_object = bpy.data.objects.new(f"{KEY}-pin", pin_mesh)
    bpy.context.scene.collection.objects.link(pin_object)
    if material:
        pin_object.data.materials.append(material)
    bpy.ops.object.select_all(action="DESELECT")
    final.select_set(True)
    pin_object.select_set(True)
    bpy.context.view_layer.objects.active = final
    bpy.ops.object.join()
    final = bpy.context.view_layer.objects.active
    final.name = KEY
    log("pinned the box on", ", ".join(sorted(short)), "with corner studs")
else:
    log("no studs needed: the steeple already fills its box on every side")

# Scaled unconditionally, even when the atlas already is the target size. The
# exporter passes a clean image straight through as its original bytes, so a
# texture that needs no resizing also never gets re-encoded — which is how a
# 4.0MB Meshy JPEG shipped untouched while the requested quality was ignored.
for image in bpy.data.images:
    if not image.size[0]:
        continue
    was = tuple(image.size)
    image.scale(min(image.size[0], MAX_TEX), min(image.size[1], MAX_TEX))
    log(f"texture {was[0]}x{was[1]} -> {image.size[0]}x{image.size[1]} at jpeg q{int(opts['jpeg'])}")

# Bisecting leaves vertices behind that belong to no face. The exporter drops
# them, so they cost nothing at runtime, but they do sit in the bounding box
# Blender measures — which is how a reported height and a shipped height came to
# disagree by 35mm on the elm.
clean = bmesh.new()
clean.from_mesh(final.data)
loose = [v for v in clean.verts if not v.link_faces]
bmesh.ops.delete(clean, geom=loose, context="VERTS")
clean.to_mesh(final.data)
clean.free()
final.data.update()
log("dropped", len(loose), "loose vertices")

placed = coords_of(final)
size = placed.max(axis=0) - placed.min(axis=0)
log(f"FINAL_SIZE x={size[0]:.4f} y={size[1]:.4f} z={size[2]:.4f}")
log(f"FINAL_WANT x={EX1 - EX0:.4f} y={EY1 - EY0:.4f} z={EZ1 - EZ0:.4f}")
log(f"FINAL_BASE z={placed[:, 2].min():+.5f} (want 0)")
log("FINAL_TRIS", tris_of(final))
log("FINAL_AUTHORED", json.dumps(authored_report))

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
final.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_yup=True,
    export_animations=False,
    export_image_format="JPEG",
    export_jpeg_quality=int(opts["jpeg"]),
    use_selection=True,
)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
