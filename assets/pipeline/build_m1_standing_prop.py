# Turn a raw Meshy prop into an M1 prop the route is left STANDING ON.
#
# Two assets need this and they need the same three things, which is why one
# script builds both: `hay-wain-loaded` (the dive landing under the printshop's
# south-east corner) and `buttress-stepped-stone` (the first hold of the Hollis
# Street south-face climb).
#
# What a standable prop has to satisfy, and why a generic optimize pass cannot
# ---------------------------------------------------------------------------
# `FittedGlb` contain-fits a prop into the box `sceneryPlacements()` asks for —
# the smallest of the three box/mesh ratios — then plan-centres it and BOTTOM-
# ALIGNS it on the placement plane. Three consequences drive everything below:
#
#   1. The mesh's own bounding box has to BE the box, on all three axes. A mesh
#      short on one axis draws at that axis's ratio and comes out short on the
#      other two: `hay-cart` in the wain's box is 1.90 x 0.89 x 1.06 against
#      2.20 x 2.20 x 3.20, so it drew 38% of the landing's depth with its top
#      1.17m UNDER the surface that catches the player. This is the repo's
#      single biggest asset defect class, so the bounds here are asserted, not
#      hoped for.
#   2. Because the fit is a contain-fit, the drawn object can never exceed its
#      box — so "must not overhang its footprint" is satisfied by normalising
#      the bounds and by nothing else. The two wains stand flush side by side
#      with their catch nodes 2.2m apart and would interpenetrate otherwise.
#   3. Fitting the box is NOT standing on it. `verify_m1_placements.mjs` rays a
#      5x5 grid down onto the plane each route-bearing surface sits at, insets
#      the samples 10% from the footprint edge, and wants a drawn face within
#      the reader's 0.35m step-down at 90% of them. A mesh can fit at scale
#      1.0000 and still be a dome that falls away at the corners, or a heap
#      whose peak is the only thing touching the plane. So the TOP is measured
#      on the verifier's own grid here, before publishing, and authored flat if
#      the generator did not deliver it flat.
#
# Two sources, the same split as the steeple and the elm:
#   Meshy   the mesh, the single texture atlas, and everything that has to look
#           built — wheels, ironwork, coursed granite, loose hay.
#   here    the bounds, and the one surface a foot meets.
#
# `--lift` exists because a vertical scale is not free on every prop. Stretching
# a hay wain 30% on Z to reach 2.2m turns its wheels into ellipses, which reads
# as broken; stretching only the LOAD above the sideboards is invisible, because
# more hay on a wain is just more hay. Masonry has no such tell and takes the
# plain per-axis scale.
#
# Run:
#   blender --background --python assets/pipeline/build_m1_standing_prop.py -- \
#     raw.glb out.glb --size 2.2,2.2,3.2 --key hay-wain-loaded \
#     [--lift 0.45] [--top iron|cap|none] [--trim y] [--tris 22000] [--tex 1024]
#
# --top iron treads a hay crown flat onto the plane; --top cap oversails a coping
# slab out to the full footprint. Both DEFORM generated geometry rather than
# adding any, so the texture stays the texture the generator built.
#
# --size is the DECLARED sizeM in game axes [x, y(up), z]. Blender is Z-up and
# glTF is Y-up, so the target in Blender is (x, z, y) — converted once, below.
import bpy
import bmesh
import math
import os
import sys

from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
RAW_GLB = os.path.abspath(argv[0])
OUT_GLB = os.path.abspath(argv[1])

opts = {"size": None, "key": "prop", "lift": 0.0, "top": "none", "tris": 22000, "tex": 1024,
        "jpeg": 88, "trim": "none", "iron": 0.55, "ironk": 0.30, "cap": 0.30}
rest = argv[2:]
for index in range(0, len(rest) - 1, 2):
    name = rest[index].lstrip("-")
    if name not in opts:
        raise SystemExit(f"unknown option {rest[index]}")
    opts[name] = rest[index + 1]

KEY = str(opts["key"])
TRI_BUDGET = int(opts["tris"])
MAX_TEX = int(opts["tex"])
JPEG_Q = int(opts["jpeg"])
LIFT = float(opts["lift"])
TOP_MODE = str(opts["top"])
TRIM = str(opts["trim"])
# How deep a band of the crown is trodden flat, and how much of its relief
# survives. 0.55m at 0.30 leaves a hand's depth of ruffle on the hay.
IRON = float(opts["iron"])
IRON_K = float(opts["ironk"])
# How far down from the plane the coping slab reaches, for `--top cap`.
CAP = float(opts["cap"])
if not opts["size"]:
    raise SystemExit("--size x,y,z (declared sizeM, game axes) is required")
