# Give a building the flat roof its collision already says it has.
#
# The defect this exists to close
# ------------------------------
# `structure()` in packages/mission-m1/src/authoring.ts emits every building as a
# full-height solid topped by a FLAT deck at the wall head, and the route was
# tuned standing on those decks: every leap arc and the 180-second budget assume a
# level plane at `roofY`. The art disagreed. Each `bldg-row-*` mesh is a single
# generated dwelling with a PITCHED roof, and `rowPlacements` scales it so the
# mesh's bounding box fills the tile exactly — which puts the RIDGE at `roofY` and
# everything either side of it below. `SOUTH_ROW_A__ROOF` is authored flat at
# 12.40m across a 9 x 12m block and its mesh only touches 12.40 at the gable apex:
# north eaves 8.00, ridge 11.13-12.24. So the player ran on air, and the two
# chimney stacks standing on that deck — which fit their own boxes at scale 1.0000
# and cover 100% of their own plan — floated 3.10m.
#
# The owner's decision was to move the ART, not the collision: generate flat-deck
# roof art so the drawn roof meets the authored plane. That is what this does.
#
# Why the roof has to be flat edge to edge, and not a roof walk
# ------------------------------------------------------------
# `verify_m1_placements.mjs` rays a 5x5 grid over the deck rect, and the deck rect
# is the building's plan INFLATED by JETTY_M. On a 9m frontage the outermost
# sample therefore lands 0.34m inside the wall face, and 90% of the grid has to
# hit. A captain's walk down the middle of the roof covers three rows of five and
# scores 60%. Nothing short of leadwork from eaves to eaves passes, so that is
# what this authors: a lead flat behind a flush parapet gutter, which is a real
# Boston roof on brick public and commercial buildings and is the first of the
# three period answers the brief allows.
#
# Nothing may stand ABOVE the deck, and that is the same arithmetic. A MODULE or
# SHELL draw is scaled per axis ONTO its box, so the mesh's bounding box top IS
# `roofY`: a parapet coping modelled 0.4m over the leadwork pushes the leadwork
# 0.4m under the plane the player walks on. So the coping is FLUSH with the lead
# and the parapet reads from below, off the moulded cornice hung under it, where a
# parapet is read from anyway. The only relief on the deck itself is the lead
# rolls, and the bays between them sit `KERB_M` down — 60mm, inside the reader's
# own step-down, so the surface stays continuous to the mover as well as to the
# probe.
#
# What it keeps
# -------------
# The generated façade, its brickwork or clapboard, and its single texture atlas.
# Only the geometry above the eaves is replaced, and the wall between the old
# eaves and the new parapet is filled by REPEATING the mesh's own top storey
# rather than by extruding blank wall — so a building that gains 4m of height
# gains another course of its own windows with it.
#
# The bounding box is preserved to the micron when `--keepbbox 1`. That is not
# tidiness: `MODULE_RUNS` in runtime.ts carries each row mesh's measured
# `naturalM`, and `rowPlacements` divides the block by it to decide how many
# houses cover a frontage. A mesh that came back 0.2 units shorter would silently
# re-tile six blocks of Boston.
#
# Run:
#   blender --background --python assets/pipeline/build_m1_flat_deck.py -- \
#     in.glb hull.json out.glb [--eaves 0.65] [--tilex 2] [--tilez 2]
#     [--yaw90 1] [--cut 0.30] [--keepbbox 1] [--tris 18000] [--tex 2048]
#
# --eaves    fraction of the mesh's own height where the wall stops and the roof
#            starts. 0 auto-detects it off the plan-area profile.
# --cut      fraction above which the source mesh is discarded outright, for a
#            mesh that carries something this building does not want. The Hollis
#            Street body comes out of `church-meetinghouse`, whose top 70% is a
#            steeple, and M1 draws that steeple as a separate climbable asset.
# --shell    keep only this depth of the plan's edge, dropping everything inside
#            it. For a tiled build, where the interior copies are party walls and
#            roof timbers nobody can see.
# --tilex/z  repeat the body this many times in plan before fitting. A contain-fit
#            cannot change an aspect, so a 1.6 x 1.9 mesh asked to be a 13 x 14m
#            printing house is stretched 2x on both plan axes; two by two copies
#            of it are within 9% of the target and read as a bay rhythm.
# --yaw90    quarter-turn the body inside the mesh, for a source whose long
#            elevation runs the wrong way. This is art-local and does not touch
#            the level's own `yaw`, which compile.ts turns into collision.
import bpy
import bmesh
import json
import math
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC_GLB = os.path.abspath(argv[0])
HULL_JSON = os.path.abspath(argv[1])
OUT_GLB = os.path.abspath(argv[2])

