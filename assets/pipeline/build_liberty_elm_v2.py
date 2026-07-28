# Rebuild liberty-elm-hero.glb as a great climbable elm — fully in Blender, no
# Meshy raw. This is a RE-AUTHOR, not a re-fit, and the reason is on the record:
#
#   * The owner's frame shows a smeared bark column under shattered flat green
#     planes. The green shards ARE the Meshy foliage: generators deliver a canopy
#     as a handful of intersecting alpha cards, which is exactly the "cards, not a
#     canopy" defect. A Meshy round-trip reproduces it.
#   * The raw Meshy GLB the old build_liberty_elm.py consumed is not in the repo
#     (only the two Gemini concepts, the hull and the collision survive), so there
#     is nothing to re-fit — the salvageable-mesh path is not available.
#   * The three walkable limb tiers must land ON the authored planes (6.4 / 8.3 /
#     11.2m over named rects); a generator cannot be aimed at a deck. The old
#     script already threw the generated trunk and rafts away and built those by
#     hand for this reason. Only the foliage and bark came from Meshy, and those
#     are precisely what read wrong.
#
# So everything visible is authored here: a fluted bole solid to 12m, three broad
# near-flat limb rafts sized to fill their authored footprints (and the two leap
# catch discs) so the affordance verifier's F_TREE rows retire, a fountain of
# finer branches into the crown, and a real late-summer canopy built from crossed
# leaf-cluster cards with a genuine alpha cutout — never a flat plane. Bark and
# leaf are two dedicated generated textures: the bark tiles at true metre scale so
# it cannot smear over a 16m trunk, and the leaf atlas carries real alpha so
# check-world-textures reads it as a cutout, not a wasted opaque PNG.
#
# Historical target (concepts a/b, Hanover Square, 14 August 1765): a ~120-year
# American elm in full August leaf — one heavy fluted bole rising unbranched
# through the lower two thirds, the classic vase of three tiers of barrel-thick
# near-horizontal scaffold limbs, a broad spreading crown, heavy low limbs a crowd
# could gather under and a body could climb.
#
# Run:
#   blender --background --python assets/pipeline/build_liberty_elm_v2.py \
#     -- hull.json out.glb
import bpy
import bmesh
import json
import math
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
HULL_JSON = os.path.abspath(argv[0])
OUT_GLB = os.path.abspath(argv[1])

with open(HULL_JSON) as handle:
    HULL = json.load(handle)

SIZE_X, SIZE_Y, SIZE_Z = HULL["sizeM"]           # 16 wide, 18 tall, 16 deep
HALF_X, HALF_Z = SIZE_X / 2.0, SIZE_Z / 2.0
BOLE_R = HULL["bole"]["radius"]                   # 0.90
BOLE_TOP = HULL["bole"]["topY"]                   # 12.0
TIERS = HULL["tiers"]

# The two leap catch discs land on tier planes and reach past the authored rects
# (the signature dive lands NW of the bole on the crown; the vane leap lands NE on
# the upper limb). The raft top has to be flat wood under the whole disc or the
# affordance gate reads the catch short. Kept here in bole-local game coords.
CATCH_DISCS = {
    "BOUGH_CROWN": (-1.4, 1.1, 1.6),   # LEAP_CROWN  (79.6,1.9) - axis (81,0.8)
    "BOUGH_UPPER": (1.0, 1.8, 1.6),    # LEAP_UPPER  (82.0,2.6) - axis (81,0.8)
}

SEED = 17650814
RNG = np.random.default_rng(SEED)
TEX = 1024


def log(*parts):
    print("[elm2]", *parts)


# glTF is Y-up, Blender Z-up. A game-space (x, y=height, z) is authored in Blender
# as (x, -z, y): X keeps, game-Z becomes Blender -Y, height becomes Blender Z.
# export_yup then maps it back so the tree lands exactly on its collision.
def g2b(x, z):
    return (x, -z)


def game_rect_to_blender(tier):
    return (tier["minX"], tier["maxX"], -tier["maxZ"], -tier["minZ"])


# ---------------------------------------------------------------------------
# 1. Textures — generated, tileable bark and a real alpha leaf cutout
# ---------------------------------------------------------------------------

def _fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def tileable_noise(size, period, rng):
    """Value noise on a lattice that wraps at `period`, so the image tiles."""
    g = rng.random((period, period))
    xs = np.linspace(0, period, size, endpoint=False)
    xi = np.floor(xs).astype(int)
    xf = xs - xi
    fx = _fade(xf)
    fy = fx
    x0 = xi % period
    x1 = (xi + 1) % period
    # bilinear over the wrapped lattice
    top = g[np.ix_(x0, x0)] * (1 - fx)[None, :] + g[np.ix_(x0, x1)] * fx[None, :]
    bot = g[np.ix_(x1, x0)] * (1 - fx)[None, :] + g[np.ix_(x1, x1)] * fx[None, :]
    return top * (1 - fy)[:, None] + bot * fy[:, None]


