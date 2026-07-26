# Turn a raw Meshy civic building into an M1 landmark: the 1713 Town House and
# the Hollis Street meeting-house steeple.
#
# Why this is more than the usual optimize pass
# ---------------------------------------------
# Same inversion as build_liberty_elm.py. Most world props are dressing, so the
# generator's shape is the answer and collision is fitted to it afterwards.
# These two are the opposite: M1 authored the hull first — an 11m block solid to
# 12.4m with a tower to a lookout at 17.6m, a 4m steeple shaft with ring
# galleries at 15.8 / 17.6 / 19.4 — and the run is played standing on those
# surfaces. A ledge that lands 40cm off its deck reads as a bug, so the surfaces
# a foot meets are not left to a generator.
#
# So each building is assembled from two sources:
#   Meshy   the silhouette and the brickwork: Flemish bond, the arcade arches,
#           the sash bays, the cornice, the gilded lion and unicorn, the
#           octagonal cupola, the louvred belfry stages. Everything that has to
#           look built rather than drawn, and the single texture atlas.
#   here    the walkable planes, read out of GEOMETRY through the hull JSON and
#           authored to the exact heights the collision was written against.
#
# The generated building is warped onto the hull before anything is authored on
# it, in two bands split at the height its own plan collapses from body to
# tower. Each band is fitted to the blocker the level put there. That is what
# stops the authored slabs looking bolted on: the leads land on the wall head
# the generator drew, and the lookout platform caps the cupola the generator
# drew, because both were moved onto the authored numbers first.
#
# What the hull will not allow, and why it is reported rather than fudged:
# FittedGlb contain-fits the mesh into the box sceneryPlacements() asks for, so
# the DRAWN object can never be larger than that box on any axis. A finial above
# the topmost walkable deck is therefore impossible — the deck is at the box
# ceiling — and any authored ledge that projects outside the box in plan cannot
# be drawn at all. Both are logged as conflicts by export_m1_building_hull.mjs.
#
# Run:
#   blender --background --python assets/pipeline/build_m1_civic.py \
#     -- raw.glb hull.json out.glb [--split 0.78] [--eaves 0.55] [--corbel 0.8]
#        [--tris 34000] [--tex 2048]
#
# --split  fraction of the generated height where the plan collapses to a tower
# --eaves  fraction where the vertical wall stops and the roof starts; pinned to
#          the highest walkable deck below the wall head. 0 disables the knot.
# --corbel how deep the underside of an oversailing ledge is allowed to be, so a
#          projecting gallery reads as brackets rather than as a plate. Always
#          cut back to leave the surface below it standing headroom.
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

opts = {
    "split": None, "eaves": None, "attic": 0.0, "towerbase": 0.0, "corbel": 0.0,
    "tris": 34000, "tex": 2048, "jpeg": 88,
}
rest = argv[3:]
for index in range(0, len(rest) - 1, 2):
    name = rest[index].lstrip("-")
    if name not in opts:
        raise SystemExit(f"unknown option {rest[index]}")
    opts[name] = (
        float(rest[index + 1])
        if name in ("split", "eaves", "attic", "towerbase", "corbel")
        else int(rest[index + 1])
    )

with open(HULL_JSON) as handle:
    HULL = json.load(handle)

KEY = HULL["key"]
ENV = HULL["envelope"]
STAND_H = HULL["capsule"]["standHeight"]
HEADROOM_M = STAND_H + 0.20
TRI_BUDGET = int(opts["tris"])
MAX_TEX = int(opts["tex"])


def log(*parts):
    print(f"[{KEY}]", *parts)


# glTF is Y-up and Blender is Z-up, so a hull-local offset (x, y, z) arrives at
# (x, -z, y). Every rect below is converted once, here, and never inline.
def to_blender_rect(source):
    return (source["minX"], source["maxX"], -source["maxZ"], -source["minZ"])


EX0, EX1, EY0, EY1 = to_blender_rect(ENV)
EZ0, EZ1 = ENV["minY"], ENV["maxY"]
log(f"envelope  x {EX0:.2f}..{EX1:.2f}  y {EY0:.2f}..{EY1:.2f}  z {EZ0:.2f}..{EZ1:.2f}")


# ---------------------------------------------------------------------------
# 1. The hull, in Blender's frame
# ---------------------------------------------------------------------------

class Blocker:
    def __init__(self, raw):
        self.id = raw["id"]
        self.x0, self.x1, self.y0, self.y1 = to_blender_rect(raw)
        self.z0, self.z1 = raw["baseY"], raw["topY"]
        self.mine = raw["mine"]

    @property
    def plan_area(self):
        return max(0.0, self.x1 - self.x0) * max(0.0, self.y1 - self.y0)

    def contains(self, x, y):
        return self.x0 < x < self.x1 and self.y0 < y < self.y1


