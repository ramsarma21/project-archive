# Repair the bldg-brick facade, which ships torn: window trim and mortar shredded
# into pale angular flaps standing off the wall, identical from every angle and
# in both placements (the Gaol's stretched 2x3 module grid AND the Old Brick
# tower's single contain-fit), so it is the mesh, not the lighting or the tiling.
#
# What probe_brick_facade.mjs found, and what it rules out
# -------------------------------------------------------
# The mesh is NOT a doubled shell: 1 exact-duplicate face and 1 degenerate in
# 18,669. What it IS: 24.2% of the triangles are needle SLIVERS (min interior
# angle < 8deg), with 185 zero-area-UV faces and 284 near-coincident pairs. A
# tight crop shows those needles as real 3D flaps around every window — a Meshy
# generation whose retopology sprayed spikes and slivers over the trim. The atlas
# is a normal (smeary, 1024) Meshy bake, not itself torn.
#
# The repair, and why it fits
# ---------------------------
# This is a weld + de-sliver, not new mass and not a re-fit: the geometry exists
# and is wrong. In order:
#   1. Merge by distance welds the cracks the flaps grow out of.
#   2. Degenerate dissolve collapses the needle bases (zero/near-zero edges).
#   3. Beautify flips the long edges of the remaining needles to maximise the
#      minimum angle WITHOUT moving a vertex, so the surface and its UVs stay put.
#   4. A bounded, UV- and boundary-preserving planar/collapse decimate pulls the
#      protruding flap tips back into the wall they stand off, which beautify (an
#      edge flip, not a move) cannot do on its own.
# The atlas is passed through untouched, the bounding box is asserted unchanged
# (both placements read it — the Gaol as a per-axis MODULE fill, the tower as a
# uniform PROP contain-fit — so a bbox drift would rescale one of them), and the
# result is re-probed by probe_brick_facade.mjs.
#
# Run:
#   blender --background --python assets/pipeline/build_brick_facade.py \
#     -- in.glb out.glb [--weld 0.004] [--degen 0.004] [--decimate 0.0]
#        [--planar 0.0] [--smooth 0]
import bpy
import bmesh
import math
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_GLB = os.path.abspath(argv[1])
opts = {"weld": 0.004, "degen": 0.004, "decimate": 0.0, "planar": 0.0, "smooth": 0,
        "despike": 0.0, "despikeiters": 4.0}
rest = argv[2:]
for i in range(0, len(rest) - 1, 2):
    name = rest[i].lstrip("-")
    if name in opts:
        opts[name] = float(rest[i + 1])


def log(*p):
    print("[bldg-brick]", *p)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN_GLB)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
assert meshes, "no mesh in the input GLB"
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def stats(tag):
    me = obj.data
    me.calc_loop_triangles()
    verts = np.array([v.co[:] for v in me.vertices])
    lo, hi = verts.min(axis=0), verts.max(axis=0)
    size = hi - lo
    slivers = 0
    tri_n = 0
    for lt in me.loop_triangles:
        tri_n += 1
        a, b, c = (me.vertices[i].co for i in lt.vertices)
        la, lb, lc = (b - a).length, (c - b).length, (a - c).length
        # smallest angle is opposite the shortest edge; law of cosines
        def ang(o1, o2, opp):
            d = 2 * o1 * o2
            if d <= 1e-12:
                return 0.0
            return math.acos(max(-1.0, min(1.0, (o1 * o1 + o2 * o2 - opp * opp) / d)))
        angs = [ang(la, lc, lb), ang(la, lb, lc), ang(lb, lc, la)]
        if min(angs) < math.radians(8):
            slivers += 1
    log(f"{tag}: tris {tri_n}  slivers {slivers} ({slivers / max(1, tri_n) * 100:.1f}%)  "
        f"bbox {size[0]:.4f} x {size[1]:.4f} x {size[2]:.4f}")
    return size, tri_n, slivers


size0, tris0, sliv0 = stats("before")
diag = float(np.linalg.norm(size0))

# --- 1. weld -----------------------------------------------------------------
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
if opts["weld"] > 0:
    bpy.ops.mesh.remove_doubles(threshold=opts["weld"] * diag)
# --- 2. degenerate dissolve --------------------------------------------------
if opts["degen"] > 0:
    bpy.ops.mesh.dissolve_degenerate(threshold=opts["degen"] * diag)
# --- 3. beautify: edge flips that maximise the minimum angle, no vertex moves -
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.beautify_fill(angle_limit=math.radians(180))
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")

# --- 3b. de-spike: pull ONLY the flap-tip vertices back to their neighbours ----
# The flaps are outlier vertices displaced off the wall, not a triangulation
# artifact, so an edge flip cannot touch them and a global decimate drags the
# whole atlas. This moves a vertex toward the average of its edge-neighbours only
# when it stands off them by more than `despike` times the local edge length —
# the wall, the window sills and the eaves (all within that band) stay put, and
# the shards that stick out get lerped in. Its own UV slides with it, which is
# what we want: a flap tip's texture is garbage, and sampling the wall beside it
# is the repair.
if opts["despike"] > 0:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for _ in range(int(opts["despikeiters"])):
        moves = []
        for v in bm.verts:
            n = len(v.link_edges)
            if n < 2:
                continue
            avg = Vector((0, 0, 0))
            elen = 0.0
            for e in v.link_edges:
                other = e.other_vert(v)
                avg += other.co
                elen += e.calc_length()
            avg /= n
            elen /= n
            if elen > 1e-9 and (v.co - avg).length > opts["despike"] * elen:
                moves.append((v, avg))
        for v, avg in moves:
            v.co = v.co.lerp(avg, 0.7)
    bm.to_mesh(obj.data)
    bm.free()

# --- 4. bounded decimate: pull the flap tips back into the wall ----------------
# Collapse preserves UV boundaries by default via the modifier flags; a light
# ratio removes the smallest (flap) triangles first.
if opts["planar"] > 0:
    m = obj.modifiers.new("planar", "DECIMATE")
    m.decimate_type = "DISSOLVE"
    m.angle_limit = math.radians(opts["planar"])
    m.delimit = {"UV"}
    bpy.ops.object.modifier_apply(modifier=m.name)
if opts["decimate"] > 0:
    m = obj.modifiers.new("collapse", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = opts["decimate"]
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=m.name)
if opts["smooth"] > 0:
    m = obj.modifiers.new("smooth", "SMOOTH")
    m.factor = 0.5
    m.iterations = int(opts["smooth"])
    bpy.ops.object.modifier_apply(modifier=m.name)

# Retriangulate cleanly so the export is all-triangles with good quality.
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.quads_convert_to_tris(quad_method="BEAUTY", ngon_method="BEAUTY")
bpy.ops.object.mode_set(mode="OBJECT")

size1, tris1, sliv1 = stats("after")

# The bounding box is the draw contract for both placements; hold it to <1%.
for axis, a, b in (("x", size0[0], size1[0]), ("y", size0[1], size1[1]), ("z", size0[2], size1[2])):
    if abs(a - b) > max(0.01, 0.01 * a):
        raise SystemExit(f"bbox drifted on {axis}: {a:.4f} -> {b:.4f}; a rescale would move one placement")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_yup=True,
    export_animations=False,
    export_image_format="AUTO",
    export_keep_originals=False,
    use_selection=True,
)
log(f"WROTE {OUT_GLB} {os.path.getsize(OUT_GLB)}  slivers {sliv0}->{sliv1}  tris {tris0}->{tris1}")