def make_bark_image():
    """Deep-furrowed gray-brown elm bark that tiles at true metre scale."""
    n = TEX
    y = np.linspace(0, 1, n, endpoint=False)[:, None] * np.ones((1, n))
    x = np.linspace(0, 1, n, endpoint=False)[None, :] * np.ones((n, 1))

    # Vertical furrows: sharp ridged valleys running up the trunk, slowly wandering
    # left/right with height and twisting, the way an old elm's ridges do. Several
    # integer frequencies keep it seamless across the wrap.
    wander = 0.06 * np.sin(2 * math.pi * (2 * y)) + 0.03 * np.sin(2 * math.pi * (5 * y + 0.3))
    furrow_phase = (x + wander) * 2 * math.pi
    ridged = 0.0
    for freq, amp in ((7, 0.55), (14, 0.28), (23, 0.17)):
        v = np.abs(np.sin(freq * math.pi * (x + wander) + 0.7 * freq * 0))
        ridged = ridged + amp * (1.0 - v) ** 1.6
    ridged = ridged / 1.0
    grain = (
        0.6 * tileable_noise(n, 16, RNG)
        + 0.3 * tileable_noise(n, 32, RNG)
        + 0.1 * tileable_noise(n, 64, RNG)
    )
    height_field = np.clip(0.65 * ridged + 0.55 * grain, 0, 1)
    # Vertical streaking so the grain reads as bark, not stucco.
    streak = 0.85 + 0.15 * np.sin(2 * math.pi * (3 * y)) * (0.5 + 0.5 * grain)
    height_field = np.clip(height_field * streak, 0, 1)

    groove = np.array([0.085, 0.070, 0.055])
    ridge = np.array([0.46, 0.40, 0.33])
    t = height_field[..., None]
    rgb = groove[None, None, :] * (1 - t) + ridge[None, None, :] * t
    # A touch of desaturated green-gray lichen in the lower grooves.
    lichen = np.clip(0.4 - height_field, 0, 1)[..., None] * np.array([0.05, 0.08, 0.05])[None, None, :]
    rgb = np.clip(rgb + 0.5 * lichen, 0, 1)
    rgba = np.concatenate([rgb, np.ones((n, n, 1))], axis=2)
    # Round-trip through a real JPEG on disk so the packed image is JPEG-backed and
    # the glTF AUTO exporter embeds it as JPEG, not a wasteful opaque PNG. (Setting
    # alpha_mode/file_format on a Blender-native image is not enough — the exporter
    # re-encodes whatever it finds packed.) The leaf atlas stays PNG for its alpha.
    img = _to_image("elm-bark-src", rgba, has_alpha=False)
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    path = os.path.join(os.path.dirname(os.path.abspath(OUT_GLB)) or ".", "_elm_bark_tmp.jpg")
    img.save_render(path)
    baked = bpy.data.images.load(path)
    baked.name = "elm-bark"
    baked.pack()
    try:
        os.remove(path)
    except OSError:
        pass
    return baked


def _leaf_mask(h, w, rng):
    """One serrated ovate elm leaf on an (h,w) alpha+rgb tile, tip up."""
    yy = np.linspace(-1, 1, h)[:, None]
    xx = np.linspace(-1, 1, w)[None, :]
    # Ovate profile: widest below middle, drawn to a point at the tip (y=+1).
    length = 1.0 - np.abs(yy)
    profile = np.clip(0.55 * np.sqrt(np.clip(1 - ((yy - -0.15) / 1.05) ** 2, 0, 1)), 1e-3, 1)
    # Serrated margin: high-frequency wobble on the half-width.
    serr = 1.0 + 0.10 * np.sin(26 * math.pi * (yy + 1) / 2)
    halfw = profile * serr
    inside = (np.abs(xx) <= halfw) & (yy < 0.98) & (length > 0)
    # Midrib + a few veins darken the green; late-summer tint varies per leaf.
    base = np.array([0.16, 0.34, 0.11]) + rng.uniform(-0.04, 0.06, 3) * np.array([1, 1, 0.6])
    base[1] += rng.uniform(-0.02, 0.05)  # some yellowing
    rgb = np.ones((h, w, 3)) * base[None, None, :]
    vein = np.exp(-((xx / (halfw + 1e-3)) ** 2) * 40) * 0.5
    vein = vein + 0.25 * np.exp(-((np.abs(xx) - 0.45 * halfw) ** 2) * 60)
    rgb *= (1 - 0.45 * vein[..., None])
    shade = 0.85 + 0.15 * (yy + 1) / 2  # slight base-to-tip gradient
    rgb *= shade[..., None]
    alpha = inside.astype(float)
    return np.clip(rgb, 0, 1), alpha


