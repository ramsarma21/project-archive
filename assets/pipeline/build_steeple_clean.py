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


def course_rgb(boards=8):
    """One SHARED atlas for the whole steeple (a hero landmark ships one atlas): a
    near-white painted surface with faint horizontal course lines (reads as
    clapboard, louvre slats, lead seams and stone courses alike) plus subtle
    grain. Per-material colour is a glTF baseColorFactor tint, so this is the only
    image in the GLB."""
    n = TEX
    v = np.linspace(0, 1, n, endpoint=False)[:, None]
    fb = v * boards; bf = fb - np.floor(fb)
    groove = 0.84 + 0.16 * _ss(0.0, 0.06, bf)          # a soft shadow line each course
    base = np.full((n, n, 3), 0.98)
    rgb = base * (0.95 + 0.08 * aniso(n, 120, 120, RNG))[..., None]
    rgb = rgb * np.broadcast_to(groove, (n, n))[..., None]
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


def make_material(name, tint, rough=0.9, spec=0.2):
    """A material that samples the ONE shared atlas and multiplies it by a constant
    tint. glTF exports this as baseColorTexture + baseColorFactor, so every
    material shares a single image (the hero-landmark one-atlas rule)."""
    mat = bpy.data.materials.new(name); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = SHARED_IMG; tex.extension = "REPEAT"
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


log("textures")
bpy.ops.wm.read_factory_settings(use_empty=True)
SHARED_IMG = pack_jpeg("steeple-atlas", course_rgb())
MAT_CLAP = make_material("clap", (0.95, 0.94, 0.90), rough=0.9)
MAT_TRIM = make_material("trim", (0.98, 0.97, 0.93), rough=0.85, spec=0.22)
MAT_LEAD = make_material("lead", (0.56, 0.58, 0.60), rough=0.8, spec=0.25)
MAT_LOUVRE = make_material("louvre", (0.20, 0.17, 0.13), rough=0.9, spec=0.12)
MAT_STONE = make_material("stone", (0.66, 0.63, 0.56), rough=0.95, spec=0.12)
IC, IT, IL, ILV, IS = 0, 1, 2, 3, 4

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
# string-course ledges every ~2 m: the six-hold south-face climb / putlog offsets
for h in (3.0, 5.0, 7.0, 9.0, 11.0, 13.0):
    solid_box(-CORE - 0.16, CORE + 0.16, -CORE - 0.16, CORE + 0.16, h - 0.12, h, IT,
              faces=("+z", "-z", "+x", "-x", "+y", "-y"), tile=1.0)
# louvred belfry openings 14.2..15.1 on each face (recessed dark slats)
for (a, b, c, d, fc) in [(-1.3, 1.3, CORE, CORE, "+y"), (-1.3, 1.3, -CORE, -CORE, "-y"),
                         (CORE, CORE, -1.3, 1.3, "+x"), (-CORE, -CORE, -1.3, 1.3, "-x")]:
    if fc in ("+y", "-y"):
        solid_box(a, b, c, c, 14.2, 15.1, ILV, faces=(fc,), tile=1.0)
    else:
        solid_box(a, a, c, d, 14.2, 15.1, ILV, faces=(fc,), tile=1.0)

# ---- LOUVRE_SILL ring @ 14.0 (widest, x/d +/-3.7; pins the box) ----------------
# Open standable ring (no parapet: the verifier grids the whole authored rect, and
# a rail there is "art above the plane" that also crouches the ring's headroom).
ring_deck(-3.7, 3.7, -3.7, 3.7, -CORE, CORE, -CORE, CORE, 14.0, 0.5, IT)

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

# ----------------------------------------------------------------- finalise
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
mesh = bpy.data.meshes.new(KEY); bm.to_mesh(mesh); bm.free()
obj = bpy.data.objects.new(KEY, mesh)
for m in (MAT_CLAP, MAT_TRIM, MAT_LEAD, MAT_LOUVRE, MAT_STONE):
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
log(f"tris {tris}  verts {len(obj.data.vertices)}  rings 14.0/15.8/18.2/20.6  spire->30")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_yup=True, export_animations=False,
                          export_image_format="AUTO", export_jpeg_quality=90, export_tangents=True, use_selection=True)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
