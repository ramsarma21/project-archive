# Author bldg-merchant as a photoreal Georgian brick SHELL for the covert drop-in,
# in the ASSET-lane worktree (build_civic_facade.py + merchant.ts are the builder's
# lane; this authors ONLY the mesh/materials/normals to the builder's authored
# heights, and ships an integration note for the structural side).
#
# Contract reproduced from build_civic_facade.py so drawn == collision:
#   - authored at TRUE world scale (contain-fit 1.0), base at 0
#   - bbox pinned to the declared box [9, 7.1, 15.2], centred on the draw axis
#   - every standable TOP sits exactly on its world plane: balcony 4.00,
#     jettied gallery 5.70, eave/leads 7.10
#   - single-skin (selected faces only) so the weld gate stays low
# Base-color-only materials (Blender 5.1's glTF writer emits normals black);
# correct tangent normals are injected post-export by fix_glb_normals.py.
#
# Local frame (Blender, export_yup): X = worldX-37.5, Y = -(worldZ+10.2),
# Z = worldY(height). Axis: worldX 37.5 (foot 33..42), worldZ -10.2 (so the
# balcony south edge -2.6 sits 7.6 m from the axis -> depth 15.2 both ways).
#
# Run: blender --background --python assets/pipeline/build_merchant_shell.py -- <out.glb>
import bpy, bmesh, os, sys
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
OUT_GLB = os.path.abspath(argv[0])
KEY = "bldg-merchant"
RNG = np.random.default_rng(17131211)
TEX = 2048
DECL = [9.0, 7.1, 15.2]

# ---- world geometry (from merchant.ts) --------------------------------------
FX0, FX1 = 33.0, 42.0          # foot x
FZ_N, FZ_S = -17.2, -3.2       # north / south wall faces
WT = 0.5
EAVE = 7.10
GALLERY = 5.70
PARLOUR = 4.00
AP_X0, AP_X1 = 37.5, 40.5      # open upper window aperture (south face)
BAL_Z_OUT = -2.6               # balcony south edge (7.6 from axis)
AXIS_X = 37.5
AXIS_Z = -10.2

def bx(x): return x - AXIS_X
def by(z): return -(z - AXIS_Z)


def log(*p): print(f"[{KEY}]", *p)


# ---- textures ----------------------------------------------------------------
def _fade(t): return t * t * t * (t * (t * 6 - 15) + 10)


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


def add_grime(rgb, amt=0.22):
    n = rgb.shape[0]
    streak = aniso(n, 12, 240, RNG) ** 1.6
    v = np.linspace(0, 1, n)[:, None]
    streak = streak * _ss(0.0, 0.5, v)
    return np.clip(rgb * (1 - amt * streak[..., None]), 0, 1)