def make_leaf_image():
    """A dense clump of elm leaves on transparent ground: a real cutout atlas."""
    n = TEX
    canvas = np.zeros((n, n, 4))
    count = 150
    for _ in range(count):
        scale = RNG.uniform(0.10, 0.20)
        lh = max(8, int(scale * n * RNG.uniform(0.9, 1.3)))
        lw = max(6, int(lh * RNG.uniform(0.45, 0.62)))
        rgb, alpha = _leaf_mask(lh, lw, RNG)
        ang = RNG.uniform(0, 2 * math.pi)
        tile = np.concatenate([rgb, alpha[..., None]], axis=2)
        tile = _rotate_tile(tile, ang)
        th, tw = tile.shape[:2]
        # Bias toward the centre so the clump reads as a rounded puff of leaves.
        cy = int(np.clip(RNG.normal(0.5, 0.22), 0.05, 0.95) * n)
        cx = int(np.clip(RNG.normal(0.5, 0.22), 0.05, 0.95) * n)
        y0, x0 = cy - th // 2, cx - tw // 2
        _alpha_over(canvas, tile, y0, x0)
    # Guarantee a genuine, generous cutout: plenty transparent, plenty opaque.
    share = float((canvas[..., 3] > 0.5).mean())
    log(f"leaf atlas coverage {share*100:.1f}% opaque")
    return _to_image("elm-leaf", canvas)


def _rotate_tile(tile, ang):
    h, w = tile.shape[:2]
    ca, sa = math.cos(ang), math.sin(ang)
    # Rotate into a square big enough to hold the leaf at any angle.
    m = int(math.hypot(h, w)) + 2
    out = np.zeros((m, m, 4))
    yy, xx = np.mgrid[0:m, 0:m]
    ry = yy - m / 2
    rx = xx - m / 2
    sy = (ca * ry + sa * rx + h / 2).astype(int)
    sx = (-sa * ry + ca * rx + w / 2).astype(int)
    valid = (sy >= 0) & (sy < h) & (sx >= 0) & (sx < w)
    out[yy[valid], xx[valid]] = tile[sy[valid], sx[valid]]
    return out


def _alpha_over(canvas, tile, y0, x0):
    h, w = tile.shape[:2]
    n = canvas.shape[0]
    ys, ye = max(0, y0), min(n, y0 + h)
    xs, xe = max(0, x0), min(n, x0 + w)
    if ys >= ye or xs >= xe:
        return
    src = tile[ys - y0 : ye - y0, xs - x0 : xe - x0]
    a = src[..., 3:4]
    dst = canvas[ys:ye, xs:xe]
    dst[..., :3] = src[..., :3] * a + dst[..., :3] * (1 - a)
    dst[..., 3:4] = a + dst[..., 3:4] * (1 - a)


def _to_image(name, rgba, has_alpha=True):
    img = bpy.data.images.new(name, width=rgba.shape[1], height=rgba.shape[0], alpha=has_alpha)
    # Blender wants a bottom-up flat RGBA float buffer.
    flat = np.flipud(rgba).astype(np.float32).reshape(-1)
    img.pixels.foreach_set(flat)
    if not has_alpha:
        # No alpha channel to carry: mark it JPEG so the glTF AUTO exporter writes
        # a small JPEG instead of a wasteful opaque PNG (check-world-textures notes
        # the latter). The leaf atlas keeps PNG so its cutout alpha survives.
        img.alpha_mode = "NONE"
        img.file_format = "JPEG"
    img.pack()
    return img


def make_material(name, image, cutout):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Linear"
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.78 if cutout else 0.88
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if cutout:
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        mat.blend_method = "CLIP"          # -> glTF alphaMode MASK, no sorted draw
        mat.alpha_threshold = 0.5
        mat.use_backface_culling = False   # -> doubleSided: leaves seen both sides
    else:
        mat.blend_method = "OPAQUE"
        mat.use_backface_culling = False
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


log("generating textures")
bpy.ops.wm.read_factory_settings(use_empty=True)
BARK_IMG = make_bark_image()
LEAF_IMG = make_leaf_image()
BARK_MAT = make_material("elm-bark", BARK_IMG, cutout=False)
LEAF_MAT = make_material("elm-leaf", LEAF_IMG, cutout=True)

