# Author int-partition-board-a as a low BOARDED YARD GATE / tar-screen that reads
# as a vaultable climb-over at 1.6 m — replacing the old full-height interior
# partition-wall-with-a-doorway that was being stretched into a 0.5 x 1.6 x 4.4
# gate slot (drawn a see-through door where the collision is a solid climb-over,
# and a flat wall face with no vault affordance).
#
# WHY THIS SHAPE. Both placements of this key — KING_LANE_GATE (geometry.ts) and
# TAR_PARTITION (ropewalk.ts) — are CLIMB_OVER masses at topY 1.6 over a 0.5 x 4.4
# footprint, and the asset is drawn as a SHELL (its path is under /structures/),
# i.e. scaled PER-AXIS to fill the box exactly (ImportedStructureInner). So the
# mesh is authored at the box's own aspect (0.5 wide x 1.6 tall x 4.4 long) and
# draws 1:1 with no distortion and no quarter-turn (shellQuarterTurn: source and
# target both long-on-Z). The declared sizeM [0.5, 1.6, 4.4] already matches, so
# no level or asset-registry change is needed.
#
# DRAWN==COLLISION. Solid boarding (no see-through opening) matches the solid
# climb-over collision; the graspable cap rail TOP sits at exactly 1.6 m — the
# climb-over line — and is only 0.5 m deep (below the 0.75 m a body needs to
# stand), which is what keeps it a climb-over and not a mantle-stand.
#
# Run: blender --background --python assets/pipeline/build_partition_gate.py -- int-partition-board-a <out.glb>
import bpy
import bmesh
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
KEY = argv[0]
OUT_GLB = os.path.abspath(argv[1])
RNG = np.random.default_rng(16041774)
TEX = 1024

# ---- declared box (gltf W x H x D). Blender export_yup makes Z the height, so:
# X = thickness (0.5), Y = the run (4.4), Z = height (1.6). -----------------------
W, H, RUN = 0.5, 1.6, 4.4
hx, hy = W / 2, RUN / 2
NBAY = 4                                        # 5 stiles -> 4 boarded bays
STILE = 0.08                                    # stile half-length along the run (Y)
CAP = 0.14                                      # cap-rail band depth (top)


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


def plank_rgb(base, vertical=True, boards=9, knots=True):
    n = TEX
    u = np.linspace(0, 1, n, endpoint=False)
    coord = np.broadcast_to((u[:, None] if vertical else u[None, :]), (n, n))
    fb = coord * boards; board = np.floor(fb); bf = fb - board
    seam = _ss(0.0, 0.04, bf) * _ss(0.0, 0.04, 1 - bf)
    bseed = np.sin(board * 33.7) * 43758.5; bvar = bseed - np.floor(bseed)
    grain = aniso(n, 260 if vertical else 6, 6 if vertical else 260, RNG)
    base = np.array(base)
    rgb = base[None, None, :] * (0.80 + 0.42 * bvar)[..., None]
    rgb = np.clip(rgb * (0.85 + 0.30 * grain)[..., None], 0, 1)
    rgb = rgb * (0.55 + 0.45 * seam)[..., None]                 # dark plank seams
    if knots:
        kn = aniso(n, 24, 24, RNG)
        rgb = np.where((kn > 0.9)[..., None], rgb * 0.5, rgb)
    rgb *= (0.80 + 0.20 * aniso(n, 40, 40, RNG))[..., None]     # weathering blotches
    return np.clip(rgb, 0, 1)


def _img(name, rgb):
    h, w = rgb.shape[:2]
    rgba = np.concatenate([rgb, np.ones((h, w, 1))], 2)
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    return img


def pack_jpeg(name, rgb, q=90):
    _img(name + "-src", rgb)
    sc = bpy.context.scene; sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = q
    path = os.path.join(os.path.dirname(OUT_GLB) or ".", f"_pg_{name}.jpg")
    bpy.data.images[name + "-src"].save_render(path)
    baked = bpy.data.images.load(path); baked.name = name; baked.pack()
    try: os.remove(path)
    except OSError: pass
    return baked


