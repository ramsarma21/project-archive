# Author the Shambles shopfront row (bldg-row-shop) as a clean, box-accurate
# procedural GLB: a jettied timber-framed row whose OWN believable features form
# the traversal. A brick ground floor with open stall bays, a continuous PENTICE
# standable at 2.55 (STALL_ROOF), two jettied timber storeys stacked so each
# projecting ledge is a mantle step <=1.9 m from the last (pentice 2.55 -> mid
# ledge ~4.05 -> leaded penthouse ROOF DECK 5.6, the GALLERY band / box top), and
# a projecting sign-bracket as a hang hold.
#
# WHY PROCEDURAL. The shipped Meshy row (dims 1.1 x 1.28 plan for an 18 x 12 box)
# contain-fit warps to ~3.2 m wide with torn jetties and shard sign-brackets
# (audit). Authoring at true scale pins the natural bbox to the declared box so
# contain-fit is 1.0 and every ledge lands on its band; outer-faces-only keeps the
# weld gate clean.
#
# Run: blender --background --python assets/pipeline/build_shambles_row.py -- bldg-row-shop <out.glb>
import bpy
import bmesh
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
KEY = argv[0]
OUT_GLB = os.path.abspath(argv[1])
SEED = 74010918
RNG = np.random.default_rng(SEED)
TEX = 1024

# PHOTOREAL: keep the clean, box-accurate, weld-clean jettied FORM and wear the
# concept's real materials (row-shop-photoreal-concept.png): warm ground brick,
# weathered lime-plaster + oak half-timbering, silver-grey timber ledges, dark
# leaded/slate roof, stone trim — plus grime/streak/efflorescence. Base-colour-only
# (the Blender 5.1 glTF writer emits normal maps BLACK; proven in test_normal_export).
PHOTOREAL = os.environ.get("PHOTOREAL", "") not in ("", "0", "false")
NO_NORMAL = os.environ.get("NO_NORMAL", "") not in ("", "0", "false")
CONCEPT_BRICK = (0.46, 0.24, 0.19)
CONCEPT_PLASTER = (0.72, 0.67, 0.57)
CONCEPT_TIMBER = (0.44, 0.39, 0.33)
CONCEPT_SLATE = (0.28, 0.30, 0.34)
CONCEPT_STONE = (0.62, 0.58, 0.52)

W, H, D = 18.0, 5.6, 12.0
hx, hz = W / 2, D / 2
BAYS = 4                                   # shopfront units across the frontage
# storeys: (wall-plane Y, z0, z1) — each higher storey jetties forward (+Y).
# PLAYTEST #2 FIX: the storey walls used to sit ~1.4 m BEHIND their projecting
# ledges, so each walkable ledge read as a thin shelf floating over a deep open
# recess — "a hole in the middle". The walls are now brought forward to ~0.5 m
# behind each ledge front, so there is a SOLID wall right behind every walkable
# deck (pentice 2.55 / mid 4.05 / roof 5.6 all UNMOVED — drawn==collision), and the
# ledges read as covered cornice-galleries against a solid jettied facade.
YG, YZ1, YZ2 = 4.0, 4.3, 4.7
PENTICE_Y, MID_Y, ROOF_Y = 2.55, 4.05, 5.6
# progressive jetty: each higher canopy/ledge/roof reaches further toward the street
PENTICE_FRONT, MID_FRONT, ROOF_FRONT = 4.8, 5.2, 5.6


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