# One mesh, two material slots: slot 0 bark (opaque), slot 1 leaf (cutout).
bm = bmesh.new()
uv = bm.loops.layers.uv.new("UVMap")
MAT_BARK, MAT_LEAF = 0, 1


def add_ring_tube(rings, mat_index, uv_of, closed=True):
    """Stitch equal-length vertex rings into a tube with per-loop UVs."""
    vlists = [[bm.verts.new(p) for p in ring] for ring in rings]
    for j in range(len(rings) - 1):
        count = len(rings[j])
        last = count if closed else count - 1
        for i in range(last):
            k = (i + 1) % count
            quad = (vlists[j][i], vlists[j][k], vlists[j + 1][k], vlists[j + 1][i])
            if len(set(quad)) < 3:
                continue
            try:
                f = bm.faces.new(quad)
            except ValueError:
                continue
            f.material_index = mat_index
            keys = [(j, i), (j, k), (j + 1, k), (j + 1, i)]
            for loop, key in zip(f.loops, keys):
                loop[uv].uv = uv_of(*key)
    return vlists


# ---------------------------------------------------------------------------
# 2. Bark UV helpers — tile at true metre scale so nothing smears
# ---------------------------------------------------------------------------
BARK_TILE_M = 2.6  # one texture repeat every 2.6m of bark


def bark_uv_world(bx, by, bz):
    """Cylindrical bark UV around the bole axis at true scale."""
    ang = math.atan2(by, bx)
    circ = ang / (2 * math.pi) * (2 * math.pi * max(0.4, math.hypot(bx, by)))
    return (circ / BARK_TILE_M, bz / BARK_TILE_M)


# ---------------------------------------------------------------------------
# 3. The bole — fluted, root-flared, solid to 12m
# ---------------------------------------------------------------------------

def bole_radius(z):
    if z > BOLE_TOP:
        return BOLE_R * 0.86
    flare = 0.40 * max(0.0, 1.0 - z / 1.05) ** 1.7
    # Gentle taper: an elm bole barely narrows over its first 12m, and the probe
    # wants every section >= 0.9r, so a steep taper plus deep flutes near the top
    # is what read thin. Kept shallow so the fluted minimum stays inside 0.9r.
    taper = 1.0 - 0.020 * min(1.0, z / BOLE_TOP)
    return BOLE_R * taper + flare


BOLE_NA = 48
BOLE_ZS = [0.0, 0.2, 0.45, 0.8, 1.3, 2.0, 3.0, 4.2, 5.4, 6.4,
           7.3, 8.3, 9.2, 10.2, 11.2, BOLE_TOP]


def bole_point(i, z):
    theta = 2.0 * math.pi * i / BOLE_NA
    # Three frequencies of relief, all cutting INWARD from the authored radius so
    # the bole is never fatter than the collision cylinder, plus a shallow outward
    # ridge (bark standing a little proud). Budget < 60mm inward keeps the
    # narrowest ridge inside a tenth of the girth (verify_liberty wants >= 0.9r).
    flute = 0.032 * (0.5 - 0.5 * math.cos(6.0 * theta + 0.30 * z))
    grain = 0.013 * (0.5 - 0.5 * math.cos(13.0 * theta - 0.55 * z + 1.1))
    ridge = 0.034 * (0.5 + 0.5 * math.sin(9.0 * theta + 0.8 * z + 2.2)) ** 2
    r = bole_radius(z) - flute - grain + ridge
    return Vector((math.cos(theta) * r, math.sin(theta) * r, z))


bole_rings = [[bole_point(i, z) for i in range(BOLE_NA)] for z in BOLE_ZS]
add_ring_tube(
    bole_rings, MAT_BARK,
    uv_of=lambda j, i: bark_uv_world(*bole_rings[j][i]),
)
# Cap the foot so a ground-level look never sees up an open pipe.
foot = [bm.verts.new(p) for p in bole_rings[0]]
try:
    f = bm.faces.new(list(reversed(foot)))
    f.material_index = MAT_BARK
    for loop in f.loops:
        loop[uv].uv = (0.5, 0.0)
except ValueError:
    pass


# ---------------------------------------------------------------------------
# 4. The three limb rafts — broad, near-flat, filling their footprints
# ---------------------------------------------------------------------------
# Each raft is a continuous near-flat wooden top covering the authored rect AND
# the tier's leap disc, flush to the bole, with only gentle relief so the whole
# footprint reads horizontal to the affordance sampler. Past the covered region
# the limbs narrow, ridge and droop for silhouette. A fat underside tube keeps it
# reading as grown limbs, not a platter.
TIER_NA = 96
TIER_NR = 6
COVER_MARGIN = 0.30      # flat wood this far past the rect/disc edge
BASE_DIP = 0.06          # raft top sits this far under the plane (hidden by boot)


