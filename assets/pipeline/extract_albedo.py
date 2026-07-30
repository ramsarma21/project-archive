# Extract the base-colour (albedo) image from a character GLB to a JPEG, so it
# can be white-balanced by correct_presenter_albedo.py and swapped back in by
# apply_presenter_appearance_fix.py. Also prints the image's mean RGB so a cast
# can be judged before deciding whether a correction is even needed.
#
# Run:
#   blender --background --python extract_albedo.py -- <glb> <out.jpg>
import bpy, os, sys

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC = os.path.abspath(argv[0])
OUT = os.path.abspath(argv[1])
os.makedirs(os.path.dirname(OUT), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

imgs = [im for im in bpy.data.images if im.name != "Render Result" and im.size[0] > 0]
assert imgs, "no image found in GLB"
# The albedo is the largest image (normal/MR maps, if any, are usually smaller or
# equal; Meshy presenter bakes carry a single albedo).
img = max(imgs, key=lambda im: im.size[0] * im.size[1])
w, h = img.size
px = list(img.pixels)  # RGBA floats 0..1, row-major
n = w * h
r = sum(px[0::4]) / n
g = sum(px[1::4]) / n
b = sum(px[2::4]) / n
print(f"ALBEDO {img.name} {w}x{h} meanRGB={r*255:.1f} {g*255:.1f} {b*255:.1f} "
      f"(b/r={b/max(r,1e-6):.3f})")

img.file_format = "JPEG"
img.filepath_raw = OUT
img.save()
print("WROTE", OUT, os.path.getsize(OUT))