GAME_X, GAME_Y, GAME_Z = (float(v) for v in str(opts["size"]).split(","))

# glTF is Y-up, Blender is Z-up: game (x, y, z) is Blender (x, z, y). Every
# target below is in BLENDER axes and converted once, here.
TARGET = Vector((GAME_X, GAME_Z, GAME_Y))

# The verifier's own numbers, mirrored so a failure is caught here rather than
# after publishing. GRID/insets and SUPPORT_TOL come from
# assets/pipeline/verify_m1_placements.mjs; changing them there without changing
# them here is how a build starts passing its own check and failing the real one.
GRID = 5
SUPPORT_TOL = 0.35
SUPPORT_MIN = 0.9


def log(*parts):
    print(f"[{KEY}]", *parts)


log(f"raw {os.path.basename(RAW_GLB)}")
log(f"declared sizeM (game) {GAME_X} x {GAME_Y} x {GAME_Z}"
    f"  -> blender target {TARGET.x} x {TARGET.y} x {TARGET.z}")

# ---------------------------------------------------------------------------
# 1. Import and join
# ---------------------------------------------------------------------------

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=RAW_GLB)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no mesh in raw glb")
bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
prop = bpy.context.view_layer.objects.active
prop.name = KEY

# Every transform below is applied straight to the vertices rather than through
# `bpy.ops.object.transform_apply`. The operator depends on selection and mode
# being what you think they are, and when they are not it does NOTHING and
# returns as if it had worked: this build's first quarter turn was silently
# dropped that way, and the residual per-axis correction then quietly stretched
# the wain's width into its length to hit the declared bounds anyway. Vertex
# maths cannot fail quietly.
matrix = prop.matrix_world.copy()
for vertex in prop.data.vertices:
    vertex.co = matrix @ vertex.co
prop.matrix_world.identity()
prop.data.update()


def bounds():
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for vertex in prop.data.vertices:
        for axis in range(3):
            lo[axis] = min(lo[axis], vertex.co[axis])
            hi[axis] = max(hi[axis], vertex.co[axis])
    return lo, hi


lo, hi = bounds()
raw = hi - lo
tris = sum(len(p.vertices) - 2 for p in prop.data.polygons)
log(f"raw bounds {raw.x:.4f} x {raw.y:.4f} x {raw.z:.4f}  tris {tris}")

# ---------------------------------------------------------------------------
# 2. Orientation
# ---------------------------------------------------------------------------
# Meshy returns the subject upright for a photographic plate, so Z is up and the
# only open question is the quarter turn: which horizontal axis carries the long
# dimension. Decided by which choice matches the target's plan aspect, and
# reported either way — an object that arrives on its side shows up here as a
# vertical aspect that no yaw can fix.

plan_aspect_raw = raw.x / raw.y if raw.y else 1e9
plan_aspect_target = TARGET.x / TARGET.y
turned_error = abs(math.log((raw.y / raw.x if raw.x else 1e9) / plan_aspect_target))
straight_error = abs(math.log(plan_aspect_raw / plan_aspect_target))
if turned_error < straight_error:
    for vertex in prop.data.vertices:
        vertex.co = Vector((-vertex.co.y, vertex.co.x, vertex.co.z))
    prop.data.update()
    lo, hi = bounds()
    raw = hi - lo
    log(f"quarter-turned: plan aspect {straight_error:.3f} -> {turned_error:.3f} off target"
        f"  now {raw.x:.4f} x {raw.y:.4f} x {raw.z:.4f}")
else:
    log(f"kept as generated: plan aspect {straight_error:.3f} off target"
        f" (a quarter turn would be {turned_error:.3f})")
log(f"vertical aspect height/width  mesh {raw.z / raw.x:.3f}  target {TARGET.z / TARGET.x:.3f}")

# ---------------------------------------------------------------------------
# 3. Bounds, exactly
# ---------------------------------------------------------------------------
# Uniform on the plan where possible so wheels stay round, then the vertical.
# `--lift` stretches only what is above a fraction of the raw height, which is
# how the hay load reaches the landing plane without the wheels going oval.

if TRIM == "y":
    # Drive the uniform scale off WIDTH alone and cut the surplus depth away
    # instead of squashing it. A buttress is declared 1.2m deep against a mesh
    # the generator made 1.84m deep, and squashing that is a 35% flattening of
    # every course and of the coping's oversail. The face being cut is the one
    # built hard against the meeting house's north wall at z=15.6, so it is not
    # a face the player can ever see: trimming costs nothing and keeps the
    # stonework's real proportions everywhere that shows.
    plan_scale = TARGET.x / raw.x