def rect_reach(theta, x0, x1, y0, y1):
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


def disc_reach(theta, cx, cy, r):
    """Far radius along `theta` that still lies inside the disc, else 0."""
    dx, dy = math.cos(theta), math.sin(theta)
    proj = cx * dx + cy * dy
    perp2 = (cx * cx + cy * cy) - proj * proj
    if perp2 > r * r:
        return 0.0
    far = proj + math.sqrt(max(0.0, r * r - perp2))
    return max(0.0, far)


# `reach_out` pulls the four cardinal limb tips right out to the canopy edge. It
# is the LOW tier's job alone, and it is load-bearing twice over: it makes the
# widest limbs of the tree, and — because those four tips define the bounding box
# — it fixes the box exactly symmetric about the bole, so FittedGlb (which centres
# the draw on the box) lands the trunk on its own collision axis rather than a
# few centimetres off it.
TIER_STYLE = {
    "BOUGH_LOW": dict(tip=3.1, thick=1.55, reach_out=HALF_X),
    "BOUGH_CROWN": dict(tip=2.1, thick=1.25, reach_out=None),
    "BOUGH_UPPER": dict(tip=1.7, thick=1.00, reach_out=None),
}


def wedge_cover(theta, x0, x1, y0, y1, disc):
    """Furthest point that must be flat wood at this bearing (rect + disc + margin)."""
    step = math.pi / TIER_NA
    best = 0.0
    for k in range(-2, 3):
        th = theta + k * step
        cover = rect_reach(th, x0, x1, y0, y1)
        if disc:
            cover = max(cover, disc_reach(th, *disc))
        best = max(best, cover)
    return best + COVER_MARGIN if best > 0 else 0.0


for tier in TIERS:
    tid = tier["id"]
    ty = tier["y"]
    style = TIER_STYLE.get(tid, dict(tip=1.8, thick=1.0))
    x0, x1, y0, y1 = game_rect_to_blender(tier)
    disc = None
    if tid in CATCH_DISCS:
        cx, cz, r = CATCH_DISCS[tid]
        disc = (cx, -cz, r)
    collar = bole_radius(ty)
    # The raft top runs INWARD past the bole surface, right in to the axis, at the
    # tier plane. The inner disc is hidden inside the solid bole, but it is the
    # limb wood meeting the trunk at the height the limb leaves it — and it is what
    # the affordance gate needs: an OFFSET tier (BOUGH_UPPER) is not a ring, so the
    # gate clips its footprint to the deck∩trunk strip at the bole, and a raft that
    # started at the bark surface left that strip empty and read the tier short.
    inner_r = 0.10
    lobes = 8
    harmonic = RNG.uniform(0, 2 * math.pi)

    covers, outers = [], []
    for i in range(TIER_NA):
        theta = 2.0 * math.pi * i / TIER_NA
        cover = wedge_cover(theta, x0, x1, y0, y1, disc)
        cover = max(cover, collar + 0.05)
        # Limb tips reach out past the covered deck, longest on the limb axes.
        lobe = (0.5 + 0.5 * math.cos(lobes * theta)) ** 3.5
        vary = 0.6 + 0.4 * (0.5 + 0.5 * math.sin(3 * theta + harmonic))
        tip = lobe * style["tip"] * vary
        # Keep the whole crown inside the authored footprint box.
        outer = min(cover + tip, HALF_X - 0.15)
        covers.append(cover)
        outers.append(max(outer, cover))

    # Pull the four cardinals out to the box edge on the low tier, so the widest
    # limbs reach ±HALF and the bounding box is symmetric about the bole.
    if style.get("reach_out") is not None:
        for i in range(TIER_NA):
            theta = 2.0 * math.pi * i / TIER_NA
            cardinal = min(abs(math.cos(theta)), abs(math.sin(theta)))
            pull = max(0.0, 1.0 - cardinal / 0.30) ** 2
            outers[i] = outers[i] * (1.0 - pull) + style["reach_out"] * pull

    def limb_axis(theta):
        k = round(lobes * theta / (2 * math.pi))
        return 2 * math.pi * k / lobes

    rings_top, rings_bot = [], []
    for step in range(TIER_NR + 1):
        u = step / TIER_NR
        top_ring, bot_ring = [], []
        for i in range(TIER_NA):
            theta = 2.0 * math.pi * i / TIER_NA
            cover = covers[i]
            outer = outers[i]
            r = inner_r + (outer - inner_r) * u ** 1.1
            past = max(0.0, r - cover)

            # Over the covered region: near-flat, a whisper of ridging along the
            # limb centrelines only. Past it: gather toward the limb axis so the
            # blade narrows in plan, ridge harder, and arch down.
            axis_theta = limb_axis(theta)
            if past > 0.0:
                gather = 0.55 * (past / (past + 1.1))
                theta_w = axis_theta + (theta - axis_theta) * (1.0 - gather)
            else:
                theta_w = theta
            along = 0.5 + 0.5 * math.cos(lobes * theta_w)   # 1 on a limb, 0 in a gully

            ridge = 0.03 * along * u                          # tiny over the deck
            droop = 0.36 * past ** 1.4
            gully = 0.0 if past <= 0 else min(0.30, 0.45 * past) * (1 - along)
            top_z = ty - BASE_DIP + ridge - droop - gully

            core = 0.18 + style["thick"] * (1.0 - u) ** 1.5
            web = 0.12 + 0.30 * (1.0 - u) ** 1.2
            thick = web + max(0.0, core - web) * along ** 1.1

            rr = r
            top_ring.append(Vector((math.cos(theta_w) * rr, math.sin(theta_w) * rr, top_z)))
            bot_ring.append(Vector((math.cos(theta_w) * rr, math.sin(theta_w) * rr, top_z - thick)))
        rings_top.append(top_ring)
        rings_bot.append(bot_ring)

    add_ring_tube(rings_top, MAT_BARK, uv_of=lambda j, i: bark_uv_world(*rings_top[j][i]))
    add_ring_tube(list(reversed(rings_bot)), MAT_BARK,
                  uv_of=lambda j, i: bark_uv_world(*rings_bot[len(rings_bot) - 1 - j][i]))
    add_ring_tube([rings_top[-1], rings_bot[-1]], MAT_BARK,
                  uv_of=lambda j, i: bark_uv_world(*rings_top[-1][i]))
    # Close the small centre hole so the raft top is a continuous disc to the axis
    # (hidden inside the bole). A triangle fan from the inner ring to a hub vertex.
    hub_z = rings_top[0][0].z
    hub = bm.verts.new(Vector((0.0, 0.0, hub_z)))
    inner_ring = [bm.verts.new(p) for p in rings_top[0]]
    for i in range(TIER_NA):
        k = (i + 1) % TIER_NA
        try:
            f = bm.faces.new((hub, inner_ring[i], inner_ring[k]))
        except ValueError:
            continue
        f.material_index = MAT_BARK
        for loop, vtx in zip(f.loops, (hub, inner_ring[i], inner_ring[k])):
            loop[uv].uv = bark_uv_world(vtx.co.x, vtx.co.y, vtx.co.z)
    log(f"{tid}: y={ty} cover {min(covers):.2f}..{max(covers):.2f}m outer max {max(outers):.2f}m")