def make_material(name, image, rough=0.92, spec=0.12):
    mat = bpy.data.materials.new(name); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = image; tex.extension = "REPEAT"
    bsdf.inputs["Metallic"].default_value = 0.0; bsdf.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in bsdf.inputs: bsdf.inputs["Specular IOR Level"].default_value = spec
    elif "Specular" in bsdf.inputs: bsdf.inputs["Specular"].default_value = spec
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mat.blend_method = "OPAQUE"; mat.use_backface_culling = False
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


bpy.ops.wm.read_factory_settings(use_empty=True)
MAT_BOARD = make_material("board", pack_jpeg("board", plank_rgb((0.52, 0.42, 0.30), vertical=True, boards=10)))
MAT_RAIL = make_material("rail", pack_jpeg("rail", plank_rgb((0.42, 0.33, 0.23), vertical=False, boards=3)), rough=0.88)
MAT_IRON = make_material("iron", pack_jpeg("iron", np.clip(np.array((0.10, 0.09, 0.09))[None, None, :]
             + (aniso(256, 30, 30, RNG) - 0.5)[..., None] * 0.05, 0, 1)), rough=0.6, spec=0.4)
IBOARD, IRAIL, IIRON = 0, 1, 2

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


def solid_box(x0, x1, y0, y1, z0, z1, mat, faces="all", tile=1.0):
    want = {"+x", "-x", "+y", "-y", "+z", "-z"} if faces == "all" else set(faces)
    U = lambda p, q: (p / tile, q / tile)
    if "+z" in want: quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), mat, [U(x0, y0), U(x1, y0), U(x1, y1), U(x0, y1)])
    if "-z" in want: quad((x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0), mat, [U(x0, y1), U(x1, y1), U(x1, y0), U(x0, y0)])
    if "-y" in want: quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), mat, [U(x0, z0), U(x1, z0), U(x1, z1), U(x0, z1)])
    if "+y" in want: quad((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1), mat, [U(x1, z0), U(x0, z0), U(x0, z1), U(x1, z1)])
    if "-x" in want: quad((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1), mat, [U(y1, z0), U(y0, z0), U(y0, z1), U(y1, z1)])
    if "+x" in want: quad((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), mat, [U(y0, z0), U(y1, z0), U(y1, z1), U(y0, z1)])


STILE_Y = list(np.linspace(-hy + STILE, hy - STILE, NBAY + 1))    # stile centres along the run
BOARD_HALF = 0.15                                                # boarded panel half-thickness (X)
CAP_TOP = H                                                      # climb-over line at exactly 1.6
MID_Z = 0.78                                                     # foothold ledger height

# ---- CAP RAIL: full run + full depth, graspable top at exactly H (climb line) --
solid_box(-hx, hx, -hy, hy, CAP_TOP - CAP, CAP_TOP, IRAIL, tile=0.6)
# ---- BOTTOM RAIL / sill: full run, pins the base at z=0 ------------------------
solid_box(-hx + 0.05, hx - 0.05, -hy, hy, 0.0, 0.16, IRAIL, tile=0.6)
# ---- MID LEDGER: a foothold band across the whole run --------------------------
solid_box(-BOARD_HALF - 0.04, BOARD_HALF + 0.04, -hy + STILE, hy - STILE, MID_Z - 0.07, MID_Z + 0.07, IRAIL, tile=0.6)

# ---- STILES (posts): tuck UNDER the cap so their top faces don't coincide with it
for yc in STILE_Y:
    solid_box(-BOARD_HALF - 0.03, BOARD_HALF + 0.03, yc - STILE, yc + STILE, 0.0, CAP_TOP - CAP, IRAIL, tile=0.5)

