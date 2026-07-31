# Save all embedded images from a GLB to PNGs for inspection.
# Run: blender --background --python extract_glb_textures.py -- <glb> <outdir>
import bpy, os, sys
argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0]); OUT = os.path.abspath(argv[1])
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN_GLB)
for i, img in enumerate(bpy.data.images):
    if img.name == "Render Result" or img.size[0] == 0:
        continue
    p = os.path.join(OUT, f"tex_{i}_{img.name.replace('/','_')}.png")
    img.filepath_raw = p; img.file_format = "PNG"
    try:
        img.save()
        print("SAVED", p, img.size[0], img.size[1])
    except Exception as e:
        print("SKIP", img.name, e)
