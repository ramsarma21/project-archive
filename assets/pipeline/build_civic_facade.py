# Author a civic building (the printshop, the Town House) as a clean Georgian
# facade straight from its collision hull — no Meshy raw, no build_m1_civic warp.
# The row/brick re-authors proved the method; these two are bespoke, so they are
# driven by the hull's own planes rather than a repeating module: every `mine`
# blocker becomes solid masonry and every `mine` deck gets a slab whose TOP sits
# exactly on the authored plane, so the affordance gate is satisfied BY
# CONSTRUCTION rather than by luck.
#
# WHY FROM THE HULL. The Town House carries more authored planes than any building
# in the level — the leads, two jettied galleries, a clock ledge, two cornices, a
# balcony hood, a plinth ring and a top lookout — and a tower. build_townhouse_
# drum.py already fills the TOWNHOUSE_TOWER blocker solid (the 1.4m float fix that
# is merged and load-bearing); authoring the whole building from the same hull
# reproduces that drum as the tower blocker filled solid, with the body-to-drum-
# to-lookout join continuous by construction rather than glued on in a second
# pass. The declared box is the draw contract (PROP contain-fit); the mesh is
# pinned so its height equals the declared height and contain-fit is 1.0, which is
# what lands every plane on its authored y.
#
# Same discipline as the five row facades: hard bbox guard, matte 2048 brick +
# normal, sharp recessed sash, pale trim and leaded flat roofs/decks, and NO
# near-coincident doubled faces (the weld gate must read 0 — a re-authored facade
# carries no ledger entry).
#
# Run: blender --background --python assets/pipeline/build_civic_facade.py -- <hull.json> <out.glb>
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
with open(HULL_JSON) as fh:
    HULL = json.load(fh)
KEY = HULL["key"]
ENV = HULL["envelope"]
DECL = HULL["declaredSizeM"]                       # glTF x(width), y(height), z(depth)
SEED = 17131211
RNG = np.random.default_rng(SEED)
TEX = 2048

# Per-building body colour + window pitch (metres of wall per bay/storey, drawn).
CONFIG = {
    "bldg-printshop": dict(body_bay=3.0, body_storey=3.2, brick=(0.40, 0.19, 0.15)),
    "bldg-townhouse-1713": dict(body_bay=3.1, body_storey=3.4, brick=(0.44, 0.34, 0.28)),
}
CFG = CONFIG.get(KEY, dict(body_bay=3.0, body_storey=3.2, brick=(0.42, 0.22, 0.16)))


def log(*p):
    print(f"[{KEY}]", *p)


# glTF (x, y=height, z) -> Blender (x, -z, y); export_yup maps it back, matching
# build_townhouse_drum.py so the mesh lands on its collision exactly.
def b_rect(s):
    return (s["minX"], s["maxX"], -s["maxZ"], -s["minZ"])


