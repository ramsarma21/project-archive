# Author the Town House repair scaffold (bldg-scaffold-run) as a clean, box-accurate
# procedural GLB: a Georgian building-under-repair timber scaffold that ENCLOSES the
# full staging staircase up the west front, so every mantle step reads as a real
# scaffold board/lift rather than a floating cargo crate.
#
# WHY THIS EXISTS (playtest look-defect #3). The builder authored the Town House
# ascent as a <=1.9 m mantle staircase with staging tops at 2.9 / 5.6 / 7.3 / 9.0 /
# 10.7 / 12.4 (up to the leads), but the shipped scaffold mesh only reached ~5.6 m,
# so the upper staging blocks stood bare against the brick with no frame around them
# and read as stacked crates. This regenerates the scaffold so a believable frame of
# standards (verticals), ledgers (horizontals along the run), transoms/putlogs
# (cross the width) and boarded lifts wraps the WHOLE staircase to 12.4 m. The board
# TOPS sit on the authored planes exactly (drawn==collision) and the natural bbox is
# pinned to the declared run so a contain-fit lands 1.0.
#
# Run: blender --background --python assets/pipeline/build_scaffold_run.py -- bldg-scaffold-run <out.glb>
import bpy
import bmesh
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
KEY = argv[0]
OUT_GLB = os.path.abspath(argv[1])
SEED = 74011124
RNG = np.random.default_rng(SEED)
TEX = 1024

# ------------------------------------------------------------------ declared box
# Blender frame (export_yup): X = width out from the wall, Y = the run along the
# west front, Z = height. gltf swaps -> W x H x D = 2.5 x 12.4 x 11.3. The run and
# width match the level's SCAFFOLD deck rect (2.5 x 11.3); the HEIGHT grows from
# the old 5.6 to 12.4 so the frame encloses the full staircase and its top board
# sits flush with the box top (base = maxY - height = 12.4 - 12.4 = 0, stands on
# the street). INTEGRATION NOTE for the builder is printed in the delivery report.
W, RUN, HT = 2.5, 11.3, 12.4
hx, hy = W / 2, RUN / 2

# staging LIFTS — the walkable board TOPS (drawn==collision), each boarded over a
# SLICE of the run rather than the whole of it, so the staging is a STAIRCASE.
#
# WHY THE SLICES ARE LOAD-BEARING (measured 31-Jul, and this supersedes the
# full-run boarding this file shipped first). The parkour reader only offers a
# mantle onto a surface that is NOT already over the player's head:
# `readRaisedSurface` takes `overhead = raisedAt(0)` and then skips every hit with
# that same id. It reads the level's AUTHORED deck rects, not this mesh. So when
# every lift was boarded over the full 11.3 m run, the lift above was overhead
# from everywhere on the lift below, and the whole ascent was refused — verified
# by `traversability.test.ts`, which refused all four staging climbs the moment
# the boards were authored honestly. Full-run stacked staging cannot be climbed at
# ANY spacing; only a stagger fixes it, and the stagger has to be in the asset
# because the authored rects have to match the mesh.
#
# (y is the run in the BLENDER frame, and `export_yup` FLIPS it: gltf z = -y, so
# world z = -y - 2.05 for this rect's centre. Getting that sign wrong put the 5.60
# landing at the south end of the run instead of the north, 7.8 m from the drop it
# has to catch — measured, not guessed. Consecutive lifts must not overlap in the
# run where the lower lift's route node stands, and the level's SCAFFOLD_D* rects
# mirror these slices exactly. Each comment below is the WORLD z the slice lands
# at, which is the number to compare against geometry.ts.)
#
# "MUST NOT OVERLAP" IS ABOUT THE NODE, NOT THE BOARDS, and reading it as the
# boards cost the mission its only ascent. Consecutive lifts here overlap by
# 0.4-0.8 m or abut exactly; what the overhead rule actually forbids is the lower
# lift's ROUTE NODE standing inside the upper lift's footprint. The 7.30 lift was
# the one exception — it stopped at world -4.00 while the 5.60 board below it ends
# at -4.20, leaving 0.2 m of open air between the two boards over a 5.6 m fall to
# the street. That is not an overhead problem, it is a HOLE: the reader answers a
# lip with a fall behind it, so `rankVerbs` returned RUN_OFF alone and CLIMB_UP was
# never a candidate from ANY standing spot on the 5.60 board (measured across its
# whole 3.5 m length, 31-Jul). The golden line's only route to the Town House leads
# was dead, and the playthrough wedged on this board. Pulling 7.30 north to -4.20
# makes it ABUT 5.60 exactly, the way 1.85/3.70 already do, and every spot on the
# lower board offers the mantle again. C_SCAFF_2S stands at world z -4.70, still
# 0.5 m clear of the upper board's footprint, so the overhead rule is untouched.
#
# The chain: 0 -> 1.85 -> 3.70 -> 5.60 -> 7.30 -> 9.00 -> 10.70 -> 12.40, i.e.
# rises of 1.85 / 1.85 / 1.90 / 1.70 / 1.70 / 1.70 / 1.70 — every one inside the
# 1.9 m mantle limit and clear of the 1.9-3.1 m dead zone, with open sky over each
# board's clear part. The old 2.90 lift is GONE: it made the first two steps 2.9
# and 2.7, both in the dead zone, and both needed a ladder to be taken at all.
LIFTS = [
    (1.85, -1.05, 0.95),    # world z -3.00 .. -1.00  first step off the street
    (3.70, 0.95, 2.95),     # world z -5.00 .. -3.00
    (5.60, 2.15, 5.63),     # world z -7.68 .. -4.20  the G-B drop landing + run south
    (7.30, -0.05, 2.15),    # world z -4.20 .. -2.00  abuts 5.60; see the hole note
    (9.00, -1.65, 0.35),    # world z -2.40 .. -0.40
    (10.70, -3.25, -1.25),  # world z -0.80 ..  1.20
    (12.40, -4.85, -2.85),  # world z  0.80 ..  2.80  flush with the leads
]
LIFT_H = [h for (h, _, _) in LIFTS]