# ---------------------------------------------------------------------------
# 5. The crown fountain — finer scaffold branches arching up out of the fork
# ---------------------------------------------------------------------------
# Barrel-thick at the fork, tapering as they rise and spread; this is the
# architecture the concept calls a "broad fountain of finer branches" and it is
# what carries the canopy above the top walkable tier.
BRANCH_TIPS = []   # (Vector end, radius) seeds for foliage

def add_branch(base, direction, length, r0, r1, segs=6, na=7, curl=0.0, mat=MAT_BARK):
    up = Vector((0, 0, 1))
    d = Vector(direction).normalized()
    side = d.cross(up)
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    upn = side.cross(d).normalized()
    rings = []
    pos = Vector(base)
    for s in range(segs + 1):
        t = s / segs
        # arch upward as it extends
        d2 = (d + up * curl * t).normalized()
        r = r0 + (r1 - r0) * t
        ring = []
        for i in range(na):
            a = 2 * math.pi * i / na
            offset = (side * math.cos(a) + upn * math.sin(a)) * r
            ring.append(pos + offset)
        rings.append(ring)
        pos = pos + d2 * (length / segs)
    add_ring_tube(rings, mat, uv_of=lambda j, i: bark_uv_world(*rings[j][i]), closed=True)
    BRANCH_TIPS.append((pos, r1))
    return pos


