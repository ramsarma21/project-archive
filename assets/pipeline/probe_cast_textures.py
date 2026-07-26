# Per-character texture audit: image format, resolution, and whether the alpha
# channel carries anything. Answers "can this albedo become a JPEG?" with a
# measurement instead of an assumption.
#
# A Meshy bake commonly returns an RGBA albedo whose alpha is entirely opaque
# apart from a handful of stray pixels. That forces PNG (lossless, huge) over
# JPEG and, when the material is alphaMode BLEND, also costs a sorted
# transparent draw. But a character with genuine cutout geometry (hair cards,
# lace, a net) DOES need it, so each one is measured before anything is changed.
#
# Run:
#   blender --background --python probe_cast_textures.py -- a.glb [b.glb ...]
import bpy
import os
import sys
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1 :]
OPAQUE = 0.996
# Below this share of non-opaque pixels the alpha is treated as bake noise.
NOISE_SHARE = 0.001

print(f"{'character':16s} {'image':22s} {'res':>11s} {'bytes':>9s} "
      f"{'aMin':>6s} {'nonOpaque':>10s} {'share%':>8s}  verdict")
for path in argv:
    name = os.path.splitext(os.path.basename(path))[0]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    for image in list(bpy.data.images):
        if image.size[0] == 0:
            continue
        width, height = image.size
        channels = image.channels
        pixels = np.empty(width * height * channels, dtype=np.float32)
        try:
            image.pixels.foreach_get(pixels)
        except Exception:
            continue
        if channels < 4:
            verdict = "NO_ALPHA_CHANNEL"
            print(f"{name:16s} {image.name[:22]:22s} {f'{width}x{height}':>11s} "
                  f"{'-':>9s} {'-':>6s} {'-':>10s} {'-':>8s}  {verdict}")
            continue
        alpha = pixels.reshape(-1, 4)[:, 3]
        below = int((alpha < OPAQUE).sum())
        share = below / alpha.size
        if below == 0:
            verdict = "SAFE_TO_JPEG (fully opaque)"
        elif share < NOISE_SHARE:
            verdict = "SAFE_TO_JPEG (noise)"
        else:
            verdict = "KEEP_ALPHA"
        print(
            f"{name:16s} {image.name[:22]:22s} {f'{width}x{height}':>11s} "
            f"{image.packed_file.size if image.packed_file else 0:9d} "
            f"{alpha.min():6.3f} {below:10d} {share * 100:8.4f}  {verdict}"
        )