opts = {
    "eaves": 0.0, "cut": 0.0, "shell": 0.0, "tilex": 1, "tilez": 1, "yaw90": 0,
    "keepbbox": 1, "tris": 18000, "tex": 2048, "jpeg": 86,
}
rest = argv[3:]
for index in range(0, len(rest) - 1, 2):
    name = rest[index].lstrip("-")
    if name not in opts:
        raise SystemExit(f"unknown option {rest[index]}")
    opts[name] = (
        float(rest[index + 1])
        if name in ("eaves", "cut", "shell")
        else int(rest[index + 1])
    )

with open(HULL_JSON) as handle:
    HULL = json.load(handle)

KEY = HULL["key"]
ENV = HULL["envelope"]


def log(*parts):
    print(f"[{KEY}]", *parts)


# glTF is Y-up and Blender is Z-up, so a hull-local offset (x, y, z) arrives at
# (x, -z, y). Converted once, here, and never inline.
EX0, EX1 = ENV["minX"], ENV["maxX"]
EY0, EY1 = -ENV["maxZ"], -ENV["minZ"]
EZ0, EZ1 = ENV["minY"], ENV["maxY"]
SPAN_X, SPAN_Y, SPAN_Z = EX1 - EX0, EY1 - EY0, EZ1 - EZ0
log(f"envelope  x {EX0:.2f}..{EX1:.2f}  y {EY0:.2f}..{EY1:.2f}  z {EZ0:.2f}..{EZ1:.2f}")

# The deck this build exists to carry: the highest walkable plane at the envelope
# ceiling. Taken from the hull rather than from the ceiling itself so that a
# mismatch between the two is a loud failure instead of a roof at the wrong height.
roof_decks = [d for d in HULL["decks"] if abs(d["y"] - EZ1) < 0.01]
if not roof_decks:
    raise SystemExit(
        f"no walkable deck at the envelope ceiling {EZ1:.2f}; "
        f"decks are {[(d['id'], round(d['y'], 2)) for d in HULL['decks']]}"
    )
ROOF = roof_decks[0]
log(f"roof deck {ROOF['id']} at z={ROOF['y']:.2f}, {ROOF['standableFraction'] * 100:.0f}% standable")


# ---------------------------------------------------------------------------
# The roof's own dimensions
# ---------------------------------------------------------------------------
# Metres, and every one of them bounded by something rather than chosen. Read
# together they are a lead flat inside a parapet gutter, on a moulded cornice.

# Depth of the whole roof structure below the deck plane. A cornice may only hang
# as far below its deck as the headroom under it allows, and 0.42m is what the
# shallowest of these buildings can spare over its top window head.
SLAB_M = 0.42
# The walking course itself. The rest of SLAB_M is profile hung underneath it.
CORONA_M = 0.15
# Width of the flush leaded parapet gutter round the edge. 0.5m is a gutter plus
# the coping over the wall head; it also has to stay OUTSIDE the probe's outermost
# ray, which on the narrowest tile here lands 0.28m in from the wall face.
PARAPET_M = 0.24
# How far a lead bay sits below the rolls that seam it. 60mm: enough to read as
# leadwork, and a fifth of the 0.35m step-down both the reader and the probe
# allow, so the deck stays one surface.
KERB_M = 0.06
ROLL_W_M = 0.11
# Lead came in sheets a yard or so wide and was joined over a timber roll, so the
# rolls are at sheet pitch. Anything much finer is triangles nobody sees at night.
ROLL_PITCH_M = 1.05
MODILLION_W_M = 0.16
MODILLION_PITCH_M = 0.72
# A cornice under 2m of frontage is brackets nobody can see, and 20 of them per
# tile times 18 tiles is a market shed made of shadows.
MODILLION_MIN_SIDE_M = 2.4


# ---------------------------------------------------------------------------
# 1. Import and normalise
# ---------------------------------------------------------------------------

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC_GLB)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
assert meshes, "no mesh in the source GLB"
bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
generated = bpy.context.view_layer.objects.active
generated.name = KEY
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
material = generated.data.materials[0] if generated.data.materials else None


