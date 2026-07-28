# Re-author bldg-brick.glb as a clean Georgian brick building — fully in Blender,
# no Meshy raw. This is a RE-AUTHOR, and the reason is on the record from the
# slice pass (probe_brick_facade.mjs, commit history):
#
#   * The shipped mesh is 24.2% needle SLIVERS and the RAW generation behind it is
#     32.0%, both on a smeary 1024 atlas. The tears are real 3-D flaps around every
#     window, coherent displaced regions, not a triangulation artifact.
#   * Every in-place repair was rendered and failed: weld+beautify took slivers
#     24%->9% but left the flaps; de-spike cannot touch coherent regions; a
#     decimate made it worse. No weld/de-dup/UV repair reaches a jagged surface.
#   * The generator's own output IS the defect — the third time today after the elm
#     and the Town House — so a Meshy round-trip is asking the same generator that
#     produced 32% slivers to do better on a retry. Authored instead.
#
# What the two placements demand (from assets.ts, geometry.ts, runtime.ts and the
# FittedGlb fit in packages/engine-world/src/ImportedAssets.tsx):
#
#   * ONE mesh serves seven draws. The Gaol draws it as a stretched 2x3 MODULE
#     grid (each tile FILLED per-axis to ~6.5 x 9.6 x 4.67); the Old Brick tower
#     draws it as a single uniform PROP contain-fit to 9.2 x 13.6 x 8.0. FittedGlb
#     recentres on the bbox and sits the base at the plane, so the GLB origin does
#     not matter — only the bbox and the shape do.
#   * The natural bbox MUST stay 1.283 x 1.904 x 1.107 (glTF X,Y,Z). runtime.ts
#     MODULE_RUNS.naturalM is that triple hard-coded, and the belfry contain-fit
#     binds on Y at 13.60/1.904 = 7.14 to land its FLAT roof on the OLD_BRICK_WATCH
#     deck at 13.60m (hard-won: 6% -> 73%, must not regress). So: a flat leaded
#     roof across the WHOLE footprint at Y-max, and no element may oversail the box.
#   * Because the module is scaled 5-7x at runtime, UVs baked at natural scale are
#     magnified by the fit. Windows are 0..1-mapped per pane so they scale with
#     their opening and stay proportionate; brick tiles at a chosen natural rate
#     picked so the DRAWN course lands near a real ~75mm brick at the Gaol's ~5x.
#
# Historical target: Boston, 1765 — a stone gaol block and a brick meeting-house
# watch tower. Georgian brick with regular fenestration (2 bays x 3 storeys per
# face, sash windows recessed into real reveals), a plain leaded flat roof.
# Windows are authored on ALL FOUR faces so the mesh reads right whichever face a
# MODULE rank or the PROP tower turns to the street. Matte throughout: a specular
# sheen is what read as varnish on the elm.
#
# Run:
#   blender --background --python assets/pipeline/build_brick_facade.py -- out.glb
#     [--brick-tile 0.42] [--nx 2] [--ny 3]
import bpy
import bmesh
import math
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
OUT_GLB = os.path.abspath(argv[0])
opts = {"brick-tile": 0.42, "nx": 2.0, "ny": 3.0, "tex": 2048.0}
rest = argv[1:]
for i in range(0, len(rest) - 1, 2):
    name = rest[i].lstrip("-")
    if name in opts:
        opts[name] = float(rest[i + 1])

# glTF X,Y,Z = width,height,depth. Blender is Z-up and export_yup maps Blender Z
# to glTF Y, so author width along X, DEPTH along Y, HEIGHT along Z.
NAT_W, NAT_H, NAT_D = 1.283, 1.904, 1.107        # glTF x,y,z
BW, BD, BH = NAT_W, NAT_D, NAT_H                  # Blender x,y,z
NX = int(opts["nx"])
NY = int(opts["ny"])
BRICK_TILE = opts["brick-tile"]
TEX = int(opts["tex"])
SEED = 17651114
RNG = np.random.default_rng(SEED)


def log(*p):
    print("[bldg-brick]", *p)


# ---------------------------------------------------------------------------
# Textures — generated, matte, tileable brick + a sash window + leaded stone
# ---------------------------------------------------------------------------

