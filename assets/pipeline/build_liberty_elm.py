# Turn the raw Meshy elm into liberty-elm-hero.glb: the climbable Liberty Tree.
#
# Why this is more than the usual optimize pass
# ---------------------------------------------
# Every other world prop is dressing, so Meshy's shape is the answer and the
# collision is fitted to it afterwards. This one is inverted. M1 already
# authored the hull the player moves through — a bole solid to 12m and three
# limb tiers at 6.4 / 8.3 / 11.2m over named rects — and the run's climax is
# played standing on the 8.3m tier. A branch that lands 40cm off the deck reads
# as a bug, not as scenery, so those surfaces cannot be left to a generator.
#
# So the tree is assembled from two sources:
#   Meshy   the bark and leaf texture, the fine branch architecture above the
#           tiers, the crown silhouette, the foliage. Everything that has to
#           look grown rather than drawn.
#   here    the bole and the three limb rafts, built to the authored numbers so
#           the wood is exactly where the collision says the foot lands.
#
# The Meshy tree is height-remapped first so its own limb tiers sit on the
# authored heights, which is what stops the rafts looking bolted on: they come
# out of the same crotches the generated limbs do.
#
# Run:
#   blender --background --python assets/pipeline/build_liberty_elm.py \
#     -- raw.glb hull.json out.glb
import bpy
import bmesh
import json
import math
import os
import random
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
RAW_GLB = os.path.abspath(argv[0])
HULL_JSON = os.path.abspath(argv[1])
OUT_GLB = os.path.abspath(argv[2])

with open(HULL_JSON) as handle:
    HULL = json.load(handle)

SIZE_X, SIZE_Y, SIZE_Z = HULL["sizeM"]          # 16 wide, 18 tall, 16 deep
HALF_X, HALF_Z = SIZE_X / 2.0, SIZE_Z / 2.0
BOLE_R = HULL["bole"]["radius"]                  # 0.90
BOLE_TOP = HULL["bole"]["topY"]                  # 12.0
TIERS = HULL["tiers"]

# Budgets. The web bundle is 1.5MB before assets and this ships to Chromebooks
# over school wifi, so the tree has to sit in the same band as its neighbours.
MESHY_TRI_BUDGET = 17000
MAX_TEX = 1024
HEADROOM_M = 1.75          # a 1.55m runner, plus clearance, above every deck
RNG = random.Random(17650814)

# glTF is Y-up and Blender is Z-up, so a game-space offset (x, y, z) arrives as
# (x, -z, y). Only BOUGH_UPPER is asymmetric, but it is asymmetric on both axes,
# so the sign is done once here and never inline.
def game_rect_to_blender(tier):
    return (tier["minX"], tier["maxX"], -tier["maxZ"], -tier["minZ"])


def log(*parts):
    print("[elm]", *parts)


# ---------------------------------------------------------------------------
# 1. Import and normalise
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
tree = bpy.context.view_layer.objects.active
tree.name = "liberty-elm-hero"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

material = tree.data.materials[0] if tree.data.materials else None
log("raw tris", sum(len(p.vertices) - 2 for p in tree.data.polygons))


def bounds(obj):
    coords = np.array([v.co[:] for v in obj.data.vertices])
    return coords.min(axis=0), coords.max(axis=0)


lo, hi = bounds(tree)
scale = SIZE_Y / (hi[2] - lo[2])
for vertex in tree.data.vertices:
    vertex.co *= scale
log(f"scaled x{scale:.4f} to {SIZE_Y:.1f}m tall")

# The bole axis, not the bounding box centre: the root flare is the one part of
# a generated tree that reliably sits over the trunk.
lo, hi = bounds(tree)
coords = np.array([v.co[:] for v in tree.data.vertices])
foot = coords[coords[:, 2] < lo[2] + 0.10 * (hi[2] - lo[2])]
axis_x, axis_y = float(np.median(foot[:, 0])), float(np.median(foot[:, 1]))
offset = Vector((-axis_x, -axis_y, -lo[2]))
for vertex in tree.data.vertices:
    vertex.co += offset
log(f"bole axis recentred from ({axis_x:.3f}, {axis_y:.3f}); base dropped to 0")


