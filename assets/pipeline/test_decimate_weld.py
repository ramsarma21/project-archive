# Test how decimation affects the weld-pair signature on a Meshy GLB.
# Run: blender --background --python test_decimate_weld.py -- <glb> <ratio1,ratio2,...>
import bpy, os, sys
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
RATIOS = [float(x) for x in argv[1].split(",")]

def weld_pairs(meshes):
    cent = []; norm = []
    for o in meshes:
        o.data.calc_loop_triangles()
        mw = o.matrix_world; verts = o.data.vertices
        for lt in o.data.loop_triangles:
            a = mw @ verts[lt.vertices[0]].co; b = mw @ verts[lt.vertices[1]].co; c = mw @ verts[lt.vertices[2]].co
            n = (b - a).cross(c - a)
            if n.length == 0: continue
            n = n.normalized()
            cent.append(((a.x+b.x+c.x)/3,(a.y+b.y+c.y)/3,(a.z+b.z+c.z)/3)); norm.append((n.x,n.y,n.z))
    cent = np.array(cent); norm = np.array(norm)
    lo = cent.min(0); hi = cent.max(0)
    diag = float(np.sqrt(((hi-lo)**2).sum())) or 1.0
    EPS = diag*1e-4; COINCIDE = diag*0.004; CELL = COINCIDE
    grid = {}
    for i, cc in enumerate(cent):
        key = (round(cc[0]/CELL), round(cc[1]/CELL), round(cc[2]/CELL)); grid.setdefault(key, []).append(i)
    neigh = [(0,0,0),(1,0,0),(0,1,0),(0,0,1),(1,1,0),(1,0,1),(0,1,1),(1,1,1)]
    pairs = 0
    for key, bucket in grid.items():
        kx,ky,kz = key
        for (dx,dy,dz) in neigh:
            other = grid.get((kx+dx,ky+dy,kz+dz)) if (dx or dy or dz) else bucket
            if not other: continue
            for i in bucket:
                for j in other:
                    if j <= i and not (dx or dy or dz): continue
                    d = float(np.linalg.norm(cent[i]-cent[j]))
                    if d <= EPS or d > COINCIDE: continue
                    if float(np.dot(norm[i], norm[j])) > 0.985: pairs += 1
    return pairs, len(cent)

for ratio in RATIOS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=IN_GLB)
    meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    # merge by distance first, then decimate collapse
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=0.001)
        bpy.ops.object.mode_set(mode="OBJECT")
        if ratio < 1.0:
            m = o.modifiers.new("dec", "DECIMATE"); m.ratio = ratio
            bpy.ops.object.modifier_apply(modifier=m.name)
    p, t = weld_pairs(meshes)
    print(f"RATIO {ratio}: tris {t}  weldPairs {p}")