POLE = 0.075                                   # standard / ledger cross-section (half)
BOARD_T = 0.055                                # staging board thickness
NBOARD = 5                                     # boards across the width per lift
NBAY = 6                                       # standards along the run (5 bays)


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


def plank_rgb(base, vertical=False, boards=7, knots=True):
    """Weathered fir boards: a run of boards with a dark seam and long grain, plus
    the odd knot — the repair-scaffold timber read."""
    n = TEX
    u = np.linspace(0, 1, n, endpoint=False)
    coord = np.broadcast_to((u[None, :] if not vertical else u[:, None]), (n, n))
    fb = coord * boards; board = np.floor(fb); bf = fb - board
    seam = _ss(0.0, 0.03, bf) * _ss(0.0, 0.03, 1 - bf)
    bseed = np.sin(board * 27.1) * 43758.5; bvar = bseed - np.floor(bseed)
    grain = aniso(n, 6 if vertical else 260, 260 if vertical else 6, RNG)
    base = np.array(base)
    rgb = base[None, None, :] * (0.80 + 0.4 * bvar)[..., None]
    rgb = np.clip(rgb * (0.86 + 0.28 * grain)[..., None], 0, 1)
    rgb = rgb * (0.62 + 0.38 * seam)[..., None]
    if knots:
        kn = aniso(n, 26, 26, RNG)
        rgb = np.where((kn > 0.9)[..., None], rgb * 0.55, rgb)
    # weathering: silvered toward one edge + grime blotches
    rgb *= (0.82 + 0.18 * aniso(n, 40, 40, RNG))[..., None]
    return np.clip(rgb, 0, 1)


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
    path = os.path.join(os.path.dirname(OUT_GLB) or ".", f"_sc_{name}.jpg")
    bpy.data.images[name + "-src"].save_render(path)
    baked = bpy.data.images.load(path); baked.name = name; baked.pack()
    try: os.remove(path)
    except OSError: pass
    return baked


