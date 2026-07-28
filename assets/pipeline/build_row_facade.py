# Re-author the row buildings that share bldg-brick's defect — clapboard a/b/c and
# the tall brick south row — as clean Georgian facades, fully in Blender. This is
# the same finding as bldg-brick, extended: the slice pass measured these at
# 26-32% needle slivers (clapboard) and 21% (brick-b), all on half-resolution
# 1024 atlases, the same generator's same failure. build_brick_facade.py proved a
# re-author beats a repair and beats a regenerate; this generalises that harness.
#
# What every one of these draws demands (assets.ts, runtime.ts MODULE_RUNS,
# geometry.ts, and the FittedGlb fit in engine-world/src/ImportedAssets.tsx):
#
#   * ROW stance -> rowPlacements TILES the mesh into a grid of houses. So one
#     tile is authored here and repeats; the fenestration has to line up rank to
#     rank, which it does because every tile is identical (the Gaol corner proved
#     this reads). Each is its OWN mesh/atlas, so the window grid and colour are
#     set per asset.
#   * The natural bbox MUST equal runtime.ts naturalM for that key (the tiling and
#     the per-axis MODULE fill both read it), so it is pinned per asset with a hard
#     guard that refuses to drift.
#   * The ROOF is a WALKED DECK on all four: the roof run starts on SOUTH_ROW_A,
#     the street crossing lands on ROW_N_A and the meeting roof, the leap crosses
#     ELLIOT_HOUSE. So a FLAT leaded roof across the WHOLE footprint at Y-max, and
#     nothing may oversail the box or the deck reads short / a placement rescales.
#
# Clapboard is horizontal LAPPED siding, a different problem from coursed brick:
# the shadow line under each board is what sells it, so it is carried by a normal
# map (a strong step under every board) rather than by albedo. Corner boards and
# window architraves are painted trim standing proud of the siding; the shutters
# are real proud louvred panels flanking each window, not painted-on rectangles —
# and because they stand proud, the SIDING is inset and the CORNER BOARDS carry
# the bounding box, so the shutters have somewhere to project without oversailing.
# Boston 1765: painted clapboard, six-over-six sash, GREEN louvred shutters. Matte
# throughout — a specular sheen read as varnish on the elm.
#
# Run:
#   blender --background --python assets/pipeline/build_row_facade.py -- <key> <out.glb>
import bpy
import bmesh
import math
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
KEY = argv[0]
OUT_GLB = os.path.abspath(argv[1])

# Per-asset: naturalM (glTF x=w,y=h,z=d) pinned to runtime.ts; siding; storeys;
# bays on the wide (width) and narrow (depth) faces; painted body colour.
CONFIG = {
    "bldg-row-brick-b": dict(
        nat=(1.269, 1.900, 1.272), siding="brick", ny=3, nx_w=2, nx_d=2,
        body=None, shutters=False,
    ),
    "bldg-row-clapboard-a": dict(
        # Narrow frontage (1.02m natural): one bay per face so the piers are wide
        # enough for real shutters rather than none. Reads as the small shuttered
        # cottages of the low north row.
        nat=(1.022, 1.899, 1.193), siding="clap", ny=2, nx_w=1, nx_d=1,
        body=(0.55, 0.57, 0.56), shutters=True,           # weathered blue-grey
    ),
    "bldg-row-clapboard-b": dict(
        nat=(1.303, 1.900, 1.145), siding="clap", ny=2, nx_w=2, nx_d=2,
        body=(0.80, 0.73, 0.57), shutters=True,           # Deacon Elliot's: cream/ochre
    ),
    "bldg-row-clapboard-c": dict(
        nat=(1.290, 1.900, 1.596), siding="clap", ny=2, nx_w=2, nx_d=3,
        body=(0.66, 0.45, 0.36), shutters=True,           # Spanish-brown red
    ),
}
if KEY not in CONFIG:
    raise SystemExit(f"unknown key {KEY}; have {list(CONFIG)}")
CFG = CONFIG[KEY]
NAT_W, NAT_H, NAT_D = CFG["nat"]
BW, BD, BH = NAT_W, NAT_D, NAT_H                          # Blender x,y(depth),z(height)
SEED = 17651114
RNG = np.random.default_rng(SEED)
TEX = 2048


