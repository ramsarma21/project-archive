# Author a Boston waterfront warehouse as a clean, box-accurate procedural GLB —
# the wharf worker's two counting-house/warehouse rebuilds, driven directly by
# the level's declared box + route bands rather than by a Meshy blob.
#
# WHY PROCEDURAL, NOT MESHY. The audit's dims.json shows the shipped Meshy
# warehouses are organic masses whose natural plan is ~square (wharf-b 1.07 x
# 1.08) while the declared box is wide-and-flat (13 x 9). A PROP contain-fit
# takes the smallest box/mesh ratio, so it height-binds and draws a warped
# narrow tower — and the loading gallery the wharf ascent MANTLES onto (y=5.35)
# lands ~1.8 m low. No prompt fixes that: contain-fit cannot move a surface to a
# route height, only author-at-true-scale can. So the mesh is pinned so its
# natural bbox EQUALS the declared box (contain-fit 1.0) and the gallery/roof
# decks are real horizontal faces whose TOP sits exactly on the authored band.
# Same discipline as build_civic_facade.py: outer faces only, remove_doubles,
# and a hard per-axis bbox guard, so the weld gate reads ~0.
#
# Run: blender --background --python assets/pipeline/build_wharf_warehouse.py -- <key> <out.glb>
import bpy
import bmesh
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
KEY = argv[0]
OUT_GLB = os.path.abspath(argv[1])
SEED = 74010207
RNG = np.random.default_rng(SEED)
TEX = 1024

# PHOTOREAL: keep the clean, box-accurate, weld-clean FORM (the Meshy image-to-3D
# mesh fails the weld gate — 1147 pairs, floors at ~153 under decimation vs the 64
# gate — and drops the loading gallery, so its geometry can't ship). Instead wear
# the CONCEPT's real materials: palette sampled from
# assets/wharf-warehouse-photoreal-concept.png (dark warm brick, weathered
# silver-grey timber, dark wet slate, grey stone), with grime/streak/efflorescence
# layers so the facade reads photoreal, not flat. Same discipline as the steeple.
PHOTOREAL = os.environ.get("PHOTOREAL", "") not in ("", "0", "false")
NO_NORMAL = os.environ.get("NO_NORMAL", "") not in ("", "0", "false")
CONCEPT_BRICK = (0.52, 0.315, 0.25)
CONCEPT_MORTAR = (0.58, 0.55, 0.49)
CONCEPT_TIMBER = (0.44, 0.40, 0.35)
CONCEPT_SLATE = (0.24, 0.26, 0.30)
CONCEPT_STONE = (0.54, 0.51, 0.46)