def _smoothstep(a, b, t):
    t = np.clip((t - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


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


def brick_fields():
    """Return (albedo rgb, height) for a running-bond brick wall that tiles. Bricks
    proud and warm red-brown with per-brick colour drift; bed and head joints
    recessed and mortar-grey."""
    n = TEX
    NC, NB = 32, 11                                   # courses, bricks per course
    v = np.linspace(0, 1, n, endpoint=False)[:, None]
    u = np.linspace(0, 1, n, endpoint=False)[None, :]
    fy = v * NC
    course = np.floor(fy)
    cf = fy - course
    offset = np.where(course % 2 == 0, 0.0, 0.5)
    fx = u * NB + offset
    brick = np.floor(fx)
    bf = fx - brick
    mv, mu, e = 0.11, 0.07, 0.02                       # bed/head joint fractions, soft edge
    bed = _smoothstep(mv - e, mv + e, cf) * _smoothstep(mv - e, mv + e, 1.0 - cf)
    head = _smoothstep(mu - e, mu + e, bf) * _smoothstep(mu - e, mu + e, 1.0 - bf)
    brick_mask = np.broadcast_to(bed, (n, n)) * head  # 1 on a brick face, 0 in a joint
    courseB = np.broadcast_to(course, (n, n))
    seed = np.sin(courseB * 12.9898 + brick * 78.233) * 43758.5453
    var = seed - np.floor(seed)                       # constant per brick, in [0,1)
    red = 0.34 + 0.20 * var
    grn = 0.15 + 0.08 * var
    blu = 0.11 + 0.06 * var
    # A few burnt/darker headers, the way a Flemish bond scatters them.
    dark = (var < 0.18)
    red = np.where(dark, red * 0.6, red)
    grn = np.where(dark, grn * 0.6, grn)
    blu = np.where(dark, blu * 0.7, blu)
    brick_rgb = np.stack([red, grn, blu], axis=2)
    grain = (aniso_noise(n, 220, 200, RNG) - 0.5) * 0.06
    brick_rgb = np.clip(brick_rgb + grain[..., None], 0, 1)
    mortar = np.array([0.60, 0.57, 0.50])
    mgrain = (aniso_noise(n, 90, 90, RNG) - 0.5) * 0.05
    mortar_rgb = np.clip(mortar[None, None, :] + mgrain[..., None], 0, 1)
    t = brick_mask[..., None]
    rgb = mortar_rgb * (1 - t) + brick_rgb * t
    # Height: brick proud, joints recessed; a little bevel from the soft mask edge.
    H = 0.25 + 0.75 * brick_mask
    return np.clip(rgb, 0, 1), H


def window_rgb():
    """A Georgian six-over-six sash: off-white frame and glazing bars on dark,
    faintly sky-tinted glass. Matte."""
    n = TEX // 2
    X = np.broadcast_to(np.linspace(0, 1, n)[None, :], (n, n))
    Y = np.broadcast_to(np.linspace(0, 1, n)[:, None], (n, n))
    glass = np.array([0.11, 0.14, 0.18])
    frame = np.array([0.85, 0.84, 0.79])
    # Slight vertical sky gradient on the glass: lighter at the top.
    sky = (0.14 * (1.0 - Y))[..., None] * np.array([0.5, 0.6, 0.8])[None, None, :]
    rgb = glass[None, None, :] + sky
    fb = 0.11                                          # outer frame/architrave
    border = (X < fb) | (X > 1 - fb) | (Y < fb) | (Y > 1 - fb)
    bar = 0.018
    vert = (np.abs(X - 1 / 3.0) < bar) | (np.abs(X - 2 / 3.0) < bar)
    horiz = (np.abs(Y - 0.25) < bar) | (np.abs(Y - 0.75) < bar)
    rail = np.abs(Y - 0.5) < bar * 1.8                 # thicker meeting rail
    mask = border | vert | horiz | rail
    rgb = np.where(mask[..., None], frame[None, None, :], rgb)
    return np.clip(rgb, 0, 1)


def stone_rgb():
    """Warm pale ashlar/lead grey for reveals, sills and the flat roof. Matte."""
    n = TEX // 4
    base = np.array([0.60, 0.585, 0.55])
    grain = (aniso_noise(n, 40, 40, RNG) - 0.5) * 0.08 + (aniso_noise(n, 130, 130, RNG) - 0.5) * 0.05
    rgb = base[None, None, :] + grain[..., None]
    return np.clip(rgb, 0, 1)


def _to_blender_image(name, rgb):
    n_h, n_w = rgb.shape[:2]
    rgba = np.concatenate([rgb, np.ones((n_h, n_w, 1))], axis=2)
    img = bpy.data.images.new(name, width=n_w, height=n_h, alpha=False)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    return img


def pack_jpeg(name, rgb, quality=90):
    """Round-trip an opaque colour image through a real JPEG on disk, so the glTF
    AUTO exporter embeds it as JPEG rather than a wasteful opaque PNG (which
    check-world-textures BLOCKS over 1 MiB). Marking the packed image is not
    enough; the exporter re-encodes whatever it finds."""
    img = _to_blender_image(name + "-src", rgb)
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = quality
    path = os.path.join(os.path.dirname(OUT_GLB) or ".", f"_brick_{name}.jpg")
    img.save_render(path)
    baked = bpy.data.images.load(path)
    baked.name = name
    baked.pack()
    try:
        os.remove(path)
    except OSError:
        pass
    return baked


def make_normal(height, strength=2.6):
    """Tangent-space normal map from a height field so the joints read RECESSED.
    Stored PNG (alpha channel) and Non-Color; check-world-textures reports it as a
    PNG_DATA_TEXTURE observation, never a block."""
    n = height.shape[0]
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(height)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    r, g, b = nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5
    rgba = np.stack([r, g, b, np.ones_like(height)], axis=2)
    img = bpy.data.images.new("brick-normal", width=n, height=n, alpha=True)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    img.colorspace_settings.name = "Non-Color"
    return img


def make_material(name, image, normal=None, roughness=0.94, spec=0.2):
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
        nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    mat.blend_method = "OPAQUE"
    mat.use_backface_culling = False                   # -> doubleSided; winding-proof
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


log("generating textures")
bpy.ops.wm.read_factory_settings(use_empty=True)
BRICK_RGB, BRICK_H = brick_fields()
BRICK_IMG = pack_jpeg("brick-albedo", BRICK_RGB)
BRICK_N = make_normal(BRICK_H)
WINDOW_IMG = pack_jpeg("brick-window", window_rgb())
STONE_IMG = pack_jpeg("brick-stone", stone_rgb())
MAT_BRICK = make_material("brick", BRICK_IMG, normal=BRICK_N, roughness=0.95, spec=0.18)
MAT_WINDOW = make_material("brick-glass", WINDOW_IMG, roughness=0.55, spec=0.25)
MAT_STONE = make_material("brick-stone", STONE_IMG, roughness=0.9, spec=0.15)

# ---------------------------------------------------------------------------
# Geometry — a closed brick box with recessed sash windows on all four faces
# ---------------------------------------------------------------------------
bm = bmesh.new()
uv = bm.loops.layers.uv.new("UVMap")
IB, IW, IS = 0, 1, 2                                   # material slots


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


WW = 0.30                                              # window opening, along the face
WH = 0.34                                              # window opening, up the face
DEPTH = 0.055                                          # recess depth
STONE_TILE = 0.5


def bounds_along(total, count, size):
    pier = (total - count * size) / (count + 1)
    b = [0.0]
    cur = 0.0
    for _ in range(count):
        cur += pier
        b.append(cur)
        cur += size
        b.append(cur)
    b.append(total)                                    # trailing pier ends the face
    return b


def build_face(origin, along, up, inward, width, height, nx, ny):
    """Brick grid with recessed sash windows. `along/up/inward` are unit Vectors;
    windows fall on odd segments in both axes, brick fills the rest."""
    ab = bounds_along(width, nx, WW)
    ub = bounds_along(height, ny, WH)

    def P(a, u, d):
        return origin + along * a + up * u + inward * d

    for i in range(len(ab) - 1):
        a0, a1 = ab[i], ab[i + 1]
        awin = i % 2 == 1
        for j in range(len(ub) - 1):
            u0, u1 = ub[j], ub[j + 1]
            uwin = j % 2 == 1
            if awin and uwin:
                # Recessed sash: dark glazed pane set back, four stone reveals.
                add_quad(P(a0, u0, DEPTH), P(a1, u0, DEPTH), P(a1, u1, DEPTH), P(a0, u1, DEPTH),
                         IW, [(0.03, 0.03), (0.97, 0.03), (0.97, 0.97), (0.03, 0.97)])
                aw = (a1 - a0) / STONE_TILE
                uw = (u1 - u0) / STONE_TILE
                dw = DEPTH / STONE_TILE
                add_quad(P(a0, u0, 0), P(a1, u0, 0), P(a1, u0, DEPTH), P(a0, u0, DEPTH),
                         IS, [(0, 0), (aw, 0), (aw, dw), (0, dw)])       # sill
                add_quad(P(a0, u1, 0), P(a1, u1, 0), P(a1, u1, DEPTH), P(a0, u1, DEPTH),
                         IS, [(0, 0), (aw, 0), (aw, dw), (0, dw)])       # lintel
                add_quad(P(a0, u0, 0), P(a0, u1, 0), P(a0, u1, DEPTH), P(a0, u0, DEPTH),
                         IS, [(0, 0), (uw, 0), (uw, dw), (0, dw)])       # left reveal
                add_quad(P(a1, u0, 0), P(a1, u1, 0), P(a1, u1, DEPTH), P(a1, u0, DEPTH),
                         IS, [(0, 0), (uw, 0), (uw, dw), (0, dw)])       # right reveal
            else:
                add_quad(P(a0, u0, 0), P(a1, u0, 0), P(a1, u1, 0), P(a0, u1, 0), IB,
                         [(a0 / BRICK_TILE, u0 / BRICK_TILE), (a1 / BRICK_TILE, u0 / BRICK_TILE),
                          (a1 / BRICK_TILE, u1 / BRICK_TILE), (a0 / BRICK_TILE, u1 / BRICK_TILE)])


X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
# +Y and -Y faces span width along X; +X and -X faces span depth along Y.
build_face(Vector((0, BD, 0)), X, Z, -Y, BW, BH, NX, NY)
build_face(Vector((0, 0, 0)), X, Z, Y, BW, BH, NX, NY)
build_face(Vector((BW, 0, 0)), Y, Z, -X, BD, BH, NX, NY)
build_face(Vector((0, 0, 0)), Y, Z, X, BD, BH, NX, NY)

# Flat leaded roof across the WHOLE footprint at Y-max (the belfry watch deck).
RT = 0.6
add_quad((0, 0, BH), (BW, 0, BH), (BW, BD, BH), (0, BD, BH), IS,
         [(0, 0), (BW / RT, 0), (BW / RT, BD / RT), (0, BD / RT)])
# Floor cap at the base so no view sees up into a hollow shell.
add_quad((0, 0, 0), (0, BD, 0), (BW, BD, 0), (BW, 0, 0), IS,
         [(0, 0), (0, BD / RT), (BW / RT, BD / RT), (BW / RT, 0)])

# ---------------------------------------------------------------------------
# Finalise: weld, normals, size-pin to the declared natural box, export
# ---------------------------------------------------------------------------
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
mesh = bpy.data.meshes.new("bldg-brick")
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("bldg-brick", mesh)
for m in (MAT_BRICK, MAT_WINDOW, MAT_STONE):
    obj.data.materials.append(m)
for poly in obj.data.polygons:
    poly.use_smooth = False                            # crisp brick/reveal edges
bpy.context.scene.collection.objects.link(obj)

co = np.array([v.co[:] for v in obj.data.vertices])
lo, hi = co.min(axis=0), co.max(axis=0)
size = hi - lo
log(f"blender bbox {size[0]:.4f} x {size[1]:.4f} x {size[2]:.4f}  (want {BW:.3f} x {BD:.3f} x {BH:.3f})")
# The bbox is the draw contract for BOTH placements; hold it hard. glTF X,Y,Z map
# from Blender X,Z,Y, so check against (BW, BH, BD).
want = {"x": (size[0], BW), "z(->gltf y)": (size[2], BH), "y(->gltf z)": (size[1], BD)}
for axis, (got, target) in want.items():
    if abs(got - target) > max(0.005, 0.005 * target):
        raise SystemExit(f"bbox drift on {axis}: {got:.4f} != {target:.4f}; a rescale would move a placement")
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
log(f"tris {tris}  verts {len(obj.data.vertices)}")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_yup=True,
    export_animations=False,
    export_image_format="AUTO",
    export_jpeg_quality=90,
    export_tangents=True,
    use_selection=True,
)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
