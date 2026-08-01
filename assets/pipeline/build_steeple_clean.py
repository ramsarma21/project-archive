# Author steeple-meetinghouse-climbable as a clean, box-accurate procedural GLB —
# a New England meeting-house steeple whose stacked rings match the level's
# authored decks EXACTLY, so verify_m1_steeple reads stone under every standable
# ring and the contain-fit is 1.0. Replaces the torn "pagoda" Meshy-family build
# (7,274 weld pairs, 802 zero-UV) the way the Liberty Elm was fixed: authored
# directly, outer faces only, no turned balusters (solid parapets), so the weld
# gate is clean.
#
# Geometry is read off packages/mission-m1 level/geometry.ts (asset plan centre =
# world (81,11.6); local coords below are world - centre):
#   tower core   x[-2,2]   d[-2,2]     0 .. 15.3
#   LOUVRE_SILL  x[-3.7,3.7] d[-3.7,3.7]  ring @ 14.0   (widest; pins the 7.4 box)
#   STEEPLE_GALLERY x[-2.7,2.7] d[-2.7,2.7] ring @ 15.8 (the leap-of-faith take-off)
#   lantern      x[0.4,1.6] d[-0.6,0.6]  15.8 .. 20.6   (shifted +1.0 in x)
#   STEEPLE_CROCKETS x[-0.4,2.4] d[-1.4,1.4] ring @ 18.2 (0.8 walk round the lantern)
#   STEEPLE_VANE x[-0.3,2.3] d[-1.3,1.3] ring @ 20.6     (0.8 walk, expert take-off)
#   spire        x[0.5,1.5] d[-0.5,0.5]  20.6 .. 30.0 (finial)
# Widths narrow monotonically 7.4>5.4>2.8>2.6 (the anti-pagoda invariant).
#
# Run: blender --background --python assets/pipeline/build_steeple_clean.py -- <out.glb>
import bpy
import bmesh
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
OUT_GLB = os.path.abspath(argv[0])
KEY = "steeple-meetinghouse-climbable"
SEED = 74011158
RNG = np.random.default_rng(SEED)
TEX = 1024

# PHOTOREAL: keep the clean, box-accurate, weld-clean FORM (rings at exact bands)
# and richen it — a weathered painted-clapboard atlas (grime/streaks) plus real
# slate and ashlar-stone atlases, a tower CLOCK, corner urn pinnacles and louvre
# keystones. This builder attaches NO normal map, so it is free of the glTF
# black-normal export bug (test_normal_export.py) — nothing to strip here.
PHOTOREAL = os.environ.get("PHOTOREAL", "") not in ("", "0", "false")

WBOX, HBOX, DBOX = 7.4, 30.0, 7.4          # declared sizeM


def log(*p):
    print(f"[{KEY}]", *p)


# ------------------------------------------------------------------- textures
def _fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def aniso(size, px, py, rng):
    g = rng.random((py, px))
    xs = np.linspace(0, px, size, endpoint=False); xi = np.floor(xs).astype(int); fx = _fade(xs - xi)
    x0, x1 = xi % px, (xi + 1) % px
    ys = np.linspace(0, py, size, endpoint=False); yi = np.floor(ys).astype(int); fy = _fade(ys - yi)
    y0, y1 = yi % py, (yi + 1) % py
    top = g[np.ix_(y0, x0)] * (1 - fx)[None, :] + g[np.ix_(y0, x1)] * fx[None, :]
    bot = g[np.ix_(y1, x0)] * (1 - fx)[None, :] + g[np.ix_(y1, x1)] * fx[None, :]
    return top * (1 - fy)[:, None] + bot * fy[:, None]