def brick_fields(body):
    n = TEX; NC, NB = 22, 8
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
    rgb = base[None, None, :] * (0.8 + 0.4 * var)[..., None]
    rgb[var < 0.18] *= 0.62
    rgb = np.clip(rgb + (aniso(n, 220, 200, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    mortar = np.clip(np.array([0.60, 0.57, 0.50])[None, None, :] + (aniso(n, 90, 90, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    t = mask[..., None]
    return np.clip(mortar * (1 - t) + rgb * t, 0, 1), 0.25 + 0.75 * mask


def frame_fields(studs=3, rails=2, plaster_base=(0.74, 0.70, 0.60)):
    """Half-timber: pale lime plaster with dark oak studs + rails (a tiled panel)."""
    n = TEX
    u = np.linspace(0, 1, n, endpoint=False)[None, :]; v = np.linspace(0, 1, n, endpoint=False)[:, None]
    plaster = np.clip(np.array(plaster_base)[None, None, :] + (aniso(n, 60, 60, RNG) - 0.5)[..., None] * 0.08, 0, 1)
    oak = np.array([0.20, 0.13, 0.08])
    sw = 0.06
    vert = np.zeros((n, n))
    for k in range(studs + 1):
        vert = np.maximum(vert, _ss(sw, 0.0, np.abs(u - k / studs)))
    hor = np.zeros((n, n))
    for k in range(rails + 1):
        hor = np.maximum(hor, _ss(sw, 0.0, np.abs(v - k / rails)))
    wood = np.clip(np.broadcast_to(np.maximum(vert, hor), (n, n)), 0, 1)
    grain = 0.8 + 0.4 * aniso(n, 30, 220, RNG)
    oakrgb = np.clip(oak[None, None, :] * grain[..., None], 0, 1)
    t = wood[..., None]
    h = wood * 0.5 + (1 - wood) * (0.5 + 0.2 * (aniso(n, 60, 60, RNG) - 0.5))
    return np.clip(plaster * (1 - t) + oakrgb * t, 0, 1), h


def plank_rgb(base, vertical=False, boards=9):
    n = TEX
    u = np.linspace(0, 1, n, endpoint=False)
    coord = np.broadcast_to((u[None, :] if not vertical else u[:, None]), (n, n))
    fb = coord * boards; board = np.floor(fb); bf = fb - board
    seam = _ss(0.0, 0.03, bf) * _ss(0.0, 0.03, 1 - bf)
    bseed = np.sin(board * 27.1) * 43758.5; bvar = bseed - np.floor(bseed)
    grain = aniso(n, 8 if vertical else 240, 240 if vertical else 8, RNG)
    base = np.array(base)
    rgb = base[None, None, :] * (0.80 + 0.4 * bvar)[..., None]
    rgb = np.clip(rgb * (0.88 + 0.24 * grain)[..., None], 0, 1)
    return np.clip(rgb * (0.66 + 0.34 * seam)[..., None], 0, 1)


def window_rgb():
    n = TEX // 2
    X = np.broadcast_to(np.linspace(0, 1, n)[None, :], (n, n)); Y = np.broadcast_to(np.linspace(0, 1, n)[:, None], (n, n))
    glass = np.array([0.10, 0.13, 0.17]); frame = np.array([0.84, 0.83, 0.78])
    rgb = glass[None, None, :] + (0.14 * (1 - Y))[..., None] * np.array([0.5, 0.6, 0.8])[None, None, :]
    fb, bar = 0.12, 0.02
    m = (X < fb) | (X > 1 - fb) | (Y < fb) | (Y > 1 - fb) | (np.abs(X - 0.5) < bar) | (np.abs(Y - 1 / 3) < bar) | (np.abs(Y - 2 / 3) < bar)
    return np.clip(np.where(m[..., None], frame[None, None, :], rgb), 0, 1)


def flat_rgb(n, base, grain=0.06):
    return np.clip(np.array(base)[None, None, :] + (aniso(n, 40, 40, RNG) - 0.5)[..., None] * grain, 0, 1)


# ---- photoreal weathering layers (applied only when PHOTOREAL) ----------------
def add_grime(rgb):
    """Vertical water-streaking, broad soot blotches, pale efflorescence flecks."""
    n = rgb.shape[0]
    out = rgb.copy()
    out *= (0.74 + 0.26 * aniso(n, 150, 5, RNG))[..., None]        # long vertical runs
    out *= (0.85 + 0.15 * aniso(n, 22, 22, RNG))[..., None]        # broad soot blotches
    out *= np.linspace(1.0, 0.84, n)[:, None, None]                # sootier toward eaves
    fle = aniso(n, 320, 320, RNG)                                  # lime efflorescence
    out = np.where((fle > 0.88)[..., None], np.clip(out * 1.4 + 0.05, 0, 1), out)
    return np.clip(out, 0, 1)


def add_cracks(rgb, n_cracks=7):
    n = rgb.shape[0]
    out = rgb.copy()
    for _ in range(n_cracks):
        cx = int(RNG.integers(0, n)); w = int(RNG.integers(1, 3))
        out[:, max(0, cx - w):cx + w] *= 0.5
    return np.clip(out, 0, 1)


def slate_rgb(base):
    """Overlapping leaded/slate courses: staggered rows, per-slate tone, a shadow
    line at each course head, a cold blue-grey tint."""
    n = TEX; NR, NS = 11, 15
    v = np.linspace(0, 1, n, endpoint=False)[:, None]; u = np.linspace(0, 1, n, endpoint=False)[None, :]
    fr = v * NR; row = np.floor(fr); rf = fr - row
    off = np.where(row % 2 == 0, 0.0, 0.5)
    fs = u * NS + off; sl = np.floor(fs); sf = fs - sl
    seed = np.sin(np.broadcast_to(row, (n, n)) * 11.1 + np.broadcast_to(sl, (n, n)) * 7.3) * 4373.1
    var = seed - np.floor(seed)
    base = np.array(base)
    rgb = base[None, None, :] * (0.68 + 0.6 * var)[..., None]
    rgb = np.clip(rgb + (aniso(n, 130, 130, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    head = np.broadcast_to(_ss(0.0, 0.07, rf), (n, n))
    seam = _ss(0.0, 0.02, sf) * _ss(0.0, 0.02, 1 - sf)
    rgb *= (0.55 + 0.45 * head)[..., None]
    rgb *= (0.7 + 0.3 * seam)[..., None]
    return np.clip(rgb, 0, 1)


def wood_shingle_rgb(across_len, along_len):
    """Weathered WOOD-SHINGLE (cedar shake) roof, mapped 0..1 so it does not tile:
    staggered courses, strong per-shingle tone with the odd split/curled shake, a
    course-head overlap shadow, moss in the damp lower courses, soot toward one
    gable and water streaking down-slope. Warm silvered brown so it reads clearly as
    WOOD — a humble shop row — distinct from the wharf's lead and the merchant slate."""
    n = TEX
    u = np.broadcast_to(np.linspace(0, 1, n, endpoint=False)[None, :], (n, n))   # across (shingle width)
    v = np.broadcast_to(np.linspace(0, 1, n, endpoint=False)[:, None], (n, n))   # up-slope (courses)
    ncourse = max(5, int(round(along_len / 0.34)))
    nshin = max(6, int(round(across_len / 0.20)))
    fc = v * ncourse; course = np.floor(fc); cf = fc - course
    coff = np.sin(course * 57.3) * 43758.5; coff = coff - np.floor(coff)         # per-course horizontal stagger
    fs = u * nshin + coff; sh = np.floor(fs); sf = fs - sh
    seed = np.sin(course * 12.9 + sh * 78.2) * 43758.5; sv = seed - np.floor(seed)
    base = np.array([0.36, 0.30, 0.235])
    col = base[None, None, :] * (0.66 + 0.64 * sv)[..., None]
    col = np.where((sv < 0.14)[..., None], col * 0.58, col)                       # dark / curled shakes
    head = _ss(0.80, 1.0, cf)                                                     # course-head overlap shadow
    col *= (1 - 0.44 * head[..., None])
    gap = np.clip(1 - np.minimum(sf, 1 - sf) / 0.02, 0, 1); gap = gap * gap * (3 - 2 * gap)
    col *= (1 - 0.5 * gap[..., None])                                             # split grooves between shakes
    col *= (0.86 + 0.28 * aniso(n, 5, 200, RNG))[..., None]                       # grain along the shake
    moss = aniso(n, 26, 30, RNG); damp = _ss(0.55, 0.0, v)                        # mossy toward the eave
    mmask = (_ss(0.60, 0.85, moss) * damp)[..., None]
    col = col * (1 - 0.5 * mmask) + np.array([0.32, 0.40, 0.26])[None, None, :] * (0.5 * mmask)
    col *= (0.82 + 0.20 * aniso(n, 4, 150, RNG))[..., None]                       # water streak down-slope
    col *= np.linspace(0.90, 1.0, n)[None, :, None]                              # sootier toward one gable
    return np.clip(col, 0, 1)


def _img(name, rgb):
    h, w = rgb.shape[:2]
    rgba = np.concatenate([rgb, np.ones((h, w, 1))], 2)
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    return img


def pack_jpeg(name, rgb, q=90):
    _img(name + "-src", rgb)
    sc = bpy.context.scene; sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = q
    path = os.path.join(os.path.dirname(OUT_GLB) or ".", f"_row_{name}.jpg")
    bpy.data.images[name + "-src"].save_render(path)
    baked = bpy.data.images.load(path); baked.name = name; baked.pack()
    try: os.remove(path)
    except OSError: pass
    return baked


def make_normal(h, strength=2.2):
    n = h.shape[0]
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(h)
    inv = 1 / np.sqrt(nx * nx + ny * ny + nz * nz)
    rgba = np.stack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5, np.ones_like(h)], 2)
    img = bpy.data.images.new(f"{KEY}-{n}n", width=n, height=n, alpha=True)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    img.colorspace_settings.name = "Non-Color"
    return img


def make_material(name, image, normal=None, rough=0.94, spec=0.16):
    mat = bpy.data.materials.new(name); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = image; tex.extension = "REPEAT"
    bsdf.inputs["Metallic"].default_value = 0.0; bsdf.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in bsdf.inputs: bsdf.inputs["Specular IOR Level"].default_value = spec
    elif "Specular" in bsdf.inputs: bsdf.inputs["Specular"].default_value = spec
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if normal is not None:
        ntex = nt.nodes.new("ShaderNodeTexImage"); ntex.image = normal; ntex.extension = "REPEAT"
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"]); nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    mat.blend_method = "OPAQUE"; mat.use_backface_culling = False
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


# NORMAL-MAP EXPORT BUG (test_normal_export.py): the Blender 5.1 glTF writer emits
# normal images BLACK regardless of authoring, while base-colour reimports fine, so
# the brick renders unlit in Cycles. Ship base-colour-only; depth comes from real
# geometry + the mortar/streak in the albedo. nrm() returns None for photoreal.
def nrm(h):
    if NO_NORMAL or PHOTOREAL:
        return None
    return make_normal(h)


log("textures", "PHOTOREAL" if PHOTOREAL else "flat")
bpy.ops.wm.read_factory_settings(use_empty=True)
if PHOTOREAL:
    B_RGB, B_H = brick_fields(CONCEPT_BRICK); B_RGB = add_grime(B_RGB)
    F_RGB, F_H = frame_fields(plaster_base=CONCEPT_PLASTER); F_RGB = add_grime(F_RGB)
    MAT_BRICK = make_material("brick", pack_jpeg("brick", B_RGB), normal=nrm(B_H), rough=0.95, spec=0.14)
    MAT_FRAME = make_material("frame", pack_jpeg("frame", F_RGB), normal=nrm(F_H), rough=0.92, spec=0.12)
    MAT_GLASS = make_material("glass", pack_jpeg("window", window_rgb()), rough=0.32, spec=0.45)
    MAT_TRIM = make_material("trim", pack_jpeg("trim", flat_rgb(TEX // 2, CONCEPT_STONE, 0.12)), rough=0.86, spec=0.2)
    MAT_LEAD = make_material("lead", pack_jpeg("lead", slate_rgb(CONCEPT_SLATE)), rough=0.5, spec=0.4)
    MAT_TIMBER = make_material("timber", pack_jpeg("timber", add_cracks(plank_rgb(CONCEPT_TIMBER))), rough=0.9, spec=0.1)
    MAT_TIMBER_V = make_material("timberv", pack_jpeg("timberv", add_cracks(plank_rgb(tuple(c * 0.86 for c in CONCEPT_TIMBER), vertical=True))), rough=0.92, spec=0.1)
else:
    B_RGB, B_H = brick_fields((0.42, 0.20, 0.16))
    F_RGB, F_H = frame_fields()
    MAT_BRICK = make_material("brick", pack_jpeg("brick", B_RGB), normal=nrm(B_H))
    MAT_FRAME = make_material("frame", pack_jpeg("frame", F_RGB), normal=nrm(F_H))
    MAT_GLASS = make_material("glass", pack_jpeg("window", window_rgb()), rough=0.5, spec=0.25)
    MAT_TRIM = make_material("trim", pack_jpeg("trim", flat_rgb(TEX // 4, (0.78, 0.76, 0.70))), rough=0.9, spec=0.18)
    MAT_LEAD = make_material("lead", pack_jpeg("lead", flat_rgb(TEX // 4, (0.52, 0.53, 0.53))), rough=0.86, spec=0.2)
    MAT_TIMBER = make_material("timber", pack_jpeg("timber", plank_rgb((0.44, 0.33, 0.22))), rough=0.93, spec=0.12)
    MAT_TIMBER_V = make_material("timberv", pack_jpeg("timberv", plank_rgb((0.30, 0.20, 0.13), vertical=True)), rough=0.94, spec=0.12)
# the penthouse roof deck: weathered wood shingle under PHOTOREAL, plain lead otherwise
if PHOTOREAL:
    MAT_ROOF = make_material("shingle", pack_jpeg("shingle", wood_shingle_rgb(W, D / 2 + ROOF_FRONT)), rough=0.92, spec=0.08)
else:
    MAT_ROOF = MAT_LEAD
IB, IF, IW, IT, IL, ITM, ITV = 0, 1, 2, 3, 4, 5, 6
# sign board material (painted board with baked serif signage); falls back to timber
SIGN_PNG = os.environ.get("SIGN_PNG", "")
if PHOTOREAL and SIGN_PNG and os.path.exists(SIGN_PNG):
    _si = bpy.data.images.load(SIGN_PNG); _si.name = "sign"; _si.pack()
    MAT_SIGN = make_material("sign", _si, rough=0.72, spec=0.22)
else:
    MAT_SIGN = MAT_TIMBER_V
ISG = 7
IROOF = 8

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


BRICK_TILE = 2.0
RECESS = 0.24


def solid_box(x0, x1, y0, y1, z0, z1, mat, faces="all", tile=BRICK_TILE):
    want = {"+x", "-x", "+y", "-y", "+z", "-z"} if faces == "all" else set(faces)
    U = lambda p, q: (p / tile, q / tile)
    if "+z" in want: quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), mat, [U(x0, y0), U(x1, y0), U(x1, y1), U(x0, y1)])
    if "-z" in want: quad((x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0), mat, [U(x0, y1), U(x1, y1), U(x1, y0), U(x0, y0)])
    if "-y" in want: quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), mat, [U(x0, z0), U(x1, z0), U(x1, z1), U(x0, z1)])
    if "+y" in want: quad((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1), mat, [U(x1, z0), U(x0, z0), U(x0, z1), U(x1, z1)])
    if "-x" in want: quad((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1), mat, [U(y1, z0), U(y0, z0), U(y0, z1), U(y1, z1)])
    if "+x" in want: quad((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), mat, [U(y0, z0), U(y1, z0), U(y1, z1), U(y0, z1)])


def paneled_face(origin, along, up, inward, Wf, Hf, openings, fill=IB, tile=BRICK_TILE):
    def P(a, u, d):
        return origin + along * a + up * u + inward * d
    ubreaks = sorted({0.0, Hf} | {o[2] for o in openings} | {o[3] for o in openings})
    for bi in range(len(ubreaks) - 1):
        ub0, ub1 = ubreaks[bi], ubreaks[bi + 1]
        if ub1 - ub0 < 1e-4: continue
        holes = sorted((o[0], o[1]) for o in openings if o[2] <= ub0 + 1e-4 and o[3] >= ub1 - 1e-4)
        a = 0.0; segs = []
        for (h0, h1) in holes:
            if h0 - a > 1e-4: segs.append((a, h0))
            a = max(a, h1)
        if Wf - a > 1e-4: segs.append((a, Wf))
        for (sa0, sa1) in segs:
            quad(P(sa0, ub0, 0), P(sa1, ub0, 0), P(sa1, ub1, 0), P(sa0, ub1, 0), fill,
                 [(sa0 / tile, ub0 / tile), (sa1 / tile, ub0 / tile), (sa1 / tile, ub1 / tile), (sa0 / tile, ub1 / tile)])
    for (a0, a1, u0, u1, kind) in openings:
        mat = IW if kind == "win" else ITV
        aw, uw = a1 - a0, u1 - u0
        quad(P(a0, u0, RECESS), P(a1, u0, RECESS), P(a1, u1, RECESS), P(a0, u1, RECESS), mat,
             [(0.04, 0.04), (0.96, 0.04), (0.96, 0.96), (0.04, 0.96)])
        quad(P(a0, u1, 0), P(a1, u1, 0), P(a1, u1, RECESS), P(a0, u1, RECESS), IT, [(0, 0), (aw, 0), (aw, RECESS), (0, RECESS)])
        if not (kind == "door" and u0 < 0.05):
            quad(P(a0, u0, 0), P(a1, u0, 0), P(a1, u0, RECESS), P(a0, u0, RECESS), IT, [(0, 0), (aw, 0), (aw, RECESS), (0, RECESS)])
        quad(P(a0, u0, 0), P(a0, u1, 0), P(a0, u1, RECESS), P(a0, u0, RECESS), IT, [(0, 0), (uw, 0), (uw, RECESS), (0, RECESS)])
        quad(P(a1, u0, 0), P(a1, u1, 0), P(a1, u1, RECESS), P(a1, u0, RECESS), IT, [(0, 0), (uw, 0), (uw, RECESS), (0, RECESS)])


X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
bay = W / BAYS


def bay_openings(z0, z1, ww, wh, per=1):
    """`per` sash openings centred in each bay, spanning [z0,z1]. Returns LOCAL
    along-face coords in [0, W] (paneled_face measures a from its origin)."""
    out = []
    for b in range(BAYS):
        cx = (b + 0.5) * bay
        out.append((cx - ww / 2, cx + ww / 2, z0, z1, "win"))
    return out


# ---- GROUND floor: brick, open stall bays (recessed timber shopfront) ----------
# LOCAL along-face coords in [0, W].
stalls = [(b * bay + 0.6, (b + 1) * bay - 0.6, 0.0, 1.9, "door") for b in range(BAYS)]
paneled_face(Vector((-hx, YG, 0.0)), X, Z, -Y, W, PENTICE_Y, stalls, fill=IB)                  # front
paneled_face(Vector((hx, -hz, 0.0)), -X, Z, Y, W, PENTICE_Y, bay_openings(0.7, 1.9, 1.0, 1.0), fill=IB)  # back
solid_box(hx - 0.001, hx, -hz, YG, 0.0, PENTICE_Y, IB, faces=("+x",))                          # +x side
solid_box(-hx, -hx + 0.001, -hz, YG, 0.0, PENTICE_Y, IB, faces=("-x",))                        # -x side

# ---- continuous PENTICE at 2.55 over the stall line ----------------------------
solid_box(-hx + 0.3, hx - 0.3, YG, PENTICE_FRONT, PENTICE_Y - 0.26, PENTICE_Y, ITM,
          faces=("+z", "-z", "+y", "+x", "-x"), tile=1.4)
solid_box(-hx + 0.3, hx - 0.3, PENTICE_FRONT - 0.06, PENTICE_FRONT, PENTICE_Y - 0.5, PENTICE_Y - 0.26, ITM,
          faces=("+y", "-y", "+x", "-x", "-z"), tile=1.0)                                        # fascia
# timber stall posts (ground -> pentice), set back from the lip
for b in range(BAYS + 1):
    pxp = -hx + b * bay
    pxp = max(-hx + 0.25, min(hx - 0.25, pxp))
    solid_box(pxp - 0.1, pxp + 0.1, PENTICE_FRONT - 0.22, PENTICE_FRONT - 0.04, 0.0, PENTICE_Y - 0.26, ITM,
              faces=("+x", "-x", "+y", "-y"), tile=1.0)

# ---- FLOOR 1 (jettied timber frame) + mid ledge at 4.05 ------------------------
paneled_face(Vector((-hx, YZ1, PENTICE_Y)), X, Z, -Y, W, MID_Y - PENTICE_Y, bay_openings(0.35, 1.15, 1.1, 1.4), fill=IF)
paneled_face(Vector((hx, -hz, PENTICE_Y)), -X, Z, Y, W, MID_Y - PENTICE_Y, bay_openings(0.35, 1.15, 1.0, 1.3), fill=IF)
solid_box(hx - 0.001, hx, -hz, YZ1, PENTICE_Y, MID_Y, IF, faces=("+x",))
solid_box(-hx, -hx + 0.001, -hz, YZ1, PENTICE_Y, MID_Y, IF, faces=("-x",))
# jetty string course under floor 1 (reads as the overhang)
solid_box(-hx, hx, YZ1, YZ1 + 0.35, PENTICE_Y, PENTICE_Y + 0.12, ITM, faces=("+y", "-y", "-z", "+x", "-x"), tile=1.0)
# mid ledge at 4.05 (projecting standable, further forward than the pentice)
solid_box(-hx + 0.3, hx - 0.3, YZ1, MID_FRONT, MID_Y - 0.28, MID_Y, ITM,
          faces=("+z", "-z", "+y", "+x", "-x"), tile=1.4)
solid_box(-hx + 0.3, hx - 0.3, MID_FRONT - 0.06, MID_FRONT, MID_Y - 0.5, MID_Y - 0.28, ITM,
          faces=("+y", "-y", "+x", "-x", "-z"), tile=1.0)                                        # fascia

# ---- FLOOR 2 (jettied) --------------------------------------------------------
paneled_face(Vector((-hx, YZ2, MID_Y)), X, Z, -Y, W, 5.0 - MID_Y, bay_openings(0.3, 0.85, 1.1, 1.3), fill=IF)
paneled_face(Vector((hx, -hz, MID_Y)), -X, Z, Y, W, 5.0 - MID_Y, bay_openings(0.3, 0.85, 1.0, 1.2), fill=IF)
solid_box(hx - 0.001, hx, -hz, YZ2, MID_Y, 5.0, IF, faces=("+x",))
solid_box(-hx, -hx + 0.001, -hz, YZ2, MID_Y, 5.0, IF, faces=("-x",))
solid_box(-hx, hx, YZ2, YZ2 + 0.35, MID_Y, MID_Y + 0.12, ITM, faces=("+y", "-y", "-z", "+x", "-x"), tile=1.0)  # jetty string course

# ---- leaded penthouse ROOF DECK at 5.6 (standable, oversails floor 2) ----------
# roof deck: the +z walkable top is drawn as ONE flat quad at exactly ROOF_Y, UV
# 0..1 across the deck (NOT tiled) so the wood-shingle material reads once, no
# repeat. Geometry identical to the old single +z quad -> box/weld/bbox unchanged.
solid_box(-hx, hx, -hz, ROOF_FRONT, ROOF_Y - 0.6, ROOF_Y, IL, faces=("+y", "-y", "+x", "-x"), tile=1.3)
quad((-hx, -hz, ROOF_Y), (hx, -hz, ROOF_Y), (hx, ROOF_FRONT, ROOF_Y), (-hx, ROOF_FRONT, ROOF_Y), IROOF,
     [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
# a run of small ridge stacks between bays for the row read (kept <= ROOF_Y)
for b in range(1, BAYS):
    cx = -hx + b * bay
    solid_box(cx - 0.35, cx + 0.35, -1.4, -0.6, ROOF_Y - 0.9, ROOF_Y - 0.02, IB, faces=("+x", "-x", "+y", "-y"), tile=1.0)

# ---- SIGN-BRACKET hang hold: a projecting timber arm + hanging board -----------
for sx in (-hx + bay * 0.9, hx - bay * 0.9):
    solid_box(sx - 0.05, sx + 0.05, YZ1, MID_FRONT + 0.15, 3.35, 3.5, ITM, faces="all", tile=1.0)    # the arm (hang hold)
    solid_box(sx - 0.02, sx + 0.02, MID_FRONT, MID_FRONT + 0.15, 2.55, 3.35, ITM, faces="all", tile=1.0)  # the drop iron
    # hanging sign board, textured both faces (photoreal painted board)
    sy = MID_FRONT + 0.06; sm = ISG if (PHOTOREAL and SIGN_PNG) else ITV
    quad((sx - 0.45, sy, 2.55), (sx + 0.45, sy, 2.55), (sx + 0.45, sy, 3.3), (sx - 0.45, sy, 3.3), sm,
         [(1, 0), (0, 0), (0, 1), (1, 1)])                                        # street-facing (+y)
    quad((sx + 0.45, sy + 0.03, 2.55), (sx - 0.45, sy + 0.03, 2.55), (sx - 0.45, sy + 0.03, 3.3), (sx + 0.45, sy + 0.03, 3.3), sm,
         [(1, 0), (0, 0), (0, 1), (1, 1)])                                        # back face
    solid_box(sx - 0.45, sx + 0.45, sy, sy + 0.03, 2.55, 3.3, IT, faces=("+x", "-x", "+z", "-z"), tile=1.0)  # board edge

if PHOTOREAL:
    # ======================= PHOTOREAL GEOMETRIC DETAIL =========================
    # Timber corbel brackets under the projecting pentice + mid ledge front lips —
    # the traditional shambles jetty bracket. Single-skin wedges offset off the wall
    # plane so no coincident same-facing faces are introduced (weld gate stays clean).
    def wedge(x0, x1, y_back, z_lo, y_lip, z_hi, mat):
        vv = [bm.verts.new(Vector(p)) for p in (
            (x0, y_back, z_lo), (x0, y_back, z_hi), (x0, y_lip, z_hi),
            (x1, y_back, z_lo), (x1, y_back, z_hi), (x1, y_lip, z_hi))]
        for idx in ((0, 1, 2), (3, 5, 4), (0, 2, 5, 3), (1, 4, 5, 2), (0, 3, 4, 1)):
            try:
                fdet = bm.faces.new([vv[i] for i in idx])
            except ValueError:
                continue
            fdet.material_index = mat
            for lp in fdet.loops:
                p = lp.vert.co; lp[uv].uv = (p.x + p.y, p.z + 0.5 * p.y)

    for b in range(BAYS + 1):
        px = max(-hx + 0.35, min(hx - 0.35, -hx + b * bay))
        # under the pentice lip
        wedge(px - 0.10, px + 0.10, YG + 0.02, PENTICE_Y - 0.26 - 0.55, PENTICE_FRONT - 0.10, PENTICE_Y - 0.30, ITM)
        # under the mid ledge lip
        wedge(px - 0.09, px + 0.09, YZ1 + 0.02, MID_Y - 0.28 - 0.5, MID_FRONT - 0.10, MID_Y - 0.32, ITM)

# ---- ground apron: pins bbox to the DECLARED box, centred, base 0 --------------
solid_box(-hx, hx, -hz, hz, 0.0, 0.03, IT, faces="all", tile=1.5)

# ----------------------------------------------------------------- finalise
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
mesh = bpy.data.meshes.new(KEY); bm.to_mesh(mesh); bm.free()
obj = bpy.data.objects.new(KEY, mesh)
for m in (MAT_BRICK, MAT_FRAME, MAT_GLASS, MAT_TRIM, MAT_LEAD, MAT_TIMBER, MAT_TIMBER_V, MAT_SIGN, MAT_ROOF):
    obj.data.materials.append(m)
for poly in obj.data.polygons:
    poly.use_smooth = False
bpy.context.scene.collection.objects.link(obj)

co = np.array([v.co[:] for v in obj.data.vertices])
lo, hi = co.min(0), co.max(0); size = hi - lo; centre = (lo + hi) / 2.0
log(f"blender bbox {size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f}  -> gltf {size[0]:.3f}(w) x {size[2]:.3f}(h) x {size[1]:.3f}(d)  declared {W}x{H}x{D}")
for axis, got, dec in (("width", size[0], W), ("height", size[2], H), ("depth", size[1], D)):
    if abs(got - dec) > 0.02:
        raise SystemExit(f"{axis} {got:.3f} != declared {dec}; contain-fit would move the route planes")
if abs(centre[0]) > 0.02 or abs(centre[1]) > 0.02 or abs(lo[2]) > 0.02:
    raise SystemExit(f"bbox not centred on axis at base 0 (centre {centre[0]:+.3f},{centre[1]:+.3f}, minZ {lo[2]:.3f})")
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
log(f"tris {tris}  verts {len(obj.data.vertices)}  ledges 2.55/4.05/5.6")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_yup=True, export_animations=False,
                          export_image_format="AUTO", export_jpeg_quality=90, export_tangents=True, use_selection=True)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