blockers = [Blocker(b) for b in HULL["blockers"]]
mine = [b for b in blockers if b.mine]
if not mine:
    raise SystemExit("the hull has no blocker owned by this asset; nothing to fit")

# The body is the widest solid the level gave this asset; the tower, if there is
# one, is whatever solid of its own stands on top of the body. Those two rects
# are the entire plan contract, and the split below is measured against them.
body = max(mine, key=lambda b: b.plan_area)
above = [b for b in mine if b.z0 >= body.z1 - 0.01 and b is not body]
tower = max(above, key=lambda b: b.z1) if above else None
log(
    f"body   {body.id} plan {body.x0:.2f}..{body.x1:.2f} / {body.y0:.2f}..{body.y1:.2f}"
    f"  z {body.z0:.2f}..{body.z1:.2f}"
)
if tower:
    log(
        f"tower  {tower.id} plan {tower.x0:.2f}..{tower.x1:.2f} / {tower.y0:.2f}..{tower.y1:.2f}"
        f"  z {tower.z0:.2f}..{tower.z1:.2f}"
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
        self.rows = [row for row in raw["mask"]["rows"]]
        clipped = raw["clipped"]
        self.x0, self.x1, self.y0, self.y1 = to_blender_rect(clipped)
        self.local = clipped
        self.fraction = raw["standableFraction"]
        # A floor lands on whatever solid is directly beneath it where there is
        # one within a step, so the slab reads as the head of that wall rather
        # than as a tray hovering over it.
        support = [b.z1 for b in blockers if b.z1 < self.z - 1e-6 and b.z1 > self.z - 0.75
                   and b.x1 > self.x0 and b.x0 < self.x1 and b.y1 > self.y0 and b.y0 < self.y1]
        self.thickness = round(self.z - max(support), 3) if support else 0.34

    def cell_centre(self, i, j):
        """Mask cell (i over local X, j over local Z) as a Blender x/y point."""
        lx = self.local["minX"] + ((i + 0.5) / self.n) * (self.local["maxX"] - self.local["minX"])
        lz = self.local["minZ"] + ((j + 0.5) / self.n) * (self.local["maxZ"] - self.local["minZ"])
        return lx, -lz

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
        i = int((x - self.local["minX"]) / span_x * self.n)
        j = int((-y - self.local["minZ"]) / span_z * self.n)
        i = min(max(i, 0), self.n - 1)
        j = min(max(j, 0), self.n - 1)
        return self.rows[i][j] == "1"


decks = [Deck(d) for d in HULL["decks"] if d.get("mask")]
decks.sort(key=lambda d: d.z)


# A surface inside this envelope belongs to this building if it TOUCHES it. The
# hull lists every deck the envelope reaches, which is right — a gutter prop
# draws a 3.5m ribbon down the middle of a 13m walk and the stone under the rest
# of it is the building's. But a wider envelope also reaches the scaffold staging
# standing against the west end and the plank hung off the leads, and those are a
# scaffold and a plank. The clock ledge shares an edge with the wall; the staging
# is clear of it by 40cm. That is the whole distinction, and it is geometric.
TOUCH_M = 0.05
own = [b for b in mine]
def touches_body(deck):
    return any(
        deck.x1 > b.x0 - TOUCH_M and deck.x0 < b.x1 + TOUCH_M
        and deck.y1 > b.y0 - TOUCH_M and deck.y0 < b.y1 + TOUCH_M
        for b in own
    )


detached = [d for d in decks if not d.mine and d.asset and not touches_body(d)]
if detached:
    log(
        "not this building's surfaces (dressed elsewhere and clear of it):",
        ", ".join(f"{d.id} at {d.z:.2f}m ({d.asset})" for d in detached),
    )
    decks = [d for d in decks if d not in detached]


# A deck that CAPS a solid is not a plate laid on top of a building, it is the
# head of the wall — so it is drawn as deep as the wall is, down to whatever the
# level put below it. Left at a plate's thickness the Town House leads read as a
# black table hovering over the roof from every street in section C, because the
# collision says the body is solid to 12.4m and the art was saying it is solid to
# 12.06m with two metres of air under the lid.
#
# Only where the solid really is under the whole surface. The tower plinth is a
# 7.4m ring round a 4m shaft: three quarters of it is a corbelled gallery with
# nothing but sky beneath, and filling that would draw a 7.4m block where the
# level authored a walk-around.
ATTIC_CAP_M = float(opts["attic"])
ATTIC_COVER = 0.80
for index, deck in enumerate(decks):
    if ATTIC_CAP_M <= 0.0 or deck.thickness > 0.4:
        continue
    span = max(1e-9, (deck.x1 - deck.x0) * (deck.y1 - deck.y0))
    capping = [
        b for b in blockers
        if abs(b.z1 - deck.z) < 0.02 and b.z0 < deck.z - 0.5
        and (max(0.0, min(b.x1, deck.x1) - max(b.x0, deck.x0))
             * max(0.0, min(b.y1, deck.y1) - max(b.y0, deck.y0))) / span >= ATTIC_COVER
    ]
    if not capping:
        continue
    floor = max([d.z for d in decks[:index] if d.z < deck.z - 0.5], default=None)
    reach = deck.z - floor if floor is not None else ATTIC_CAP_M
    deck.thickness = round(min(ATTIC_CAP_M, max(deck.thickness, reach)), 3)
    log(
        f"deck   {deck.id} caps {capping[0].id}; drawn {deck.thickness:.2f}m deep "
        f"to the {floor:.2f}m surface" if floor is not None else
        f"deck   {deck.id} caps {capping[0].id}; drawn {deck.thickness:.2f}m deep"
    )

# A ledge that oversails its wall by two metres and is 34cm thick is a plate, and
# five of them stacked round a brick core is a pagoda — which is what this
# building read as from every street in section C once the draw box was wide
# enough to carry the galleries. The walking surface cannot move: it is the
# authored plane and the whole asset exists to put stone exactly on it. So the
# only place a profile can go is underneath, and it has to be deep enough to see:
# a fascia, then courses stepping back toward the wall. At 0.8m the eye reads
# brackets carrying a gallery; at 0.34m it reads sheet metal.
CORBEL_M = float(opts["corbel"])
for deck in decks:
    if CORBEL_M <= deck.thickness:
        continue
    over = [
        b for b in blockers
        if b.z1 > deck.z - 0.75 and b.z0 < deck.z
        and b.x1 > deck.x0 and b.x0 < deck.x1 and b.y1 > deck.y0 and b.y0 < deck.y1
    ]
    span = max(1e-9, (deck.x1 - deck.x0) * (deck.y1 - deck.y0))
    carried = sum(
        max(0.0, min(b.x1, deck.x1) - max(b.x0, deck.x0))
        * max(0.0, min(b.y1, deck.y1) - max(b.y0, deck.y0))
        for b in over
    )
    # Only where it really is hanging in the air. A surface sitting squarely on a
    # solid has nothing to corbel off and thickening it just buries the wall head.
    if carried / span > 0.7:
        continue
    log(f"deck   {deck.id} oversails its wall ({carried / span * 100:.0f}% carried); corbelled to {CORBEL_M:.2f}m")
    deck.thickness = CORBEL_M

# A slab hangs into the room under it, and these rooms are 1.8m tall. The clock
# ledge at 8.4m has the cornice gutter walk 1.8m over it: at a plate's 0.34m the
# runner standing on the clock ledge has 1.46m of headroom and cannot stand up,
# which the probe reads as a wall and the player reads as a ceiling. So a slab is
# only ever as deep as the surface below it can spare.
SLAB_HEADROOM_M = STAND_H + 0.05
for index, deck in enumerate(decks):
    under = [
        d for d in decks[:index]
        if d.z < deck.z - 0.05
        and d.x1 > deck.x0 and d.x0 < deck.x1 and d.y1 > deck.y0 and d.y0 < deck.y1
    ]
    if not under:
        continue
    room = deck.z - max(d.z for d in under)
    spare = round(room - SLAB_HEADROOM_M, 3)
    if spare < deck.thickness:
        log(
            f"deck   {deck.id} thinned {deck.thickness:.2f} -> {max(0.06, spare):.2f}m so the "
            f"{room:.2f}m storey under it keeps {SLAB_HEADROOM_M:.2f}m of headroom"
        )
        deck.thickness = max(0.06, spare)

for deck in decks:
    log(
        f"deck   {deck.id} z={deck.z:.2f} t={deck.thickness:.2f}"
        f"  standable {deck.fraction * 100:.0f}%  {'mine' if deck.mine else deck.asset}"
    )
skipped = [d["id"] for d in HULL["decks"] if not d.get("mask")]
if skipped:
    log("no standable area inside the envelope, so no floor authored:", ", ".join(skipped))


# ---------------------------------------------------------------------------
# 2. Import and normalise
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
# Drop to the floor and work in a 0..1 height fraction from here on, so nothing
# below depends on the arbitrary scale Meshy normalised the building to.
coords[:, 2] -= lo[2]
height = hi[2] - lo[2]
log(f"raw bbox {hi[0] - lo[0]:.3f} x {hi[1] - lo[1]:.3f} x {height:.3f}")


# ---------------------------------------------------------------------------
# 3. Where the body stops and the tower starts
# ---------------------------------------------------------------------------
# A tower is a narrow thing standing on a wide thing, so the split is read off
# the plan-area profile rather than off a silhouette width: a gambrel roof
# narrows gradually and would fool a width test into cutting the roof in half,
# and half a roof warped into a tower footprint is a lump on the leads.

SLABS = 240
edges = np.linspace(0.0, height, SLABS + 1)
centres = (edges[:-1] + edges[1:]) / 2.0
slab_index = np.clip(np.digitize(coords[:, 2], edges) - 1, 0, SLABS - 1)

area_profile = np.zeros(SLABS)
for s in range(SLABS):
    members = coords[slab_index == s]
    if len(members) < 8:
        continue
    x_lo, x_hi = np.percentile(members[:, 0], (2, 98))
    y_lo, y_hi = np.percentile(members[:, 1], (2, 98))
    area_profile[s] = max(0.0, x_hi - x_lo) * max(0.0, y_hi - y_lo)

kernel = np.ones(5) / 5.0
smooth_area = np.convolve(area_profile, kernel, mode="same")
lower = smooth_area[: int(SLABS * 0.55)]
max_area = float(lower.max()) if lower.size else float(smooth_area.max())

if opts["split"] is not None:
    split_fraction = float(opts["split"])
    log(f"split forced to {split_fraction:.3f} of height")
elif tower is None:
    split_fraction = 1.0
    log("no tower in the hull; the whole mesh is one band")
else:
    # The threshold is the tower's share of the body's plan, with a little room
    # for the generator drawing the tower slightly fatter than the level did.
    # Generous multipliers are a trap: at 2.5x the steeple's belfry stage — a
    # setback of a few per cent, not a tower — read as the collapse, and the
    # whole white steeple was warped into the 2m spire footprint, leaving a 15m
    # plain brick shaft with a toy on top.
    ratio = tower.plan_area / max(body.plan_area, 1e-9)
    threshold = min(0.40, max(0.10, ratio * 1.25))
    floor_index = int(SLABS * 0.35)
    split_index = None
    for s in range(floor_index, SLABS):
        if np.all(smooth_area[s:] <= threshold * max_area):
            split_index = s
            break
    if split_index is None:
        split_fraction = 0.72
        log(f"no clean plan collapse at {threshold:.2f} of the body; falling back to 0.72")
    else:
        split_fraction = float(centres[split_index]) / height
        log(
            f"plan collapses below {threshold:.2f} of the body area at "
            f"{split_fraction:.3f} of height"
        )

split_z = split_fraction * height


# ---------------------------------------------------------------------------
# 3b. Where the wall stops and the roof starts
# ---------------------------------------------------------------------------
# Two knots are not enough for a building with a roof. With only base and wall
# head, everything between the eaves and the ridge is stretched to land the
# GENERATED ridge on the wall head the level authored — so the slate reaches the
# leads and the walls grow to make room. Invert it and the leads plate hangs two
# metres over the ridge like a table over a hat, which is exactly what the Town
# House did at every split fraction tried: the plate cannot move, so the roof
# has to arrive at it.
#
# The level already says where the eaves are. Its highest walkable deck below the
# wall head is the cornice gutter walk, and a cornice is by definition the top of
# the wall. So the plateau of full plan area — the vertical walls, before the
# roof starts taking area away — is pinned to that height, and the roof gets
# exactly the band between the cornice and the leads to live in. The gutter walk
# then lands on the generated cornice instead of on brick halfway up a window.

eaves_from = None
eaves_to = None
if opts["eaves"] != 0.0 and tower is not None:
    below = [d.z for d in decks if d.z < body.z1 - 0.5]
    eaves_to = max(below) if below else None
    if opts["eaves"] is not None:
        eaves_from = float(opts["eaves"]) * height
    else:
        # The highest slab still carrying the wall's own plan, measured against
        # the MIDDLE of the wall rather than against the largest slab anywhere.
        # The largest slab is the arcade: its piers and its base spread wider
        # than the brickwork above them, so on this building the widest-slab
        # reading put the wall head at a fifth of the height and crushed two
        # storeys of sash windows into the roof band. 0.90 rather than 1.0
        # because a moulded cornice oversails the wall it caps.
        wall_lo, wall_hi = int(SLABS * 0.30), int(SLABS * 0.58)
        wall_area = float(np.median(smooth_area[wall_lo:wall_hi]))
        ceiling = int(min(SLABS, split_fraction * SLABS))
        plateau = [
            s for s in range(wall_lo, ceiling) if smooth_area[s] >= 0.90 * wall_area
        ]
        eaves_from = float(centres[max(plateau)]) if plateau else None
    if eaves_from is not None and eaves_to is not None:
        # Both knots have to leave the remap monotonic and leave the roof a band
        # to be a roof in. A generated wall head below a third of the height, or
        # above the plan collapse, or a cornice within a hand's breadth of the
        # leads, means this reading is wrong and two knots are the honest answer.
        if not (0.30 * height < eaves_from < split_z - 0.02 * height and eaves_to < body.z1 - 0.3):
            log(
                f"eaves knot rejected: wall head at {eaves_from / height:.3f} of height, "
                f"deck at {eaves_to:.2f} against a wall head of {body.z1:.2f}"
            )
            eaves_from = eaves_to = None
    else:
        eaves_from = eaves_to = None
if eaves_from is not None:
    log(
        f"eaves knot: plan is full to {eaves_from / height:.3f} of height, pinned to the "
        f"{eaves_to:.2f}m deck, leaving {body.z1 - eaves_to:.2f}m for the roof"
    )


# ---------------------------------------------------------------------------
# 4. Warp the generated building onto the hull
# ---------------------------------------------------------------------------
# Height first, as a monotonic piecewise-linear stretch — it only opens and
# closes the gaps between the knots, so nothing shears and nothing folds. Then
# the plan, per band, onto the blocker the level actually put there.

band_top = tower.z1 if tower else body.z1
if tower is None:
    knots_from = [0.0, height]
    knots_to = [0.0, body.z1]
elif eaves_from is not None:
    knots_from = [0.0, eaves_from, split_z, height]
    knots_to = [0.0, eaves_to, body.z1, band_top]
else:
    knots_from = [0.0, split_z, height]
    knots_to = [0.0, body.z1, band_top]
for i in range(1, len(knots_from)):
    if knots_from[i] <= knots_from[i - 1] or knots_to[i] <= knots_to[i - 1]:
        raise SystemExit(f"height remap is not monotonic: {knots_from} -> {knots_to}")
log("height remap", [round(v, 3) for v in knots_from], "->", [round(v, 3) for v in knots_to])

is_upper = coords[:, 2] > split_z


def fit_axis(values, target_lo, target_hi):
    """Affine map of a robust extent of `values` onto a target span."""
    source_lo, source_hi = np.percentile(values, (1.5, 98.5))
    if source_hi - source_lo < 1e-6:
        return 1.0, (target_lo + target_hi) / 2.0 - (source_lo + source_hi) / 2.0
    scale = (target_hi - target_lo) / (source_hi - source_lo)
    return scale, target_lo - source_lo * scale


def fit_band(mask, target, label):
    if mask.sum() < 24:
        log(f"{label}: too few vertices to fit; left alone")
        return (1.0, 0.0), (1.0, 0.0)
    members = coords[mask]
    fit_x = fit_axis(members[:, 0], target.x0, target.x1)
    fit_y = fit_axis(members[:, 1], target.y0, target.y1)
    log(
        f"{label}: {int(mask.sum())} verts, plan x*{fit_x[0]:.3f}{fit_x[1]:+.3f}"
        f" y*{fit_y[0]:.3f}{fit_y[1]:+.3f}"
    )
    return fit_x, fit_y


# The body extent is measured clear of the ground: a generated stone pavement or
# a base slab spreads wider than the walls, and letting it set the scale draws
# the building smaller than its own collision with a skirt sticking out of it.
body_band = (~is_upper) & (coords[:, 2] > 0.10 * split_z) & (coords[:, 2] < 0.94 * split_z)
if body_band.sum() < 24:
    body_band = ~is_upper
body_fit_x, body_fit_y = fit_band(body_band, body, "body band")
if tower is not None:
    # The tower's plan is measured on the tower, not on everything above the
    # split. A gambrel's upper slope is a long thin wedge, and where the plan
    # collapse lands on it the band it defines is the RIDGE — 1.34 x 0.33 on the
    # Town House. Fitted to a square 4m shaft that is a 4:1 stretch, and the
    # cupola comes out a metre wide with the ridge fanned out either side of it.
    # Measuring above the ridge and applying that scale to the whole band leaves
    # the ridge remnant oversized instead, where the envelope clip and the deck
    # cull take it away.
    measure = is_upper
    if opts["towerbase"] > 0.0:
        floor_z = split_z + float(opts["towerbase"]) * (height - split_z)
        candidate = coords[:, 2] > floor_z
        if candidate.sum() >= 24:
            measure = candidate
            log(f"tower plan measured above {floor_z / height:.3f} of height")
    tower_fit_x, tower_fit_y = fit_band(measure, tower, "tower band")
else:
    tower_fit_x, tower_fit_y = body_fit_x, body_fit_y

warped = coords.copy()
warped[:, 2] = np.interp(coords[:, 2], knots_from, knots_to)
for axis, (low_fit, high_fit) in ((0, (body_fit_x, tower_fit_x)), (1, (body_fit_y, tower_fit_y))):
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
# 5. Atlas sampling, before anything is deleted
# ---------------------------------------------------------------------------
# The authored slabs share Meshy's atlas, so they need UVs that land on the
# right material rather than on sky. Take the interquartile UV box of the faces
# that already are that material — up-facing faces at the head of the wall are
# the leads, faces above the wall head are the painted timber of the tower — and
# ping-pong into it, which tiles without a seam and cannot wander into a
# neighbouring island.

def flat_atlas_uv(low, high, fallback, grey=0.0):
    """The calmest patch of the atlas in a brightness band.

    Sampling UVs off the faces that already are a material sounds right and is
    not: a Meshy atlas is a patchwork of islands, and the interquartile box of
    the tower's faces straddled several of them — which drew the authored
    galleries as dark streaks with bits of louvre in them. What an authored
    stone surface actually wants is a quiet piece of the right colour, so this
    looks for exactly that: the lowest-variance block whose mean brightness is
    in the band asked for, measured on a thumbnail so it costs nothing.
    """
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
    # Lead and stone are grey; brick is not. Brightness alone cannot tell them
    # apart — the calmest mid-brightness block on this atlas was dark red brick,
    # which drew the leads of the Town House as a black plate hovering over a
    # slate roof. `grey` prices saturation into the score so a lead surface asks
    # for lead.
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
    _, row, col, mean = best
    # Blender's pixel rows run bottom-up, which is also how UV v runs, so the
    # row index maps to v directly. Pulled in a tenth of a block on every side
    # so a bilinear fetch cannot reach into the neighbouring island.
    pad = 0.1 * block / grid
    return (
        col / grid + pad, (col + block) / grid - pad,
        row / grid + pad, (row + block) / grid - pad,
    )


LEAD_UV = flat_atlas_uv(0.26, 0.60, (0.45, 0.55, 0.45, 0.55), grey=0.6)
PAINT_UV = flat_atlas_uv(0.56, 0.94, LEAD_UV, grey=0.6)
log(f"lead  uv u {LEAD_UV[0]:.3f}..{LEAD_UV[1]:.3f} v {LEAD_UV[2]:.3f}..{LEAD_UV[3]:.3f}")
log(f"paint uv u {PAINT_UV[0]:.3f}..{PAINT_UV[1]:.3f} v {PAINT_UV[2]:.3f}..{PAINT_UV[3]:.3f}")


def ping_pong(value):
    t = math.fmod(abs(value), 2.0)
    return t if t <= 1.0 else 2.0 - t


def atlas_uv(box, u_raw, v_raw):
    u0, u1, v0, v1 = box
    return (u0 + ping_pong(u_raw) * (u1 - u0), v0 + ping_pong(v_raw) * (v1 - v0))


# ---------------------------------------------------------------------------
# 6. Clear the space the authored surfaces and the player will occupy
# ---------------------------------------------------------------------------

def clip_to_envelope(obj):
    """Square the building off at the envelope on all five sides that matter.

    FittedGlb contain-fits on the bounding box and then centres it, so an
    overhang does not make the building bigger — it shrinks the whole building
    until the overhang fits, which drops every authored deck below its plane.
    Anything outside the box is therefore not decoration, it is a scale error.
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


def cull_over_decks(obj, precise):
    """Drop generated faces standing in a walkable surface or its headroom.

    `precise` tests every vertex rather than the centroid. A centroid test is
    enough before decimation and much cheaper; afterwards the triangles are
    large enough to reach a long way in from a centroid that is safely outside,
    and one spar through the leads is what turns a deck probe into a failure.
    """
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    mesh.faces.ensure_lookup_table()
    doomed = []
    for face in mesh.faces:
        points = [v.co for v in face.verts] if precise else [face.calc_center_median()]
        for deck in decks:
            low = deck.z - deck.thickness + 0.02
            high = deck.z + HEADROOM_M
            if any(
                low < point.z < high and deck.standable_at(point.x, point.y)
                for point in points
            ):
                doomed.append(face)
                break
    log(f"culling {len(doomed)} generated faces over walkable decks ({'precise' if precise else 'coarse'})")
    bmesh.ops.delete(mesh, geom=doomed, context="FACES")
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()


clip_to_envelope(generated)
log("after clip", tris_of(generated), "tris")
cull_over_decks(generated, precise=False)
log("after coarse cull", tris_of(generated), "tris")

# Decimate the generated half only, and before the authored surfaces exist, so a
# collapse pass can never round off the deck the player stands on.
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
# deck. So the generated half is pinned to an exact base of zero, and re-clipped,
# before anything is built on it.
placed = coords_of(generated)
drop = placed[:, 2].min()
if abs(drop) > 1e-4:
    for vertex in generated.data.vertices:
        vertex.co.z -= drop
    generated.data.update()
    log(f"re-zeroed generated half: base was {drop:+.4f}")
clip_to_envelope(generated)
cull_over_decks(generated, precise=True)
log("after precise cull", tris_of(generated), "tris")


# ---------------------------------------------------------------------------
# 7. The authored surfaces
# ---------------------------------------------------------------------------
# One slab per walkable deck, covering exactly the standable mask the hull
# computed: the leads are a ring round a solid tower, the tower plinth is a
# walk-around, the steeple galleries are collars round its spire. A slab across
# the whole rect would push stone through the tower; a slab short of the mask
# leaves the player standing on air.

def greedy_rectangles(deck):
    """Cover the standable mask with as few axis-aligned rectangles as possible.

    Few big rectangles rather than a quad per cell: the cover is what becomes
    geometry, and a 48x48 grid of quads is 4,600 triangles for one floor.
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
            while i + depth < n and all(
                not taken[i + depth][j + k] for k in range(width)
            ):
                depth += 1
            for di in range(depth):
                for dk in range(width):
                    taken[i + di][j + dk] = True
            rects.append((i, i + depth, j, j + width))
    return rects


built = bmesh.new()
uv_layer = built.loops.layers.uv.new("UVMap")


def add_box(x0, x1, y0, y1, z0, z1, uv_box, uv_scale=0.5):
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
        face.smooth = False
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


def free_sides(deck, rect):
    """Which of a rectangle's four sides are the outside edge of the mask.

    Only those may be moulded. The greedy cover cuts one ring into several
    rectangles, and stepping a shared edge would saw a groove up the middle of
    a continuous floor.
    """
    i0, i1, j0, j1 = rect
    n = deck.n

    def free(i_range, j_range):
        for i in i_range:
            for j in j_range:
                if 0 <= i < n and 0 <= j < n and deck.rows[i][j] == "1":
                    return False
        return True

    # Mask index j runs along local +Z, and Blender y is -Z, so the j0 side of
    # the rectangle is its y1 edge and the j1 side is its y0 edge.
    return {
        "x0": free([i0 - 1], range(j0, j1)),
        "x1": free([i1], range(j0, j1)),
        "y1": free(range(i0, i1), [j0 - 1]),
        "y0": free(range(i0, i1), [j1]),
    }


MODILLION_W = 0.16       # a bracket this wide, at this pitch, under a corona
MODILLION_PITCH = 0.62


def add_modillions(x0, x1, y0, y1, top, drop, inset, uv_box, sides):
    """The bracket course of a cornice: discrete blocks with daylight between them.

    This is the difference between a cornice and a tray, and it costs no headroom
    at all — which matters, because on this building there is none to spend. The
    slab already fills its entire budget: a ledge 1.8m under the next one may hang
    0.22m and no more, so a bracket hung BELOW the slab is a bracket that cannot
    exist. Modillions were never below it. They sit inside the cornice's own depth,
    under the corona, and what reads at fifty metres is not their modelling but the
    row of shadows in the gaps. So the middle course of the profile is broken into
    blocks instead of being one more smooth step, at identical depth.
    """
    if drop < 0.05 or inset < 0.04:
        return
    for side, along, fixed in (
        ("x0", (y0, y1), x0), ("x1", (y0, y1), x1),
        ("y0", (x0, x1), y0), ("y1", (x0, x1), y1),
    ):
        if not sides[side]:
            continue
        span = along[1] - along[0]
        count = max(1, int(span / MODILLION_PITCH))
        for index in range(count):
            centre = along[0] + span * (index + 0.5) / count
            a, b = centre - MODILLION_W / 2.0, centre + MODILLION_W / 2.0
            if side == "x0":
                add_box(fixed, fixed + inset, a, b, top - drop, top, uv_box)
            elif side == "x1":
                add_box(fixed - inset, fixed, a, b, top - drop, top, uv_box)
            elif side == "y0":
                add_box(a, b, fixed, fixed + inset, top - drop, top, uv_box)
            else:
                add_box(a, b, fixed - inset, fixed, top - drop, top, uv_box)


def add_moulded_slab(x0, x1, y0, y1, top, thickness, uv_box, sides):
    """A walkable slab with a moulded, bracketed underside instead of a tray edge.

    The walking surface has to be the full extent of the standable mask, so the
    only place a profile can go is underneath. Three bands: a corona at the full
    extent, a modillion course of separate blocks under it, and a bed mould stepped
    back to the wall. The middle band used to be a third smooth step, and three
    smooth steps still read as a plate with a chamfer — every one of them is a
    continuous horizontal edge, and a plate is exactly a stack of continuous
    horizontal edges. The blocks are what break that.
    """
    corona = min(thickness, max(0.05, thickness * 0.24))
    bed = min(thickness - corona, max(0.05, thickness * 0.34))
    band = max(0.0, thickness - corona - bed)
    step = 0.30 * thickness + 0.03

    def cut(inset):
        return (
            x0 + (inset if sides["x0"] else 0.0),
            x1 - (inset if sides["x1"] else 0.0),
            y0 + (inset if sides["y0"] else 0.0),
            y1 - (inset if sides["y1"] else 0.0),
        )

    # Corona: the full extent of the mask, and the walking surface itself.
    cx0, cx1, cy0, cy1 = cut(0.0)
    add_box(cx0, cx1, cy0, cy1, top - corona, top, uv_box)

    # Modillion course, then a thin soffit behind it so there is no daylight
    # between the brackets and the wall.
    if band > 0.05:
        add_modillions(x0, x1, y0, y1, top - corona, band, step, uv_box, sides)
        sx0, sx1, sy0, sy1 = cut(step)
        if sx1 - sx0 > 0.05 and sy1 - sy0 > 0.05:
            add_box(sx0, sx1, sy0, sy1, top - corona - band, top - corona, uv_box)

    # Bed mould, stepped further back toward the wall.
    bx0, bx1, by0, by1 = cut(step + 0.04)
    if bed > 0.02 and bx1 - bx0 > 0.05 and by1 - by0 > 0.05:
        add_box(bx0, bx1, by0, by1, top - thickness, top - corona - band, uv_box)


authored_report = []
for deck in decks:
    rects = greedy_rectangles(deck)
    uv_box = LEAD_UV if deck.z <= body.z1 + 0.01 else PAINT_UV
    covered = 0.0
    for rect in rects:
        x0, x1, y0, y1 = deck.cell_bounds(*rect)
        add_moulded_slab(
            x0, x1, y0, y1, deck.z, deck.thickness, uv_box, free_sides(deck, rect)
        )
        covered += (x1 - x0) * (y1 - y0)
    log(
        f"authored {deck.id} at z={deck.z:.2f}: {len(rects)} rectangles, "
        f"{covered:.1f} m2 of walkable surface, {deck.thickness:.2f}m thick"
    )
    authored_report.append({"id": deck.id, "y": deck.z, "rects": len(rects), "areaM2": round(covered, 2)})

# The envelope's plan and ceiling are pinned by the authored surfaces where they
# reach them, and by an explicit rail of eight corner studs where they do not.
# Without this the bounding box is whatever survived decimation, the contain-fit
# scale drifts off 1.0, and every deck lands a few centimetres low.
PIN = 0.02
pin_z0, pin_z1 = EZ1 - PIN, EZ1
for x0, x1 in ((EX0, EX0 + PIN), (EX1 - PIN, EX1)):
    for y0, y1 in ((EY0, EY0 + PIN), (EY1 - PIN, EY1)):
        add_box(x0, x1, y0, y1, EZ0, EZ0 + PIN, LEAD_UV)
        add_box(x0, x1, y0, y1, pin_z0, pin_z1, PAINT_UV)

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
# 8. Join, shrink the texture, export
# ---------------------------------------------------------------------------

bpy.ops.object.select_all(action="DESELECT")
generated.select_set(True)
authored.select_set(True)
bpy.context.view_layer.objects.active = generated
bpy.ops.object.join()
final = bpy.context.view_layer.objects.active
final.name = KEY

# Scaled unconditionally, even when the atlas already is the target size. The
# exporter passes a clean image straight through as its original bytes, so a
# texture that needs no resizing also never gets re-encoded — which is how a
# 4.0MB Meshy JPEG shipped untouched while the requested quality was ignored.
# Rewriting the pixels marks it dirty and the quality setting starts to bite.
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