def make_material(name, image, rough=0.93, spec=0.12):
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
# base-colour-only (the Blender 5.1 glTF writer emits normals BLACK; fix_glb_normals
# injects correct tangent normals post-export from these atlases)
MAT_POLE = make_material("pole", pack_jpeg("pole", plank_rgb((0.40, 0.30, 0.20), vertical=True, boards=3)), rough=0.9)
MAT_PLANK = make_material("plank", pack_jpeg("plank", plank_rgb((0.55, 0.45, 0.33), vertical=False, boards=6)), rough=0.92)
MAT_ROPE = make_material("rope", pack_jpeg("rope", flat_rgb(TEX // 4, (0.30, 0.24, 0.15), 0.10)), rough=0.95)
IPOLE, IPLANK, IROPE = 0, 1, 2

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


TILE = 1.0


def solid_box(x0, x1, y0, y1, z0, z1, mat, faces="all", tile=TILE):
    want = {"+x", "-x", "+y", "-y", "+z", "-z"} if faces == "all" else set(faces)
    U = lambda p, q: (p / tile, q / tile)
    if "+z" in want: quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), mat, [U(x0, y0), U(x1, y0), U(x1, y1), U(x0, y1)])
    if "-z" in want: quad((x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0), mat, [U(x0, y1), U(x1, y1), U(x1, y0), U(x0, y0)])
    if "-y" in want: quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), mat, [U(x0, z0), U(x1, z0), U(x1, z1), U(x0, z1)])
    if "+y" in want: quad((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1), mat, [U(x1, z0), U(x0, z0), U(x0, z1), U(x1, z1)])
    if "-x" in want: quad((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1), mat, [U(y1, z0), U(y0, z0), U(y0, z1), U(y1, z1)])
    if "+x" in want: quad((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), mat, [U(y0, z0), U(y1, z0), U(y1, z1), U(y0, z1)])


def diag(x0, x1, ya, za, yb, zb, mat, t=0.05):
    """A thin diagonal brace pole in the y-z plane at [x0,x1], from (ya,za) to
    (yb,zb). Drawn as a slender box swept along the diagonal (4 side quads)."""
    d = Vector((0.0, yb - ya, zb - za)); L = d.length
    if L < 1e-4: return
    d.normalize()
    nrm = Vector((0.0, -d.z, d.y)) * t          # in-plane normal
    a0 = Vector((0.0, ya, za)); b0 = Vector((0.0, yb, zb))
    for (xa, xb) in ((x0, x1),):
        p = [
            Vector((xa, a0.y + nrm.y, a0.z + nrm.z)), Vector((xa, a0.y - nrm.y, a0.z - nrm.z)),
            Vector((xa, b0.y - nrm.y, b0.z - nrm.z)), Vector((xa, b0.y + nrm.y, b0.z + nrm.z)),
            Vector((xb, a0.y + nrm.y, a0.z + nrm.z)), Vector((xb, a0.y - nrm.y, a0.z - nrm.z)),
            Vector((xb, b0.y - nrm.y, b0.z - nrm.z)), Vector((xb, b0.y + nrm.y, b0.z + nrm.z)),
        ]
        for idx in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
            vs = [bm.verts.new(p[i]) for i in idx]
            try:
                f = bm.faces.new(vs)
            except ValueError:
                for v in vs:
                    if v.is_valid and not v.link_faces: bm.verts.remove(v)
                continue
            f.material_index = mat
            for lp in f.loops:
                q = lp.vert.co; lp[uv].uv = (q.y + q.x, q.z)


# ----- standard (vertical pole) x/y positions ---------------------------------
STDX = [-(hx - 0.12), (hx - 0.12)]                       # near-wall row + outer row
STDY = list(np.linspace(-hy + 0.14, hy - 0.14, NBAY))    # bays along the run

# ---- STANDARDS: verticals ground -> top, at every node -----------------------
for sx in STDX:
    for sy in STDY:
        solid_box(sx - POLE, sx + POLE, sy - POLE, sy + POLE, 0.0, HT, IPOLE, tile=0.4)

# ---- foot SOLE PLATES: pin the footprint to the declared box + read as sills ---
solid_box(-hx, -hx + 0.16, -hy, hy, 0.0, 0.06, IPLANK, tile=1.4)
solid_box(hx - 0.16, hx, -hy, hy, 0.0, 0.06, IPLANK, tile=1.4)