else:
    plan_scale = min(TARGET.x / raw.x, TARGET.y / raw.y)
for vertex in prop.data.vertices:
    vertex.co *= plan_scale
prop.data.update()
lo, hi = bounds()
log(f"uniform plan scale {plan_scale:.4f} -> {(hi - lo).x:.4f} x {(hi - lo).y:.4f} x {(hi - lo).z:.4f}")

if TRIM == "y":
    surplus = (hi.y - lo.y) - TARGET.y
    if surplus <= 0.001:
        log(f"no depth to trim ({(hi - lo).y:.4f} <= {TARGET.y:.4f})")
    else:
        # Blender +y is game -z, and the wall stands at the buttress's minimum
        # game z, so the wall side is +y here and the surplus comes off +y.
        # CLAMPED onto the cut plane rather than bisected off it. A bisect leaves
        # a hole, and a generated mesh will not reliably close one: cutting this
        # buttress left 372 boundary edges that neither `edgeloop_fill` nor
        # `triangle_fill` could turn into a single face, because Meshy topology
        # gives open chains rather than clean coplanar loops. The runtime draws
        # single-sided, so a hole in the back is a hole you can see the inside of
        # through the gap between the buttress and the wall.
        #
        # Folding every vertex past the plane onto it cannot open a hole, because
        # it removes no geometry: the surplus 0.26m of stonework flattens against
        # the face that stands against the wall, which is the one face on this
        # object the player can never see. The degenerate faces that fold leaves
        # are dissolved after.
        cut = hi.y - surplus
        folded = 0
        for vertex in prop.data.vertices:
            if vertex.co.y > cut:
                vertex.co.y = cut
                folded += 1
        prop.data.update()
        work = bmesh.new()
        work.from_mesh(prop.data)
        before_faces = len(work.faces)
        bmesh.ops.dissolve_degenerate(work, dist=1e-5,
                                      edges=work.edges[:])
        work.normal_update()
        work.to_mesh(prop.data)
        dissolved = before_faces - len(work.faces)
        work.free()
        prop.data.update()
        lo, hi = bounds()
        log(f"trimmed {surplus:.4f}m off the wall side (+y): depth {(hi - lo).y:.4f},"
            f" {folded} vertices folded onto the cut plane,"
            f" {dissolved} degenerate faces dissolved")

if LIFT > 0.0:
    # Everything above the split rises; everything below it is untouched, so the
    # wheels, frame and sideboards keep the proportions they were generated with.
    split = lo.z + (hi.z - lo.z) * LIFT
    want_above = TARGET.z - (split - lo.z)
    have_above = hi.z - split
    if want_above <= 0:
        raise SystemExit(f"--lift {LIFT} puts the split above the target height")
    k = want_above / have_above
    for vertex in prop.data.vertices:
        if vertex.co.z > split:
            vertex.co.z = split + (vertex.co.z - split) * k
    prop.data.update()
    lo, hi = bounds()
    log(f"lift above {LIFT:.2f} of height (z={split:.3f}): load x{k:.4f}"
        f" -> height {(hi - lo).z:.4f}")

# Whatever is left on each axis is taken flat. After the uniform plan scale and
# the lift this is small, and it is reported so a large correction cannot pass
# unnoticed: a big number here means the concept plate's proportions were wrong.
lo, hi = bounds()
have = hi - lo
correction = Vector((TARGET.x / have.x, TARGET.y / have.y, TARGET.z / have.z))
log(f"residual per-axis correction {correction.x:.4f} x {correction.y:.4f} x {correction.z:.4f}")
for vertex in prop.data.vertices:
    vertex.co.x = (vertex.co.x - lo.x) * correction.x
    vertex.co.y = (vertex.co.y - lo.y) * correction.y
    vertex.co.z = (vertex.co.z - lo.z) * correction.z
prop.data.update()
lo, hi = bounds()
log(f"normalised bounds {(hi - lo).x:.4f} x {(hi - lo).y:.4f} x {(hi - lo).z:.4f}"
    f"  origin at {lo.x:.4f}, {lo.y:.4f}, {lo.z:.4f}")

# ---------------------------------------------------------------------------
# 4. Is the top actually there? The verifier's grid, before publishing.
# ---------------------------------------------------------------------------