# ---- BOARDED INFILL: each bay a solid panel of vertical planks (no see-through)
for b in range(NBAY):
    y0 = STILE_Y[b] + STILE
    y1 = STILE_Y[b + 1] - STILE
    # a single solid slab per bay (butted planks -> reads solid, matches the solid
    # climb-over collision), plank seams carried by the vertical-grain texture
    solid_box(-BOARD_HALF, BOARD_HALF, y0, y1, 0.14, CAP_TOP - CAP, IBOARD, tile=0.5)

# ---- DIAGONAL BRACES: one per bay on the front face (yard-gate bracing read) ---
def brace(ya, za, yb, zb, xface, t=0.045):
    d = Vector((0.0, yb - ya, zb - za)); L = d.length
    if L < 1e-4: return
    d.normalize(); nrm = Vector((0.0, -d.z, d.y)) * t
    p = [Vector((xface, ya + nrm.y, za + nrm.z)), Vector((xface, ya - nrm.y, za - nrm.z)),
         Vector((xface, yb - nrm.y, zb - nrm.z)), Vector((xface, yb + nrm.y, zb + nrm.z))]
    vs = [bm.verts.new(pt) for pt in p]         # one thin outward board (low weld/tris)
    try:
        f = bm.faces.new(vs)
    except ValueError:
        for v in vs:
            if v.is_valid and not v.link_faces: bm.verts.remove(v)
        return
    f.material_index = IRAIL
    for lp in f.loops:
        q = lp.vert.co; lp[uv].uv = (q.y, q.z)

for b in range(NBAY):
    y0 = STILE_Y[b] + STILE; y1 = STILE_Y[b + 1] - STILE
    lo, hi = (0.2, CAP_TOP - CAP - 0.05)
    if b % 2 == 0:
        brace(y0, lo, y1, hi, BOARD_HALF + 0.012)
    else:
        brace(y1, lo, y0, hi, BOARD_HALF + 0.012)

# ---- IRON straps/hinges on one end stile (the gate read) ----------------------
yc = STILE_Y[0]
for zc in (0.45, CAP_TOP - CAP - 0.2):
    solid_box(BOARD_HALF + 0.005, BOARD_HALF + 0.02, yc - STILE + 0.01, yc + 0.35, zc - 0.05, zc + 0.05, IIRON, tile=0.2)

# ----------------------------------------------------------------- finalise
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
mesh = bpy.data.meshes.new(KEY); bm.to_mesh(mesh); bm.free()
obj = bpy.data.objects.new(KEY, mesh)
for m in (MAT_BOARD, MAT_RAIL, MAT_IRON):
    obj.data.materials.append(m)
for poly in obj.data.polygons:
    poly.use_smooth = False
bpy.context.scene.collection.objects.link(obj)

co = np.array([v.co[:] for v in obj.data.vertices])
lo, hi = co.min(0), co.max(0); size = hi - lo; centre = (lo + hi) / 2.0
log(f"blender bbox {size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f}  -> gltf {size[0]:.3f}(w) x {size[2]:.3f}(h) x {size[1]:.3f}(d)  declared {W}x{H}x{RUN}")
for axis, got, dec in (("width", size[0], W), ("run", size[1], RUN), ("height", size[2], H)):
    if abs(got - dec) > 0.02:
        raise SystemExit(f"{axis} {got:.3f} != declared {dec}")
if abs(centre[0]) > 0.02 or abs(centre[1]) > 0.02 or abs(lo[2]) > 0.02:
    raise SystemExit(f"not centred on base 0 (centre {centre[0]:+.3f},{centre[1]:+.3f}, minZ {lo[2]:.3f})")
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
log(f"tris {tris}  verts {len(obj.data.vertices)}  cap top (climb line) {CAP_TOP:.2f}")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_yup=True, export_animations=False,
                          export_image_format="AUTO", export_jpeg_quality=90, export_tangents=True, use_selection=True)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
