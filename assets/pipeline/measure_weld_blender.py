# Measure the weld/near-coincident-face signature on a GLB inside Blender, using
# the SAME algorithm as scripts/check-world-visual-sweep.mjs weldMetric(): world
# centroids, COINCIDE=diag*0.004, EPS=diag*1e-4, same-facing dot>0.985. The metric
# is scale-relative and rigid-transform invariant, so measuring the exported GLB
# here matches the node/three gate. Also prints bbox, tris, zero-UV tris, and the
# top face at each requested target height (drawn==collision confirmation).
# Run: blender --background --python measure_weld_blender.py -- <glb> [h1,h2,...]
import bpy
import os
import sys
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
TARGETS = [float(x) for x in argv[1].split(",")] if len(argv) > 1 and argv[1] else []

bpy.ops.wm.read_factory_settings(use_empty=True)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=IN_GLB)
meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]

cent = []
norm = []
uvzero = 0
tri_count = 0
for o in meshes:
    o.data.calc_loop_triangles()
    mw = o.matrix_world
    verts = o.data.vertices
    uvl = o.data.uv_layers.active.data if o.data.uv_layers.active else None
    loops = o.data.loops
    for lt in o.data.loop_triangles:
        a = mw @ verts[lt.vertices[0]].co
        b = mw @ verts[lt.vertices[1]].co
        c = mw @ verts[lt.vertices[2]].co
        n = (b - a).cross(c - a)
        if n.length == 0:
            continue
        n = n.normalized()
        cent.append(((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3))
        norm.append((n.x, n.y, n.z))
        tri_count += 1
        if uvl is not None:
            l0, l1, l2 = lt.loops
            u0, v0 = uvl[l0].uv; u1, v1 = uvl[l1].uv; u2, v2 = uvl[l2].uv
            if abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) * 0.5 < 1e-8:
                uvzero += 1

cent = np.array(cent); norm = np.array(norm)
lo = cent.min(0); hi = cent.max(0)
diag = float(np.sqrt(((hi - lo) ** 2).sum())) or 1.0
EPS = diag * 1e-4
COINCIDE = diag * 0.004
CELL = COINCIDE
grid = {}
for i, cc in enumerate(cent):
    key = (round(cc[0] / CELL), round(cc[1] / CELL), round(cc[2] / CELL))
    grid.setdefault(key, []).append(i)
neigh = [(0,0,0),(1,0,0),(0,1,0),(0,0,1),(1,1,0),(1,0,1),(0,1,1),(1,1,1)]
pairs = 0
for key, bucket in grid.items():
    kx, ky, kz = key
    for (dx, dy, dz) in neigh:
        other = grid.get((kx+dx, ky+dy, kz+dz)) if (dx or dy or dz) else bucket
        if not other:
            continue
        for i in bucket:
            for j in other:
                if j <= i and not (dx or dy or dz):
                    continue
                d = float(np.linalg.norm(cent[i] - cent[j]))
                if d <= EPS or d > COINCIDE:
                    continue
                if float(np.dot(norm[i], norm[j])) > 0.985:
                    pairs += 1

# bbox from actual geometry (not just centroids)
allco = []
for o in meshes:
    mw = o.matrix_world
    for v in o.data.vertices:
        allco.append((mw @ v.co)[:])
allco = np.array(allco)
gl = allco.min(0); gh = allco.max(0); gs = gh - gl
print(f"WELD {os.path.basename(IN_GLB)}  bbox {gs[0]:.3f} x {gs[1]:.3f} x {gs[2]:.3f}  tris {tri_count}  weldPairs {pairs}  zeroUv {uvzero}")

# top standable face at each target height: is there a near-horizontal (up-facing)
# face whose top sits within 3 cm of the target? (drawn == collision confirmation)
for h in TARGETS:
    ok = False
    for o in meshes:
        mw = o.matrix_world
        for lt in o.data.loop_triangles:
            zs = [(mw @ o.data.vertices[k].co).z for k in lt.vertices]
            n = ((mw @ o.data.vertices[lt.vertices[1]].co) - (mw @ o.data.vertices[lt.vertices[0]].co)).cross(
                (mw @ o.data.vertices[lt.vertices[2]].co) - (mw @ o.data.vertices[lt.vertices[0]].co))
            if n.length == 0:
                continue
            up = n.normalized().z
            if up > 0.85 and abs(max(zs) - h) < 0.03 and (max(zs) - min(zs)) < 0.02:
                ok = True; break
        if ok:
            break
    print(f"  target y={h:.2f}: {'FACE PRESENT (up-facing, top within 3cm)' if ok else 'no up-face at height'}")