# ------------------------------------------------------------------ per-key spec
# All lengths in metres, at true (contain-fit 1.0) scale. Front face is +Y and
# carries the loading front (cargo door, projecting pentice + loft gallery, hoist
# beam). `front_setback` is how far the main wall sits back from the front edge:
# the pentice/gallery/hoist project across it, so the deck oversails the wall by
# exactly that much (>= the brief's minimum). Heights are envelope.ts BAND values.
#
# BOX = the LEVEL'S ACTUAL PLACEMENT box (packages/mission-m1/src/level/wharf.ts),
# not assets.ts sizeM, which is STALE: wharf.ts backdrop() draws each warehouse by
# contain-fitting the asset into its own mass rect+roofY, and check-world-collision
# measures fill against THAT. wharf-b is rect(-5,2,3,12) topY 8 => 7 x 8 x 9 (NOT
# assets.ts [13,8,9]); wharf-a is rect(-19,-5,3,12) topY 9 => 14 x 9 x 9 (NOT
# [14,9,10]). Building to sizeM drew wharf-b at 43% fill. Flagged for the owner.
SPEC = {
    "bldg-warehouse-wharf-b": dict(
        W=7.0, H=8.0, D=9.0,       # wharf.ts WHARF_WAREHOUSE_B rect 7x9, topY 8
        brick=(0.44, 0.20, 0.16),
        ground_top=3.2,            # cargo-bay header
        gallery_y=5.35,            # PENTICE band: the loft loading gallery deck
        gallery_thick=0.34,
        gallery_width=6.2,
        pentice_y=2.9,             # SCAFFOLD_1 band: the ground loading pentice
        pentice_thick=0.22,
        pentice_width=6.2,
        hoist_y=6.9,               # hoist-beam hang hold above the gallery
        loft_head=6.9,
        roof="flat",
        roof_deck=7.5,             # flat leaded roof deck (standable)
        dormer_top=8.0,            # dormer ridge pins the box height
        front_setback=1.1,         # >= 0.7 m oversail (brief)
        cargo_w=2.4, cargo_h=2.6,
        loft_w=1.8,
        portal_w=4.4,              # loading-bay opening in the front plane (rest = solid brick flanks)
    ),
    "bldg-warehouse-wharf-a": dict(
        W=14.0, H=9.0, D=9.0,      # wharf.ts WHARF_WAREHOUSE_A rect 14x9, topY 9
        brick=(0.47, 0.31, 0.23),
        ground_top=3.3,
        gallery_y=5.35,
        gallery_thick=0.34,
        gallery_width=12.4,
        pentice_y=2.9,
        pentice_thick=0.22,
        pentice_width=12.4,
        hoist_y=6.9,
        loft_head=7.0,
        roof="gambrel",
        roof_deck=7.4,             # gambrel lower eave / start of the ridge walk
        ridge_walk_y=9.0,          # standable ridge walk on top (pins box height)
        ridge_walk_w=3.0,
        dormer_top=9.0,
        stair_stub=True,           # external stone stair-stub at STEP_UP
        front_setback=1.0,         # >= 0.6 m oversail (brief)
        cargo_w=3.6, cargo_h=2.7,
        loft_w=2.6,
        portal_w=8.0,              # loading-bay opening in the front plane (rest = solid brick flanks)
    ),
}
CFG = SPEC[KEY]
W, H, D = CFG["W"], CFG["H"], CFG["D"]
FW = D / 2 - CFG["front_setback"]           # front wall plane (Blender +Y)


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
    n = TEX; NC, NB = 24, 8
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
    dark = var < 0.18
    rgb[dark] *= 0.62
    rgb = np.clip(rgb + (aniso(n, 220, 200, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    mortar = np.clip(np.array([0.60, 0.57, 0.50])[None, None, :] + (aniso(n, 90, 90, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    t = mask[..., None]
    return np.clip(mortar * (1 - t) + rgb * t, 0, 1), 0.25 + 0.75 * mask


def plank_rgb(base, vertical=False, boards=9):
    """Weathered timber boards: a run of boards with a seam line and grain."""
    n = TEX
    u = np.linspace(0, 1, n, endpoint=False)
    coord = u[None, :] if not vertical else u[:, None]
    coord = np.broadcast_to(coord, (n, n))
    fb = coord * boards; board = np.floor(fb); bf = fb - board
    seam = _ss(0.0, 0.03, bf) * _ss(0.0, 0.03, 1 - bf)      # dark groove between boards
    bseed = np.sin(board * 27.1) * 43758.5; bvar = bseed - np.floor(bseed)
    grain = aniso(n, 8 if vertical else 240, 240 if vertical else 8, RNG)
    base = np.array(base)
    rgb = base[None, None, :] * (0.80 + 0.4 * bvar)[..., None]
    rgb = np.clip(rgb * (0.88 + 0.24 * grain)[..., None], 0, 1)
    rgb = rgb * (0.66 + 0.34 * seam)[..., None]             # groove darkens (weathered, not black)
    return np.clip(rgb, 0, 1)


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


def _img(name, rgb):
    h, w = rgb.shape[:2]
    rgba = np.concatenate([rgb, np.ones((h, w, 1))], 2)
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    return img


def pack_jpeg(name, rgb, q=90):
    _img(name + "-src", rgb)
    sc = bpy.context.scene; sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = q
    path = os.path.join(os.path.dirname(OUT_GLB) or ".", f"_wh_{name}.jpg")
    bpy.data.images[name + "-src"].save_render(path)
    baked = bpy.data.images.load(path); baked.name = name; baked.pack()
    try: os.remove(path)
    except OSError: pass
    return baked


def make_normal(h, strength=2.4, name="n"):
    n = h.shape[0]
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(h)
    inv = 1 / np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5], 2)
    # A bare generated image is not packed, so the glTF exporter writes it BLACK ->
    # Cycles flips the normal inward -> the face reads unlit/black. Write the RAW
    # pixels to a PNG with img.save() (NOT save_render, which would bake the view
    # transform into the normal), reload + pack so the exporter has real data.
    src = _img(f"{KEY}-{name}", rgb)
    src.colorspace_settings.name = "Non-Color"
    path = os.path.join(os.path.dirname(OUT_GLB) or ".", f"_wh_{KEY}_{name}.png")
    src.filepath_raw = path; src.file_format = "PNG"; src.save()
    baked = bpy.data.images.load(path); baked.name = f"{KEY}-{name}b"
    baked.colorspace_settings.name = "Non-Color"; baked.pack()
    try: os.remove(path)
    except OSError: pass
    return baked


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


# ---- photoreal weathering layers (applied only when PHOTOREAL) ----------------
def add_grime(rgb):
    """Vertical water-streaking, broad soot blotches and pale efflorescence — the
    aged-brick read the flat procedural fill lacks."""
    n = rgb.shape[0]
    out = rgb.copy()
    streak = aniso(n, 150, 5, RNG)                       # long vertical runs
    out *= (0.74 + 0.26 * streak)[..., None]
    grime = aniso(n, 22, 22, RNG)                        # broad soot blotches
    out *= (0.85 + 0.15 * grime)[..., None]
    top = np.linspace(1.0, 0.82, n)[:, None, None]       # sootier toward the eaves
    out *= top
    fle = aniso(n, 320, 320, RNG)                        # lime efflorescence flecks
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
    """Overlapping slate courses: staggered rows, per-slate tone, a shadow line at
    each course head (the overlap read), a cold blue-grey tint."""
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
    head = np.broadcast_to(_ss(0.0, 0.07, rf), (n, n))   # course head shadow (overlap)
    seam = _ss(0.0, 0.02, sf) * _ss(0.0, 0.02, 1 - sf)
    rgb *= (0.55 + 0.45 * head)[..., None]
    rgb *= (0.7 + 0.3 * seam)[..., None]
    return np.clip(rgb, 0, 1), (0.4 + 0.6 * head).copy()


log("textures", "PHOTOREAL" if PHOTOREAL else "flat")
bpy.ops.wm.read_factory_settings(use_empty=True)
# NORMAL-MAP EXPORT BUG: a generated normal image exports BLACK through the glTF
# writer here (verified: with the normal attached the brick renders unlit/black in
# Cycles AND would do the same in the game engine; without it the brick reads
# correctly). Until the export path is fixed, photoreal ships WITHOUT tangent-space
# normals — the base-colour maps already carry the mortar/grain/streak detail. The
# non-photoreal path keeps its (harmless-in-EEVEE) normal for back-compat.
# FLAGGED for the coordinator: the shipped procedural GLBs (560a21c) also attach
# this normal, so their brick may render dark in-engine — worth a check at sync.
def nrm(h, strength, name):
    if NO_NORMAL or PHOTOREAL:
        return None
    return make_normal(h, strength, name)


if PHOTOREAL:
    B_RGB, B_H = brick_fields(CONCEPT_BRICK)
    B_RGB = add_grime(B_RGB)
    S_RGB, S_H = slate_rgb(CONCEPT_SLATE)
    MAT_BRICK = make_material("brick", pack_jpeg("brick", B_RGB), normal=nrm(B_H, 3.0, "brickn"), rough=0.95, spec=0.14)
    MAT_GLASS = make_material("glass", pack_jpeg("window", window_rgb()), rough=0.32, spec=0.45)
    MAT_TRIM = make_material("trim", pack_jpeg("trim", flat_rgb(TEX // 2, CONCEPT_STONE, 0.12)), rough=0.86, spec=0.2)
    MAT_LEAD = make_material("lead", pack_jpeg("lead", S_RGB), normal=nrm(S_H, 2.0, "slaten"), rough=0.5, spec=0.4)
    MAT_TIMBER = make_material("timber", pack_jpeg("timber", add_cracks(plank_rgb(CONCEPT_TIMBER))), rough=0.9, spec=0.1)
    MAT_TIMBER_V = make_material("timberv", pack_jpeg("timberv", add_cracks(plank_rgb(tuple(c * 0.86 for c in CONCEPT_TIMBER), vertical=True))), rough=0.92, spec=0.1)
else:
    B_RGB, B_H = brick_fields(CFG["brick"])
    MAT_BRICK = make_material("brick", pack_jpeg("brick", B_RGB), normal=nrm(B_H, 2.4, "brickn"))
    MAT_GLASS = make_material("glass", pack_jpeg("window", window_rgb()), rough=0.5, spec=0.25)
    MAT_TRIM = make_material("trim", pack_jpeg("trim", flat_rgb(TEX // 4, (0.80, 0.78, 0.72))), rough=0.9, spec=0.18)
    MAT_LEAD = make_material("lead", pack_jpeg("lead", flat_rgb(TEX // 4, (0.52, 0.53, 0.53))), rough=0.86, spec=0.2)
    MAT_TIMBER = make_material("timber", pack_jpeg("timber", plank_rgb((0.46, 0.35, 0.24))), rough=0.93, spec=0.12)
    MAT_TIMBER_V = make_material("timberv", pack_jpeg("timberv", plank_rgb((0.34, 0.24, 0.16), vertical=True)), rough=0.94, spec=0.12)
IB, IW, IT, IL, ITM, ITV = 0, 1, 2, 3, 4, 5
# sign board material (painted board with baked serif signage); falls back to trim
SIGN_PNG = os.environ.get("SIGN_PNG", "")
if PHOTOREAL and SIGN_PNG and os.path.exists(SIGN_PNG):
    _si = bpy.data.images.load(SIGN_PNG); _si.name = "sign"; _si.pack()
    MAT_SIGN = make_material("sign", _si, rough=0.72, spec=0.22)
else:
    MAT_SIGN = MAT_TRIM
ISG = 6

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


def nface(points, mat, uvs):
    """An n-gon face (e.g. a gambrel gable end), UVs given per point."""
    vs = [bm.verts.new(Vector(p)) for p in points]
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


def solid_box(x0, x1, y0, y1, z0, z1, mat, faces="all", tile=BRICK_TILE):
    want = {"+x", "-x", "+y", "-y", "+z", "-z"} if faces == "all" else set(faces)
    U = lambda p, q: (p / tile, q / tile)
    if "+z" in want: quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), mat, [U(x0, y0), U(x1, y0), U(x1, y1), U(x0, y1)])
    if "-z" in want: quad((x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0), mat, [U(x0, y1), U(x1, y1), U(x1, y0), U(x0, y0)])
    if "-y" in want: quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), mat, [U(x0, z0), U(x1, z0), U(x1, z1), U(x0, z1)])
    if "+y" in want: quad((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1), mat, [U(x1, z0), U(x0, z0), U(x0, z1), U(x1, z1)])
    if "-x" in want: quad((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1), mat, [U(y1, z0), U(y0, z0), U(y0, z1), U(y1, z1)])
    if "+x" in want: quad((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), mat, [U(y0, z0), U(y1, z0), U(y1, z1), U(y0, z1)])


# ---- a wall face with rectangular openings, brick fill by band-guillotine -----
# origin: the face's (a=0,u=0) corner (Blender xyz). along: +a direction (unit).
# up: +u direction. inward: into the wall (unit, away from outward face).
# openings: list of (a0,a1,u0,u1,kind) with kind in {"win","door"}. The brick is
# the (a,u)-complement of the openings, partitioned into rectangles by the
# openings' u-edges (bands) then their a-edges — no two faces coincide, so the
# weld gate stays clean. Each opening is a recessed inset (reveals + back panel).
RECESS = 0.26


def paneled_face(origin, along, up, inward, Wf, Hf, openings, tile=BRICK_TILE):
    def P(a, u, d):
        return origin + along * a + up * u + inward * d

    ubreaks = sorted({0.0, Hf} | {o[2] for o in openings} | {o[3] for o in openings})
    for bi in range(len(ubreaks) - 1):
        ub0, ub1 = ubreaks[bi], ubreaks[bi + 1]
        if ub1 - ub0 < 1e-4:
            continue
        holes = sorted((o[0], o[1]) for o in openings if o[2] <= ub0 + 1e-4 and o[3] >= ub1 - 1e-4)
        a = 0.0
        segs = []
        for (h0, h1) in holes:
            if h0 - a > 1e-4:
                segs.append((a, h0))
            a = max(a, h1)
        if Wf - a > 1e-4:
            segs.append((a, Wf))
        for (sa0, sa1) in segs:
            quad(P(sa0, ub0, 0), P(sa1, ub0, 0), P(sa1, ub1, 0), P(sa0, ub1, 0), IB,
                 [(sa0 / tile, ub0 / tile), (sa1 / tile, ub0 / tile), (sa1 / tile, ub1 / tile), (sa0 / tile, ub1 / tile)])

    for (a0, a1, u0, u1, kind) in openings:
        mat = IW if kind == "win" else ITV
        aw, uw = a1 - a0, u1 - u0
        # inset back panel
        quad(P(a0, u0, RECESS), P(a1, u0, RECESS), P(a1, u1, RECESS), P(a0, u1, RECESS), mat,
             [(0.04, 0.04), (0.96, 0.04), (0.96, 0.96), (0.04, 0.96)])
        # reveals (trim), skip the sill reveal for a ground door (u0 ~ 0)
        quad(P(a0, u1, 0), P(a1, u1, 0), P(a1, u1, RECESS), P(a0, u1, RECESS), IT, [(0, 0), (aw, 0), (aw, RECESS), (0, RECESS)])  # head
        if not (kind == "door" and u0 < 0.05):
            quad(P(a0, u0, 0), P(a1, u0, 0), P(a1, u0, RECESS), P(a0, u0, RECESS), IT, [(0, 0), (aw, 0), (aw, RECESS), (0, RECESS)])  # sill
        quad(P(a0, u0, 0), P(a0, u1, 0), P(a0, u1, RECESS), P(a0, u0, RECESS), IT, [(0, 0), (uw, 0), (uw, RECESS), (0, RECESS)])   # left
        quad(P(a1, u0, 0), P(a1, u1, 0), P(a1, u1, RECESS), P(a1, u0, RECESS), IT, [(0, 0), (uw, 0), (uw, RECESS), (0, RECESS)])   # right


def window_grid(Wf, Hf, storey, bay, ww=1.2, wh=1.6, u_lo=0.6):
    """Regular sash openings centred in a nx x ny grid over a wall face."""
    nx = max(1, int(round(Wf / bay)))
    ny = max(1, int(round((Hf - u_lo) / storey)))
    out = []
    for i in range(nx):
        cx = (i + 0.5) * Wf / nx
        for j in range(ny):
            cu = u_lo + (j + 0.5) * (Hf - u_lo) / ny
            out.append((cx - ww / 2, cx + ww / 2, cu - wh / 2, cu + wh / 2, "win"))
    return out


X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
hx, hz = W / 2, D / 2

# ---- FRONT (+Y) LOADING PORTAL in a SOLID BRICK FACADE ------------------------
# PLAYTEST #2 FIX. Previously the WHOLE front wall was set back to FW, so the
# entire face read as an open, carved-out recess with thin decks floating in it —
# "a hole in the middle of the building". Now the front plane (hz) carries a SOLID
# brick facade with brick corner flanks, and only a central LOADING PORTAL is
# recessed: the loading wall sits back at FW behind the deck (solid, with the
# cargo + loft doors as recessed openings), brick jambs return from the front plane
# to that wall, and the covered eave is the lintel. The gallery/pentice decks live
# INSIDE this framed covered bay — a real warehouse loading gallery, not a void.
cw, ch = CFG["cargo_w"], CFG["cargo_h"]
lw = CFG["loft_w"]
gy = CFG["gallery_y"]
rd_top = CFG["roof_deck"]
PORTAL_W = CFG["portal_w"]
hpw = PORTAL_W / 2
PORTAL_TOP = rd_top - 0.18                        # opening head = the covered-eave soffit
loft_door_head = min(CFG["loft_head"], PORTAL_TOP - 0.9)

# solid brick corner flanks: a solid brick block from the set-back wall (FW) to the
# front plane (hz), full height, on each side of the portal. The front facade is a
# paneled brick face with recessed sash windows; the inner face is the deep jamb
# reveal of the portal. (Facade drawn via paneled_face so the windows are true
# cut-outs — no coincident proud boxes on the +Y plane, keeping the weld gate clean.)
for sgn in (-1, 1):
    fx0, fx1 = (hpw, hx) if sgn > 0 else (-hx, -hpw)
    jamb = "-x" if sgn > 0 else "+x"              # face that looks INTO the portal
    solid_box(fx0, fx1, FW, hz, 0.0, rd_top, IB, faces=(jamb, "+z"), tile=BRICK_TILE)
    wc = (fx0 + fx1) / 2 - fx0                     # window centre in face-local coords
    flank_open = [(wc - 0.55, wc + 0.55, 1.4, 3.0, "win"),
                  (wc - 0.55, wc + 0.55, gy + 0.6, gy + 2.0, "win")]
    paneled_face(Vector((fx0, hz, 0.0)), X, Z, -Y, fx1 - fx0, rd_top, flank_open)

# the recessed LOADING WALL at FW (solid brick behind the deck) with the cargo bay
# + loft door as recessed openings INTO the solid wall (not holes through)
portal_open = [
    (-cw / 2, cw / 2, 0.0, ch, "door"),                       # ground cargo bay
    (-lw / 2, lw / 2, gy, loft_door_head, "door"),            # loft loading door
]
paneled_face(Vector((-hpw, FW, 0.0)), X, Z, -Y, PORTAL_W, PORTAL_TOP, portal_open)
# (the solid brick flanks above already supply the deep jamb reveals at +/-hpw)

# ---- BACK (-Y) and SIDES (+/-X): brick with sash grids ------------------------
paneled_face(Vector((hx, -hz, 0.0)), -X, Z, Y, W, CFG["roof_deck"],
             window_grid(W, CFG["roof_deck"], 2.7, 3.0))
paneled_face(Vector((hx, -hz, 0.0)), Y, Z, -X, D, CFG["roof_deck"],
             window_grid(D, CFG["roof_deck"], 2.7, 3.0))                       # +X (east)
paneled_face(Vector((-hx, hz, 0.0)), -Y, Z, X, D, CFG["roof_deck"],
             window_grid(D, CFG["roof_deck"], 2.7, 3.0))                       # -X (west)

# ---- corner quoins / string course for the Georgian read ----------------------
# a slim stone string-course band at the gallery floor, wrapping the set-back
# body (front is the gallery, so band the other three sides only)
sc = CFG["gallery_y"]
solid_box(-hx, hx, -hz, FW, sc - 0.12, sc, IT, faces=("-y", "+x", "-x"), tile=1.0)

# The pentice + gallery decks now live INSIDE the framed portal (width = the portal
# opening less a small margin off the jambs), so they read as the floors of a
# covered loading bay rather than shelves stuck on an open recess.
deck_w = PORTAL_W - 0.3

# ---- ground PENTICE: a projecting flat loading canopy over the cargo door ------
py = CFG["pentice_y"]
solid_box(-deck_w / 2, deck_w / 2, FW, hz, py - CFG["pentice_thick"], py, ITM,
          faces=("+z", "-z", "+y", "-x", "+x"), tile=1.4)
solid_box(-deck_w / 2, deck_w / 2, hz - 0.06, hz, py - 0.42, py - CFG["pentice_thick"], ITM,
          faces=("+y", "-y", "-x", "+x", "-z"), tile=1.0)                                     # fascia

# ---- loft GALLERY deck at 5.35: projecting standable loft platform -------------
gw = deck_w
solid_box(-gw / 2, gw / 2, FW, hz, gy - CFG["gallery_thick"], gy, ITM,
          faces=("+z", "-z", "+y", "-x", "+x"), tile=1.4)
solid_box(-gw / 2, gw / 2, hz - 0.06, hz, gy - 0.5, gy - CFG["gallery_thick"], ITM,
          faces=("+y", "-y", "-x", "+x", "-z"), tile=1.0)                                     # fascia

# ---- loading-gallery support posts: ground -> gallery, at the portal front lip --
_np = max(2, int(round(gw / 2.6)))
post_xs = sorted({round(x, 2) for x in np.linspace(-gw / 2 + 0.3, gw / 2 - 0.3, _np)})
for pxp in post_xs:
    solid_box(pxp - 0.10, pxp + 0.10, hz - 0.28, hz - 0.08, 0.0, gy - 0.02, ITM,
              faces=("+x", "-x", "+y", "-y"), tile=1.0)
# gallery guard rail on the FRONT lip only (low; clear of the standing span)
rail_top = gy + 0.5
for rx in (-gw / 2 + 0.15, gw / 2 - 0.15, 0.0):
    solid_box(rx - 0.06, rx + 0.06, hz - 0.12, hz, gy, rail_top, ITM, faces=("+x", "-x", "+y", "-y", "+z"), tile=1.0)
solid_box(-gw / 2, gw / 2, hz - 0.12, hz, rail_top - 0.08, rail_top, ITM, faces=("+z", "-z", "+y", "-y", "+x", "-x"), tile=1.0)

# ---- HOIST BEAM: a projecting timber beam above the gallery (a hang hold) ------
# It now hangs UNDER the covered eave (below), so it reads as a real hoist beam in
# a covered loading gallery rather than a beam poking out of an open notch.
hb = CFG["hoist_y"]
solid_box(-0.16, 0.16, FW - 0.3, hz, hb, hb + 0.28, ITM, faces="all", tile=1.0)          # the projecting hoist beam
solid_box(-0.22, 0.22, hz - 0.32, hz, hb - 0.34, hb, ITM, faces="all", tile=1.0)         # a pulley block at the tip

if CFG["roof"] == "flat":
    # ---- flat leaded ROOF DECK over the body, with a low parapet + dormers -----
    rd = CFG["roof_deck"]
    solid_box(-hx, hx, -hz, FW, rd - 0.16, rd, IL, faces=("+z",), tile=1.3)             # the lead deck (standable top)
    # low parapet round three sides (front open onto the gallery approach)
    for (px0, px1, py0, py1) in [(-hx, hx, -hz, -hz + 0.18), (-hx, -hx + 0.18, -hz, FW), (hx - 0.18, hx, -hz, FW)]:
        solid_box(px0, px1, py0, py1, rd, rd + 0.28, IL, faces=("+z", "-z", "+y", "-y", "+x", "-x"), tile=1.0)
    # dormers: sills at STEP_UP (<=0.5 m) above the deck; ridge pins the box top
    dt = CFG["dormer_top"]
    for dx in (-hx * 0.5, hx * 0.5):
        solid_box(dx - 1.0, dx + 1.0, FW - 2.2, FW - 0.8, rd, dt, ITM, faces=("+y", "-y", "+x", "-x"), tile=1.0)
        solid_box(dx - 1.0, dx + 1.0, FW - 2.2, FW - 0.8, dt - 0.12, dt, IL, faces=("+z",), tile=1.0)   # dormer lead top
        # dormer window
        solid_box(dx - 0.55, dx + 0.55, FW - 0.82, FW - 0.8, rd + 0.35, dt - 0.25, IW, faces=("+y",), tile=1.0)
    # chimney (kept below the dormer ridge)
    solid_box(-1.0, -0.2, -1.4, -0.6, rd, dt - 0.2, IB, faces="all", tile=1.0)
else:
    # ---- GAMBREL roof with a standable ridge walk (wharf-a) --------------------
    # Real double-pitched gambrel: steep lower slope eave->knuckle, shallow upper
    # knuckle->ridge, a FLAT lead ridge walk on top (standable, pins the box top),
    # and a brick gable n-gon closing each end so nothing sees through.
    rd = CFG["roof_deck"]                     # eave height
    rw = CFG["ridge_walk_y"]                   # ridge walk (top)
    rh = CFG["ridge_walk_w"] / 2               # ridge half-width (depth of the walk)
    yb, yf = -hz, FW                            # roof depth span (back wall, front wall)
    yc = (yb + yf) / 2.0
    half = (yf - yb) / 2.0
    kn = half * 0.52                            # knuckle offset from centre
    kz = rd + (rw - rd) * 0.5                   # knuckle height

    def slope(y_a, z_a, y_b, z_b):              # a lead slope band across the full width
        quad((-hx, yc + y_a, z_a), (hx, yc + y_a, z_a), (hx, yc + y_b, z_b), (-hx, yc + y_b, z_b), IL,
             [(0, 0), (W / 1.2, 0), (W / 1.2, 1.6), (0, 1.6)])
    slope(half, rd, kn, kz);   slope(kn, kz, rh, rw)      # front steep + shallow
    slope(-half, rd, -kn, kz); slope(-kn, kz, -rh, rw)    # back steep + shallow
    quad((-hx, yc - rh, rw), (hx, yc - rh, rw), (hx, yc + rh, rw), (-hx, yc + rh, rw), IL,
         [(0, 0), (W, 0), (W, rh * 2), (0, rh * 2)])       # flat ridge walk (standable top)
    # brick gable ends following the gambrel profile
    prof = [(yc + half, rd), (yc + kn, kz), (yc + rh, rw), (yc - rh, rw), (yc - kn, kz), (yc - half, rd)]
    for gx, nrm in ((hx, 1), (-hx, -1)):
        pts = [(gx, y, z) for (y, z) in (prof if nrm > 0 else list(reversed(prof)))]
        nface(pts, IB, [((y - yb) / 3.0, z / 3.0) for (y, z) in (prof if nrm > 0 else list(reversed(prof)))])
    if CFG.get("stair_stub"):
        # external stone stair-stub against the loading front, beside the cargo
        # door and inside the box footprint: two treads, tops flat at STEP_UP and
        # 2xSTEP_UP (the intermediate mantle footing off the wharf deck).
        sx0 = cw / 2 + 0.4
        sx1 = min(sx0 + 1.9, hpw - 0.15)          # keep the stair inside the portal opening
        solid_box(sx0, sx1, FW, hz - 0.1, 0.0, 0.5, IT, faces=("+z", "-z", "+y", "+x", "-x"), tile=1.0)
        solid_box(sx0 + 0.5, sx1, FW, hz - 0.7, 0.5, 1.0, IT, faces=("+z", "-z", "+y", "+x", "-x"), tile=1.0)

# ---- COVERED EAVE over the loading loggia (playtest #2 fix) --------------------
# The set-back loading front used to read as an OPEN NOTCH punched in the corner:
# the roof stopped at the wall plane (FW), so the projecting gallery/pentice sat in
# an open-topped recess you could see down into. Oversail the roof forward over the
# loggia (FW -> front edge) so the gallery becomes a COVERED loading gallery against
# a solid wall — a real warehouse loading front, not a hole. The gallery deck stays
# at 5.35 and the roof deck at CFG['roof_deck'] (both drawn==collision, unmoved);
# this only adds a covering slab over the previously-open strip.
eave_z = CFG["roof_deck"]
# lead soffit + top over the portal opening only (the brick flanks already roof the
# FW->hz strip outside the portal), so the covered bay reads closed on top
solid_box(-hpw, hpw, FW, hz, eave_z - 0.18, eave_z, IL, faces=("+z", "-z", "+y"), tile=1.3)
# a timber head-beam across the top of the loading opening (the covered-bay lintel)
solid_box(-hpw + 0.1, hpw - 0.1, FW, FW + 0.22, PORTAL_TOP - 0.30, PORTAL_TOP, ITM,
          faces=("+y", "-x", "+x", "-z", "+z"), tile=1.2)

if PHOTOREAL:
    # ======================= PHOTOREAL GEOMETRIC DETAIL =========================
    # Rich single-skin detail on the HERO LOADING FRONT. Its wall is set back to FW,
    # so every element projects PROUD toward the front edge yet stays inside the
    # declared box; the brick side/back walls sit on the box faces and keep their
    # recessed reveals. Each element is a separate solid offset off the wall plane
    # (no coincident same-facing faces), and the against-wall (-y) face is omitted,
    # so the weld gate stays clean and no doubled skin is reintroduced.
    def wedge(x0, x1, y_back, z_lo, y_lip, z_hi, mat):
        """Right-triangle timber bracket under a deck lip (back on the wall, top
        under the lip, hypotenuse across)."""
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
                p = lp.vert.co; lp[uv].uv = (p.x + p.y, p.z + 0.5 * p.y)  # skew so no face is UV-degenerate

    # (1) corbel brackets under the pentice and the loading gallery, at each post
    for pxp in post_xs:
        gbot = gy - CFG["gallery_thick"]
        wedge(pxp - 0.10, pxp + 0.10, FW + 0.03, gbot - 0.85, hz - 0.15, gbot - 0.05, ITM)
        pbot = py - CFG["pentice_thick"]
        wedge(pxp - 0.09, pxp + 0.09, FW + 0.03, pbot - 0.60, hz - 0.15, pbot - 0.05, ITM)

    # (2) stone pilasters framing the cargo bay (apron -> under the pentice), proud
    for sgnp in (-1, 1):
        pxs = sgnp * (cw / 2 + 0.30)
        solid_box(pxs - 0.20, pxs + 0.20, FW, FW + 0.16, 0.05, py - CFG["pentice_thick"] - 0.06,
                  IT, faces=("+y", "-x", "+x", "+z"), tile=1.1)

    # (3) segmental stone ARCHED HEAD over the cargo bay (voussoirs + crown keystone),
    # tucked into the door-head zone below the pentice
    for t in np.linspace(-1.0, 1.0, 9):
        vx = t * (cw / 2 + 0.06)
        vz = ch - 0.20 - 0.42 * (t * t)                    # crown high at t=0, springs low
        crown = abs(t) < 0.13
        hw = 0.26 if crown else 0.17
        hh = 0.20 if crown else 0.15
        solid_box(vx - hw, vx + hw, FW, FW + (0.16 if crown else 0.11), vz - hh, vz + hh,
                  IT, faces=("+y", "-x", "+x", "+z", "-z"), tile=1.0)

    # (4) a projecting weather HOOD + brackets over the loft loading door
    solid_box(-lw / 2 - 0.35, lw / 2 + 0.35, FW, FW + 0.55, loft_door_head, loft_door_head + 0.20,
              ITM, faces=("+y", "-x", "+x", "+z", "-z"), tile=1.0)
    for hxb in (-lw / 2 - 0.18, lw / 2 + 0.18):
        wedge(hxb - 0.06, hxb + 0.06, FW + 0.03, loft_door_head - 0.5, FW + 0.5, loft_door_head - 0.02, ITM)

    # (5) painted SIGN board above the loft door (trim-edged body + textured face)
    sb0 = loft_door_head + 0.30
    sb1 = min(CFG["roof_deck"] - 0.40, sb0 + 1.15)
    sbw = min(PORTAL_W - 0.6, (sb1 - sb0) * 2.7)
    solid_box(-sbw / 2 - 0.08, sbw / 2 + 0.08, FW, FW + 0.10, sb0 - 0.08, sb1 + 0.08,
              IT, faces=("+y", "-x", "+x", "+z", "-z"), tile=1.0)
    quad((-sbw / 2, FW + 0.11, sb0), (sbw / 2, FW + 0.11, sb0),
         (sbw / 2, FW + 0.11, sb1), (-sbw / 2, FW + 0.11, sb1), ISG,
         [(1, 0), (0, 0), (0, 1), (1, 1)])  # flip U: face is +Y, read left-to-right from the front

    # (6) projecting stone CORNICE band across the recessed loading wall (portal
    # width only, so it is not buried inside the solid brick flanks)
    solid_box(-hpw, hpw, FW, FW + 0.14, CFG["roof_deck"] - 0.52, CFG["roof_deck"] - 0.24,
              IT, faces=("+y", "+z", "-z", "-x", "+x"), tile=1.2)

    # (7) roof: a chimney CAP for a stronger silhouette (flat roof only)
    if CFG["roof"] == "flat":
        solid_box(-1.08, -0.12, -1.48, -0.52, dt - 0.28, dt - 0.10, IT, faces="all", tile=1.0)

# ---- ground apron: pins the bbox to the DECLARED box, centred, base 0 ----------
solid_box(-hx, hx, -hz, hz, 0.0, 0.03, IT, faces="all", tile=1.5)

# ----------------------------------------------------------------- finalise
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
mesh = bpy.data.meshes.new(KEY); bm.to_mesh(mesh); bm.free()
obj = bpy.data.objects.new(KEY, mesh)
for m in (MAT_BRICK, MAT_GLASS, MAT_TRIM, MAT_LEAD, MAT_TIMBER, MAT_TIMBER_V, MAT_SIGN):
    obj.data.materials.append(m)
for poly in obj.data.polygons:
    poly.use_smooth = False
bpy.context.scene.collection.objects.link(obj)

co = np.array([v.co[:] for v in obj.data.vertices])
lo, hi = co.min(0), co.max(0)
size = hi - lo
centre = (lo + hi) / 2.0
log(f"blender bbox {size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f}  -> gltf {size[0]:.3f}(w) x {size[2]:.3f}(h) x {size[1]:.3f}(d)  declared {W}x{H}x{D}")
for axis, got, dec in (("width", size[0], W), ("height", size[2], H), ("depth", size[1], D)):
    if abs(got - dec) > 0.02:
        raise SystemExit(f"{axis} {got:.3f} != declared {dec}; contain-fit would move the route planes")
if abs(centre[0]) > 0.02 or abs(centre[1]) > 0.02 or abs(lo[2]) > 0.02:
    raise SystemExit(f"bbox not centred on axis at base 0 (centre {centre[0]:+.3f},{centre[1]:+.3f}, minZ {lo[2]:.3f})")
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
log(f"tris {tris}  verts {len(obj.data.vertices)}  gallery_top={CFG['gallery_y']}  roof={CFG['roof']}")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_yup=True, export_animations=False,
                          export_image_format="AUTO", export_jpeg_quality=90, export_tangents=True, use_selection=True)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
