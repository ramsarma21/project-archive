# Does a texture's alpha channel carry anything? An RGBA albedo with a fully
# opaque alpha is pure waste: it forces PNG (lossless, huge) over JPEG and, when
# the material is alphaMode BLEND, also costs a sorted transparent draw.
#
# Run:
#   blender --background --python probe_texture_alpha.py -- image.png [more.png]
import bpy
import os
import sys
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1 :]
for path in argv:
    image = bpy.data.images.load(os.path.abspath(path))
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    alpha = pixels.reshape(-1, 4)[:, 3]
    below = int((alpha < 0.996).sum())
    print(
        f"{os.path.basename(path)} {width}x{height} "
        f"alphaMin={alpha.min():.4f} alphaMax={alpha.max():.4f} "
        f"pixelsBelowOpaque={below} ({below / alpha.size * 100:.4f}%)"
    )
    print("VERDICT", "ALPHA_USED" if below > 0 else "ALPHA_FULLY_OPAQUE")
    bpy.data.images.remove(image)