def brick_fields(body):
    n = TEX; NC, NB = 32, 11
    v = np.linspace(0, 1, n, endpoint=False)[:, None]; u = np.linspace(0, 1, n, endpoint=False)[None, :]
    fy = v * NC; course = np.floor(fy); cf = fy - course
    offset = np.where(course % 2 == 0, 0.0, 0.5)
    fx = u * NB + offset; brick = np.floor(fx); bf = fx - brick
    mv, mu, e = 0.11, 0.07, 0.02
    bed = _ss(mv - e, mv + e, cf) * _ss(mv - e, mv + e, 1 - cf)
    head = _ss(mu - e, mu + e, bf) * _ss(mu - e, mu + e, 1 - bf)
    mask = np.broadcast_to(bed, (n, n)) * head
    seed = np.sin(np.broadcast_to(course, (n, n)) * 12.9898 + brick * 78.233) * 43758.5453
    var = seed - np.floor(seed)
    base = np.array(body)
    rgb = base[None, None, :] * (0.82 + 0.36 * var)[..., None]
    dark = var < 0.16
    rgb[dark] *= 0.66
    rgb = np.clip(rgb + (aniso(n, 220, 200, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    mortar = np.clip(np.array([0.72, 0.69, 0.62])[None, None, :] + (aniso(n, 90, 90, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    t = mask[..., None]
    rgb = np.clip(mortar * (1 - t) + rgb * t, 0, 1)
    return add_grime(rgb, 0.20)


def stone_rgb(base=(0.80, 0.77, 0.69)):
    n = TEX // 2
    v = np.linspace(0, 1, n, endpoint=False)[:, None] * 8; course = np.floor(v); cf = v - course
    bed = _ss(0.0, 0.05, cf) * _ss(0.0, 0.05, 1 - cf)
    seed = np.sin(course * 41.3) * 4137.1; var = seed - np.floor(seed)
    rgb = np.array(base)[None, None, :] * (0.9 + 0.16 * var)[..., None]
    rgb = np.clip(rgb + (aniso(n, 120, 120, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    rgb = rgb * (0.55 + 0.45 * np.broadcast_to(bed, (n, n)))[..., None]
    return add_grime(np.clip(rgb, 0, 1), 0.16)


def slate_rgb(base=(0.30, 0.31, 0.34)):
    n = TEX // 2
    v = np.linspace(0, 1, n, endpoint=False)[:, None] * 14; u = np.linspace(0, 1, n, endpoint=False)[None, :] * 10
    course = np.floor(v); cf = v - course
    off = np.where(course % 2 == 0, 0.0, 0.5)
    tile = np.floor(u + off); tf = (u + off) - tile
    seam = np.maximum(_ss(0.0, 0.03, cf), 0) * 0 + (1 - _ss(0.0, 0.04, cf))
    edge = 1 - _ss(0.0, 0.05, tf) * _ss(0.0, 0.05, 1 - tf)
    seed = np.sin(course * 12.1 + tile * 7.7) * 991.3; var = seed - np.floor(seed)
    rgb = np.array(base)[None, None, :] * (0.82 + 0.32 * var)[..., None]
    dark = np.maximum(seam, edge)[..., None]
    rgb = np.clip(rgb * (1 - 0.4 * dark), 0, 1)
    return rgb


def window_rgb():
    n = TEX // 2
    X = np.broadcast_to(np.linspace(0, 1, n)[None, :], (n, n)); Y = np.broadcast_to(np.linspace(0, 1, n)[:, None], (n, n))
    glass = np.array([0.10, 0.13, 0.17]); frame = np.array([0.86, 0.85, 0.80])
    rgb = glass[None, None, :] + (0.16 * (1 - Y))[..., None] * np.array([0.5, 0.6, 0.8])[None, None, :]
    fb, bar = 0.10, 0.016
    m = (X < fb) | (X > 1 - fb) | (Y < fb) | (Y > 1 - fb) | (np.abs(X - 1 / 3) < bar) | (np.abs(X - 2 / 3) < bar) | (np.abs(Y - 0.25) < bar) | (np.abs(Y - 0.5) < bar) | (np.abs(Y - 0.75) < bar)
    return np.clip(np.where(m[..., None], frame[None, None, :], rgb), 0, 1)


def shutter_rgb(base=(0.16, 0.20, 0.17)):
    n = TEX // 4
    u = np.linspace(0, 1, n, endpoint=False)[None, :] * 9; sl = np.floor(u); sf = u - sl
    louvre = 0.55 + 0.45 * _ss(0.0, 0.5, sf)
    rgb = np.array(base)[None, None, :] * np.broadcast_to(louvre, (n, n))[..., None]
    return np.clip(rgb + (aniso(n, 60, 60, RNG) - 0.5)[..., None] * 0.02, 0, 1)


def flat_rgb(n, base, grain=0.05):
    return np.clip(np.array(base)[None, None, :] + (aniso(n, 40, 40, RNG) - 0.5)[..., None] * grain, 0, 1)


def sign_rgb():
    # "SOLDIERS QUARTERED HERE" board — a dark painted board, text drawn as bars.
    n = 256; rgb = np.zeros((n, n, 3), np.float32) + np.array([0.14, 0.10, 0.07])
    rgb[:14] = rgb[-14:] = (0.30, 0.24, 0.16)
    rgb[:, :10] = rgb[:, -10:] = (0.30, 0.24, 0.16)
    for row in (0.30, 0.55, 0.78):
        r0 = int(row * n)
        rgb[r0:r0 + 12, 30:-30] = (0.72, 0.66, 0.50)
    return rgb


def _img(name, rgb):
    h, w = rgb.shape[:2]
    rgba = np.concatenate([rgb, np.ones((h, w, 1))], 2)
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    return img


def pack_jpeg(name, rgb, q=90):
    _img(name + "-src", rgb)
    sc = bpy.context.scene; sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = q
    path = os.path.join(os.path.dirname(OUT_GLB) or ".", f"_mer_{name}.jpg")
    bpy.data.images[name + "-src"].save_render(path)
    baked = bpy.data.images.load(path); baked.name = name; baked.pack()
    try: os.remove(path)
    except OSError: pass
    return baked


def make_material(name, image, rough=0.93, spec=0.18):
    mat = bpy.data.materials.new(name); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = image; tex.extension = "REPEAT"
    bsdf.inputs["Metallic"].default_value = 0.0; bsdf.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in bsdf.inputs: bsdf.inputs["Specular IOR Level"].default_value = spec
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


bpy.ops.wm.read_factory_settings(use_empty=True)
log("textures")
MAT_BRICK = make_material("brick", pack_jpeg("brick", brick_fields((0.47, 0.27, 0.22))))
MAT_STONE = make_material("stone", pack_jpeg("stone", stone_rgb()), rough=0.88)
MAT_SLATE = make_material("slate", pack_jpeg("slate", slate_rgb()), rough=0.8, spec=0.22)
MAT_GLASS = make_material("glass", pack_jpeg("window", window_rgb()), rough=0.5, spec=0.3)
MAT_SHUT = make_material("shutter", pack_jpeg("shutter", shutter_rgb()), rough=0.85)
MAT_TIMB = make_material("timber", pack_jpeg("timber", flat_rgb(TEX // 4, (0.30, 0.22, 0.15))), rough=0.9)
MAT_LEAD = make_material("lead", pack_jpeg("lead", flat_rgb(TEX // 4, (0.50, 0.51, 0.52))), rough=0.85)
MAT_SIGN = make_material("sign", pack_jpeg("sign", sign_rgb()), rough=0.8)
IB, IST, ISL, IW, ISH, IT, IL, ISG = 0, 1, 2, 3, 4, 5, 6, 7

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


TILE = 2.2


def box(x0, x1, y0, y1, z0, z1, mat, faces="all", tile=TILE):
    """Blender-coord axis box; y is DEPTH, z is HEIGHT. Selected faces only."""
    want = {"+x", "-x", "+y", "-y", "+z", "-z"} if faces == "all" else set(faces)
    U = lambda p, q: (p / tile, q / tile)
    if "+z" in want: quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), mat, [U(x0, y0), U(x1, y0), U(x1, y1), U(x0, y1)])
    if "-z" in want: quad((x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0), mat, [U(x0, y1), U(x1, y1), U(x1, y0), U(x0, y0)])
    if "-y" in want: quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), mat, [U(x0, z0), U(x1, z0), U(x1, z1), U(x0, z1)])
    if "+y" in want: quad((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1), mat, [U(x1, z0), U(x0, z0), U(x0, z1), U(x1, z1)])
    if "-x" in want: quad((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1), mat, [U(y1, z0), U(y0, z0), U(y0, z1), U(y1, z1)])
    if "+x" in want: quad((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), mat, [U(y0, z0), U(y1, z0), U(y1, z1), U(y0, z1)])


def bounds(lo, hi, count, size):
    pier = (hi - lo - count * size) / (count + 1)
    b = [lo]; cur = lo
    for _ in range(count):
        cur += pier; b.append(cur); cur += size; b.append(cur)
    b.append(hi)
    return b


WW, WH, RECESS = 1.3, 1.7, 0.16


def facade(x_lo, x_hi, y_face, outward, storeys, bays, skip=None, shutters=True):
    """A brick wall on a constant-DEPTH plane (y_face), drawn on the `outward`
    (+1/-1) side, with recessed sash windows + flanking shutters. `skip` is a
    (bx0,bx1,z0,z1) rect (Blender x, world-height z) left as an OPEN hole."""
    W = x_hi - x_lo; H = EAVE
    ab = bounds(x_lo, x_hi, bays, WW)
    ub = bounds(0.0, H, storeys, WH)
    rec = -outward * RECESS
    for i in range(len(ab) - 1):
        a0, a1 = ab[i], ab[i + 1]; awin = i % 2 == 1
        for j in range(len(ub) - 1):
            z0, z1 = ub[j], ub[j + 1]; zwin = j % 2 == 1
            if skip and a0 >= skip[0] - 1e-3 and a1 <= skip[1] + 1e-3 and z0 >= skip[2] - 1e-3 and z1 <= skip[3] + 1e-3:
                continue
            wallface = "+y" if outward < 0 else "-y"      # face flush to the wall plane -> never drawn
            keep = tuple(f for f in ("+x", "-x", "+y", "-y", "+z", "-z") if f != wallface)
            if awin and zwin:
                yb = y_face + rec
                quad((a0, yb, z0), (a1, yb, z0), (a1, yb, z1), (a0, yb, z1), IW,
                     [(0.03, 0.03), (0.97, 0.03), (0.97, 0.97), (0.03, 0.97)]) if outward > 0 else \
                quad((a1, yb, z0), (a0, yb, z0), (a0, yb, z1), (a1, yb, z1), IW,
                     [(0.03, 0.03), (0.97, 0.03), (0.97, 0.97), (0.03, 0.97)])
                # reveal jambs (trim quads only, like the generator — no wall-flush faces)
                quad((a0, y_face, z0), (a1, y_face, z0), (a1, yb, z0), (a0, yb, z0), IST, [(0, 0), (1, 0), (1, 1), (0, 1)])
                quad((a0, y_face, z1), (a1, y_face, z1), (a1, yb, z1), (a0, yb, z1), IST, [(0, 0), (1, 0), (1, 1), (0, 1)])
                quad((a0, y_face, z0), (a0, y_face, z1), (a0, yb, z1), (a0, yb, z0), IST, [(0, 0), (1, 0), (1, 1), (0, 1)])
                quad((a1, y_face, z0), (a1, y_face, z1), (a1, yb, z1), (a1, yb, z0), IST, [(0, 0), (1, 0), (1, 1), (0, 1)])
                # sill + lintel (stone): outward face + top/bottom only (no tiny x-ends,
                # no wall-flush face) so the centroid weld metric sees no small self-pair.
                ofy = "-y" if outward < 0 else "+y"
                sf = (ofy, "+z", "-z")
                box(a0 - 0.08, a1 + 0.08, min(y_face, y_face + outward * 0.06), max(y_face, y_face + outward * 0.06), z0 - 0.06, z0, IST, faces=sf, tile=1.0)
                box(a0 - 0.10, a1 + 0.10, min(y_face, y_face + outward * 0.07), max(y_face, y_face + outward * 0.07), z1, z1 + 0.10, IST, faces=sf, tile=1.0)
                if shutters:
                    sw = (a1 - a0) * 0.42
                    for sx0, sx1 in ((a0 - sw - 0.02, a0 - 0.02), (a1 + 0.02, a1 + sw + 0.02)):
                        box(sx0, sx1, min(y_face + outward * 0.02, y_face + outward * 0.05), max(y_face + outward * 0.02, y_face + outward * 0.05), z0, z1, ISH, faces=keep, tile=1.0)
            else:
                yb = y_face
                if outward > 0:
                    quad((a0, yb, z0), (a1, yb, z0), (a1, yb, z1), (a0, yb, z1), IB,
                         [(a0 / TILE, z0 / TILE), (a1 / TILE, z0 / TILE), (a1 / TILE, z1 / TILE), (a0 / TILE, z1 / TILE)])
                else:
                    quad((a1, yb, z0), (a0, yb, z0), (a0, yb, z1), (a1, yb, z1), IB,
                         [(a1 / TILE, z0 / TILE), (a0 / TILE, z0 / TILE), (a0 / TILE, z1 / TILE), (a1 / TILE, z1 / TILE)])


# ---- ground apron / bbox base ------------------------------------------------
box(-DECL[0] / 2, DECL[0] / 2, -DECL[2] / 2, DECL[2] / 2, 0.0, 0.03, IL, faces="all", tile=1.5)

# ---- four perimeter walls (outer faces) --------------------------------------
# South (street) face at worldZ -3.2 -> by(-3.2); outward toward +worldZ (street),
# which is Blender -y. Aperture hole over the balcony (x AP..AP, z PARLOUR..EAVE).
ys = by(FZ_S)
ap = (bx(AP_X0), bx(AP_X1), PARLOUR, EAVE)
facade(bx(FX0), bx(FX1), ys, -1, storeys=3, bays=3, skip=ap)
# North face worldZ -17.2 -> outward +y (Blender). Plain, fewer openings.
yn = by(FZ_N)
facade(bx(FX0), bx(FX1), yn, +1, storeys=3, bays=3, shutters=False)
# East (worldX 42) and West (worldX 33) flanks run along DEPTH. Draw as brick with
# windows using a depth-major facade (swap roles by hand).
def flank(x_face, outward, z0w, z1w):
    ylo, yhi = by(FZ_S), by(FZ_N)      # depth span (note by flips sign/order)
    lo, hi = min(ylo, yhi), max(ylo, yhi)
    ab = bounds(lo, hi, 3, WW); ub = bounds(0.0, EAVE, 3, WH)
    for i in range(len(ab) - 1):
        a0, a1 = ab[i], ab[i + 1]; awin = i % 2 == 1
        for j in range(len(ub) - 1):
            z0, z1 = ub[j], ub[j + 1]; zwin = j % 2 == 1
            if awin and zwin:
                xb = x_face - outward * RECESS
                if outward > 0:
                    quad((xb, a1, z0), (xb, a0, z0), (xb, a0, z1), (xb, a1, z1), IW, [(0.03, 0.03), (0.97, 0.03), (0.97, 0.97), (0.03, 0.97)])
                else:
                    quad((xb, a0, z0), (xb, a1, z0), (xb, a1, z1), (xb, a0, z1), IW, [(0.03, 0.03), (0.97, 0.03), (0.97, 0.97), (0.03, 0.97)])
                ofx = "+x" if outward > 0 else "-x"          # outward face only (no tiny y-ends)
                kf = (ofx, "+z", "-z")
                box(min(x_face, x_face - outward * 0.06), max(x_face, x_face - outward * 0.06), a0 - 0.08, a1 + 0.08, z0 - 0.06, z0, IST, faces=kf, tile=1.0)
                box(min(x_face, x_face - outward * 0.07), max(x_face, x_face - outward * 0.07), a0 - 0.10, a1 + 0.10, z1, z1 + 0.10, IST, faces=kf, tile=1.0)
            else:
                xb = x_face
                if outward > 0:
                    quad((xb, a1, z0), (xb, a0, z0), (xb, a0, z1), (xb, a1, z1), IB, [(a1 / TILE, z0 / TILE), (a0 / TILE, z0 / TILE), (a0 / TILE, z1 / TILE), (a1 / TILE, z1 / TILE)])
                else:
                    quad((xb, a0, z0), (xb, a1, z0), (xb, a1, z1), (xb, a0, z1), IB, [(a0 / TILE, z0 / TILE), (a1 / TILE, z0 / TILE), (a1 / TILE, z1 / TILE), (a0 / TILE, z1 / TILE)])

flank(bx(FX1), +1, FZ_N, FZ_S)   # east
flank(bx(FX0), -1, FZ_N, FZ_S)   # west

# ---- stone quoins up the four corners (one box per corner; block read comes
# from the stone atlas courses; only the two exterior faces + top are drawn) ----
for (cx, ox) in ((bx(FX0), +1), (bx(FX1), -1)):
    for (cy, oy) in ((by(FZ_S), -1), (by(FZ_N), +1)):
        xf = "-x" if ox > 0 else "+x"
        yf = "-y" if oy < 0 else "+y"
        box(min(cx, cx + ox * 0.45), max(cx, cx + ox * 0.45), min(cy, cy + oy * 0.30), max(cy, cy + oy * 0.30), 0.0, EAVE - 0.1, IST, faces=(xf, yf, "+z"), tile=1.0)

# ---- string-courses (stone bands) at storey lines ----------------------------
for zc in (PARLOUR - 0.05, GALLERY - 0.05):
    box(bx(FX0), bx(FX1), by(FZ_S) - 0.10, by(FZ_S) + 0.02, zc, zc + 0.18, IST, faces=("-y", "+z", "-z"), tile=1.0)

# ---- SOUTH parlour BALCONY @ 4.00 (projecting ledge, balustrade, hood) --------
# balcony slab: top exactly PARLOUR, projecting south (Blender -y) to by(BAL_Z_OUT)
bxa0, bxa1 = bx(AP_X0) - 0.15, bx(AP_X1) + 0.15
ys_out = by(BAL_Z_OUT)
box(bxa0, bxa1, min(ys, ys_out), max(ys, ys_out), PARLOUR - 0.18, PARLOUR, IST, faces=("+z", "-z", "-y", "+x", "-x"), tile=1.0)
# corbels under the balcony (top omitted -> flush to the slab base)
for cxx in (bxa0 + 0.15, (bxa0 + bxa1) / 2, bxa1 - 0.15):
    box(cxx - 0.10, cxx + 0.10, ys_out, ys_out + 0.28, PARLOUR - 0.55, PARLOUR - 0.18, IT, faces=("-z", "-y", "+x", "-x"), tile=1.0)
# balustrade (posts + rail) around the projecting edge; kept inside the balcony
# south edge (ys_out) so the depth pin stays exactly 15.2.
rail_z = PARLOUR + 0.5
for cxx in np.linspace(bxa0 + 0.1, bxa1 - 0.1, 5):
    box(cxx - 0.03, cxx + 0.03, ys_out, ys_out + 0.06, PARLOUR, rail_z, IT, faces=("+y", "-y", "+x", "-x"), tile=1.0)
box(bxa0, bxa1, ys_out, ys_out + 0.08, rail_z, rail_z + 0.08, IT, faces="all", tile=1.0)
# balcony hood (pediment) on brackets above the window head at ~PARLOUR+2.0
hood_z = PARLOUR + 1.9
box(bxa0 - 0.12, bxa1 + 0.12, ys - 0.55, ys + 0.02, hood_z, hood_z + 0.12, IST, faces=("+z", "-z", "-y", "+x", "-x"), tile=1.0)
for cxx in (bxa0, bxa1):
    box(cxx - 0.07, cxx + 0.07, ys - 0.5, ys, hood_z - 0.5, hood_z, IT, faces=("-z", "-y", "+x", "-x"), tile=1.0)

# ---- JETTIED GALLERY @ 5.70 (the new mantle-chain ledge) ---------------------
# A jettied stone string-gallery oversailing the south face, top exactly 5.70,
# spanning the facade so it reads as a projecting storey band and is standable.
gx0, gx1 = bx(FX0) + 0.3, bx(FX1) - 0.3
gy_out = by(FZ_S - 0.7)     # oversail 0.7 m south of the wall face
box(gx0, gx1, min(ys, gy_out), max(ys, gy_out), GALLERY - 0.22, GALLERY, IST, faces=("+z", "-z", "-y", "+x", "-x"), tile=1.0)
# jetty joists/brackets under the gallery (top face omitted -> flush to slab base)
for cxx in np.linspace(gx0 + 0.3, gx1 - 0.3, 6):
    box(cxx - 0.06, cxx + 0.06, gy_out, ys, GALLERY - 0.5, GALLERY - 0.22, IT, faces=("-z", "-y", "+x", "-x"), tile=1.0)

# ---- interior PARLOUR floor @ 4.00 -------------------------------------------
px0, px1 = bx(33.3), bx(41.7)
pyn, pys = by(-16.9), by(-3.4)
box(px0, px1, min(pyn, pys), max(pyn, pys), PARLOUR - 0.15, PARLOUR, IT, faces=("+z", "-z"), tile=1.2)

# ---- leaded roof / eave @ 7.10 -----------------------------------------------
# closed inset slab (0.05 off the walls so no face is coincident with a wall plane);
# a closed volume orients its top normal up reliably for the drawn==collision check.
box(bx(FX0) + 0.05, bx(FX1) - 0.05, min(by(FZ_N), by(FZ_S)) + 0.05, max(by(FZ_N), by(FZ_S)) - 0.05, EAVE - 0.15, EAVE, IL, faces="all", tile=1.2)
# eave cornice band (stone) just under the leads, oversailing south only (depth)
box(bx(FX0), bx(FX1), by(FZ_S) - 0.14, by(FZ_S) + 0.02, EAVE - 0.28, EAVE - 0.10, IST, faces=("-y", "+z", "-z", "+x", "-x"), tile=1.0)

# ---- door + sign on the south ground floor -----------------------------------
dcx = 0.0
box(dcx - 0.55, dcx + 0.55, ys - 0.001, ys + 0.001, 0.0, 2.2, IT, faces=("-y",), tile=1.0)   # door leaf
box(dcx + 0.7, dcx + 1.5, ys - 0.02, ys + 0.0, 1.9, 2.5, ISG, faces=("-y",), tile=1.0)        # SOLDIERS QUARTERED sign

# ---- corner studs to PIN the bbox to DECL, centred on axis, base 0 -----------
for sx in (-DECL[0] / 2, DECL[0] / 2):
    for sy in (-DECL[2] / 2, DECL[2] / 2):
        box(sx - 0.05 if sx > 0 else sx, sx if sx > 0 else sx + 0.05,
            sy - 0.05 if sy > 0 else sy, sy if sy > 0 else sy + 0.05, 0.0, 0.05, IL, faces=("+z",), tile=1.0)

# ---- finalise ----------------------------------------------------------------
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
mesh = bpy.data.meshes.new(KEY); bm.to_mesh(mesh); bm.free()
obj = bpy.data.objects.new(KEY, mesh)
for m in (MAT_BRICK, MAT_STONE, MAT_SLATE, MAT_GLASS, MAT_SHUT, MAT_TIMB, MAT_LEAD, MAT_SIGN):
    obj.data.materials.append(m)
for poly in obj.data.polygons:
    poly.use_smooth = False
bpy.context.scene.collection.objects.link(obj)

co = np.array([v.co[:] for v in obj.data.vertices])
lo, hi = co.min(0), co.max(0); size = hi - lo; centre = (lo + hi) / 2.0
log(f"blender bbox {size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f}  gltf {size[0]:.3f}(w) x {size[2]:.3f}(h) x {size[1]:.3f}(d)  declared {DECL}")
log(f"centre x={centre[0]:+.4f} y(depth)={centre[1]:+.4f} minZ={lo[2]:.4f} (want 0,0,0)")
for axis, got, dec in (("width", size[0], DECL[0]), ("height", size[2], DECL[1]), ("depth", size[1], DECL[2])):
    if abs(got - dec) > 0.03:
        raise SystemExit(f"{axis} {got:.3f} != declared {dec}")
if abs(centre[0]) > 0.03 or abs(centre[1]) > 0.03 or abs(lo[2]) > 0.03:
    raise SystemExit(f"bbox not centred at base 0 (centre {centre[0]:+.3f},{centre[1]:+.3f}, minZ {lo[2]:.3f})")
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
log(f"tris {tris}  verts {len(obj.data.vertices)}  planes: balcony {PARLOUR} gallery {GALLERY} eave {EAVE}")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_yup=True, export_animations=False,
                          export_image_format="AUTO", export_jpeg_quality=90, export_tangents=True, use_selection=True)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
