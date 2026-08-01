# Author a Boston waterfront warehouse as a clean, box-accurate procedural GLB —
# the wharf worker's two counting-house/warehouse rebuilds, driven directly by
# the level's declared box + route bands rather than by a Meshy blob.
#
# WHY PROCEDURAL, AND WHY LOW SHEDS. A contain-fit takes the SMALLEST of the three
# box/mesh ratios (uniform scale), so a mesh whose aspect differs from its box
# gets scaled by its binding axis and leaves the others short. The level places
# each shed by structure() with the mass topY == roofY, so the box is rect x roofY;
# the roofs the wharf chain stands on are LOW (5.35 and 4.30). A tall warehouse
# mesh in that low box height-binds and draws only a shrunk ridge band at roofY,
# with the rest of the deck over invisible floor (the 31-Jul defect). Contain-fit
# cannot move a surface to a route height; only author-at-true-scale can. So each
# shed is authored at its BOX's true (low) proportions — natural bbox EQUALS the
# declared box (contain-fit 1.0) — with the walkable leaded roof as a real
# horizontal face at the LOCAL TOP (z=H), so it lands exactly on the authored deck
# plane across the WHOLE footprint. Same discipline as build_civic_facade.py:
# outer faces only, remove_doubles, and a hard per-axis bbox guard, weld ~0.
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
# carries the loading front (cargo door, covered pentice canopy, loft door, hoist
# beam). `front_setback` is how far the loading wall sits back from the front edge;
# the covered eave oversails it, so the roof shelters a real loading loggia.
#
# WHY THESE ARE LOW SHEDS NOW (31 Jul rebuild). BOX = the LEVEL'S ACTUAL PLACEMENT
# box (packages/mission-m1/src/level/wharf.ts): structure() sets the mass topY =
# roofY and the roof deck y = roofY, so the placement box is rect x roofY and the
# asset contain-fits into it. A contain-fit takes the SMALLEST of the three ratios
# (uniform scale), so a TALL mesh in a low box height-binds: the old wharf-a was
# built 14x9x9 against a rect(-10,0,-2,6) roofY 5.35 box (10 x 5.35 x 8), scale
# 5.35/9 = 0.594, which shrank the footprint to 8.3 x 5.35 and drew only the
# 3.0 m ridge walk (local z 9) at roofY as a 1.78 x 8.3 = ~14.8 m2 band — the
# rest of the deck was invisible floor over the shrunk pitched roof. The deck
# claims the whole footprint (narrowing it moves the take-off lips ~2.8 m inward
# and breaks the descents), so the ART must fill the box, not the deck retreat to
# the art. The ONLY fit that puts a standable surface at roofY across the whole
# footprint is contain-fit 1.0 — natural bbox == box — so each shed is authored at
# its box's true (low) proportions with the walkable roof at the LOCAL TOP (z=H),
# and the box guard below pins bbox == W x H x D exactly.
#
# THE ROOF IS FLAT, and wharf-a's gambrel silhouette is a deliberate, reported
# cost: roofY is the box cap, so a real pitched slope draws BELOW the collision
# plane and recreates the invisible-floor lie on a deck that claims the whole
# footprint. Both roofs are broad leaded walks at z=H across the full footprint;
# wharf-a's variation is proportion + a pitched leaded eave-skirt folding below
# the walk edge + gambrel-profiled gable ends (all <= H), not a raised ridge.
SPEC = {
    "bldg-warehouse-wharf-b": dict(
        W=4.0, H=4.30, D=8.0,      # wharf.ts WHARF_WAREHOUSE_B rect(-2,2,6,14) roofY 4.30
        brick=(0.44, 0.20, 0.16),
        roof="flat",
        cargo_w=1.8, cargo_h=2.3,
        loft_w=1.2,
        pentice_y=2.55, pentice_thick=0.20, pentice_width=2.6,
        hoist_y=3.65,
        front_setback=0.85,        # covered-eave oversail over the loading loggia
        portal_w=2.9,              # loading-bay opening (rest = solid brick flanks)
    ),
    "bldg-warehouse-wharf-a": dict(
        W=10.0, H=5.35, D=8.0,     # wharf.ts WHARF_WAREHOUSE_A rect(-10,0,-2,6) roofY 5.35
        brick=(0.47, 0.31, 0.23),
        roof="walk",               # flat leaded roof-walk + pitched eave-skirt (see note)
        eave_skirt=0.55,           # depth the leaded skirt folds below the walk edge
        eave_inset=0.9,            # how far in the skirt reaches (the pitched read)
        cargo_w=3.2, cargo_h=2.6,
        loft_w=2.2,
        pentice_y=2.85, pentice_thick=0.22, pentice_width=6.0,
        hoist_y=4.55,
        front_setback=1.0,         # covered-eave oversail over the loading loggia
        portal_w=6.4,              # loading-bay opening (rest = solid brick flanks)
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


def leaded_walk_rgb(across_len, along_len):
    """A period LEADED ROOF-WALK read, mapped 0..1 across the whole deck so it does
    not tile: standing-seam ROLLS at true ~0.72 m spacing (the defining feature that
    reads 'built lead roof' not 'shingle tile'), lead-sheet cross welts, large-scale
    tonal drift, water-streak / patina / soot weathering, and a fresher lead FLASHING
    band at the deck perimeter. Baked directional shading on the rolls carries the
    raised read without a normal map (the generator's normal path is disabled under
    PHOTOREAL, see nrm()). Kills the flat-uniform 'Minecraft' plane the owner flagged."""
    n = TEX
    u = np.broadcast_to(np.linspace(0, 1, n, endpoint=False)[None, :], (n, n))   # across rolls (x)
    v = np.broadcast_to(np.linspace(0, 1, n, endpoint=False)[:, None], (n, n))   # along rolls (y)
    nrolls = max(3, int(round(across_len / 0.72)))
    nwelts = max(2, int(round(along_len / 1.70)))

    # standing-seam rolls across u
    rw = 0.055
    phase = (u * nrolls) - np.floor(u * nrolls)
    seam_d = np.minimum(phase, 1 - phase)
    crest = np.clip(1.0 - seam_d / rw, 0.0, 1.0); crest = crest * crest * (3 - 2 * crest)
    flank = _ss(rw, rw * 2.4, seam_d) * _ss(rw * 2.4, rw, seam_d)                 # shadow band beside the roll

    lead = np.array([0.35, 0.38, 0.41])
    drift = aniso(n, 6, 5, RNG)                                                   # big soft tonal patches
    col = lead[None, None, :] * (0.78 + 0.42 * drift)[..., None]

    # per-bay + per-course weathering so the seam grid is NOT perfectly uniform
    rid = np.floor(u * nrolls); cid = np.floor(v * nwelts)
    bseed = np.sin(rid * 12.9 + cid * 4.7) * 43758.5; bvar = bseed - np.floor(bseed)
    col *= (0.80 + 0.40 * bvar)[..., None]

    patina = aniso(n, 26, 30, RNG)                                               # verdigris in the bays
    pmask = (_ss(0.60, 0.86, patina) * (1 - crest))[..., None]
    col = col * (1 - 0.45 * pmask) + np.array([0.30, 0.43, 0.35])[None, None, :] * (0.45 * pmask)

    streak = aniso(n, 4, 150, RNG)                                               # water running down-slope (v)
    col *= (0.82 + 0.20 * streak)[..., None]
    soot = np.linspace(0.90, 1.0, n)[:, None, None]                              # sootier toward one end
    col *= soot

    col = col * (1 - 0.34 * flank[..., None])                                    # roll self-shadow
    col = col * (0.90 + 0.55 * crest[..., None])                                 # roll crest catches light

    wphase = (v * nwelts) - np.floor(v * nwelts); wd = np.minimum(wphase, 1 - wphase)
    welt = np.clip(1 - wd / 0.02, 0, 1); welt = welt * welt * (3 - 2 * welt) * (1 - crest)
    col = col * (1 - 0.20 * welt[..., None])                                     # faint lead-sheet joints

    du = np.minimum(u, 1 - u); dv = np.minimum(v, 1 - v)
    edge = np.minimum(du, dv)
    flash = np.clip(1 - edge / 0.022, 0, 1); flash = flash * flash * (3 - 2 * flash) * 0.7
    col = col * (1 - flash[..., None]) + np.array([0.46, 0.49, 0.52])[None, None, :] * flash[..., None]

    fle = aniso(n, 300, 300, RNG)                                                # oxidation flecks
    col = np.where((fle > 0.90)[..., None], np.clip(col * 1.28 + 0.03, 0, 1), col)
    return np.clip(col, 0, 1)


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
# the roof-walk deck: a proper leaded roof-walk under PHOTOREAL, plain lead otherwise
if PHOTOREAL:
    MAT_ROOF = make_material("roofwalk", pack_jpeg("roofwalk", leaded_walk_rgb(W, D)), rough=0.55, spec=0.34)
else:
    MAT_ROOF = MAT_LEAD
IB, IW, IT, IL, ITM, ITV = 0, 1, 2, 3, 4, 5
# sign board material (painted board with baked serif signage); falls back to trim
SIGN_PNG = os.environ.get("SIGN_PNG", "")
if PHOTOREAL and SIGN_PNG and os.path.exists(SIGN_PNG):
    _si = bpy.data.images.load(SIGN_PNG); _si.name = "sign"; _si.pack()
    MAT_SIGN = make_material("sign", _si, rough=0.72, spec=0.22)
else:
    MAT_SIGN = MAT_TRIM
ISG = 6
IRF = 7

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
# The front plane (hz) is a SOLID brick facade with brick corner flanks; only a
# central LOADING PORTAL is recessed to the loading wall at FW, with the cargo bay
# and (where the low storey allows) a loft door as recessed openings INTO that
# solid wall — not holes through it. The covered eave (below) oversails FW->front
# edge, so the loading bay reads as a covered loggia against a solid wall. The
# building is a LOW shed: everything sits under the roof at z=H (== roofY).
cw, ch = CFG["cargo_w"], CFG["cargo_h"]
lw = CFG["loft_w"]
PORTAL_W = CFG["portal_w"]
hpw = PORTAL_W / 2
EAVE_Z = H - 0.16                                 # wall head / loggia soffit, just under the lead deck
PORTAL_TOP = EAVE_Z - 0.06                        # loading-opening head = the covered-eave lintel
py = CFG["pentice_y"]
loft_door_head = EAVE_Z - 0.30

# solid brick corner flanks from the set-back wall (FW) to the front plane (hz),
# full height, each side of the portal; the front facade is a paneled brick face
# with a recessed sash (a true cut-out, so no coincident proud boxes on +Y).
for sgn in (-1, 1):
    fx0, fx1 = (hpw, hx) if sgn > 0 else (-hx, -hpw)
    if fx1 - fx0 < 0.05:
        continue
    jamb = "-x" if sgn > 0 else "+x"              # face that looks INTO the portal
    solid_box(fx0, fx1, FW, hz, 0.0, EAVE_Z, IB, faces=(jamb, "+z"), tile=BRICK_TILE)
    wc = (fx0 + fx1) / 2 - fx0                     # window centre in face-local coords
    flank_open = []
    if fx1 - fx0 > 1.3:
        flank_open = [(wc - 0.5, wc + 0.5, 1.2, min(2.8, EAVE_Z - 0.5), "win")]
    paneled_face(Vector((fx0, hz, 0.0)), X, Z, -Y, fx1 - fx0, EAVE_Z, flank_open)

# the recessed LOADING WALL at FW (solid brick behind the loggia) with the cargo
# bay + (if the storey is tall enough) a loft door as recessed openings INTO the
# wall, not holes through it
# NB: paneled_face's along-coord `a` runs 0..PORTAL_W from the portal's LEFT edge
# (origin -hpw), so openings must be centred on a = PORTAL_W/2, not on 0.
pc = PORTAL_W / 2
portal_open = [(pc - cw / 2, pc + cw / 2, 0.0, ch, "door")]       # ground cargo bay
if loft_door_head - (py + 0.1) > 0.7:
    portal_open.append((pc - lw / 2, pc + lw / 2, py + 0.1, loft_door_head, "door"))   # loft loading door
paneled_face(Vector((-hpw, FW, 0.0)), X, Z, -Y, PORTAL_W, PORTAL_TOP, portal_open)

# ---- BACK (-Y) and SIDES (+/-X): brick with sash grids up to the wall head -----
paneled_face(Vector((hx, -hz, 0.0)), -X, Z, Y, W, EAVE_Z, window_grid(W, EAVE_Z, 2.4, 3.0))
paneled_face(Vector((hx, -hz, 0.0)), Y, Z, -X, D, EAVE_Z, window_grid(D, EAVE_Z, 2.4, 3.0))   # +X (east)
paneled_face(Vector((-hx, hz, 0.0)), -Y, Z, X, D, EAVE_Z, window_grid(D, EAVE_Z, 2.4, 3.0))   # -X (west)

# ---- stone string-course band at the pentice floor, wrapping the body (3 sides)-
solid_box(-hx, hx, -hz, FW, py - 0.12, py, IT, faces=("-y", "+x", "-x"), tile=1.0)

# ---- covered PENTICE: a projecting flat loading canopy over the cargo door -----
# Decoration, NOT a route surface — the route stands on the roof only. It projects
# across the set-back front so the loading bay reads as a real covered loggia.
deck_w = min(CFG["pentice_width"], PORTAL_W - 0.3)
solid_box(-deck_w / 2, deck_w / 2, FW, hz, py - CFG["pentice_thick"], py, ITM,
          faces=("+z", "-z", "+y", "-x", "+x"), tile=1.4)
solid_box(-deck_w / 2, deck_w / 2, hz - 0.06, hz, py - 0.40, py - CFG["pentice_thick"], ITM,
          faces=("+y", "-y", "-x", "+x", "-z"), tile=1.0)                                     # fascia
# pentice support posts, ground -> pentice, at the front lip
_np = max(2, int(round(deck_w / 2.6)))
post_xs = sorted({round(x, 2) for x in np.linspace(-deck_w / 2 + 0.3, deck_w / 2 - 0.3, _np)})
for pxp in post_xs:
    solid_box(pxp - 0.09, pxp + 0.09, hz - 0.24, hz - 0.06, 0.0, py - CFG["pentice_thick"] - 0.02, ITM,
              faces=("+x", "-x", "+y", "-y"), tile=1.0)

# ---- HOIST BEAM: a projecting timber beam under the eave (a hang hold) ---------
hb = CFG["hoist_y"]
solid_box(-0.15, 0.15, FW - 0.3, hz, hb, hb + 0.26, ITM, faces="all", tile=1.0)          # the projecting hoist beam
solid_box(-0.20, 0.20, hz - 0.30, hz, hb - 0.32, hb, ITM, faces="all", tile=1.0)         # a pulley block at the tip

# ---- ROOF: a broad leaded WALK across the WHOLE footprint at z=H (== roofY) -----
# The standable top is the box cap, so a contain-fit 1.0 lands it EXACTLY on the
# authored deck plane over the FULL footprint — drawn == collision at every lip.
# There is NO raised ridge: roofY is the cap, so a real gambrel would draw its
# eaves BELOW the collision plane and re-open the invisible-floor defect on a deck
# that claims the whole footprint. wharf-a's variation is a pitched leaded
# eave-skirt folding BELOW the walk edge (visual only) + its broad low proportion.
# the walk (standable top, z=H): ONE flat quad at exactly z=H spanning the whole
# footprint, UV-mapped 0..1 across the deck (NOT tiled) so the leaded roof-walk
# material reads once with rolls at true spacing and no repeat. Geometry is byte-
# identical to the old single +z quad, so box / weld / bbox are unchanged.
quad((-hx, -hz, H), (hx, -hz, H), (hx, hz, H), (-hx, hz, H), IRF,
     [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
# lead fascia closing the wall-head-to-deck gap on all four edges (below the top)
for (ex0, ex1, ey0, ey1) in [(-hx, hx, -hz, -hz + 0.10), (-hx, hx, hz - 0.10, hz),
                             (-hx, -hx + 0.10, -hz + 0.10, hz - 0.10), (hx - 0.10, hx, -hz + 0.10, hz - 0.10)]:
    solid_box(ex0, ex1, ey0, ey1, EAVE_Z, H - 0.14, IL, faces=("+x", "-x", "+y", "-y"), tile=1.0)

if CFG["roof"] == "walk":
    # wharf-a: a pitched leaded eave-skirt folding below the walk on the two long
    # sides (+/-x) and the back (-y), for a shallow pitched (gambrel-ish) read.
    # Drawn ENTIRELY below H, so no walkable surface drops off roofY. The FRONT
    # (+y) edge is left clean — it is the take-off lip a body drops from northward
    # onto the cargo mound.
    sk = CFG["eave_skirt"]; ins = CFG["eave_inset"]
    zt = H - 0.14; zb = zt - sk
    for gx, d in ((-hx, 1), (hx, -1)):
        xi = gx + d * ins
        quad((gx, -hz, zt), (gx, hz, zt), (xi, hz, zb), (xi, -hz, zb), IL,
             [(0, 0), (D, 0), (D, sk), (0, sk)])
    quad((-hx, -hz, zt), (hx, -hz, zt), (hx, -hz + ins, zb), (-hx, -hz + ins, zb), IL,
         [(0, 0), (W, 0), (W, sk), (0, sk)])

# ---- COVERED EAVE over the loading loggia --------------------------------------
# The loading front is set back to FW; oversail a lead soffit forward over the
# portal opening (FW -> front edge) so the loading bay reads as a covered loggia
# against a solid wall, not an open notch. Its underside at EAVE_Z-0.16 is the
# loggia ceiling; the roof deck at z=H spans over it (the shed's true roof).
solid_box(-hpw, hpw, FW, hz, EAVE_Z - 0.16, EAVE_Z, IL, faces=("+z", "-z", "+y"), tile=1.3)
# a timber head-beam across the top of the loading opening (the covered-bay lintel)
solid_box(-hpw + 0.1, hpw - 0.1, FW, FW + 0.20, PORTAL_TOP - 0.28, PORTAL_TOP, ITM,
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

    has_loft = loft_door_head - (py + 0.1) > 0.7        # matches the portal-opening test above

    # (1) corbel brackets under the covered pentice canopy, at each post
    for pxp in post_xs:
        pbot = py - CFG["pentice_thick"]
        wedge(pxp - 0.09, pxp + 0.09, FW + 0.03, pbot - 0.55, hz - 0.15, pbot - 0.05, ITM)

    # (2) stone pilasters framing the cargo bay (apron -> under the pentice), proud
    for sgnp in (-1, 1):
        pxs = sgnp * (cw / 2 + 0.30)
        if abs(pxs) + 0.20 > hpw - 0.02:                 # keep inside the portal opening
            continue
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

    if has_loft:
        # (4) a projecting weather HOOD + brackets over the loft loading door
        solid_box(-lw / 2 - 0.30, lw / 2 + 0.30, FW, FW + 0.45, loft_door_head, loft_door_head + 0.18,
                  ITM, faces=("+y", "-x", "+x", "+z", "-z"), tile=1.0)
        for hxb in (-lw / 2 - 0.16, lw / 2 + 0.16):
            wedge(hxb - 0.06, hxb + 0.06, FW + 0.03, loft_door_head - 0.45, FW + 0.42, loft_door_head - 0.02, ITM)

    # (5) painted SIGN board on the loading wall (trim-edged body + textured face)
    sb0 = (loft_door_head + 0.28) if has_loft else (ch + 0.30)
    sb1 = min(EAVE_Z - 0.16, sb0 + 1.0)
    if sb1 - sb0 > 0.35:
        sbw = min(PORTAL_W - 0.6, (sb1 - sb0) * 2.7)
        solid_box(-sbw / 2 - 0.08, sbw / 2 + 0.08, FW, FW + 0.10, sb0 - 0.08, sb1 + 0.08,
                  IT, faces=("+y", "-x", "+x", "+z", "-z"), tile=1.0)
        quad((-sbw / 2, FW + 0.11, sb0), (sbw / 2, FW + 0.11, sb0),
             (sbw / 2, FW + 0.11, sb1), (-sbw / 2, FW + 0.11, sb1), ISG,
             [(1, 0), (0, 0), (0, 1), (1, 1)])  # flip U: +Y face, read left-to-right from the front

    # (6) projecting stone CORNICE band across the recessed loading wall (portal
    # width only, so it is not buried inside the solid brick flanks)
    solid_box(-hpw, hpw, FW, FW + 0.14, EAVE_Z - 0.44, EAVE_Z - 0.20,
              IT, faces=("+y", "+z", "-z", "-x", "+x"), tile=1.2)

# ---- ground apron: pins the bbox to the DECLARED box, centred, base 0 ----------
solid_box(-hx, hx, -hz, hz, 0.0, 0.03, IT, faces="all", tile=1.5)

# ----------------------------------------------------------------- finalise
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
mesh = bpy.data.meshes.new(KEY); bm.to_mesh(mesh); bm.free()
obj = bpy.data.objects.new(KEY, mesh)
for m in (MAT_BRICK, MAT_GLASS, MAT_TRIM, MAT_LEAD, MAT_TIMBER, MAT_TIMBER_V, MAT_SIGN, MAT_ROOF):
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
        ai = {"width": 0, "depth": 1, "height": 2}[axis]
        over = co[(co[:, ai] > hi[ai] - 0.01) | (co[:, ai] < lo[ai] + 0.01)]
        log(f"OFFENDING {axis} verts near {lo[ai]:.3f}/{hi[ai]:.3f}:", over[:8].round(3).tolist())
        raise SystemExit(f"{axis} {got:.3f} != declared {dec}; contain-fit would move the route planes")
if abs(centre[0]) > 0.02 or abs(centre[1]) > 0.02 or abs(lo[2]) > 0.02:
    raise SystemExit(f"bbox not centred on axis at base 0 (centre {centre[0]:+.3f},{centre[1]:+.3f}, minZ {lo[2]:.3f})")
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
log(f"tris {tris}  verts {len(obj.data.vertices)}  roof_top(z=H)={H}  roof={CFG['roof']}")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_yup=True, export_animations=False,
                          export_image_format="AUTO", export_jpeg_quality=90, export_tangents=True, use_selection=True)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