def tris_of(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def coords_of(obj):
    return np.array([v.co[:] for v in obj.data.vertices], dtype=np.float64)


def bbox_of(obj):
    placed = coords_of(obj)
    return placed.min(axis=0), placed.max(axis=0)


SOURCE_LO, SOURCE_HI = bbox_of(generated)
SOURCE_SIZE = SOURCE_HI - SOURCE_LO
log(f"source tris {tris_of(generated)} bbox "
    f"{SOURCE_SIZE[0]:.4f} x {SOURCE_SIZE[1]:.4f} x {SOURCE_SIZE[2]:.4f}")


def transform(fn):
    for vertex in generated.data.vertices:
        vertex.co = fn(vertex.co)
    generated.data.update()


def normalise():
    """Base on z=0, plan centred on the bounding box."""
    lo, hi = bbox_of(generated)
    mid = ((lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0)
    transform(lambda co: Vector((co.x - mid[0], co.y - mid[1], co.z - lo[2])))


normalise()

if opts["yaw90"]:
    transform(lambda co: Vector((co.y, -co.x, co.z)))
    normalise()
    log("quarter-turned the body inside the mesh")

# A source that carries something this building does not want — the church body's
# steeple — is cut before anything is measured, so the eaves detector reads the
# body's own profile rather than the tower standing on it.
if opts["cut"] > 0.0:
    _, hi = bbox_of(generated)
    cut_z = opts["cut"] * hi[2]
    mesh = bmesh.new()
    mesh.from_mesh(generated.data)
    bmesh.ops.bisect_plane(
        mesh, geom=list(mesh.faces) + list(mesh.edges) + list(mesh.verts),
        plane_co=Vector((0, 0, cut_z)), plane_no=Vector((0, 0, 1)), clear_outer=True,
    )
    mesh.to_mesh(generated.data)
    mesh.free()
    generated.data.update()
    normalise()
    log(f"cut the source at {opts['cut']:.2f} of its height ({cut_z:.3f}); "
        f"{tris_of(generated)} tris left")


# ---------------------------------------------------------------------------
# 2. Repeat the body in plan, if the aspect asks for it
# ---------------------------------------------------------------------------
# A contain-fit takes the smallest of three box/mesh ratios, so a PROP whose mesh
# is the wrong shape draws small on two axes however it is placed — the printing
# office is a 1.63 x 1.90 mesh in a 13 x 14m box and drew 6.6 x 7.7m of it. No
# scale fixes an aspect; more of the building does.

if opts["tilex"] > 1 or opts["tilez"] > 1:
    lo, hi = bbox_of(generated)
    step_x, step_y = hi[0] - lo[0], hi[1] - lo[1]
    base = generated
    copies = []
    for ix in range(int(opts["tilex"])):
        for iy in range(int(opts["tilez"])):
            if ix == 0 and iy == 0:
                continue
            clone = base.copy()
            clone.data = base.data.copy()
            bpy.context.scene.collection.objects.link(clone)
            clone.location = (ix * step_x, iy * step_y, 0.0)
            copies.append(clone)
    bpy.ops.object.select_all(action="DESELECT")
    base.select_set(True)
    for clone in copies:
        clone.select_set(True)
    bpy.context.view_layer.objects.active = base
    bpy.ops.object.join()
    generated = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    normalise()
    lo, hi = bbox_of(generated)
    log(f"tiled {int(opts['tilex'])} x {int(opts['tilez'])}: bbox "
        f"{hi[0] - lo[0]:.3f} x {hi[1] - lo[1]:.3f} x {hi[2] - lo[2]:.3f}")


# ---------------------------------------------------------------------------
# 3. Into metres
# ---------------------------------------------------------------------------
# Everything from here is real-world, so a 0.42m cornice is 0.42m of stone rather
# than 0.42 of whatever unit Meshy normalised this building to. `--keepbbox`
# reverses exactly this scale at the end, which is what lets a mesh be authored in
# metres and still ship at the size `MODULE_RUNS` measured.

TILED_LO, TILED_HI = bbox_of(generated)
TILED_SIZE = np.maximum(TILED_HI - TILED_LO, 1e-9)
FIT = np.array([SPAN_X, SPAN_Y, SPAN_Z]) / TILED_SIZE
log(f"fit scale x {FIT[0]:.4f} y {FIT[1]:.4f} z {FIT[2]:.4f} "
    f"(relative to height: x {FIT[0] / FIT[2]:.3f} y {FIT[1] / FIT[2]:.3f})")
transform(lambda co: Vector((
    EX0 + (co.x - TILED_LO[0]) * FIT[0],
    EY0 + (co.y - TILED_LO[1]) * FIT[1],
    EZ0 + (co.z - TILED_LO[2]) * FIT[2],
)))

# Repeating a building four times over also repeats its party walls, its interior
# and its roof timbers, and every one of those is inside the block and cannot be
# seen. On the printing office that was two thirds of 200,000 triangles, and the
# decimation that followed took its 34% off the façade instead. So a tiled build
# keeps only the shell: faces whose centre lies further than this inside the plan
# are dropped before anything else measures the mesh.
if opts["shell"] > 0.0:
    depth = opts["shell"]
    mesh = bmesh.new()
    mesh.from_mesh(generated.data)
    mesh.faces.ensure_lookup_table()
    doomed = []
    for face in mesh.faces:
        centre = face.calc_center_median()
        if (
            EX0 + depth < centre.x < EX1 - depth
            and EY0 + depth < centre.y < EY1 - depth
        ):
            doomed.append(face)
    bmesh.ops.delete(mesh, geom=doomed, context="FACES")
    mesh.to_mesh(generated.data)
    mesh.free()
    generated.data.update()
    log(f"kept a {depth:.2f}m shell: dropped {len(doomed)} interior faces, "
        f"{tris_of(generated)} tris left")


# ---------------------------------------------------------------------------
# 4. Where the wall stops and the roof starts
# ---------------------------------------------------------------------------
# Off the plan-area profile, never off a silhouette width: a gambrel narrows in
# two stages and a width test cuts it at the first one, which leaves half a roof
# under the new leads.

SLABS = 200
coords = coords_of(generated)
edges = np.linspace(EZ0, EZ1, SLABS + 1)
centres = (edges[:-1] + edges[1:]) / 2.0
slab_index = np.clip(np.digitize(coords[:, 2], edges) - 1, 0, SLABS - 1)
area_profile = np.zeros(SLABS)
for s in range(SLABS):
    members = coords[slab_index == s]
    if len(members) < 8:
        continue
    x_lo, x_hi = np.percentile(members[:, 0], (2, 98))
    y_lo, y_hi = np.percentile(members[:, 1], (2, 98))
    area_profile[s] = max(0.0, x_hi - x_lo) * max(0.0, y_hi - y_lo)
smooth_area = np.convolve(area_profile, np.ones(5) / 5.0, mode="same")

if opts["eaves"] > 0.0:
    eaves_z = EZ0 + opts["eaves"] * SPAN_Z
    log(f"eaves forced to {opts['eaves']:.2f} of height ({eaves_z:.2f}m)")
else:
    # The wall is the band still holding most of the plan. 0.86 rather than 0.95:
    # a generated façade has a jetty, a doorcase and a string course, so the
    # profile is noisy by a few per cent all the way up, and a tight threshold
    # cuts the wall off at its own cornice.
    lower = smooth_area[: int(SLABS * 0.6)]
    max_area = float(lower.max()) if lower.size else float(smooth_area.max())
    full = [s for s in range(SLABS) if smooth_area[s] >= 0.86 * max_area]
    eaves_z = float(centres[max(full)]) if full else EZ0 + 0.6 * SPAN_Z
    log(f"eaves read off the plan profile at {(eaves_z - EZ0) / SPAN_Z:.3f} "
        f"of height ({eaves_z:.2f}m)")

WALL_TOP = EZ1 - SLAB_M
if eaves_z > WALL_TOP:
    log(f"eaves already above the wall head {WALL_TOP:.2f}; nothing to repeat")
    eaves_z = WALL_TOP


# ---------------------------------------------------------------------------
# 5. Cut the pitch off and repeat the top storey up to the parapet
# ---------------------------------------------------------------------------


def clip_z(obj, lo, hi):
    """Keep only the band between two heights.

    `offset` is signed so that `normal * offset` is a point on the plane, which is
    what lets one loop cut from both sides; `clear_outer` drops whatever lies on
    the normal's side of it.
    """
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    for normal, offset in (((0, 0, 1), hi), ((0, 0, -1), -lo)):
        mesh.faces.ensure_lookup_table()
        bmesh.ops.bisect_plane(
            mesh, geom=list(mesh.faces) + list(mesh.edges) + list(mesh.verts),
            plane_co=Vector(normal) * offset,
            plane_no=Vector(normal), clear_outer=True,
        )
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()


def clip_plan(obj):
    """Square the building off at the envelope in plan and at its ceiling.

    A contain-fit does not make an overhang bigger, it shrinks the whole building
    until the overhang fits — which drops the deck below its plane. Anything
    outside the box is a scale error, not decoration.
    """
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    for normal, offset in (
        ((1, 0, 0), EX1), ((-1, 0, 0), -EX0),
        ((0, 1, 0), EY1), ((0, -1, 0), -EY0),
        ((0, 0, 1), EZ1), ((0, 0, -1), -EZ0),
    ):
        mesh.faces.ensure_lookup_table()
        bmesh.ops.bisect_plane(
            mesh, geom=list(mesh.faces) + list(mesh.edges) + list(mesh.verts),
            plane_co=Vector(normal) * offset, plane_no=Vector(normal),
            clear_outer=True,
        )
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()


clip_z(generated, EZ0 - 1.0, eaves_z)
log(f"pitch removed above {eaves_z:.2f}m: {tris_of(generated)} tris")

# ONE course, always, and the wall is stretched first if that is what it takes.
#
# Two courses read as a stack of slabs and three read as debris, which is what the
# printing office came back as: every course is cut out of a shell mesh, so each
# one contributes an open cross-section at its own top and bottom, and the more
# often the wall is cut the more of it is edge rather than façade. The shambles
# got two 1.6m bands of blank clapboard and looked like a chest of drawers.
#
# So the gap is closed by a single band taken off the wall's own head, and the
# wall is stretched beforehand only as far as is needed to make one band enough.
# `COURSE_MAX_SHARE` is what "enough" means: a repeated band that is more than
# this share of the wall it came from is not a storey any more, it is the whole
# building said twice.
COURSE_MAX_SHARE = 0.65
wall_height = eaves_z - EZ0
gap = WALL_TOP - eaves_z
if gap > COURSE_MAX_SHARE * wall_height and wall_height > 0.2:
    # The smallest stretch that leaves one band sufficient, with a little margin
    # on COURSE_MAX_SHARE so the arithmetic is not sitting exactly on it.
    stretch = WALL_TOP / ((1.0 + 0.6 * COURSE_MAX_SHARE) * wall_height)
    if stretch > 1.001:
        transform(lambda co: Vector((co.x, co.y, EZ0 + (co.z - EZ0) * stretch)))
        eaves_z = EZ0 + wall_height * stretch
        wall_height = eaves_z - EZ0
        gap = WALL_TOP - eaves_z
        log(f"wall stretched x{stretch:.3f} to {eaves_z:.2f}m so one course covers "
            f"the remaining {gap:.2f}m")

if gap > 0.08:
    log(f"filling {gap:.2f}m of wall with one {gap:.2f}m course off its own head")
    clone = generated.copy()
    clone.data = generated.data.copy()
    bpy.context.scene.collection.objects.link(clone)
    clone.location = (0.0, 0.0, gap)
    bpy.context.view_layer.objects.active = clone
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    clip_z(clone, eaves_z, WALL_TOP)
    bpy.ops.object.select_all(action="DESELECT")
    generated.select_set(True)
    clone.select_set(True)
    bpy.context.view_layer.objects.active = generated
    bpy.ops.object.join()
    generated = bpy.context.view_layer.objects.active
    log(f"wall built to {WALL_TOP:.2f}m: {tris_of(generated)} tris")

clip_plan(generated)

TRI_BUDGET = int(opts["tris"])
tris = tris_of(generated)
if tris > TRI_BUDGET:
    bpy.context.view_layer.objects.active = generated
    modifier = generated.modifiers.new("dec", "DECIMATE")
    modifier.ratio = TRI_BUDGET / tris
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    # Re-pinned and re-clipped AFTER the collapse. Quadric collapse moves
    # vertices, and a base that drifts 150mm below zero becomes 150mm of float on
    # every deck once the fit bottom-aligns the bounding box.
    lo, _ = bbox_of(generated)
    if abs(lo[2] - EZ0) > 1e-4:
        transform(lambda co: Vector((co.x, co.y, co.z - (lo[2] - EZ0))))
        log(f"re-zeroed after decimation: base was {lo[2] - EZ0:+.4f}")
    clip_plan(generated)
log(f"generated half {tris_of(generated)} tris")


# ---------------------------------------------------------------------------
# 6. Atlas sampling
# ---------------------------------------------------------------------------
# The authored leadwork shares the generated atlas, so it needs UVs that land on
# grey rather than on sky. Same reasoning as build_m1_civic.py: sampling the UVs
# of faces that already are a material straddles Meshy's islands, so what an
# authored stone surface wants is the calmest patch of the right colour.

def flat_atlas_uv(low, high, fallback, grey=0.0):
    images = [i for i in bpy.data.images if i.size[0] >= 16]
    if not images:
        return fallback
    thumb = images[0].copy()
    grid = 48
    thumb.scale(grid, grid)
    pixels = np.empty(grid * grid * 4, dtype=np.float32)
    thumb.pixels.foreach_get(pixels)
    bpy.data.images.remove(thumb)
    rgb = pixels.reshape(grid, grid, 4)[:, :, :3]
    luma = rgb.mean(axis=2)
    # Brightness alone cannot tell lead from brick, and the calmest mid-bright
    # block on a brick atlas is brick — which is how a lead flat came out red.
    chroma = (rgb.max(axis=2) - rgb.min(axis=2)) / np.maximum(rgb.max(axis=2), 1e-4)
    block = 4
    best = None
    for row in range(0, grid - block + 1):
        for col in range(0, grid - block + 1):
            patch = luma[row : row + block, col : col + block]
            mean = float(patch.mean())
            if not (low <= mean <= high):
                continue
            score = float(patch.std()) + grey * float(
                chroma[row : row + block, col : col + block].mean()
            )
            if best is None or score < best[0]:
                best = (score, row, col)
    if best is None:
        return fallback
    _, row, col = best
    pad = 0.1 * block / grid
    return (
        col / grid + pad, (col + block) / grid - pad,
        row / grid + pad, (row + block) / grid - pad,
    )


# Disjoint brightness bands, so the cornice and the leadwork are not the same
# patch of atlas. Overlapping bands scored the same block twice and drew a lead
# flat and the dressed stone under it in one flat grey, which is the one thing a
# roofline cannot afford: the cornice reads entirely on the tonal step between it
# and the lead above it.
LEAD_UV = flat_atlas_uv(0.18, 0.48, (0.45, 0.55, 0.45, 0.55), grey=0.7)
STONE_UV = flat_atlas_uv(0.50, 0.92, LEAD_UV, grey=0.7)
log(f"lead  uv u {LEAD_UV[0]:.3f}..{LEAD_UV[1]:.3f} v {LEAD_UV[2]:.3f}..{LEAD_UV[3]:.3f}")
log(f"stone uv u {STONE_UV[0]:.3f}..{STONE_UV[1]:.3f} v {STONE_UV[2]:.3f}..{STONE_UV[3]:.3f}")


def ping_pong(value):
    t = math.fmod(abs(value), 2.0)
    return t if t <= 1.0 else 2.0 - t


def atlas_uv(box, u_raw, v_raw):
    u0, u1, v0, v1 = box
    return (u0 + ping_pong(u_raw) * (u1 - u0), v0 + ping_pong(v_raw) * (v1 - v0))


# ---------------------------------------------------------------------------
# 7. The roof
# ---------------------------------------------------------------------------

built = bmesh.new()
uv_layer = built.loops.layers.uv.new("UVMap")


def add_box(x0, x1, y0, y1, z0, z1, uv_box, uv_scale=0.5):
    if x1 - x0 <= 1e-4 or y1 - y0 <= 1e-4 or z1 - z0 <= 1e-4:
        return
    corners = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    verts = [built.verts.new(Vector(point)) for point in corners]
    quads = (
        (4, 5, 6, 7), (3, 2, 1, 0),
        (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
    )
    for quad in quads:
        try:
            face = built.faces.new([verts[i] for i in quad])
        except ValueError:
            continue
        face.smooth = False
        for loop, index in zip(face.loops, quad):
            point = corners[index]
            # Project on whichever pair of axes the face is broadest in, so the
            # grain of the atlas runs along the surface and not across it.
            if quad in ((4, 5, 6, 7), (3, 2, 1, 0)):
                u, v = point[0], point[1]
            elif quad in ((0, 1, 5, 4), (2, 3, 7, 6)):
                u, v = point[0], point[2]
            else:
                u, v = point[1], point[2]
            loop[uv_layer].uv = atlas_uv(uv_box, u * uv_scale, v * uv_scale)


def add_modillions(top, drop, inset):
    """The bracket course of a cornice: blocks with daylight between them.

    This is the difference between a cornice and a tray, and what reads at fifty
    metres is not the modelling but the row of shadows in the gaps. They sit
    inside the cornice's own depth rather than below it, because on the shallowest
    of these buildings there is no headroom to hang anything in.
    """
    for along, fixed, axis in (
        ((EY0, EY1), EX0, "x0"), ((EY0, EY1), EX1, "x1"),
        ((EX0, EX1), EY0, "y0"), ((EX0, EX1), EY1, "y1"),
    ):
        if along[1] - along[0] < MODILLION_MIN_SIDE_M:
            continue
        span = along[1] - along[0]
        count = max(1, int(span / MODILLION_PITCH_M))
        for index in range(count):
            centre = along[0] + span * (index + 0.5) / count
            a, b = centre - MODILLION_W_M / 2.0, centre + MODILLION_W_M / 2.0
            if axis == "x0":
                add_box(fixed, fixed + inset, a, b, top - drop, top, STONE_UV)
            elif axis == "x1":
                add_box(fixed - inset, fixed, a, b, top - drop, top, STONE_UV)
            elif axis == "y0":
                add_box(a, b, fixed, fixed + inset, top - drop, top, STONE_UV)
            else:
                add_box(a, b, fixed - inset, fixed, top - drop, top, STONE_UV)


# 7a. The parapet gutter: a flush leaded band round the whole edge, at the deck
# plane. It carries the outermost probe ray and it is what the coping reads as
# from the street. It cannot stand proud of the lead, for the reason in the header.
corona_lo = EZ1 - CORONA_M
inner_x0 = min(EX0 + PARAPET_M, (EX0 + EX1) / 2.0 - 0.05)
inner_x1 = max(EX1 - PARAPET_M, (EX0 + EX1) / 2.0 + 0.05)
inner_y0 = min(EY0 + PARAPET_M, (EY0 + EY1) / 2.0 - 0.05)
inner_y1 = max(EY1 - PARAPET_M, (EY0 + EY1) / 2.0 + 0.05)
add_box(EX0, EX1, EY0, inner_y0, corona_lo, EZ1, LEAD_UV)
add_box(EX0, EX1, inner_y1, EY1, corona_lo, EZ1, LEAD_UV)
add_box(EX0, inner_x0, inner_y0, inner_y1, corona_lo, EZ1, LEAD_UV)
add_box(inner_x1, EX1, inner_y0, inner_y1, corona_lo, EZ1, LEAD_UV)

# 7b. The flat itself, as lead sheets seamed over rolls. The rolls are at the deck
# plane and the bays a KERB_M below it, so the bounding box top is the plane the
# route was authored against and every square metre of the flat is inside the
# step-down the probe and the mover both allow.
flat_x0, flat_x1 = inner_x0, inner_x1
flat_y0, flat_y1 = inner_y0, inner_y1
rolls = max(1, int(round((flat_x1 - flat_x0) / ROLL_PITCH_M)))
pitch = (flat_x1 - flat_x0) / rolls
bays = 0
for index in range(rolls):
    a = flat_x0 + pitch * index
    b = a + pitch
    roll_a = max(a, b - ROLL_W_M)
    add_box(a, roll_a, flat_y0, flat_y1, corona_lo, EZ1 - KERB_M, LEAD_UV)
    add_box(roll_a, b, flat_y0, flat_y1, corona_lo, EZ1, LEAD_UV)
    bays += 1
log(f"lead flat {flat_x1 - flat_x0:.2f} x {flat_y1 - flat_y0:.2f}m in {bays} bays "
    f"at {pitch:.2f}m pitch, inside a {PARAPET_M:.2f}m parapet gutter")

# 7c. The cornice under it: a modillion course inside the corona's depth and a bed
# mould stepped back to the wall, so the roofline is architecture from the street
# rather than a slab edge.
band = max(0.0, SLAB_M - CORONA_M)
step = 0.30 * SLAB_M + 0.03
if band > 0.06:
    add_modillions(corona_lo, band * 0.6, step)
    add_box(EX0 + step, EX1 - step, EY0 + step, EY1 - step,
            corona_lo - band, corona_lo, STONE_UV)

# The envelope's plan and ceiling are pinned by the roof where it reaches them and
# by an explicit rail of corner studs where it does not. Without this the bounding
# box is whatever survived decimation, the fit scale drifts off 1.0, and every
# authored height lands a few centimetres low.
PIN = 0.02
for x0, x1 in ((EX0, EX0 + PIN), (EX1 - PIN, EX1)):
    for y0, y1 in ((EY0, EY0 + PIN), (EY1 - PIN, EY1)):
        add_box(x0, x1, y0, y1, EZ0, EZ0 + PIN, STONE_UV)
        add_box(x0, x1, y0, y1, EZ1 - PIN, EZ1, LEAD_UV)

bmesh.ops.remove_doubles(built, verts=list(built.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(built, faces=list(built.faces))
roof_mesh = bpy.data.meshes.new(f"{KEY}-roof")
built.to_mesh(roof_mesh)
built.free()
roof = bpy.data.objects.new(f"{KEY}-roof", roof_mesh)
bpy.context.scene.collection.objects.link(roof)
if material:
    roof.data.materials.append(material)
log("roof", tris_of(roof), "tris")


# ---------------------------------------------------------------------------
# 8. Join, restore the shipped scale, export
# ---------------------------------------------------------------------------

bpy.ops.object.select_all(action="DESELECT")
generated.select_set(True)
roof.select_set(True)
bpy.context.view_layer.objects.active = generated
bpy.ops.object.join()
final = bpy.context.view_layer.objects.active
final.name = KEY

# Bisecting leaves vertices behind that belong to no face. The exporter drops
# them, so they cost nothing at runtime, but they DO sit in the bounding box —
# which is how a reported height and a shipped height came to disagree by 35mm.
clean = bmesh.new()
clean.from_mesh(final.data)
loose = [v for v in clean.verts if not v.link_faces]
bmesh.ops.delete(clean, geom=loose, context="VERTS")
clean.to_mesh(final.data)
clean.free()
final.data.update()
log("dropped", len(loose), "loose vertices")

generated = final
if opts["keepbbox"]:
    # Exactly the inverse of section 3, so the mesh ships at the size
    # `MODULE_RUNS.naturalM` measured and every metre authored above still lands
    # where it was authored once the runtime stretches the box back out.
    transform(lambda co: Vector((
        TILED_LO[0] + (co.x - EX0) / FIT[0],
        TILED_LO[1] + (co.y - EY0) / FIT[1],
        TILED_LO[2] + (co.z - EZ0) / FIT[2],
    )))
    log("restored the source scale")

for image in bpy.data.images:
    if not image.size[0]:
        continue
    was = tuple(image.size)
    # Scaled unconditionally: the exporter passes a clean image straight through
    # as its original bytes, so a texture that needs no resizing also never gets
    # re-encoded and the requested quality is ignored.
    image.scale(min(image.size[0], int(opts["tex"])), min(image.size[1], int(opts["tex"])))
    log(f"texture {was[0]}x{was[1]} -> {image.size[0]}x{image.size[1]} at jpeg q{int(opts['jpeg'])}")

lo, hi = bbox_of(final)
size = hi - lo
want = SOURCE_SIZE if opts["keepbbox"] else np.array([SPAN_X, SPAN_Y, SPAN_Z])
log(f"FINAL_SIZE x={size[0]:.4f} y={size[1]:.4f} z={size[2]:.4f}")
log(f"FINAL_WANT x={want[0]:.4f} y={want[1]:.4f} z={want[2]:.4f}")
log(f"FINAL_BASE z={lo[2]:+.5f}")
log("FINAL_TRIS", tris_of(final))

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
final.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_yup=True,
    export_animations=False,
    export_image_format="JPEG",
    export_jpeg_quality=int(opts["jpeg"]),
    use_selection=True,
)
log("WROTE", OUT_GLB, os.path.getsize(OUT_GLB))