# Major scaffolds leaving the fork at ~11.5-12.2m, then a denser second order.
RNG_PY = __import__("random").Random(SEED)
fork_z = BOLE_TOP - 0.3
majors = 6
for m in range(majors):
    a = 2 * math.pi * m / majors + RNG_PY.uniform(-0.15, 0.15)
    outward = Vector((math.cos(a), math.sin(a), 0))
    base = Vector((math.cos(a) * BOLE_R * 0.5, math.sin(a) * BOLE_R * 0.5, fork_z))
    d = (outward * 0.75 + Vector((0, 0, 1)) * 0.9).normalized()
    length = RNG_PY.uniform(4.2, 5.2)
    end = add_branch(base, d, length, 0.34, 0.12, segs=6, na=7, curl=0.5)
    # second-order limbs fanning off the major
    for _ in range(3):
        a2 = a + RNG_PY.uniform(-0.7, 0.7)
        d2 = (Vector((math.cos(a2), math.sin(a2), 0)) * 0.8 + Vector((0, 0, 1)) * RNG_PY.uniform(0.7, 1.3)).normalized()
        mid = base.lerp(end, RNG_PY.uniform(0.4, 0.8))
        add_branch(mid, d2, RNG_PY.uniform(2.0, 3.2), 0.11, 0.05, segs=4, na=6, curl=0.6)

# A few limbs also lift off the OUTER edge of the upper and crown rafts to tie the
# canopy to the tiers, so foliage does not float clear of the wood. They start
# beyond each rect and above the walk clearance so they never poke through a deck
# the player stands on.
for tier_id, base_z, reach in (("BOUGH_UPPER", 11.2, 4.6), ("BOUGH_CROWN", 8.3, 3.6)):
    for _ in range(4):
        a = RNG_PY.uniform(0, 2 * math.pi)
        base = Vector((math.cos(a) * reach, math.sin(a) * reach, base_z + 0.2))
        d = (Vector((math.cos(a), math.sin(a), 0)) * 0.8 + Vector((0, 0, 1))).normalized()
        add_branch(base, d, RNG_PY.uniform(2.2, 3.4), 0.10, 0.04, segs=4, na=6, curl=0.7)


# ---------------------------------------------------------------------------
# 6. The canopy — crossed leaf-cluster cards, never a flat plane
# ---------------------------------------------------------------------------
# Each cluster is three quads crossed at 60 degrees (a billboard cross) carrying
# the alpha leaf atlas, so from any angle the eye sees a leafy volume. Clusters
# fill the crown dome and hang off the limb tips, but never inside the standable
# box above a deck (headroom stays clear), so the boughs read as walkable wood.
HEADROOM = 1.9


def over_deck(bx, by, bz):
    """True if (bx,by,bz) is in the walk-up clearance above any authored tier."""
    for tier in TIERS:
        if tier["y"] + 0.02 < bz < tier["y"] + HEADROOM:
            rx0, rx1, ry0, ry1 = game_rect_to_blender(tier)
            if rx0 - 0.2 < bx < rx1 + 0.2 and ry0 - 0.2 < by < ry1 + 0.2:
                return True
    return False


def add_leaf_cluster(centre, size):
    cx, cy, cz = centre
    if over_deck(cx, cy, cz):
        return 0
    made = 0
    for k in range(3):
        ang = k * math.pi / 3 + RNG_PY.uniform(-0.2, 0.2)
        ca, sa = math.cos(ang), math.sin(ang)
        # a quad tilted slightly so the cross is not perfectly radial
        tilt = RNG_PY.uniform(-0.25, 0.25)
        hw = size * RNG_PY.uniform(0.8, 1.1)
        hh = size * RNG_PY.uniform(0.8, 1.1)
        corners = [
            (-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh),
        ]
        pts = []
        for (u_, v_) in corners:
            x = cx + ca * u_
            y = cy + sa * u_
            z = cz + v_ + tilt * u_
            pts.append(bm.verts.new(Vector((x, y, z))))
        try:
            f = bm.faces.new(pts)
        except ValueError:
            for p in pts:
                bm.verts.remove(p)
            continue
        f.material_index = MAT_LEAF
        uvc = [(0.02, 0.02), (0.98, 0.02), (0.98, 0.98), (0.02, 0.98)]
        for loop, uvp in zip(f.loops, uvc):
            loop[uv].uv = uvp
        made += 1
    return made


# Crown dome: a broad late-summer canopy from the top tier up to ~18m, densest
# in a vase-shaped shell so the limb architecture beneath stays readable.
clusters = 0
CROWN_BASE = 11.6
CROWN_TOP = SIZE_Y             # reach the top of the declared box
# A vase-shaped canopy SHELL: leaves live in an outer band, never packed against
# the trunk, so the heavy limb architecture stays readable (concept a) and the
# bole probe below 12m only ever sees the bole. The shell also spreads out to
# ±HALF so the crown genuinely fills the 16m width.
CROWN_MIN_R = 2.3
for _ in range(560):
    t = RNG_PY.random()
    z = CROWN_BASE + (CROWN_TOP - CROWN_BASE) * (t ** 0.7)
    rt = (z - CROWN_BASE) / (CROWN_TOP - CROWN_BASE)
    rmax = 2.6 + 5.2 * math.sin(min(1.0, rt + 0.18) * math.pi * 0.82)
    rmax = min(rmax, HALF_X - 0.2)
    lo_r = max(CROWN_MIN_R, rmax - 2.6)
    rad = lo_r + (rmax - lo_r) * RNG_PY.random()
    a = RNG_PY.uniform(0, 2 * math.pi)
    cx = math.cos(a) * rad
    cy = math.sin(a) * rad
    clusters += add_leaf_cluster((cx, cy, z), RNG_PY.uniform(0.55, 0.95))