def log(*p):
    print(f"[{KEY}]", *p)


# ----------------------------------------------------------------- helpers
def _fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def aniso_noise(size, px, py, rng):
    g = rng.random((py, px))
    xs = np.linspace(0, px, size, endpoint=False)
    xi = np.floor(xs).astype(int)
    fx = _fade(xs - xi)
    x0, x1 = xi % px, (xi + 1) % px
    ys = np.linspace(0, py, size, endpoint=False)
    yi = np.floor(ys).astype(int)
    fy = _fade(ys - yi)
    y0, y1 = yi % py, (yi + 1) % py
    top = g[np.ix_(y0, x0)] * (1 - fx)[None, :] + g[np.ix_(y0, x1)] * fx[None, :]
    bot = g[np.ix_(y1, x0)] * (1 - fx)[None, :] + g[np.ix_(y1, x1)] * fx[None, :]
    return top * (1 - fy)[:, None] + bot * fy[:, None]


def _smoothstep(a, b, t):
    t = np.clip((t - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def brick_fields():
    n = TEX
    NC, NB = 32, 11
    v = np.linspace(0, 1, n, endpoint=False)[:, None]
    u = np.linspace(0, 1, n, endpoint=False)[None, :]
    fy = v * NC
    course = np.floor(fy)
    cf = fy - course
    offset = np.where(course % 2 == 0, 0.0, 0.5)
    fx = u * NB + offset
    brick = np.floor(fx)
    bf = fx - brick
    mv, mu, e = 0.11, 0.07, 0.02
    bed = _smoothstep(mv - e, mv + e, cf) * _smoothstep(mv - e, mv + e, 1.0 - cf)
    head = _smoothstep(mu - e, mu + e, bf) * _smoothstep(mu - e, mu + e, 1.0 - bf)
    mask = np.broadcast_to(bed, (n, n)) * head
    courseB = np.broadcast_to(course, (n, n))
    seed = np.sin(courseB * 12.9898 + brick * 78.233) * 43758.5453
    var = seed - np.floor(seed)
    red = 0.34 + 0.20 * var
    grn = 0.15 + 0.08 * var
    blu = 0.11 + 0.06 * var
    dark = var < 0.18
    red = np.where(dark, red * 0.6, red)
    grn = np.where(dark, grn * 0.6, grn)
    blu = np.where(dark, blu * 0.7, blu)
    brick_rgb = np.clip(np.stack([red, grn, blu], 2) + (aniso_noise(n, 220, 200, RNG) - 0.5)[..., None] * 0.06, 0, 1)
    mortar = np.clip(np.array([0.60, 0.57, 0.50])[None, None, :] + (aniso_noise(n, 90, 90, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    t = mask[..., None]
    return np.clip(mortar * (1 - t) + brick_rgb * t, 0, 1), 0.25 + 0.75 * mask


def clap_fields(body):
    """Horizontal lapped clapboard: albedo is the painted body drifting a little
    per board; the height field steps DOWN across each board so the normal map
    casts a shadow line under every lap — the thing that reads as clapboard."""
    n = TEX
    NB = 22                                              # boards per vertical repeat
    v = np.linspace(0, 1, n, endpoint=False)[:, None]
    fy = v * NB
    board = np.floor(fy)
    bf = fy - board                                      # 0 at a board's bottom lap, 1 at its top
    # Height: each board is a shallow ramp, proud at its bottom lap edge and
    # receding to the top, then a hard step at the lap line -> a shadow beneath.
    H2d = (1.0 - 0.85 * bf)
    H2d = np.where(bf > 0.94, H2d * 0.15, H2d)           # deep notch at the lap line
    H = np.broadcast_to(H2d, (n, n)).copy()
    grain = (aniso_noise(n, 4, 260, RNG) - 0.5) * 0.05   # faint vertical wood grain
    H = np.clip(H + grain, 0, 1)
    base = np.array(body)
    seedb = np.sin(np.broadcast_to(board, (n, n)) * 51.13) * 4531.7
    varb = (seedb - np.floor(seedb) - 0.5) * 0.06        # per-board tint drift
    rgb = base[None, None, :] * (1.0 + varb[..., None])
    # Darken toward each lap line so even the albedo carries a hint of the shadow.
    lap = _smoothstep(0.80, 0.98, np.broadcast_to(bf, (n, n)))
    rgb = rgb * (1.0 - 0.28 * lap[..., None])
    rgb = rgb + (aniso_noise(n, 6, 220, RNG) - 0.5)[..., None] * 0.03
    return np.clip(rgb, 0, 1), H


def window_rgb():
    n = TEX // 2
    X = np.broadcast_to(np.linspace(0, 1, n)[None, :], (n, n))
    Y = np.broadcast_to(np.linspace(0, 1, n)[:, None], (n, n))
    glass = np.array([0.11, 0.14, 0.18])
    frame = np.array([0.86, 0.85, 0.80])
    rgb = glass[None, None, :] + (0.14 * (1.0 - Y))[..., None] * np.array([0.5, 0.6, 0.8])[None, None, :]
    fb, bar = 0.11, 0.018
    border = (X < fb) | (X > 1 - fb) | (Y < fb) | (Y > 1 - fb)
    vert = (np.abs(X - 1 / 3.0) < bar) | (np.abs(X - 2 / 3.0) < bar)
    horiz = (np.abs(Y - 0.25) < bar) | (np.abs(Y - 0.75) < bar)
    rail = np.abs(Y - 0.5) < bar * 1.8
    rgb = np.where((border | vert | horiz | rail)[..., None], frame[None, None, :], rgb)
    return np.clip(rgb, 0, 1)


def shutter_rgb():
    """A green louvred shutter: horizontal slats in a stile-and-rail frame."""
    n = TEX // 2
    X = np.broadcast_to(np.linspace(0, 1, n)[None, :], (n, n))
    Y = np.broadcast_to(np.linspace(0, 1, n)[:, None], (n, n))
    green = np.array([0.16, 0.28, 0.17])
    rgb = np.broadcast_to(green, (n, n, 3)).copy()
    NL = 16
    fy = Y * NL
    slat = fy - np.floor(fy)
    shade = 0.6 + 0.4 * _smoothstep(0.0, 0.5, slat)      # dark under each slat
    rgb = rgb * shade[..., None]
    fb = 0.10                                            # stiles and rails
    frame = (X < fb) | (X > 1 - fb) | (Y < fb) | (Y > 1 - fb) | (np.abs(Y - 0.5) < 0.03)
    rgb = np.where(frame[..., None], green[None, None, :] * 1.15, rgb)
    return np.clip(rgb, 0, 1)


def trim_rgb():
    n = TEX // 4
    base = np.array([0.85, 0.83, 0.77])                  # painted off-white trim
    return np.clip(base[None, None, :] + (aniso_noise(n, 30, 30, RNG) - 0.5)[..., None] * 0.04, 0, 1)


def stone_rgb():
    n = TEX // 4
    base = np.array([0.56, 0.57, 0.55])                  # leaded flat roof, reveals
    return np.clip(base[None, None, :] + (aniso_noise(n, 40, 40, RNG) - 0.5)[..., None] * 0.07, 0, 1)


def _to_blender_image(name, rgb):
    h, w = rgb.shape[:2]
    rgba = np.concatenate([rgb, np.ones((h, w, 1))], 2)
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    return img


def pack_jpeg(name, rgb, quality=90):
    img = _to_blender_image(name + "-src", rgb)
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = quality
    path = os.path.join(os.path.dirname(OUT_GLB) or ".", f"_row_{name}.jpg")
    img.save_render(path)
    baked = bpy.data.images.load(path)
    baked.name = name
    baked.pack()
    try:
        os.remove(path)
    except OSError:
        pass
    return baked


def make_normal(height, strength=3.0):
    n = height.shape[0]
    gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
    gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(height)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    rgba = np.stack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5, np.ones_like(height)], 2)
    img = bpy.data.images.new(f"{KEY}-normal", width=n, height=n, alpha=True)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    img.colorspace_settings.name = "Non-Color"
    return img


def make_material(name, image, normal=None, roughness=0.94, spec=0.18):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.extension = "REPEAT"
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = spec
    elif "Specular" in bsdf.inputs:
        bsdf.inputs["Specular"].default_value = spec
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if normal is not None:
        ntex = nt.nodes.new("ShaderNodeTexImage")
        ntex.image = normal
        ntex.extension = "REPEAT"
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = 1.0
        nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    mat.blend_method = "OPAQUE"
    mat.use_backface_culling = False
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


log("generating textures")
bpy.ops.wm.read_factory_settings(use_empty=True)
if CFG["siding"] == "brick":
    S_RGB, S_H = brick_fields()
else:
    S_RGB, S_H = clap_fields(CFG["body"])
SIDING_IMG = pack_jpeg("siding", S_RGB)
SIDING_N = make_normal(S_H, strength=3.4 if CFG["siding"] == "clap" else 2.6)
WINDOW_IMG = pack_jpeg("window", window_rgb())
TRIM_IMG = pack_jpeg("trim", trim_rgb())
STONE_IMG = pack_jpeg("stone", stone_rgb())
MAT_SIDING = make_material("siding", SIDING_IMG, normal=SIDING_N, roughness=0.95, spec=0.16)
MAT_WINDOW = make_material("glass", WINDOW_IMG, roughness=0.55, spec=0.25)
MAT_TRIM = make_material("trim", TRIM_IMG, roughness=0.9, spec=0.2)
MAT_STONE = make_material("stone", STONE_IMG, roughness=0.9, spec=0.15)
if CFG["shutters"]:
    SHUT_IMG = pack_jpeg("shutter", shutter_rgb())
    MAT_SHUT = make_material("shutter", SHUT_IMG, roughness=0.8, spec=0.18)

IB, IW, IT, IS = 0, 1, 2, 3
ISH = 4
mats = [MAT_SIDING, MAT_WINDOW, MAT_TRIM, MAT_STONE]
if CFG["shutters"]:
    mats.append(MAT_SHUT)

bm = bmesh.new()
uv = bm.loops.layers.uv.new("UVMap")


def add_quad(p0, p1, p2, p3, mat, uvs):
    vs = [bm.verts.new(Vector(p)) for p in (p0, p1, p2, p3)]
    try:
        f = bm.faces.new(vs)
    except ValueError:
        for vtx in vs:
            if vtx.is_valid and not vtx.link_faces:
                bm.verts.remove(vtx)
        return
    f.material_index = mat
    for loop, uvp in zip(f.loops, uvs):
        loop[uv].uv = uvp


# tuning constants (natural units)
WALL_INSET = 0.030 if CFG["siding"] == "clap" else 0.0   # siding sits behind the trim
CORNER_W = 0.045 if CFG["siding"] == "clap" else 0.0     # corner board half-size
WW, WH = 0.30, 0.34                                       # window opening
RECESS = 0.055
SIDING_TILE = 0.42
STONE_TILE = 0.5
ARCH = 0.028                                              # architrave border width


def bounds_along(lo, hi, count, size):
    total = hi - lo
    pier = (total - count * size) / (count + 1)
    b = [lo]
    cur = lo
    for _ in range(count):
        cur += pier
        b.append(cur)
        cur += size
        b.append(cur)
    b.append(hi)
    return b, pier


def build_face(origin, along, up, inward, width, nx):
    """Grid of recessed sash windows in siding, between corner boards. `origin` is
    the outer (bbox) plane corner; siding sits at inward*WALL_INSET, trim/shutters
    at the bbox plane."""
    a_lo, a_hi = CORNER_W, width - CORNER_W
    ab, pier = bounds_along(a_lo, a_hi, nx, WW)
    ub, _ = bounds_along(0.03, BH - 0.03, CFG["ny"], WH)
    # Shutter width from the pier, so a left+right pair plus their architraves fit
    # in every bay (including the end bays) without oversailing the box.
    sw = min(WW * 0.5, max(0.0, (pier - 2 * ARCH) / 2.0 - 0.01))

    def P(a, u, d):
        return origin + along * a + up * u + inward * d

    for i in range(len(ab) - 1):
        a0, a1 = ab[i], ab[i + 1]
        awin = i % 2 == 1
        for j in range(len(ub) - 1):
            u0, u1 = ub[j], ub[j + 1]
            uwin = j % 2 == 1
            if awin and uwin:
                wd = WALL_INSET                              # siding plane depth
                # recessed glazed pane + four reveals from the siding plane inward
                add_quad(P(a0, u0, wd + RECESS), P(a1, u0, wd + RECESS), P(a1, u1, wd + RECESS), P(a0, u1, wd + RECESS),
                         IW, [(0.03, 0.03), (0.97, 0.03), (0.97, 0.97), (0.03, 0.97)])
                aw, uw, dw = (a1 - a0) / STONE_TILE, (u1 - u0) / STONE_TILE, RECESS / STONE_TILE
                add_quad(P(a0, u0, wd), P(a1, u0, wd), P(a1, u0, wd + RECESS), P(a0, u0, wd + RECESS), IT, [(0, 0), (aw, 0), (aw, dw), (0, dw)])
                add_quad(P(a0, u1, wd), P(a1, u1, wd), P(a1, u1, wd + RECESS), P(a0, u1, wd + RECESS), IT, [(0, 0), (aw, 0), (aw, dw), (0, dw)])
                add_quad(P(a0, u0, wd), P(a0, u1, wd), P(a0, u1, wd + RECESS), P(a0, u0, wd + RECESS), IT, [(0, 0), (uw, 0), (uw, dw), (0, dw)])
                add_quad(P(a1, u0, wd), P(a1, u1, wd), P(a1, u1, wd + RECESS), P(a1, u0, wd + RECESS), IT, [(0, 0), (uw, 0), (uw, dw), (0, dw)])
                # painted architrave: a flat trim border at the bbox plane framing
                # the opening (proud of the inset siding for clapboard).
                if WALL_INSET > 0:
                    for (b0, c0, b1, c1) in (
                        (a0 - ARCH, u0 - ARCH, a1 + ARCH, u0),      # below
                        (a0 - ARCH, u1, a1 + ARCH, u1 + ARCH),      # above
                        (a0 - ARCH, u0, a0, u1),                    # left
                        (a1, u0, a1 + ARCH, u1),                    # right
                    ):
                        add_quad(P(b0, c0, 0), P(b1, c0, 0), P(b1, c1, 0), P(b0, c1, 0), IT,
                                 [(0, 0), (1, 0), (1, 1), (0, 1)])
                # proud louvred shutters flanking the opening
                if CFG["shutters"] and sw > 0.02:
                    for (s0, s1) in ((a0 - ARCH - sw, a0 - ARCH), (a1 + ARCH, a1 + ARCH + sw)):
                        add_quad(P(s0, u0, 0), P(s1, u0, 0), P(s1, u1, 0), P(s0, u1, 0), ISH,
                                 [(0.02, 0.02), (0.98, 0.02), (0.98, 0.98), (0.02, 0.98)])   # face
                        add_quad(P(s0, u0, 0), P(s1, u0, 0), P(s1, u0, wd), P(s0, u0, wd), IT, [(0, 0), (1, 0), (1, 0.3), (0, 0.3)])
                        add_quad(P(s0, u1, 0), P(s1, u1, 0), P(s1, u1, wd), P(s0, u1, wd), IT, [(0, 0), (1, 0), (1, 0.3), (0, 0.3)])
                        add_quad(P(s0, u0, 0), P(s0, u1, 0), P(s0, u1, wd), P(s0, u0, wd), IT, [(0, 0), (1, 0), (1, 0.3), (0, 0.3)])
                        add_quad(P(s1, u0, 0), P(s1, u1, 0), P(s1, u1, wd), P(s1, u0, wd), IT, [(0, 0), (1, 0), (1, 0.3), (0, 0.3)])
            else:
                wd = WALL_INSET
                add_quad(P(a0, u0, wd), P(a1, u0, wd), P(a1, u1, wd), P(a0, u1, wd), IB,
                         [(a0 / SIDING_TILE, u0 / SIDING_TILE), (a1 / SIDING_TILE, u0 / SIDING_TILE),
                          (a1 / SIDING_TILE, u1 / SIDING_TILE), (a0 / SIDING_TILE, u1 / SIDING_TILE)])


X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
build_face(Vector((0, BD, 0)), X, Z, -Y, BW, CFG["nx_w"])   # +Y (front)
build_face(Vector((0, 0, 0)), X, Z, Y, BW, CFG["nx_w"])     # -Y (back)
build_face(Vector((BW, 0, 0)), Y, Z, -X, BD, CFG["nx_d"])   # +X (side)
build_face(Vector((0, 0, 0)), Y, Z, X, BD, CFG["nx_d"])     # -X (side)

# Corner boards (clapboard): square posts flush at the two bbox faces they meet,
# so the siding can be inset and the bbox still measures exactly W x D.
if CORNER_W > 0:
    cw = CORNER_W
    for (cx, cy) in ((0, 0), (BW, 0), (BW, BD), (0, BD)):
        sx = 1 if cx == 0 else -1
        sy = 1 if cy == 0 else -1
        x0, x1 = cx, cx + sx * cw
        y0, y1 = cy, cy + sy * cw
        lo_x, hi_x = min(x0, x1), max(x0, x1)
        lo_y, hi_y = min(y0, y1), max(y0, y1)
        # the two OUTER faces (one per bbox plane) plus the two inner returns
        add_quad((cx, lo_y, 0), (cx, hi_y, 0), (cx, hi_y, BH), (cx, lo_y, BH), IT, [(0, 0), (1, 0), (1, BH), (0, BH)])
        add_quad((lo_x, cy, 0), (hi_x, cy, 0), (hi_x, cy, BH), (lo_x, cy, BH), IT, [(0, 0), (1, 0), (1, BH), (0, BH)])
        inx = cx + sx * cw
        iny = cy + sy * cw
        add_quad((inx, lo_y, 0), (inx, hi_y, 0), (inx, hi_y, BH), (inx, lo_y, BH), IT, [(0, 0), (1, 0), (1, BH), (0, BH)])
        add_quad((lo_x, iny, 0), (hi_x, iny, 0), (hi_x, iny, BH), (lo_x, iny, BH), IT, [(0, 0), (1, 0), (1, BH), (0, BH)])

# Flat leaded roof across the WHOLE footprint at Y-max (the walked deck), and a
# floor cap at the base.
RTL = 0.6
add_quad((0, 0, BH), (BW, 0, BH), (BW, BD, BH), (0, BD, BH), IS, [(0, 0), (BW / RTL, 0), (BW / RTL, BD / RTL), (0, BD / RTL)])
add_quad((0, 0, 0), (0, BD, 0), (BW, BD, 0), (BW, 0, 0), IS, [(0, 0), (0, BD / RTL), (BW / RTL, BD / RTL), (BW / RTL, 0)])

# ----------------------------------------------------------------- finalise
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
mesh = bpy.data.meshes.new(KEY)
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new(KEY, mesh)
for m in mats:
    obj.data.materials.append(m)
for poly in obj.data.polygons:
    poly.use_smooth = False
bpy.context.scene.collection.objects.link(obj)

co = np.array([v.co[:] for v in obj.data.vertices])
size = co.max(0) - co.min(0)
log(f"blender bbox {size[0]:.4f} x {size[1]:.4f} x {size[2]:.4f}  (want {BW:.3f} x {BD:.3f} x {BH:.3f})")
for axis, got, target in (("x", size[0], BW), ("y(depth)", size[1], BD), ("z(height)", size[2], BH)):
    if abs(got - target) > max(0.006, 0.006 * target):
        raise SystemExit(f"bbox drift on {axis}: {got:.4f} != {target:.4f}; a rescale would move a placement")
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
log(f"tris {tris}  verts {len(obj.data.vertices)}")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format="GLB", export_yup=True, export_animations=False,
    export_image_format="AUTO", export_jpeg_quality=90, export_tangents=True, use_selection=True,
)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