def coverage():
    """Fraction of the verifier's 5x5 grid with a face within the step-down."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    prop.data.update()
    hit_count = 0
    misses = []
    for i in range(GRID):
        for j in range(GRID):
            x = TARGET.x * (i + 0.5) / GRID
            y = TARGET.y * (j + 0.5) / GRID
            origin = Vector((x, y, TARGET.z + 3.0))
            found, location, _, _, _, _ = bpy.context.scene.ray_cast(
                depsgraph, origin, Vector((0, 0, -1)),
            )
            if found and abs(location.z - TARGET.z) < SUPPORT_TOL:
                hit_count += 1
            else:
                misses.append((x, y, location.z if found else float("nan")))
    return hit_count / (GRID * GRID), misses


fraction, misses = coverage()
log(f"top at {TARGET.z:.2f}m (game y): {fraction * 100:.0f}% of the verifier's"
    f" {GRID}x{GRID} grid has a face within {SUPPORT_TOL}m")
for x, y, z in misses:
    log(f"  dry sample x={x:.2f} y={y:.2f} highest face z={z:.3f}")

# ---------------------------------------------------------------------------
# 5. The one surface a foot meets, authored if the generator fell short
# ---------------------------------------------------------------------------
# Only where it is needed, and built out of the generated mesh's own material and
# UVs so it is the same hay or the same granite rather than a grey lid.


# The top is fixed by DEFORMING the generated mesh, never by adding geometry to
# it. The first version of this build authored a flat plateau instead, took its
# material from the commonest upward-facing polygon and its UVs by nearest
# neighbour from the generated top faces, and the turntable showed why that
# cannot work: a Meshy atlas is a set of charts with no continuous relationship
# to world position, so four corners of one new quad sample four unrelated
# islands and the result is a swirled marble lid on a hay wain and a streaked
# herringbone slab on a granite cap. Every vertex moved below already carries
# correct UVs and the right material, so nothing has to be invented.


def iron_top():
    """Tread the top band flat: a vertical squash of the crown onto the plane.

    For the hay wain. The load is loose hay and the top of a loaded wain has been
    walked on by the man who built the load, so pulling the crown up to the plane
    is what the object should have looked like anyway. Relief survives at a third
    of its depth, which keeps it reading as raked hay rather than as a tarpaulin.
    """
    band = TARGET.z - IRON
    moved = 0
    worst = 0.0
    for vertex in prop.data.vertices:
        if vertex.co.z > band:
            shortfall = TARGET.z - vertex.co.z
            vertex.co.z = TARGET.z - shortfall * IRON_K
            moved += 1
            worst = max(worst, shortfall * (1.0 - IRON_K))
    prop.data.update()
    log(f"ironed the top {IRON:.2f}m band onto {TARGET.z:.3f}m at x{IRON_K:.2f}:"
        f" {moved} vertices, largest lift {worst:.3f}m")


def spread_cap():
    """Oversail the coping slab out to the full footprint.

    For the buttress. A stepped buttress leans back as it rises, so the front
    strip of its footprint carries only the plinth and the top plane has nothing
    over it — five of the verifier's twenty-five samples, which is exactly the
    80% it measured. The fix is the one period masonry already uses: the cap is a
    set-off, and a set-off oversails what it sits on. Scaling the slab in plan
    keeps its own granite and its own UVs and just makes it the broad flat table
    the route needs.
    """
    base = TARGET.z - CAP
    cap = [v for v in prop.data.vertices if v.co.z > base]
    if not cap:
        raise SystemExit(f"no cap geometry above {base:.3f}m to spread")
    x0 = min(v.co.x for v in cap)
    x1 = max(v.co.x for v in cap)
    y0 = min(v.co.y for v in cap)
    y1 = max(v.co.y for v in cap)
    sx = TARGET.x / (x1 - x0) if x1 > x0 else 1.0
    sy = TARGET.y / (y1 - y0) if y1 > y0 else 1.0
    for vertex in cap:
        vertex.co.x = (vertex.co.x - x0) * sx
        vertex.co.y = (vertex.co.y - y0) * sy
    prop.data.update()
    log(f"spread the cap above {base:.3f}m from {x1 - x0:.3f} x {y1 - y0:.3f}"
        f" to {TARGET.x:.3f} x {TARGET.y:.3f} ({len(cap)} vertices, x{sx:.3f} x{sy:.3f})")


if fraction < 1.0 and TOP_MODE == "iron":
    iron_top()
elif fraction < 1.0 and TOP_MODE == "cap":
    spread_cap()
if fraction < 1.0 and TOP_MODE != "none":
    lo, hi = bounds()
    log(f"bounds after top {(hi - lo).x:.4f} x {(hi - lo).y:.4f} x {(hi - lo).z:.4f}")
    fraction, misses = coverage()
    log(f"top coverage now {fraction * 100:.0f}%")
    for x, y, z in misses:
        log(f"  still dry x={x:.2f} y={y:.2f} highest face z={z:.3f}")
elif fraction < 1.0:
    log("top left as generated (--top none)")

# ---------------------------------------------------------------------------
# 6. Budget
# ---------------------------------------------------------------------------

tris = sum(len(p.vertices) - 2 for p in prop.data.polygons)
if tris > TRI_BUDGET:
    # Collapse rather than un-subdivide: the authored top is already coarse and
    # planar, so a ratio decimate takes its triangles from the generated detail
    # where there is redundancy, which is what we want.
    modifier = prop.modifiers.new("dec", "DECIMATE")
    modifier.ratio = TRI_BUDGET / tris
    bpy.ops.object.modifier_apply(modifier=modifier.name)
log(f"tris {tris} -> {sum(len(p.vertices) - 2 for p in prop.data.polygons)}")

for image in bpy.data.images:
    if image.size[0] > MAX_TEX or image.size[1] > MAX_TEX:
        was = tuple(image.size)
        image.scale(min(image.size[0], MAX_TEX), min(image.size[1], MAX_TEX))
        log(f"texture {image.name} {was[0]}x{was[1]} -> {image.size[0]}x{image.size[1]}")

# Decimation moves vertices, so the bounds and the surface are re-asserted after
# it rather than before. This is the check that would have caught a prop whose
# top was flattened and then decimated into a slope. A collapse also drifts the
# bounds by a millimetre or three, which is inside the verifier's tolerance but
# not inside the point of this build, so the bounds are re-struck exactly here.
lo, hi = bounds()
drift = hi - lo
settle = Vector((TARGET.x / drift.x, TARGET.y / drift.y, TARGET.z / drift.z))
for vertex in prop.data.vertices:
    vertex.co.x = (vertex.co.x - lo.x) * settle.x
    vertex.co.y = (vertex.co.y - lo.y) * settle.y
    vertex.co.z = (vertex.co.z - lo.z) * settle.z
prop.data.update()
log(f"post-decimate settle {settle.x:.5f} x {settle.y:.5f} x {settle.z:.5f}")

lo, hi = bounds()
final = hi - lo
fraction, misses = coverage()
log(f"FINAL bounds (blender) {final.x:.4f} x {final.y:.4f} x {final.z:.4f}")
log(f"FINAL bounds (game xyz) {final.x:.4f} x {final.z:.4f} x {final.y:.4f}"
    f"  declared {GAME_X} x {GAME_Y} x {GAME_Z}")
log(f"FINAL top coverage {fraction * 100:.0f}% (verifier wants >= {SUPPORT_MIN * 100:.0f}%)")
for x, y, z in misses:
    log(f"  dry x={x:.2f} y={y:.2f} highest face z={z:.3f}")

worst = max(abs(final.x - TARGET.x), abs(final.y - TARGET.y), abs(final.z - TARGET.z))
if worst > 0.01:
    raise SystemExit(f"bounds off by {worst:.4f}m: the mesh and the declaration must agree")
if fraction < SUPPORT_MIN:
    raise SystemExit(f"top coverage {fraction * 100:.0f}% is below the verifier's"
                     f" {SUPPORT_MIN * 100:.0f}%: the route would stand on nothing")

# Centred on its own bounding box, which is the convention the rest of the prop
# set follows because it is what Meshy returns. Nothing in the runtime depends on
# it — `FittedGlb` re-derives the box and plan-centres and bottom-aligns whatever
# it is given — but `render_prop_qa.py` builds its turntable pivot at the bbox
# centre without flushing the depsgraph, so a mesh whose origin is elsewhere gets
# displaced by exactly that offset and renders half out of frame.
lo, hi = bounds()
centre = (lo + hi) / 2.0
for vertex in prop.data.vertices:
    vertex.co -= centre
prop.data.update()
log(f"centred on the bounding box (was offset {centre.x:.3f}, {centre.y:.3f}, {centre.z:.3f})")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
prop.select_set(True)
bpy.context.view_layer.objects.active = prop
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_animations=False,
    export_image_format="JPEG",
    export_jpeg_quality=JPEG_Q,
)
log(f"WROTE {OUT_GLB} {os.path.getsize(OUT_GLB)} bytes"
    f" ({os.path.getsize(OUT_GLB) / 1048576:.2f} MiB)")