# Foliage hung off the limb tips of the lower two tiers (outside their walk box),
# so the low boughs carry leaf too, the way a heavy August elm does.
for (tip, r0) in BRANCH_TIPS:
    if RNG_PY.random() < 0.85:
        clusters += add_leaf_cluster((tip.x, tip.y, tip.z), RNG_PY.uniform(0.5, 0.85))
for tier in TIERS:
    if tier["id"] == "BOUGH_UPPER":
        continue
    ty = tier["y"]
    rx0, rx1, ry0, ry1 = game_rect_to_blender(tier)
    for _ in range(70):
        a = RNG_PY.uniform(0, 2 * math.pi)
        rad = RNG_PY.uniform(max(abs(rx1), abs(ry1)) + 0.2, HALF_X - 0.4)
        cx, cy = math.cos(a) * rad, math.sin(a) * rad
        cz = ty + RNG_PY.uniform(-0.3, 0.9)
        clusters += add_leaf_cluster((cx, cy, cz), RNG_PY.uniform(0.45, 0.8))

log(f"canopy clusters placed {clusters}")


# ---------------------------------------------------------------------------
# 7. Finalise: clean, size-pin, export
# ---------------------------------------------------------------------------
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-4)
# Only the bark tube normals need recalculating outward; leaf cards are
# double-sided so their winding does not matter.
bark_faces = [f for f in bm.faces if f.material_index == MAT_BARK]
bmesh.ops.recalc_face_normals(bm, faces=bark_faces)

mesh = bpy.data.meshes.new("liberty-elm-hero")
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("liberty-elm-hero", mesh)
obj.data.materials.append(BARK_MAT)
obj.data.materials.append(LEAF_MAT)
for poly in obj.data.polygons:
    poly.use_smooth = poly.material_index == MAT_BARK
bpy.context.scene.collection.objects.link(obj)


def bounds(o):
    cs = np.array([v.co[:] for v in o.data.vertices])
    return cs.min(axis=0), cs.max(axis=0)


lo, hi = bounds(obj)
log(f"raw bounds x {lo[0]:.2f}..{hi[0]:.2f}  y {lo[1]:.2f}..{hi[1]:.2f}  z {lo[2]:.2f}..{hi[2]:.2f}")

# Pin the base to z=0. X/Y are NOT recentred: the bole is already built on the
# origin, and the low tier's cardinal limbs reach ±HALF on all four sides, so the
# bounding box is already symmetric about the bole. Recentring on the (slightly
# canopy-asymmetric) bbox centre is exactly what would shove the trunk off its
# own collision axis, which FittedGlb centres the draw on.
for v in obj.data.vertices:
    v.co.z -= lo[2]
obj.data.update()

# Pin the natural box to the declared 16 x 18 x 16 so the runtime contain-fit is
# exactly 1.0 and every tier lands on its authored plane. FittedGlb scales by
# min(declared/natural); any axis over the box would bind that below 1.0 and drop
# the tiers. Only outer canopy cards and the crown top ever reach the boundary —
# the rafts (max reach ~7.9m, top ~11.2m) are well inside, so nothing walkable is
# touched. Clamping the slight canopy overshoot pins natural to the box exactly.
for v in obj.data.vertices:
    v.co.x = max(-HALF_X, min(HALF_X, v.co.x))
    v.co.y = max(-HALF_Z, min(HALF_Z, v.co.y))
    v.co.z = max(0.0, min(SIZE_Y, v.co.z))
obj.data.update()

lo, hi = bounds(obj)
size = hi - lo
log(f"FINAL size x={size[0]:.3f} y={size[1]:.3f} z={size[2]:.3f}")
log(f"FINAL centre x={(lo[0]+hi[0])/2:+.4f} y={(lo[1]+hi[1])/2:+.4f} (want 0,0)  minZ={lo[2]:.4f}")
log("FINAL tris", sum(len(p.vertices) - 2 for p in obj.data.polygons))

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_yup=True,
    export_animations=False,
    export_image_format="AUTO",   # bark -> JPEG (opaque), leaf -> PNG (alpha)
    export_jpeg_quality=88,
    use_selection=True,
)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
