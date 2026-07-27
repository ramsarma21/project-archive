# Assemble the appearance-fixed System presenter GLB.
#
# WHY THIS EXISTS
#   The shipped presenter shows two asset-side defects under the hologram shader:
#     1. Faceted shards on the face/neck/decolletage/hair. Root cause: the Meshy
#        mesh carries ~15k COINCIDENT SPLIT VERTICES (38,835 verts for only 23,705
#        unique positions) left at UV/normal/material seams. Smooth shading can
#        only average normals across CONNECTED faces, so it cannot cross those
#        splits -> a hard facet at every seam, even after custom normals are
#        cleared. The fix is to WELD the coincident verts (merge by distance at a
#        sub-mm threshold, which fuses only truly-coincident seam verts, never the
#        thin hair/cloth shells) so the surface is connected and shades smooth.
#     2. A heavy blue albedo that no warm light can turn into skin.
#   This step fixes both reproducibly and re-exports, preserving the rig, the
#   idle/talk/talk2 clips, the jawOpen morph, scale and materials:
#     - clear custom split normals, WELD coincident seam verts, shade smooth,
#       recalc consistent (weld is topological only, no shell collapse, and it is
#       shape-key safe: coincident verts carry identical jawOpen deltas);
#     - replace the albedo image with a white-balanced version produced by
#       correct_presenter_albedo.py.
#
# Run:
#   blender --background --python apply_presenter_appearance_fix.py -- in.glb warm_albedo.jpg out.glb
import bpy, os, sys

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC = os.path.abspath(argv[0])
TEX = os.path.abspath(argv[1])
DST = os.path.abspath(argv[2])
os.makedirs(os.path.dirname(DST), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
character = [o for o in meshes if (o.parent and o.parent.type == "ARMATURE") or len(o.vertex_groups) > 0]
assert len(character) == 1, f"expected 1 character mesh, got {len(character)}"
mesh = character[0]
me = mesh.data

# --- 1. Normals: drop custom split normals, WELD coincident seam verts, smooth -
tris = sum(len(p.vertices) - 2 for p in me.polygons)
verts0 = len(me.vertices)
print(f"MESH {mesh.name} verts={verts0} tris={tris} custom_normals={me.has_custom_normals}")
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
try:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    print("cleared custom split normals")
except Exception as e:
    print("clear custom normals skipped:", e)
for p in me.polygons:
    p.use_smooth = True
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
# Weld coincident seam verts so normal smoothing can cross the UV/normal seams
# that otherwise force a facet at every split. 1e-4 m (0.1 mm) fuses only truly
# coincident verts; hair/cloth shells are thicker so they are never collapsed.
# Shape-key safe: coincident verts share identical jawOpen deltas, so the morph
# and the idle/talk/talk2 clips are preserved.
bpy.ops.mesh.remove_doubles(threshold=1e-4)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")
me.update()
print(f"welded {verts0} -> {len(me.vertices)} verts; shaded smooth + recalculated normals")

# --- 2. Albedo: swap in the white-balanced texture ------------------------------
warm = bpy.data.images.load(TEX)
warm.name = "presenter_albedo_warm"
warm.pack()
replaced = 0
for mat in me.materials:
    if not mat or not mat.use_nodes:
        continue
    for node in mat.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image is not None:
            node.image = warm
            replaced += 1
print(f"replaced {replaced} image texture node(s)")
assert replaced >= 1, "no image texture node found to replace"

# --- 3. Export, preserving rig / clips / morph / skin ---------------------------
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(
    filepath=DST,
    export_format="GLB",
    export_yup=True,
    export_image_format="JPEG",
    export_jpeg_quality=92,
    export_animations=True,
    export_morph=True,
    export_skins=True,
)
print("WROTE", DST, os.path.getsize(DST))