# ---------------------------------------------------------------------------
# 2. Bark UVs, sampled before the trunk is deleted
# ---------------------------------------------------------------------------
# The authored bole and rafts share the Meshy atlas, so they need UVs that land
# on bark rather than on sky or leaves. Take the interquartile UV box of the
# faces that are actually trunk and ping-pong into it, which tiles without a
# seam and cannot wander into a neighbouring island.

uv_layer_name = tree.data.uv_layers.active.name if tree.data.uv_layers.active else None
BARK_UV = (0.25, 0.35, 0.25, 0.35)
if uv_layer_name:
    uv_data = tree.data.uv_layers[uv_layer_name].data
    samples = []
    for poly in tree.data.polygons:
        centre = poly.center
        if centre.z < 0.30 * SIZE_Y and math.hypot(centre.x, centre.y) < 1.8:
            for loop_index in poly.loop_indices:
                samples.append(uv_data[loop_index].uv[:])
    if len(samples) > 64:
        arr = np.array(samples)
        BARK_UV = (
            float(np.percentile(arr[:, 0], 30)),
            float(np.percentile(arr[:, 0], 70)),
            float(np.percentile(arr[:, 1], 30)),
            float(np.percentile(arr[:, 1], 70)),
        )
log(f"bark uv box u {BARK_UV[0]:.3f}..{BARK_UV[1]:.3f} v {BARK_UV[2]:.3f}..{BARK_UV[3]:.3f}")


def ping_pong(value):
    t = math.fmod(abs(value), 2.0)
    return t if t <= 1.0 else 2.0 - t


def bark_uv(u_raw, v_raw):
    u0, u1, v0, v1 = BARK_UV
    return (u0 + ping_pong(u_raw) * (u1 - u0), v0 + ping_pong(v_raw) * (v1 - v0))


# ---------------------------------------------------------------------------
# 3. Remap the generated tree's own limb tiers onto the authored heights
# ---------------------------------------------------------------------------
# A monotonic piecewise-linear stretch along Z. It only opens and closes the
# vertical gaps between tiers, so nothing shears and nothing folds: the tree
# keeps every bit of its generated shape and simply agrees about where its
# tiers are.

coords = np.array([v.co[:] for v in tree.data.vertices])
radius = np.hypot(coords[:, 0], coords[:, 1])
limb = coords[radius > 1.8]
bins = np.linspace(0.0, SIZE_Y, 121)
hist, _ = np.histogram(limb[:, 2], bins=bins)
kernel = np.ones(7) / 7.0
smooth = np.convolve(hist.astype(float), kernel, mode="same")
centres = (bins[:-1] + bins[1:]) / 2.0

window = (centres > 0.22 * SIZE_Y) & (centres < 0.78 * SIZE_Y)
peaks = [
    i
    for i in range(1, len(smooth) - 1)
    if window[i] and smooth[i] >= smooth[i - 1] and smooth[i] > smooth[i + 1]
]
peaks.sort(key=lambda i: smooth[i], reverse=True)
natural = sorted(float(centres[i]) for i in peaks[:3])
targets = [tier["y"] for tier in TIERS]

if len(natural) < 3 or any(
    natural[i + 1] - natural[i] < 0.45 for i in range(len(natural) - 1)
):
    # No clean tier structure to align to. Spread the knots across the band the
    # limbs actually occupy rather than inventing peaks.
    low, high = float(np.percentile(limb[:, 2], 8)), float(np.percentile(limb[:, 2], 72))
    natural = [low + (high - low) * f for f in (0.0, 0.42, 1.0)]
    log("no clean tier peaks; falling back to the limb band")
log("natural tiers", [round(v, 2) for v in natural], "->", targets)

knots_from = [0.0] + natural + [SIZE_Y]
knots_to = [0.0] + targets + [SIZE_Y]
for i in range(1, len(knots_from)):
    assert knots_from[i] > knots_from[i - 1], f"remap not monotonic: {knots_from}"
for vertex in tree.data.vertices:
    vertex.co.z = float(np.interp(vertex.co.z, knots_from, knots_to))


# ---------------------------------------------------------------------------
# 4. Clear the space the authored geometry and the player will occupy
# ---------------------------------------------------------------------------