# ----------------------------------------------------------------- textures
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
    rgb = base[None, None, :] * (0.8 + 0.4 * var)[..., None]
    dark = var < 0.18
    rgb[dark] *= 0.62
    rgb = np.clip(rgb + (aniso(n, 220, 200, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    mortar = np.clip(np.array([0.62, 0.59, 0.52])[None, None, :] + (aniso(n, 90, 90, RNG) - 0.5)[..., None] * 0.05, 0, 1)
    t = mask[..., None]
    return np.clip(mortar * (1 - t) + rgb * t, 0, 1), 0.25 + 0.75 * mask


def window_rgb():
    n = TEX // 2
    X = np.broadcast_to(np.linspace(0, 1, n)[None, :], (n, n)); Y = np.broadcast_to(np.linspace(0, 1, n)[:, None], (n, n))
    glass = np.array([0.11, 0.14, 0.18]); frame = np.array([0.85, 0.84, 0.79])
    rgb = glass[None, None, :] + (0.14 * (1 - Y))[..., None] * np.array([0.5, 0.6, 0.8])[None, None, :]
    fb, bar = 0.11, 0.018
    m = (X < fb) | (X > 1 - fb) | (Y < fb) | (Y > 1 - fb) | (np.abs(X - 1 / 3) < bar) | (np.abs(X - 2 / 3) < bar) | (np.abs(Y - 0.25) < bar) | (np.abs(Y - 0.75) < bar) | (np.abs(Y - 0.5) < bar * 1.8)
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
    path = os.path.join(os.path.dirname(OUT_GLB) or ".", f"_civic_{name}.jpg")
    bpy.data.images[name + "-src"].save_render(path)
    baked = bpy.data.images.load(path); baked.name = name; baked.pack()
    try: os.remove(path)
    except OSError: pass
    return baked


def make_normal(h, strength=2.6):
    n = h.shape[0]
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5; gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(h)
    inv = 1 / np.sqrt(nx * nx + ny * ny + nz * nz)
    rgba = np.stack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5, np.ones_like(h)], 2)
    img = bpy.data.images.new(f"{KEY}-n", width=n, height=n, alpha=True)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    img.colorspace_settings.name = "Non-Color"
    return img


def make_material(name, image, normal=None, rough=0.94, spec=0.18):
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


log("textures")
bpy.ops.wm.read_factory_settings(use_empty=True)
B_RGB, B_H = brick_fields(CFG["brick"])
MAT_BRICK = make_material("brick", pack_jpeg("brick", B_RGB), normal=make_normal(B_H))
MAT_GLASS = make_material("glass", pack_jpeg("window", window_rgb()), rough=0.55, spec=0.25)
MAT_TRIM = make_material("trim", pack_jpeg("trim", flat_rgb(TEX // 4, (0.82, 0.80, 0.74))), rough=0.9, spec=0.2)
MAT_LEAD = make_material("lead", pack_jpeg("lead", flat_rgb(TEX // 4, (0.55, 0.56, 0.55))), rough=0.9, spec=0.15)
IB, IW, IT, IL = 0, 1, 2, 3

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


BRICK_TILE = 2.2   # metres of wall per texture repeat, at true (contain-fit 1.0) scale
WW, WH, RECESS = 1.4, 1.8, 0.28


def brick_uv(a, b):
    return (a / BRICK_TILE, b / BRICK_TILE)


def bounds(lo, hi, count, size):
    pier = (hi - lo - count * size) / (count + 1)
    b = [lo]; cur = lo
    for _ in range(count):
        cur += pier; b.append(cur); cur += size; b.append(cur)
    b.append(hi)
    return b


def windowed_wall(origin, along, up, inward, W, H):
    """Brick wall with a regular grid of recessed sash windows, drawn in true
    metres (the mesh is contain-fit 1.0)."""
    nx = max(1, round(W / CFG["body_bay"]))
    ny = max(1, round(H / CFG["body_storey"]))
    ab = bounds(0.0, W, nx, WW)          # full-height/width: end segments are brick piers
    ub = bounds(0.0, H, ny, WH)

    def P(a, u, d):
        return origin + along * a + up * u + inward * d

    for i in range(len(ab) - 1):
        a0, a1 = ab[i], ab[i + 1]; awin = i % 2 == 1
        for j in range(len(ub) - 1):
            u0, u1 = ub[j], ub[j + 1]; uwin = j % 2 == 1
            if awin and uwin:
                quad(P(a0, u0, RECESS), P(a1, u0, RECESS), P(a1, u1, RECESS), P(a0, u1, RECESS), IW,
                     [(0.03, 0.03), (0.97, 0.03), (0.97, 0.97), (0.03, 0.97)])
                aw, uw, dw = (a1 - a0), (u1 - u0), RECESS
                quad(P(a0, u0, 0), P(a1, u0, 0), P(a1, u0, RECESS), P(a0, u0, RECESS), IT, [(0, 0), (aw, 0), (aw, dw), (0, dw)])
                quad(P(a0, u1, 0), P(a1, u1, 0), P(a1, u1, RECESS), P(a0, u1, RECESS), IT, [(0, 0), (aw, 0), (aw, dw), (0, dw)])
                quad(P(a0, u0, 0), P(a0, u1, 0), P(a0, u1, RECESS), P(a0, u0, RECESS), IT, [(0, 0), (uw, 0), (uw, dw), (0, dw)])
                quad(P(a1, u0, 0), P(a1, u1, 0), P(a1, u1, RECESS), P(a1, u0, RECESS), IT, [(0, 0), (uw, 0), (uw, dw), (0, dw)])
            else:
                quad(P(a0, u0, 0), P(a1, u0, 0), P(a1, u1, 0), P(a0, u1, 0), IB,
                     [brick_uv(a0, u0), brick_uv(a1, u0), brick_uv(a1, u1), brick_uv(a0, u1)])


def solid_box(x0, x1, y0, y1, z0, z1, mat, faces="all", tile=BRICK_TILE):
    """An axis-aligned box, selected faces only, brick/trim UVs at true scale.
    `faces` picks which of +x -x +y -y +z -z to draw so interior faces that would
    z-fight a neighbour are simply never made (the weld gate must stay 0)."""
    want = {"+x", "-x", "+y", "-y", "+z", "-z"} if faces == "all" else set(faces)
    U = lambda p, q: (p / tile, q / tile)
    if "+z" in want: quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), mat, [U(x0, y0), U(x1, y0), U(x1, y1), U(x0, y1)])
    if "-z" in want: quad((x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0), mat, [U(x0, y1), U(x1, y1), U(x1, y0), U(x0, y0)])
    if "-y" in want: quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), mat, [U(x0, z0), U(x1, z0), U(x1, z1), U(x0, z1)])
    if "+y" in want: quad((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1), mat, [U(x1, z0), U(x0, z0), U(x0, z1), U(x1, z1)])
    if "-x" in want: quad((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1), mat, [U(y1, z0), U(y0, z0), U(y0, z1), U(y1, z1)])
    if "+x" in want: quad((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), mat, [U(y0, z0), U(y1, z0), U(y1, z1), U(y0, z1)])


# ----------------------------------------------------------------- build
blockers = [b for b in HULL["blockers"] if b.get("mine")]
decks = [d for d in HULL["decks"] if d.get("mine")]
# The body is the mine blocker that starts at the ground; the tower is tagged.
body = max((b for b in blockers if b["baseY"] <= 0.01 and "tower" not in b.get("tags", [])),
           key=lambda b: (b["maxX"] - b["minX"]) * (b["maxZ"] - b["minZ"]))
towers = [b for b in blockers if "tower" in b.get("tags", [])]
hoods = [b for b in blockers if "soffit" in b.get("tags", []) and b is not body and b not in towers]

# --- body ---------------------------------------------------------------------
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
# An ENTERABLE building is authored as thin perimeter WALL blockers (tag
# interior-shell) with authored GAPS (a door / the printshop's south shopfront),
# rather than one solid body. Draw each wall blocker as its own windowed brick
# wall on its OUTER face, so drawn == collision and the gap is a real hole you
# walk through. A solid-body building (the Town House) has no such blockers and
# takes the original four-walls-around-the-body path unchanged.
shell_walls = [
    b for b in blockers
    if "interior-shell" in b.get("tags", []) and b["baseY"] <= 0.01
]
if shell_walls:
    fbx0 = min(b["minX"] for b in shell_walls); fbx1 = max(b["maxX"] for b in shell_walls)
    fbz0 = min(b["minZ"] for b in shell_walls); fbz1 = max(b["maxZ"] for b in shell_walls)
    fh = max(b["topY"] for b in shell_walls)
    for b in shell_walls:
        wx0, wx1, wy0, wy1 = b_rect(b)
        h = b["topY"] - b["baseY"]
        wide_x = (b["maxX"] - b["minX"]) >= (b["maxZ"] - b["minZ"])
        if wide_x:                                  # a N/S wall, runs along X
            w = wx1 - wx0
            if abs(b["maxZ"] - fbz1) < 0.3:         # south edge -> outer -y face
                windowed_wall(Vector((wx0, wy0, b["baseY"])), X, Z, Y, w, h)
            else:                                    # north edge -> outer +y face
                windowed_wall(Vector((wx0, wy1, b["baseY"])), X, Z, -Y, w, h)
        else:                                        # an E/W wall, runs along Z
            w = wy1 - wy0
            if abs(b["maxX"] - fbx1) < 0.3:          # east edge -> outer +x face
                windowed_wall(Vector((wx1, wy0, b["baseY"])), Y, Z, -X, w, h)
            else:                                    # west edge -> outer -x face
                windowed_wall(Vector((wx0, wy0, b["baseY"])), Y, Z, X, w, h)
    # interior ceiling slab(s): the mine 'ceiling' blocker(s), so the room is
    # capped (drawn top + underside) and the body cannot clip up to the leads.
    for b in blockers:
        if "ceiling" in b.get("tags", []):
            cx0, cx1, cy0, cy1 = b_rect(b)
            # Top + underside only: the edges are buried in the walls, so drawing
            # the side faces would sit a hair off the wall recess and trip the weld
            # gate. The underside at baseY is the ceiling the room sees.
            solid_box(cx0, cx1, cy0, cy1, b["baseY"], b["topY"], IT,
                      faces=("+z", "-z"), tile=1.0)
    # leaded roof over the footprint (the leads) + ground apron (interior floor +
    # the bbox pin, same as the solid path below).
    solid_box(fbx0, fbx1, -fbz1, -fbz0, fh - 0.15, fh, IL, faces=("+z",), tile=1.2)
    solid_box(-DECL[0] / 2, DECL[0] / 2, -DECL[2] / 2, DECL[2] / 2, 0.0, 0.03, IL, faces="all", tile=1.5)
else:
    # --- solid body: four windowed brick walls, a leaded flat roof, a floor cap -
    bx0, bx1, by0, by1 = b_rect(body)
    bz0, bz1 = body["baseY"], body["topY"]
    windowed_wall(Vector((bx0, by0, bz0)), X, Z, Y, bx1 - bx0, bz1 - bz0)      # -y face
    windowed_wall(Vector((bx0, by1, bz0)), X, Z, -Y, bx1 - bx0, bz1 - bz0)     # +y face
    windowed_wall(Vector((bx1, by0, bz0)), Y, Z, -X, by1 - by0, bz1 - bz0)     # +x face
    windowed_wall(Vector((bx0, by0, bz0)), Y, Z, X, by1 - by0, bz1 - bz0)      # -x face
    solid_box(bx0, bx1, by0, by1, bz1 - 0.15, bz1, IL, faces=("+z",), tile=1.2)   # leaded roof (leads)
    # Ground apron spanning the DECLARED envelope, symmetric about the axis: it is
    # the building's stone base AND the bbox pin. FittedGlb recentres the draw on
    # the bbox centre, so pinning the box to the declared size centred on the axis
    # keeps contain-fit 1.0 and every authored plane on its x/z. One slab, so no
    # doubled face — the four-corner-stud alternative tripped the weld gate.
    solid_box(-DECL[0] / 2, DECL[0] / 2, -DECL[2] / 2, DECL[2] / 2, 0.0, 0.03, IL, faces="all", tile=1.5)

# --- tower blockers: solid masonry drum (the merged float-fix), kept solid -----
for t in towers:
    tx0, tx1, ty0, ty1 = b_rect(t)
    solid_box(tx0, tx1, ty0, ty1, t["baseY"], t["topY"], IB,
              faces=("+x", "-x", "+y", "-y"))                               # drum walls, open top/bottom
    # a leaded cap on the drum, and a thin cornice band just under it for the
    # cupola read; both inside the tower footprint so nothing oversails.
    solid_box(tx0, tx1, ty0, ty1, t["topY"] - 0.02, t["topY"], IL, faces=("+z",), tile=1.0)

# --- hoods (balcony soffit): a shallow trim box under its plane -----------------
for h in hoods:
    hx0, hx1, hy0, hy1 = b_rect(h)
    solid_box(hx0, hx1, hy0, hy1, h["baseY"], h["topY"], IT, faces=("+z", "-z", "+y", "-y", "+x", "-x"), tile=1.0)

# --- decks (galleries, cornices, ledges, plinth ring, top lookout) -------------
# Each is a slab whose TOP sits on the authored plane y, so the affordance gate
# reads mesh exactly there. A ring deck (a hole in its mask) is drawn as four
# border slabs around the tower footprint so it never overlaps the drum.
tower_fp = None
if towers:
    t = towers[0]; tx0, tx1, ty0, ty1 = b_rect(t)
    tower_fp = (tx0, tx1, ty0, ty1)
SLAB = 0.3
for d in decks:
    dx0, dx1, dy0, dy1 = b_rect(d)
    y = d["y"]
    ring = d.get("standableFraction", 1) < 0.98 and tower_fp is not None
    if ring:
        fx0, fx1, fy0, fy1 = tower_fp
        segs = [(dx0, dx1, dy0, fy0), (dx0, dx1, fy1, dy1), (dx0, fx0, fy0, fy1), (fx1, dx1, fy0, fy1)]
    else:
        segs = [(dx0, dx1, dy0, dy1)]
    for (sx0, sx1, sy0, sy1) in segs:
        if sx1 - sx0 < 1e-3 or sy1 - sy0 < 1e-3:
            continue
        solid_box(sx0, sx1, sy0, sy1, y - SLAB, y, IT, faces=("+z", "-z", "+y", "-y", "+x", "-x"), tile=1.0)

# --- pin the natural box to the declared size, SYMMETRIC about the axis ---------
# FittedGlb recentres the draw on the bbox centre and sits the base at the plane,
# so an asymmetric or undersized bbox would both shove every authored plane off
# its x/z AND (if an axis overran) shrink the whole building. Tiny corner studs at
# the envelope's four vertical edges make the bbox exactly the declared box
# centred on the axis — the same pin build_m1_civic uses (the .sh calls them
# corner studs) — so contain-fit stays 1.0 and every plane lands where the hull
# put it. They sit at ground level at the plot corners, 5cm, effectively unseen.
# ----------------------------------------------------------------- finalise
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
mesh = bpy.data.meshes.new(KEY); bm.to_mesh(mesh); bm.free()
obj = bpy.data.objects.new(KEY, mesh)
for m in (MAT_BRICK, MAT_GLASS, MAT_TRIM, MAT_LEAD):
    obj.data.materials.append(m)
for poly in obj.data.polygons:
    poly.use_smooth = False
bpy.context.scene.collection.objects.link(obj)

co = np.array([v.co[:] for v in obj.data.vertices])
lo, hi = co.min(0), co.max(0)
size = hi - lo
# glTF x,y,z map from Blender x,z,y. The HEIGHT (Blender Z) is the plane contract:
# pin it to the declared height so PROP contain-fit is 1.0 and every plane lands.
centre = (lo + hi) / 2.0
log(f"blender bbox {size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f}  gltf {size[0]:.3f} x {size[2]:.3f} x {size[1]:.3f}  declared {DECL}")
log(f"centre x={centre[0]:+.4f} y(depth)={centre[1]:+.4f} minZ={lo[2]:.4f} (want 0,0,0)")
# All three axes must equal the declared box, centred on the axis and based at 0,
# or contain-fit is not 1.0 / the recentre moves the planes.
for axis, got, dec in (("width", size[0], DECL[0]), ("height", size[2], DECL[1]), ("depth", size[1], DECL[2])):
    if abs(got - dec) > 0.02:
        raise SystemExit(f"{axis} {got:.3f} != declared {dec}; contain-fit / recentre would move the planes")
if abs(centre[0]) > 0.02 or abs(centre[1]) > 0.02 or abs(lo[2]) > 0.02:
    raise SystemExit(f"bbox not centred on the axis at base 0 (centre {centre[0]:+.3f},{centre[1]:+.3f}, minZ {lo[2]:.3f})")
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
log(f"tris {tris}  verts {len(obj.data.vertices)}")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_yup=True, export_animations=False,
                          export_image_format="AUTO", export_jpeg_quality=90, export_tangents=True, use_selection=True)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