# ---- per-lift LEDGERS, TRANSOMS, BOARDS, GUARD RAILS -------------------------
board_x0, board_x1 = STDX[0] + POLE, STDX[1] - POLE       # deck span between the rows
for li, (h, by0, by1) in enumerate(LIFTS):
    zt = h                                                # board TOP == authored plane
    zb = h - BOARD_T
    # ledgers run node-to-node along each standard row, just under the boards. Their
    # tiny y-END faces butt inside the corner standards (hidden), and a sub-COINCIDE
    # quad trips the weld gate as a self-pair, so they are dropped.
    for sx in STDX:
        solid_box(sx - POLE, sx + POLE, STDY[0], STDY[-1], zb - 2 * POLE, zb, IPOLE,
                  faces=("+x", "-x", "+z", "-z"), tile=0.5)
    # transoms/putlogs cross the width at each node, carrying the boards; their x-END
    # faces butt inside the ledgers (hidden) -> dropped for the same reason.
    for sy in STDY:
        solid_box(board_x0, board_x1, sy - POLE, sy + POLE, zb - POLE, zb, IPOLE,
                  faces=("+y", "-y", "+z", "-z"), tile=0.5)
    # boarded staging: NBOARD planks across the width, small gaps between them.
    # Boarded over THIS LIFT'S SLICE of the run only — see the LIFTS note. The
    # ledgers and transoms above stay full-run, which is both correct scaffold and
    # what keeps the frame reading as one continuous structure rather than a stack
    # of disconnected boards.
    span = board_x1 - board_x0
    bw = (span - 0.02 * (NBOARD - 1)) / NBOARD
    for k in range(NBOARD):
        bx0 = board_x0 + k * (bw + 0.02)
        solid_box(bx0, bx0 + bw, by0, by1, zb, zt, IPLANK, tile=1.2)
    # guard rail + mid rail on the OUTER row (kept inside the box; skip on top lift
    # where the plane is the leads take-off). Rails and toe board follow the BOARD,
    # so there is never a rail guarding a lift that has no staging under it.
    if h < HT - 0.5:
        gx = STDX[1]
        for gz in (h + 0.5, h + 1.0):
            if gz <= HT - POLE:
                solid_box(gx - POLE, gx + POLE, by0, by1, gz - POLE, gz + POLE, IPOLE,
                          faces=("+x", "-x", "+z", "-z"), tile=0.5)
        # toe board along the outer edge
        solid_box(gx - POLE, gx + POLE, by0, by1, zt, zt + 0.22, IPLANK,
                  faces=("+x", "-x", "+z", "-z"), tile=0.8)
    # END RAIL across the width at the SOUTH end of the 10.70 lift, and this one
    # is a collider — the single documented exception to the non-colliding rule
    # the rails otherwise follow (see the FACE braces note below).
    #
    # WHY ONLY HERE. `fatalTraversal.test.ts` drives a body off every reachable
    # high edge at a walk, a run and three dash phases. Twelve stations failed,
    # all of them leaving from THIS lip: the reader auto-offers CLIMB_UP, so a
    # body driven off the 7.30 or 9.00 lift climbs the staircase and runs off the
    # 10.70 board into a 10.70 m fall. The edge brake is not the answer and was
    # measured: at a walk it arms at world z 0.83 and the body settles, but at a
    # run it arms only once the capsule has cleared the board — 0.27 m past the
    # lip — kills the horizontal velocity and drops the body straight down.
    #
    # It does NOT block the ascent. The mantle onto the 12.40 lift is entered at
    # world z 0.80, north of this rail at 1.20, and the rail stands below that
    # lift's plane, so a body that has made the step is above it.
    #
    # by0 is the SOUTH end of a lift's slice: world z = -by - 2.05, so the larger
    # world z is the smaller by. The level mirrors this at SCAFFOLD_RAIL_D5_* in
    # level/geometry.ts — two thin bars, not a slab, so the collision is the
    # timber that is actually drawn and there is no invisible fill between them.
    if abs(h - 10.70) < 1e-6:
        for gz in (h + 0.5, h + 1.0):
            solid_box(board_x0, board_x1, by0 - POLE, by0 + POLE, gz - POLE, gz + POLE, IPOLE,
                      faces=("+y", "-y", "+z", "-z"), tile=0.5)

# ---- FACE braces: zig-zag diagonals up the outer face (the scaffold read) -----
gx = STDX[1]
for li in range(len(LIFT_H) - 2):                 # stop below the top lift so no brace overshoots HT
    y0d, y1d = STDY[0], STDY[-1]
    if li % 2 == 0:
        diag(gx - POLE, gx + POLE, y0d, LIFT_H[li] - 1.2 if li else 0.12, y1d, LIFT_H[li + 1], IPOLE)
    else:
        diag(gx - POLE, gx + POLE, y1d, LIFT_H[li] - 1.2, y0d, LIFT_H[li + 1], IPOLE)