def bole_radius(z):
    """Mean bole radius at height z: authored girth, with a root flare."""
    # Strictly greater: the topmost bole ring sits exactly on BOLE_TOP, and
    # narrowing it there pinched the last 800mm of a trunk the level calls
    # solid to twelve metres. The fork above it does the narrowing instead.
    if z > BOLE_TOP:
        return BOLE_R * 0.86
    flare = 0.36 * max(0.0, 1.0 - z / 0.95) ** 1.7
    taper = 1.0 - 0.035 * min(1.0, z / BOLE_TOP)
    return BOLE_R * taper + flare


def cull_generated(obj, precise):
    """Drop generated faces the authored geometry or the player will occupy.

    `precise` tests every vertex rather than the centroid. A centroid test is
    enough before decimation and much cheaper; afterwards the triangles are
    large enough to reach a long way inside from a centroid that is safely
    outside, and a single spar poking through the bole is what turns the bole
    probe into a false negative.
    """
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    mesh.faces.ensure_lookup_table()
    doomed = []
    for face in mesh.faces:
        points = [v.co for v in face.verts] if precise else [face.calc_center_median()]

        # The authored bole replaces the generated trunk outright, so anything
        # inside it is invisible weight. The bole's own radius is never faded —
        # a spar left inside the trunk is hidden but still the first thing a
        # probe finds, and it reads as a trunk thinner than the authored one.
        # Only the clearance margin outside it tapers away, so the branches
        # that leave the bole near the top survive.
        if any(
            point.z < BOLE_TOP
            and math.hypot(point.x, point.y)
            < bole_radius(point.z) + 0.02 + 0.32 * min(1.0, BOLE_TOP - point.z)
            for point in points
        ):
            doomed.append(face)
            continue

        # Headroom. A bough you cannot stand up on is not a bough, and this is
        # the only place the generated canopy and the authored route collide.
        hit = False
        for tier in TIERS:
            bx0, bx1, by0, by1 = game_rect_to_blender(tier)
            if any(
                tier["y"] + 0.02 < point.z < tier["y"] + HEADROOM_M
                and bx0 - 0.3 < point.x < bx1 + 0.3
                and by0 - 0.3 < point.y < by1 + 0.3
                for point in points
            ):
                hit = True
                break
        if hit:
            doomed.append(face)
    log(f"culling {len(doomed)} generated faces ({'precise' if precise else 'coarse'})")
    bmesh.ops.delete(mesh, geom=doomed, context="FACES")

    if precise:
        # Square the canopy off at the authored footprint. FittedGlb centres a
        # prop on its bounding box, so the box has to be symmetric about the
        # bole or the trunk lands off its own collision. The generated crown
        # overshoots by ~0.2m on one side; that is all that gets trimmed. Like
        # the floor, this has to come after decimation: a collapse pass had
        # already nudged a leaf 134mm back outside an earlier clip.
        for normal, offset in (
            ((1, 0, 0), HALF_X), ((-1, 0, 0), HALF_X),
            ((0, 1, 0), HALF_Z), ((0, -1, 0), HALF_Z),
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


cull_generated(tree, precise=False)
log("after coarse cull/clip", sum(len(p.vertices) - 2 for p in tree.data.polygons), "tris")

# Decimate the generated half only, and before the authored surfaces exist, so
# a collapse pass can never round off the deck the player stands on.
tris = sum(len(p.vertices) - 2 for p in tree.data.polygons)
if tris > MESHY_TRI_BUDGET:
    bpy.context.view_layer.objects.active = tree
    modifier = tree.modifiers.new("dec", "DECIMATE")
    modifier.ratio = MESHY_TRI_BUDGET / tris
    bpy.ops.object.modifier_apply(modifier=modifier.name)
log("generated half", sum(len(p.vertices) - 2 for p in tree.data.polygons), "tris")

# Re-zero AFTER decimating. Quadric collapse moves vertices, and it had pushed
# a root 151mm below the floor — which FittedGlb, since it bottom-aligns on the
# bounding box, would have turned into every bough sitting 151mm over its deck.
# That is precisely the "beautiful branch 40cm off the deck" failure, so the
# generated half is pinned to an exact 0..18m before anything is built on it.
lo, hi = bounds(tree)
span = hi[2] - lo[2]
for vertex in tree.data.vertices:
    vertex.co.z = (vertex.co.z - lo[2]) * (SIZE_Y / span)
log(f"re-zeroed generated half: was {lo[2]:+.3f}..{hi[2]:+.3f}, now 0..{SIZE_Y:.1f}")

cull_generated(tree, precise=True)
log("after precise cull", sum(len(p.vertices) - 2 for p in tree.data.polygons), "tris")


# ---------------------------------------------------------------------------
# 5. The authored bole
# ---------------------------------------------------------------------------

def smooth_ring(values, passes=2):
    out = list(values)
    n = len(out)
    for _ in range(passes):
        out = [(out[i - 1] + 2.0 * out[i] + out[(i + 1) % n]) / 4.0 for i in range(n)]
    return out


built = bmesh.new()
uv_layer = built.loops.layers.uv.new("UVMap")


def add_grid(rings, closed=True, uv_of=None):
    """Stitch a list of equal-length vertex rings into a tube."""
    verts = [[built.verts.new(point) for point in ring] for ring in rings]
    faces = []
    for j in range(len(rings) - 1):
        count = len(rings[j])
        last = count if closed else count - 1
        for i in range(last):
            k = (i + 1) % count
            quad = (verts[j][i], verts[j][k], verts[j + 1][k], verts[j + 1][i])
            if len({v.index for v in quad}) < 4 and len(set(quad)) < 3:
                continue
            try:
                face = built.faces.new(quad)
            except ValueError:
                continue
            faces.append((face, [(j, i), (j, k), (j + 1, k), (j + 1, i)]))
    if uv_of:
        for face, keys in faces:
            for loop, key in zip(face.loops, keys):
                loop[uv_layer].uv = uv_of(*key)
    return verts


BOLE_NA = 46
BOLE_ZS = [0.0, 0.22, 0.5, 0.85, 1.3, 2.0, 3.0, 4.2, 5.4, 6.4,
           7.3, 8.3, 9.2, 10.2, 11.2, BOLE_TOP]


def bole_point(i, z):
    theta = 2.0 * math.pi * i / BOLE_NA
    # Flutes cut inward from the authored radius so the bole is never wider
    # than the collision the player is stopped by, and twist slowly with height
    # the way an old elm's ridges do. Kept shallow enough that the narrowest
    # point of the fluting is still inside a tenth of the authored girth.
    # Deliberately plumb. A lean looks better in isolation but walks the bole
    # off-centre inside a collision cylinder the player is stopped by, and the
    # downhill side then measures thinner than the trunk that was authored.
    #
    # Bark relief is three frequencies: the deep flutes an old elm carries up
    # the bole, a finer ridge over them, and a slow vertical wander. The
    # inward budget is held under 60mm so the narrowest ridge is still inside a
    # tenth of the authored girth; the outward ridge is allowed 35mm, which is
    # bark standing a little proud of the collision cylinder rather than the
    # trunk itself being fat.
    flute = 0.038 * (0.5 - 0.5 * math.cos(6.0 * theta + 0.30 * z))
    grain = 0.017 * (0.5 - 0.5 * math.cos(13.0 * theta - 0.55 * z + 1.1))
    ridge = 0.035 * (0.5 + 0.5 * math.sin(9.0 * theta + 0.8 * z + 2.2)) ** 2
    wander = 0.012 * math.sin(0.62 * z + 0.9)
    r = bole_radius(z) - flute - grain + ridge + wander
    return Vector((math.cos(theta) * r, math.sin(theta) * r, z))


bole_rings = [[bole_point(i, z) for i in range(BOLE_NA)] for z in BOLE_ZS]
add_grid(
    bole_rings,
    uv_of=lambda j, i: bark_uv(i / BOLE_NA * 4.0, BOLE_ZS[j] / 2.6),
)

# Cap the foot, and fork the head so the authored bole hands off to the
# generated crown instead of stopping dead at a rim at 12m.
foot_ring = [built.verts.new(p) for p in bole_rings[0]]
try:
    built.faces.new(list(reversed(foot_ring)))
except ValueError:
    pass

FORK_NA = 10
for stem in range(4):
    base = 2.0 * math.pi * (stem + 0.18 * RNG.random()) / 4.0
    lean_x, lean_y = math.cos(base), math.sin(base)
    rings = []
    for step in range(7):
        t = step / 6.0
        z = BOLE_TOP - 0.55 + t * 2.9
        spread = 1.35 * t ** 1.5
        r = 0.40 * (1.0 - 0.72 * t) + 0.06
        rings.append([
            Vector((
                lean_x * spread + math.cos(2.0 * math.pi * i / FORK_NA) * r,
                lean_y * spread + math.sin(2.0 * math.pi * i / FORK_NA) * r,
                z,
            ))
            for i in range(FORK_NA)
        ])
    add_grid(rings, uv_of=lambda j, i: bark_uv(i / FORK_NA * 2.0, j * 0.55))


# ---------------------------------------------------------------------------
# 6. The three limb rafts
# ---------------------------------------------------------------------------
# Each tier is a knot of scaffold limbs grown together, not a disc: the outline
# is lobed, the top is ridged along the limb axes, and the ends droop once they
# are past the rect the player is allowed to stand on. Inside that rect the top
# is held flat on the deck plane, because that is the whole point.

def rect_reach(theta, x0, x1, y0, y1):
    """Distance from the bole axis to the far side of the rect along theta."""
    enter, exit_at = 0.0, 1e9
    for direction, low, high in ((math.cos(theta), x0, x1), (math.sin(theta), y0, y1)):
        if abs(direction) < 1e-9:
            if low > 0.0 or high < 0.0:
                return 0.0
            continue
        a, b = low / direction, high / direction
        if a > b:
            a, b = b, a
        enter, exit_at = max(enter, a), min(exit_at, b)
    return exit_at if exit_at >= enter and exit_at > 0.0 else 0.0


TIER_NA = 84
TIER_NR = 5


def reach_over_wedge(theta, x0, x1, y0, y1):
    """Furthest rect point in the wedge this ring sample is responsible for.

    A polar boundary joins its samples with straight chords, and at a corner
    the rays graze almost tangentially — BOUGH_UPPER's north-west corner sits
    in a window barely a tenth of a degree wide. Taking the reach on the exact
    bearing lets the chord cut inside the corner and leaves the player a patch
    of deck with no wood under it. Taking the furthest point in the wedge
    cannot: the chord is then always outside the rect.
    """
    step = math.pi / TIER_NA
    return max(
        rect_reach(theta + k * step / 2.0, x0, x1, y0, y1) for k in range(-2, 3)
    )
# The low tier carries the tree's widest reach, which also fixes the bounding
# box symmetric about the bole; the upper tier is a single limb heading east,
# so it gets a collar and little else on its blind side.
TIER_STYLE = {
    "BOUGH_LOW": dict(collar=0.55, notch=0.14, tip=2.95, reach_out=HALF_X, thick=1.45),
    "BOUGH_CROWN": dict(collar=0.50, notch=0.12, tip=1.95, reach_out=None, thick=1.20),
    "BOUGH_UPPER": dict(collar=0.30, notch=0.10, tip=1.45, reach_out=None, thick=0.95),
}

# How deep the gullies between limbs are allowed to cut into the walkable part
# of a tier. Well inside the tolerance a boot hides, and it is the difference
# between a stack of platters and a knot of limbs grown together.
GULLY_OVER_DECK = 0.12

for tier in TIERS:
    style = TIER_STYLE.get(tier["id"], dict(collar=0.45, margin=(0.4, 1.2), reach_out=None, thick=1.1))
    ty = tier["y"]
    x0, x1, y0, y1 = game_rect_to_blender(tier)
    collar = bole_radius(ty) + style["collar"]
    inner = bole_radius(ty) * 0.80
    lobes = RNG.randint(7, 9)
    phase = RNG.random() * math.tau
    if style["reach_out"] is not None:
        # Eight limbs on a zero phase puts a centreline on each of the four
        # cardinals. The plan-taper below gathers a ring toward the nearest
        # centreline, and a centreline is the one bearing it cannot move — so
        # the four limbs that fix the bounding box stay exactly where the
        # symmetry needs them.
        lobes, phase = 8, 0.0
    harmonic = RNG.random() * math.tau

    # Two widths of the same limb field. The soft one shapes the top ridging
    # and the underside, which want to be broad and rolling. The sharp one sets
    # how far the wood runs out past the deck, and it has to be narrow: a broad
    # one fans the tier into a disc that reaches the canopy, which is what turns
    # the tree into a pagoda. Past the deck the eye should see slender limbs
    # with air between them, and the plate should stop where the player does.
    reaches, radii, soft, sharp = [], [], [], []
    for i in range(TIER_NA):
        theta = 2.0 * math.pi * i / TIER_NA
        reach = reach_over_wedge(theta, x0, x1, y0, y1)
        base = 0.5 + 0.5 * math.cos(lobes * theta + phase)
        # Limbs of one length would read as a cog. The second harmonic gives
        # each one its own reach, the way a real crown is never even.
        vary = 0.55 + 0.45 * (0.5 + 0.5 * math.sin(3.0 * theta + harmonic))
        radius = max(reach, collar) + style["notch"] + base ** 4.5 * style["tip"] * vary
        reaches.append(reach)
        radii.append(radius)
        soft.append(base ** 1.3)
        sharp.append(base ** 4.5)
    radii = smooth_ring(radii, passes=1)

    if style["reach_out"] is not None:
        # Four limbs run right out to the canopy edge. They are what makes the
        # bounding box exactly symmetric about the bole, so the trunk lands on
        # its own collision rather than a few centimetres off it — which means
        # they have to be applied after the smoothing pass, not before it, or
        # the smoothing pulls the tips back in and the symmetry is lost.
        for i in range(TIER_NA):
            theta = 2.0 * math.pi * i / TIER_NA
            cardinal = min(abs(math.cos(theta)), abs(math.sin(theta)))
            pull = max(0.0, 1.0 - cardinal / 0.34) ** 2
            radii[i] = radii[i] * (1.0 - pull) + style["reach_out"] * pull

    def limb_axis(theta):
        """The nearest limb centreline to this bearing."""
        k = round((lobes * theta + phase) / (2.0 * math.pi))
        return (2.0 * math.pi * k - phase) / lobes

    rings_top, rings_bottom = [], []
    for step in range(TIER_NR + 1):
        u = step / TIER_NR
        top_ring, bottom_ring = [], []
        for i in range(TIER_NA):
            theta = 2.0 * math.pi * i / TIER_NA
            outer = radii[i]
            r = inner + (outer - inner) * u ** 1.15
            peak = soft[i]

            # Past the deck, gather the ring toward the limb centrelines so the
            # limb narrows in plan as it thins. Without this it keeps its full
            # angular width all the way out and reads as a flat blade. The
            # gather is zero over the deck itself, so it cannot uncover the
            # rect the collision was authored against.
            # Held off for a further 150mm past the rect. The gather is decided
            # on the pre-warp bearing and judged on the post-warp one, and with
            # no margin between them a grid corner can fall through the sliver.
            rough = max(0.0, r - max(reaches[i], collar) - 0.15)
            gather = 0.62 * (rough / (rough + 1.2))
            axis_theta = limb_axis(theta)
            theta = axis_theta + (theta - axis_theta) * (1.0 - gather)

            # Everything below is measured on the bearing the vertex actually
            # ends up on. Using the pre-gather bearing put points a quarter of
            # a metre off their deck, because the rect it was compared against
            # was not the rect underneath it any more.
            reach = reach_over_wedge(theta, x0, x1, y0, y1)
            past = max(0.0, r - max(reach, collar))

            # Top: ridged along each limb, gullied between them. Capped tight
            # over the authored deck and allowed to open right up past it.
            ceiling = (
                GULLY_OVER_DECK if r <= reach
                else min(0.45, GULLY_OVER_DECK + 0.5 * past)
            )
            dip = 0.015 + (1.0 - peak) * (ceiling - 0.015) * (0.30 + 0.70 * u)
            # Past the deck the limb arches down hard. Nothing else breaks the
            # dead horizontal line three stacked tiers otherwise draw.
            droop = 0.34 * past ** 1.45

            # Underside: a fat round tube under each limb, thinning to a web
            # between them. This is what stops the tier reading as a platter —
            # in silhouette and from below the eye sees limbs, not a slab.
            core = 0.20 + style["thick"] * (1.0 - u) ** 1.6
            web = 0.13 + 0.34 * (1.0 - u) ** 1.3
            thickness = web + max(0.0, core - web) * peak ** 1.1
            top_z = ty - dip - droop
            top_ring.append(Vector((math.cos(theta) * r, math.sin(theta) * r, top_z)))
            bottom_ring.append(
                Vector((math.cos(theta) * r, math.sin(theta) * r, top_z - thickness))
            )
        rings_top.append(top_ring)
        rings_bottom.append(bottom_ring)

    scale_uv = 0.55
    add_grid(rings_top, uv_of=lambda j, i, s=scale_uv: bark_uv(
        rings_top[j][i].x * s, rings_top[j][i].y * s))
    add_grid(list(reversed(rings_bottom)), uv_of=lambda j, i, s=scale_uv: bark_uv(
        rings_bottom[len(rings_bottom) - 1 - j][i].x * s,
        rings_bottom[len(rings_bottom) - 1 - j][i].y * s))
    add_grid([rings_top[-1], rings_bottom[-1]], uv_of=lambda j, i: bark_uv(i * 0.22, j * 0.5))
    # The inner edge is left open on purpose. It sits inside the bole, so it is
    # never seen, and a wall there is the first thing an outward probe from the
    # bole axis hits — which reads as a trunk far thinner than the one authored.
    log(f"{tier['id']}: y={ty} radius {min(radii):.2f}..{max(radii):.2f}m, {lobes} lobes")

bmesh.ops.remove_doubles(built, verts=list(built.verts), dist=1e-4)
bmesh.ops.recalc_face_normals(built, faces=list(built.faces))

authored_mesh = bpy.data.meshes.new("elm-authored")
built.to_mesh(authored_mesh)
built.free()
authored = bpy.data.objects.new("elm-authored", authored_mesh)
bpy.context.scene.collection.objects.link(authored)
if material:
    authored.data.materials.append(material)
for poly in authored.data.polygons:
    poly.use_smooth = True
log("authored", sum(len(p.vertices) - 2 for p in authored.data.polygons), "tris")


# ---------------------------------------------------------------------------
# 7. Join, shrink the texture, export
# ---------------------------------------------------------------------------

bpy.ops.object.select_all(action="DESELECT")
tree.select_set(True)
authored.select_set(True)
bpy.context.view_layer.objects.active = tree
bpy.ops.object.join()
final = bpy.context.view_layer.objects.active
final.name = "liberty-elm-hero"

for image in bpy.data.images:
    if image.size[0] > MAX_TEX or image.size[1] > MAX_TEX:
        image.scale(min(image.size[0], MAX_TEX), min(image.size[1], MAX_TEX))
        log("texture scaled to", image.size[0], "x", image.size[1])

# Bisecting leaves vertices behind that belong to no face. The exporter drops
# them, so they cost nothing at runtime, but they do sit in the bounding box
# Blender measures — which is how the reported height and the shipped height
# came to disagree by 35mm.
clean = bmesh.new()
clean.from_mesh(final.data)
loose = [v for v in clean.verts if not v.link_faces]
bmesh.ops.delete(clean, geom=loose, context="VERTS")
clean.to_mesh(final.data)
clean.free()
final.data.update()
log("dropped", len(loose), "loose vertices")

lo, hi = bounds(final)
size = hi - lo
log(f"FINAL_SIZE x={size[0]:.3f} y={size[1]:.3f} z={size[2]:.3f}")
log(f"FINAL_CENTRE x={(lo[0] + hi[0]) / 2:+.4f} y={(lo[1] + hi[1]) / 2:+.4f} (want 0, 0)")
log("FINAL_TRIS", sum(len(p.vertices) - 2 for p in final.data.polygons))

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
final.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_yup=True,
    export_animations=False,
    export_image_format="JPEG",
    export_jpeg_quality=82,
    use_selection=True,
)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
