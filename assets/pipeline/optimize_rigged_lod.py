# Decimate an ALREADY-BAKED rigged character to a lower triangle budget while
# keeping its armature, skin weights and EVERY animation clip.
#
# WHY THIS IS A SEPARATE SCRIPT FROM optimize_rigged.py. That one runs BEFORE the
# clips are baked and exports with export_animations=False on purpose — its output
# (characters-opt) is a mesh-only rig that bake_character_anims.py then retargets
# Mixamo clips onto. sync_web.mjs refuses to publish characters-opt for exactly
# that reason: "those files are optimized meshes with zero animation clips."
#
# This one runs at the OTHER end of the pipeline, on the self-contained final rig
# that already carries its named clips (the file sync_web publishes), and its whole
# job is to lower the triangle budget of the crowd bodies without disturbing
# anything else. Animation lives on the armature's bone F-curves, which are
# independent of mesh topology, so a mesh decimate does not touch a single clip —
# but this is verified after the fact with measure_clip_rates.mjs, not assumed.
#
# Textures are re-encoded JPEG (default q90, inside the cast's 44-49dB band) and
# capped at a max resolution (default 1024, matching optimize_rigged.py). A
# street-distance crowd body carried a 2048 albedo AND a 2048 normal — 22MB of
# VRAM apiece, 44MB a body, and the crowd cycles five of them — so leaving the
# resolution alone would cut triangles while the far larger texture cost stayed.
# 1024 is imperceptible at the range these bodies are ever seen and quarters that.
#
# WELD THE SHATTER BEFORE COLLAPSING — the actual bug an earlier version had.
#
# These Meshy heads ship SHATTERED: the surface is one continuous UV map, but the
# geometry is cracked into loose fragments along ~10k open edges (townsman: 9,644
# open boundary edges, zero of them a real UV seam). A COLLAPSE run on that soup
# pulls every fragment border inward independently and drags the albedo into the
# vertical sliver streaks the owner caught down the cheeks and nose. It is a
# shattered-mesh artifact, not simple low-poly faceting, and it is not a
# fidelity-vs-triangles tradeoff: the same 10k target is clean once the mesh is a
# manifold. optimize_world.py never hit it because a prop at ratio ~0.75 barely
# moves a border.
#
# So: merge coincident vertices into a closed manifold first (open edges -> ~0),
# THEN collapse. A manifold collapses cleanly with no borders to shred.
#
# WHY NOT RE-SPLIT REAL UV SEAMS AFTERWARD. An earlier version welded and then
# re-opened every edge whose two faces disagreed on UV, to protect a genuine seam
# (a mirror line) from being smeared. On this cast that put the streaks straight
# back: these Meshy cracks carry sub-pixel UV OFFSETS (Meshy split the surface
# imprecisely), so thousands of near-continuous cracks read as "seams" and the
# re-split simply re-shattered the mesh. Verified by render: weld-only is clean,
# weld-then-resplit tears. The heads are a single continuous UV map, so there is
# no real seam to protect — the weld is both necessary and sufficient, and every
# rig is checked by eye (render-face.py) rather than trusted.
#
# Run: blender --background --python assets/pipeline/optimize_rigged_lod.py \
#        -- <src.glb> <dst.glb> <target_tris> [max_tex=1024] [jpeg_quality=90] [ratio]
import bpy
import bmesh
import sys

WELD_DIST = 1e-4  # 0.1mm: closes coincident shatter verts, fuses nothing real


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def weld_shatter(obj):
    """Heal the shattered mesh into a manifold so a later collapse has no loose
    borders to drag into slivers. Returns (open_before, open_after)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    open_before = sum(1 for e in bm.edges if len(e.link_faces) <= 1)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD_DIST)
    open_after = sum(1 for e in bm.edges if len(e.link_faces) <= 1)
    bm.to_mesh(me)
    bm.free()
    return (open_before, open_after)


argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, target = argv[0], argv[1], int(argv[2])
max_tex = int(argv[3]) if len(argv) > 3 else 1024
quality = int(argv[4]) if len(argv) > 4 else 90
ratio_override = float(argv[5]) if len(argv) > 5 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if any(o.data.shape_keys for o in meshes):
    # A collapse decimate cannot be applied over shape keys, and silently
    # skipping it would ship an undecimated rig reported as decimated.
    raise SystemExit(f"{src}: has shape keys; refuse to guess")

total = sum(tri_count(o) for o in meshes)
ratio = ratio_override if ratio_override else max(0.02, min(1.0, target / total)) if total > 0 else 1.0
print(f"[lod] {src}: {total} tris -> target {target} (ratio {ratio:.4f})")

for obj in meshes:
    if tri_count(obj) <= 1000:
        continue  # a small mesh (an accessory) is not where the budget is
    before, after_open = weld_shatter(obj)
    print(f"[lod]   {obj.name}: welded open-edges {before} -> {after_open}")
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    # Apply first in the stack so it bakes the base mesh, leaving the armature
    # deform modifier in place and the vertex groups (skin weights) interpolated
    # across the collapse rather than dropped.
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)

after = sum(tri_count(o) for o in meshes)
print(f"[lod] {src}: {after} tris after")

for img in bpy.data.images:
    if img.size[0] > max_tex or img.size[1] > max_tex:
        print(f"[lod]   scale {img.name} {img.size[0]}x{img.size[1]} -> {max_tex}")
        img.scale(min(img.size[0], max_tex), min(img.size[1], max_tex))

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_yup=True,
    export_image_format="JPEG",
    export_jpeg_quality=quality,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_skins=True,
    export_morph=False,
    # Drops only keyframes a curve can be reconstructed from (constant/linear
    # redundancies), which the re-import otherwise writes out in full and roughly
    # doubles the clip buffers. It changes no pose the mixer samples — verified
    # after export with measure_clip_rates.mjs, which reads durations and the
    # planted-foot stance off every clip.
    export_optimize_animation_size=True,
)
print("[lod] WROTE", dst)