# a couple of low ground braces for the planted read (start above the sole plate)
diag(gx - POLE, gx + POLE, STDY[0], 0.12, STDY[1], LIFT_H[0], IPOLE)

# ---- END (gable) frames: cross-brace the two end bays in the x-z plane --------
for sy in (STDY[0], STDY[-1]):
    # in the x-z plane at this y, a diagonal from near-wall foot to outer head of
    # the first lift, drawn as a thin box
    x0d, x1d = STDX[0], STDX[1]
    for li in range(0, len(LIFT_H) - 2, 2):       # keep gable braces clear of the top edge
        za, zc = LIFT_H[li] if li else 0.12, LIFT_H[li + 1]
        # sweep a slim box along x from (x0d,za) to (x1d,zc)
        d = Vector((x1d - x0d, 0.0, zc - za)); L = d.length; d.normalize()
        nn = Vector((-d.z, 0.0, d.x)) * 0.045
        p = [Vector((x0d + nn.x, sy - POLE, za + nn.z)), Vector((x0d - nn.x, sy - POLE, za - nn.z)),
             Vector((x1d - nn.x, sy - POLE, zc - nn.z)), Vector((x1d + nn.x, sy - POLE, zc + nn.z)),
             Vector((x0d + nn.x, sy + POLE, za + nn.z)), Vector((x0d - nn.x, sy + POLE, za - nn.z)),
             Vector((x1d - nn.x, sy + POLE, zc - nn.z)), Vector((x1d + nn.x, sy + POLE, zc + nn.z))]
        for idx in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
            vs = [bm.verts.new(p[i]) for i in idx]
            try:
                f = bm.faces.new(vs)
            except ValueError:
                for v in vs:
                    if v.is_valid and not v.link_faces: bm.verts.remove(v)
                continue
            f.material_index = IPOLE
            for lp in f.loops:
                q = lp.vert.co; lp[uv].uv = (q.x + q.y, q.z)

# ---- rope LASHINGS: a dark band ringing the standard MID-BAY, clear of the ledger
# junctions (so the band's faces never sit within the weld gate's coincide radius of
# a ledger/transom face). Placed halfway between two lifts on the outer standards.
LASH = 0.024
mids = [(LIFT_H[i] + LIFT_H[i + 1]) / 2 for i in range(len(LIFT_H) - 1)]
for sx in STDX:
    for sy in (STDY[0], STDY[len(STDY) // 2], STDY[-1]):
        for mz in mids:
            solid_box(sx - POLE - LASH, sx + POLE + LASH, sy - POLE - LASH, sy + POLE + LASH,
                      mz - 0.035, mz + 0.035, IROPE, faces=("+x", "-x", "+y", "-y"), tile=0.3)

# ----------------------------------------------------------------- finalise
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
mesh = bpy.data.meshes.new(KEY); bm.to_mesh(mesh); bm.free()
obj = bpy.data.objects.new(KEY, mesh)
for m in (MAT_POLE, MAT_PLANK, MAT_ROPE):
    obj.data.materials.append(m)
for poly in obj.data.polygons:
    poly.use_smooth = False
bpy.context.scene.collection.objects.link(obj)

co = np.array([v.co[:] for v in obj.data.vertices])
lo, hi = co.min(0), co.max(0); size = hi - lo; centre = (lo + hi) / 2.0
log(f"blender bbox {size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f}  -> gltf {size[0]:.3f}(w) x {size[2]:.3f}(h) x {size[1]:.3f}(d)  declared {W}x{HT}x{RUN}")
for axis, got, dec in (("width", size[0], W), ("run", size[1], RUN), ("height", size[2], HT)):
    if abs(got - dec) > 0.02:
        raise SystemExit(f"{axis} {got:.3f} != declared {dec}; contain-fit would move the staging planes")
if abs(centre[0]) > 0.02 or abs(centre[1]) > 0.02 or abs(lo[2]) > 0.02:
    raise SystemExit(f"bbox not centred on axis at base 0 (centre {centre[0]:+.3f},{centre[1]:+.3f}, minZ {lo[2]:.3f})")
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
log(f"tris {tris}  verts {len(obj.data.vertices)}  lifts {LIFT_H}")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_yup=True, export_animations=False,
                          export_image_format="AUTO", export_jpeg_quality=90, export_tangents=True, use_selection=True)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