def _ss(a, b, t):
    t = np.clip((t - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def course_rgb(boards=8, photoreal=False):
    """The clapboard atlas: a near-white painted surface with horizontal course
    lines (reads as clapboard, louvre slats, lead seams alike) plus grain. When
    photoreal, add vertical water-streaks, broad soot blotches and a stronger
    course shadow so the painted timber reads weathered, not flat."""
    n = TEX
    v = np.linspace(0, 1, n, endpoint=False)[:, None]
    fb = v * boards; bf = fb - np.floor(fb)
    groove = (0.78 if photoreal else 0.84) + (0.22 if photoreal else 0.16) * _ss(0.0, 0.06, bf)
    base = np.full((n, n, 3), 0.98)
    rgb = base * (0.95 + 0.08 * aniso(n, 120, 120, RNG))[..., None]
    rgb = rgb * np.broadcast_to(groove, (n, n))[..., None]
    if photoreal:
        rgb *= (0.82 + 0.18 * aniso(n, 140, 5, RNG))[..., None]   # vertical streaks
        rgb *= (0.88 + 0.12 * aniso(n, 20, 20, RNG))[..., None]   # broad soiling
    return np.clip(rgb, 0, 1)


def slate_rgb(base):
    """Overlapping slate/lead courses: staggered rows, per-slate tone, a course-head
    shadow line (the overlap read), cold blue-grey tint."""
    n = TEX; NR, NS = 12, 16
    v = np.linspace(0, 1, n, endpoint=False)[:, None]; u = np.linspace(0, 1, n, endpoint=False)[None, :]
    fr = v * NR; row = np.floor(fr); rf = fr - row
    off = np.where(row % 2 == 0, 0.0, 0.5)
    fs = u * NS + off; sl = np.floor(fs); sf = fs - sl
    seed = np.sin(np.broadcast_to(row, (n, n)) * 11.1 + np.broadcast_to(sl, (n, n)) * 7.3) * 4373.1
    var = seed - np.floor(seed)
    rgb = np.array(base)[None, None, :] * (0.68 + 0.6 * var)[..., None]
    rgb = np.clip(rgb + (aniso(n, 130, 130, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    head = np.broadcast_to(_ss(0.0, 0.07, rf), (n, n))
    seam = _ss(0.0, 0.02, sf) * _ss(0.0, 0.02, 1 - sf)
    rgb *= (0.55 + 0.45 * head)[..., None]
    rgb *= (0.7 + 0.3 * seam)[..., None]
    return np.clip(rgb, 0, 1)


def stone_rgb(base):
    """Ashlar stone: staggered blocks, mortar lines, per-block tone + efflorescence."""
    n = TEX; NR, NC = 9, 5
    v = np.linspace(0, 1, n, endpoint=False)[:, None]; u = np.linspace(0, 1, n, endpoint=False)[None, :]
    fr = v * NR; row = np.floor(fr); rf = fr - row
    off = np.where(row % 2 == 0, 0.0, 0.5)
    fc = u * NC + off; col = np.floor(fc); cf = fc - col
    seed = np.sin(np.broadcast_to(row, (n, n)) * 9.7 + np.broadcast_to(col, (n, n)) * 4.1) * 3571.3
    var = seed - np.floor(seed)
    rgb = np.array(base)[None, None, :] * (0.82 + 0.28 * var)[..., None]
    rgb = np.clip(rgb + (aniso(n, 90, 90, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    mortar = np.broadcast_to(_ss(0.0, 0.03, rf) * _ss(0.0, 0.03, 1 - rf), (n, n)) * (_ss(0.0, 0.03, cf) * _ss(0.0, 0.03, 1 - cf))
    rgb *= (0.6 + 0.4 * mortar)[..., None]
    return np.clip(rgb, 0, 1)


def flat_rgb(n, base, grain=0.05):
    return np.clip(np.array(base)[None, None, :] + (aniso(n, 40, 40, RNG) - 0.5)[..., None] * grain, 0, 1)


def _img(name, rgb):
    h, w = rgb.shape[:2]
    rgba = np.concatenate([rgb, np.ones((h, w, 1))], 2)
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    return img


def pack_jpeg(name, rgb, q=90):
    _img(name + "-src", rgb)
    sc = bpy.context.scene; sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = q
    path = os.path.join(os.path.dirname(OUT_GLB) or ".", f"_st_{name}.jpg")
    bpy.data.images[name + "-src"].save_render(path)
    baked = bpy.data.images.load(path); baked.name = name; baked.pack()
    try: os.remove(path)
    except OSError: pass
    return baked


def make_normal(h, strength=1.8):
    n = h.shape[0]
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(h)
    inv = 1 / np.sqrt(nx * nx + ny * ny + nz * nz)
    rgba = np.stack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5, np.ones_like(h)], 2)
    img = bpy.data.images.new(f"{KEY}-n", width=n, height=n, alpha=True)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    img.colorspace_settings.name = "Non-Color"
    return img


def make_material(name, tint, rough=0.9, spec=0.2, image=None):
    """A material that samples an atlas and multiplies it by a constant tint. glTF
    exports this as baseColorTexture + baseColorFactor. Clapboard/trim/louvre share
    the clapboard atlas; photoreal adds a slate atlas (lead) and an ashlar atlas
    (stone) plus the clock, so the GLB stays to a handful of small images."""
    mat = bpy.data.materials.new(name); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = image if image is not None else SHARED_IMG; tex.extension = "REPEAT"
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs["B"].default_value = (tint[0], tint[1], tint[2], 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0; bsdf.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in bsdf.inputs: bsdf.inputs["Specular IOR Level"].default_value = spec
    elif "Specular" in bsdf.inputs: bsdf.inputs["Specular"].default_value = spec
    nt.links.new(tex.outputs["Color"], mix.inputs["A"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    mat.blend_method = "OPAQUE"; mat.use_backface_culling = False
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


log("textures", "PHOTOREAL" if PHOTOREAL else "flat")
bpy.ops.wm.read_factory_settings(use_empty=True)
SHARED_IMG = pack_jpeg("steeple-atlas", course_rgb(photoreal=PHOTOREAL))
CLOCK_PNG = os.environ.get("CLOCK_PNG", "")
if PHOTOREAL:
    SLATE_IMG = pack_jpeg("steeple-slate", slate_rgb((0.30, 0.32, 0.35)))
    STONE_IMG = pack_jpeg("steeple-stone", stone_rgb((0.64, 0.60, 0.54)))
    MAT_CLAP = make_material("clap", (0.93, 0.91, 0.86), rough=0.92)
    MAT_TRIM = make_material("trim", (0.97, 0.96, 0.92), rough=0.85, spec=0.22)
    MAT_LEAD = make_material("lead", (0.92, 0.94, 0.98), rough=0.5, spec=0.4, image=SLATE_IMG)
    MAT_LOUVRE = make_material("louvre", (0.20, 0.17, 0.13), rough=0.9, spec=0.12)
    MAT_STONE = make_material("stone", (0.98, 0.96, 0.92), rough=0.95, spec=0.12, image=STONE_IMG)
    if CLOCK_PNG and os.path.exists(CLOCK_PNG):
        _ck = bpy.data.images.load(CLOCK_PNG); _ck.name = "clock"; _ck.pack()
        MAT_CLOCK = make_material("clock", (1.0, 1.0, 1.0), rough=0.6, spec=0.3, image=_ck)
    else:
        MAT_CLOCK = MAT_STONE
else:
    MAT_CLAP = make_material("clap", (0.95, 0.94, 0.90), rough=0.9)
    MAT_TRIM = make_material("trim", (0.98, 0.97, 0.93), rough=0.85, spec=0.22)
    MAT_LEAD = make_material("lead", (0.56, 0.58, 0.60), rough=0.8, spec=0.25)
    MAT_LOUVRE = make_material("louvre", (0.20, 0.17, 0.13), rough=0.9, spec=0.12)
    MAT_STONE = make_material("stone", (0.66, 0.63, 0.56), rough=0.95, spec=0.12)
    MAT_CLOCK = MAT_STONE
IC, IT, IL, ILV, IS, ICK = 0, 1, 2, 3, 4, 5

bm = bmesh.new()
uv = bm.loops.layers.uv.new("UVMap")


def quad(p0, p1, p2, p3, mat, uvs):
    vs = [bm.verts.new(Vector(p)) for p in (p0, p1, p2, p3)]
    try:
        f = bm.faces.new(vs)
    except ValueError:
        for v in vs:
            if v.is_valid and not v.link_faces: bm.verts.remove(v)
        return
    f.material_index = mat
    for lp, uvp in zip(f.loops, uvs):
        lp[uv].uv = uvp


def tri(p0, p1, p2, mat, uvs):
    vs = [bm.verts.new(Vector(p)) for p in (p0, p1, p2)]
    try:
        f = bm.faces.new(vs)
    except ValueError:
        for v in vs:
            if v.is_valid and not v.link_faces: bm.verts.remove(v)
        return
    f.material_index = mat
    for lp, uvp in zip(f.loops, uvs):
        lp[uv].uv = uvp


TILE = 2.0


def solid_box(x0, x1, y0, y1, z0, z1, mat, faces="all", tile=TILE):
    """Axis-aligned box; Blender X=width, Y=depth, Z=height. Selected faces only."""
    want = {"+x", "-x", "+y", "-y", "+z", "-z"} if faces == "all" else set(faces)
    U = lambda p, q: (p / tile, q / tile)
    if "+z" in want: quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), mat, [U(x0, y0), U(x1, y0), U(x1, y1), U(x0, y1)])
    if "-z" in want: quad((x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0), mat, [U(x0, y1), U(x1, y1), U(x1, y0), U(x0, y0)])
    if "-y" in want: quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), mat, [U(x0, z0), U(x1, z0), U(x1, z1), U(x0, z1)])
    if "+y" in want: quad((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1), mat, [U(x1, z0), U(x0, z0), U(x0, z1), U(x1, z1)])
    if "-x" in want: quad((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1), mat, [U(y1, z0), U(y0, z0), U(y0, z1), U(y1, z1)])
    if "+x" in want: quad((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), mat, [U(y0, z0), U(y1, z0), U(y1, z1), U(y0, z1)])


def ring_deck(ox0, ox1, oy0, oy1, ix0, ix1, iy0, iy1, ztop, thick, mat, parapet=0.0, pmat=None):
    """A standable ring: the annulus (outer rect minus inner rect) as 4 non-
    overlapping border slabs (top up-face + underside + outer fascia), optionally
    with a low SOLID parapet on the outer edge (clean, no turned balusters)."""
    z0 = ztop - thick
    bands = [
        (ox0, ox1, oy0, iy0),   # south
        (ox0, ox1, iy1, oy1),   # north
        (ox0, ix0, iy0, iy1),   # west
        (ix1, ox1, iy0, iy1),   # east
    ]
    for (bx0, bx1, by0, by1) in bands:
        if bx1 - bx0 < 1e-4 or by1 - by0 < 1e-4:
            continue
        solid_box(bx0, bx1, by0, by1, z0, ztop, mat, faces=("+z", "-z"), tile=1.0)
    # outer fascia (a moulded cornice band just under the ring)
    solid_box(ox0, ox1, oy0, oy1, z0 - 0.14, ztop, mat, faces=("+x", "-x", "+y", "-y"), tile=1.0)
    if parapet > 0:
        pm = pmat if pmat is not None else mat
        t = 0.14
        solid_box(ox0, ox1, oy0, oy0 + t, ztop, ztop + parapet, pm, faces=("+x", "-x", "+y", "-y", "+z"), tile=1.0)
        solid_box(ox0, ox1, oy1 - t, oy1, ztop, ztop + parapet, pm, faces=("+x", "-x", "+y", "-y", "+z"), tile=1.0)
        solid_box(ox0, ox0 + t, oy0 + t, oy1 - t, ztop, ztop + parapet, pm, faces=("+x", "-x", "+y", "-y", "+z"), tile=1.0)
        solid_box(ox1 - t, ox1, oy0 + t, oy1 - t, ztop, ztop + parapet, pm, faces=("+x", "-x", "+y", "-y", "+z"), tile=1.0)


# ------------------------------------------------------------------- geometry
# ---- tower core 0..15.6 (clapboard, corner pilasters, string-course holds) -----
# Core tops at 15.6 so the thin gallery deck beds on it while its oversailing lip
# clears 1.55 m over the louvre sill (14.0) below.
CORE = 2.0
CORE_TOP = 15.6
solid_box(-CORE, CORE, -CORE, CORE, 0.0, CORE_TOP, IC, faces=("+x", "-x", "+y", "-y"), tile=2.2)
# a stone plinth base
solid_box(-2.2, 2.2, -2.2, 2.2, 0.0, 1.1, IS, faces=("+x", "-x", "+y", "-y", "+z"), tile=1.4)
# corner pilasters, full height (the climb reads + the vertical order)
for sx in (-CORE, CORE):
    for sy in (-CORE, CORE):
        solid_box(sx - 0.18 if sx > 0 else sx, sx + 0.18 if sx < 0 else sx,
                  sy - 0.18 if sy > 0 else sy, sy + 0.18 if sy < 0 else sy,
                  1.1, 13.6, IT, faces="all", tile=1.0)
# string-course ledges (thin core-face bands, putlog offsets) — kept BELOW the
# MEETING_RIDGE monitor (11.2) so none sits at/above it; the climb chain above the
# ridge is the SOUTH-annulus ledge stack, not a full-perimeter band.
for h in (3.0, 5.0, 7.0, 9.0):
    solid_box(-CORE - 0.16, CORE + 0.16, -CORE - 0.16, CORE + 0.16, h - 0.12, h, IT,
              faces=("+z", "-z", "+x", "-x", "+y", "-y"), tile=1.0)
# louvred belfry openings 14.2..15.1 on each face (recessed dark slats)
for (a, b, c, d, fc) in [(-1.3, 1.3, CORE, CORE, "+y"), (-1.3, 1.3, -CORE, -CORE, "-y"),
                         (CORE, CORE, -1.3, 1.3, "+x"), (-CORE, -CORE, -1.3, 1.3, "-x")]:
    if fc in ("+y", "-y"):
        solid_box(a, b, c, c, 14.2, 15.1, ILV, faces=(fc,), tile=1.0)
    else:
        solid_box(a, a, c, d, 14.2, 15.1, ILV, faces=(fc,), tile=1.0)

# ---- BELFRY base skirt @ ~14.0 (was the full-width LOUVRE_SILL landable ring) --
# The old ring was a full-width (+/-3.7) SPANNING standable deck at 14.0 whose
# collision conflicted with the MEETING_RIDGE monitor (11.2). Replaced by a STEEP
# sloped cornice skirt: it still pins the 7.4 box at +/-3.7 and gives the belfry
# oversail read, but its top is a ~34deg slope (up<0.85) so it is NOT a standable
# ring — the affordance grid finds no flat face here. The standable chain moves to
# the SOUTH annulus below. The builder authors NO full-width deck at 14.0.
SK_OUT, SK_IN, SK_TZ, SK_BZ = 3.7, 2.2, 14.0, 13.0
# THREE-sided sloped cornice (north -y, east +x, west -x). The SOUTH (+y) face is
# deliberately LEFT OPEN so no decorative cornice ever overhangs the climb ledges.
# north (-y):
quad((-SK_OUT, -SK_OUT, SK_BZ), (SK_OUT, -SK_OUT, SK_BZ), (SK_OUT, -SK_IN, SK_TZ), (-SK_OUT, -SK_IN, SK_TZ), IT, [(0, 0), (3.7, 0), (3.7, 1), (0, 1)])
# east (+x):
quad((SK_OUT, -SK_OUT, SK_BZ), (SK_OUT, SK_OUT, SK_BZ), (SK_IN, SK_OUT, SK_TZ), (SK_IN, -SK_OUT, SK_TZ), IT, [(0, 0), (3.7, 0), (3.7, 1), (0, 1)])
# west (-x):
quad((-SK_OUT, SK_OUT, SK_BZ), (-SK_OUT, -SK_OUT, SK_BZ), (-SK_IN, -SK_OUT, SK_TZ), (-SK_IN, SK_OUT, SK_TZ), IT, [(0, 0), (3.7, 0), (3.7, 1), (0, 1)])
# vertical drip fascia on those three sides (firms the +/-3.7 box pin on N/E/W)
solid_box(-SK_OUT, SK_OUT, -SK_OUT, -SK_OUT, SK_BZ - 0.35, SK_BZ, IL, faces=("-y",), tile=1.0)
solid_box(SK_OUT, SK_OUT, -SK_OUT, SK_OUT, SK_BZ - 0.35, SK_BZ, IL, faces=("+x",), tile=1.0)
solid_box(-SK_OUT, -SK_OUT, -SK_OUT, SK_OUT, SK_BZ - 0.35, SK_BZ, IL, faces=("-x",), tile=1.0)

# ---- ANNULUS standable RING STACK: the mantle chain 11.2 -> 15.8 ----------------
# A ledge is a flat standable slab projecting OFF one shaft face to the box edge
# (3.7), so it is the OUTERMOST thing on that face and is never overhung by cornice.
# FIX: 13.0 and 14.7 were BOTH on the south face at the same footprint, so the 14.7
# slab + its corbel (down to 14.08) roofed the 13.0 ledge with ~1.08 m headroom over
# 82% of it — unstandable, and unfixable by height (a clear 14.7 needs a >=15.17 top,
# making 13.0->15.17 a 2.17 m dead-zone rise). So the chain SPIRALS onto adjacent
# faces: 13.0 stays SOUTH (+y), 14.7 moves to the EAST (+x) flank, which the 15.8
# gallery's +/-2.7 edge does not cover (1.0 m of clear standable depth, open sky
# above). Chain (<=1.9 m): ridge 11.2 -> south 13.0 (1.8) -> east 14.7 (1.7) ->
# 15.8 gallery (1.1). South ledge pins +y=3.7; east ledge pins +x=3.7.
def south_ledge(ztop, thick=0.24, y_out=3.7, hw=2.0):
    solid_box(-hw, hw, CORE, y_out, ztop - thick, ztop, IT, faces=("+z", "-z", "+y", "+x", "-x"), tile=1.0)
    # jettied corbel bracket under the ledge (no top/back face -> flush to slab/core)
    solid_box(-hw + 0.12, hw - 0.12, CORE, y_out - 0.3, ztop - 0.62, ztop - thick, IT, faces=("-z", "+y", "+x", "-x"), tile=1.0)

def east_ledge(ztop, thick=0.24, x_out=3.7, hw=2.0):
    # mirror of south_ledge onto the +x flank: projects EAST to the box edge, spans
    # the core depth y[-hw,hw]. Back face (-x, flush to core) omitted.
    solid_box(CORE, x_out, -hw, hw, ztop - thick, ztop, IT, faces=("+z", "-z", "+x", "+y", "-y"), tile=1.0)
    solid_box(CORE, x_out - 0.3, -hw + 0.12, hw - 0.12, ztop - 0.62, ztop - thick, IT, faces=("-z", "+x", "+y", "-y"), tile=1.0)

south_ledge(13.0)
east_ledge(14.7)

# ---- STEEPLE_GALLERY @ 15.8 (+/-2.7; the leap take-off), lantern hole -----------
# Thin deck (0.2) so its underside at 15.6 clears 1.55 m over the louvre sill.
LX0, LX1, LY0, LY1 = 0.4, 1.6, -0.6, 0.6            # lantern footprint (shifted +1 x)
ring_deck(-2.7, 2.7, -2.7, 2.7, LX0, LX1, LY0, LY1, 15.8, 0.2, IL)

# ---- lantern 15.8..20.6 (shifted +1 x): a SOLID closed drum (the collision is a
# solid mass; verify_m1_placements needs the drawn art to fill it), with recessed
# blind-arch panels for the lantern read -----------------------------------------
solid_box(LX0, LX1, LY0, LY1, 15.8, 20.6, IT, faces="all", tile=1.0)
r = 0.06                                            # blind-arch recess depth
solid_box(LX0 + 0.15, LX1 - 0.15, LY1 - r, LY1 - r, 16.3, 19.6, ILV, faces=("-y",), tile=1.0)
solid_box(LX0 + 0.15, LX1 - 0.15, LY0 + r, LY0 + r, 16.3, 19.6, ILV, faces=("+y",), tile=1.0)
solid_box(LX1 - r, LX1 - r, LY0 + 0.15, LY1 - 0.15, 16.3, 19.6, ILV, faces=("-x",), tile=1.0)
solid_box(LX0 + r, LX0 + r, LY0 + 0.15, LY1 - 0.15, 16.3, 19.6, ILV, faces=("+x",), tile=1.0)

# ---- STEEPLE_CROCKETS ring @ 18.2 (0.8 walk round the lantern) ------------------
ring_deck(-0.4, 2.4, -1.4, 1.4, LX0, LX1, LY0, LY1, 18.2, 0.3, IT)

# ---- STEEPLE_VANE balcony @ 20.6 (0.8 walk, expert take-off), spire hole ---------
SX0, SX1, SY0, SY1 = 0.5, 1.5, -0.5, 0.5           # spire base footprint
ring_deck(-0.3, 2.3, -1.3, 1.3, SX0, SX1, SY0, SY1, 20.6, 0.3, IT)

# ---- SPIRE 20.6..30.0: a tapered square needle (lead) + finial ------------------
apex_z = 29.4
cx, cy = (SX0 + SX1) / 2, (SY0 + SY1) / 2            # spire centre (+1 x)
base = [(SX0, SY0), (SX1, SY0), (SX1, SY1), (SX0, SY1)]
top = (cx, cy, apex_z)
for i in range(4):
    (bx0, by0) = base[i]; (bx1, by1) = base[(i + 1) % 4]
    tri((bx0, by0, 20.6), (bx1, by1, 20.6), top, IL, [(0, 0), (1, 0), (0.5, 1)])
# finial spike + weathervane arms (thin, clean) to the box top at 30.0
solid_box(cx - 0.05, cx + 0.05, cy - 0.05, cy + 0.05, apex_z, 30.0, IL, faces="all", tile=1.0)
solid_box(cx - 0.45, cx + 0.45, cy - 0.03, cy + 0.03, 29.7, 29.78, IL, faces="all", tile=1.0)
solid_box(cx - 0.03, cx + 0.03, cy - 0.45, cy + 0.45, 29.62, 29.70, IL, faces="all", tile=1.0)

if PHOTOREAL:
    # ======================= PHOTOREAL DETAIL ==================================
    # (a) tower CLOCK on the south (+y) face — the iconic meeting-house landmark
    # read, on a proud stone panel below the belfry. Full-UV quad (sign convention).
    solid_box(-0.98, 0.98, CORE, CORE + 0.12, 10.8, 12.9, IS, faces=("+x", "-x", "+y", "+z", "-z"), tile=1.4)
    quad((-0.82, CORE + 0.13, 11.02), (0.82, CORE + 0.13, 11.02),
         (0.82, CORE + 0.13, 12.66), (-0.82, CORE + 0.13, 12.66), ICK, [(1, 0), (0, 0), (0, 1), (1, 1)])

    # (b) corner URN PINNACLES at the louvre-sill ring corners (stone base + lead
    # needle + ball) — Georgian steeple detail; kept inside the 3.7 box half-width
    # and outside the 2.7 gallery so the leap take-off stays clear.
    def pinnacle(cx, cy):
        solid_box(cx - 0.26, cx + 0.26, cy - 0.26, cy + 0.26, 14.0, 14.9, IS, faces=("+x", "-x", "+y", "-y", "+z"), tile=1.0)
        b = [(cx - 0.22, cy - 0.22), (cx + 0.22, cy - 0.22), (cx + 0.22, cy + 0.22), (cx - 0.22, cy + 0.22)]
        tip = (cx, cy, 16.3)
        for i in range(4):
            tri((b[i][0], b[i][1], 14.9), (b[(i + 1) % 4][0], b[(i + 1) % 4][1], 14.9), tip, IL, [(0, 0), (1, 0), (0.5, 1)])
        solid_box(cx - 0.08, cx + 0.08, cy - 0.08, cy + 0.08, 16.2, 16.5, IL, faces="all", tile=1.0)

    for (cx, cy) in ((-3.4, -3.4), (3.4, -3.4), (-3.4, 3.4), (3.4, 3.4)):
        pinnacle(cx, cy)

    # (c) stone KEYSTONES over the four louvred belfry openings
    for (a, b, c, d, fc) in [(-0.24, 0.24, CORE, CORE + 0.16, "+y"), (-0.24, 0.24, -CORE - 0.16, -CORE, "-y")]:
        solid_box(a, b, c, d, 14.9, 15.4, IS, faces=("+y", "-y", "+x", "-x", "+z"), tile=1.0)
    solid_box(CORE, CORE + 0.16, -0.24, 0.24, 14.9, 15.4, IS, faces=("+y", "-y", "+x", "+z"), tile=1.0)
    solid_box(-CORE - 0.16, -CORE, -0.24, 0.24, 14.9, 15.4, IS, faces=("+y", "-y", "-x", "+z"), tile=1.0)

# ----------------------------------------------------------------- finalise
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
mesh = bpy.data.meshes.new(KEY); bm.to_mesh(mesh); bm.free()
obj = bpy.data.objects.new(KEY, mesh)
for m in (MAT_CLAP, MAT_TRIM, MAT_LEAD, MAT_LOUVRE, MAT_STONE, MAT_CLOCK):
    obj.data.materials.append(m)
for poly in obj.data.polygons:
    poly.use_smooth = False
bpy.context.scene.collection.objects.link(obj)

co = np.array([v.co[:] for v in obj.data.vertices])
lo, hi = co.min(0), co.max(0); size = hi - lo; centre = (lo + hi) / 2.0
log(f"blender bbox {size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f}  -> gltf {size[0]:.3f}(w) x {size[2]:.3f}(h) x {size[1]:.3f}(d)  declared {WBOX}x{HBOX}x{DBOX}")
for axis, got, dec in (("width", size[0], WBOX), ("height", size[2], HBOX), ("depth", size[1], DBOX)):
    if abs(got - dec) > 0.03:
        raise SystemExit(f"{axis} {got:.3f} != declared {dec}; contain-fit would move the rings off their bands")
if abs(centre[0]) > 0.03 or abs(centre[1]) > 0.03 or abs(lo[2]) > 0.02:
    raise SystemExit(f"bbox not centred on axis at base 0 (centre {centre[0]:+.3f},{centre[1]:+.3f}, minZ {lo[2]:.3f})")
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
log(f"tris {tris}  verts {len(obj.data.vertices)}  south-chain 13.0/14.7 -> gallery 15.8, then 18.2/20.6  spire->30")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_yup=True, export_animations=False,
                          export_image_format="AUTO", export_jpeg_quality=90, export_tangents=True, use_selection=True)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
