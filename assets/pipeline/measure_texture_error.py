# How much did re-encoding an albedo actually change it?
#
# "It looks the same to me" is the weakest link in a texture swap, especially for
# a story NPC whose face fills a dialogue frame. This measures the swap instead:
# it decodes the original PNG and the replacement JPEG back to raw samples and
# reports mean/max per-channel error and PSNR over the RGB channels.
#
# Texture space is the right place to measure. The error here bounds what any
# camera can show, so a good number is evidence for every shot rather than for
# the one that happened to be photographed.
#
# Rough reading for an 8-bit albedo: PSNR above ~45dB is visually lossless,
# 40-45dB is safe for anything but extreme close-ups, below ~35dB is visible.
#
# Run:
#   python3 assets/pipeline/measure_texture_error.py before.glb after.glb [more pairs...]
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_glb_textures import glb_parts, image_blobs, png_decode  # noqa: E402


def to_png(blob, suffix):
    """Round a JPEG back to PNG so both sides can be decoded by the same reader."""
    with tempfile.TemporaryDirectory() as workdir:
        source = os.path.join(workdir, f"image{suffix}")
        target = os.path.join(workdir, "image.png")
        with open(source, "wb") as handle:
            handle.write(blob)
        subprocess.run(
            ["sips", "-s", "format", "png", source, "--out", target],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        with open(target, "rb") as handle:
            return handle.read()


def albedo(path):
    document, binary = glb_parts(path)
    for index, name, mime, blob in image_blobs(document, binary):
        if "normal" in name.lower():
            continue
        return name, mime, blob
    raise ValueError(f"{path}: no albedo found")


def samples(mime, blob):
    if "png" not in mime:
        blob = to_png(blob, ".jpg")
    image = png_decode(blob)
    return image


def compare(before_path, after_path):
    before_name, before_mime, before_blob = albedo(before_path)
    after_name, after_mime, after_blob = albedo(after_path)
    a = samples(before_mime, before_blob)
    b = samples(after_mime, after_blob)
    if (a["width"], a["height"]) != (b["width"], b["height"]):
        print(f"  RESOLUTION CHANGED {a['width']}x{a['height']} -> {b['width']}x{b['height']}")
        return None

    ca, cb = a["channels"], b["channels"]
    total = a["width"] * a["height"]
    squared = 0
    absolute = 0
    worst = 0
    pa, pb = a["pixels"], b["pixels"]
    for channel in range(3):  # RGB only; alpha is intentionally dropped
        ia, ib = channel, channel
        for i in range(total):
            delta = pa[i * ca + ia] - pb[i * cb + ib]
            if delta < 0:
                delta = -delta
            absolute += delta
            squared += delta * delta
            if delta > worst:
                worst = delta
    count = total * 3
    mse = squared / count
    psnr = float("inf") if mse == 0 else 10 * __import__("math").log10(255 * 255 / mse)
    print(
        f"  albedo {a['width']}x{a['height']}  "
        f"{before_mime.replace('image/','')} {len(before_blob)/1048576:.2f}MB -> "
        f"{after_mime.replace('image/','')} {len(after_blob)/1048576:.2f}MB"
    )
    print(
        f"  meanAbsErr={absolute / count:.3f}/255  maxErr={worst}/255  "
        f"rmse={mse ** 0.5:.3f}  PSNR={psnr:.2f}dB"
    )
    verdict = (
        "VISUALLY_LOSSLESS" if psnr >= 45
        else "SAFE" if psnr >= 40
        else "MARGINAL" if psnr >= 35
        else "VISIBLE_LOSS"
    )
    print(f"  VERDICT {verdict}")
    return psnr


pairs = sys.argv[1:]
if len(pairs) % 2 != 0:
    print("usage: measure_texture_error.py before.glb after.glb [before2.glb after2.glb ...]")
    sys.exit(2)
worst_psnr = float("inf")
for i in range(0, len(pairs), 2):
    print(f"=== {os.path.basename(pairs[i])} -> {os.path.basename(pairs[i + 1])}")
    psnr = compare(pairs[i], pairs[i + 1])
    if psnr is not None:
        worst_psnr = min(worst_psnr, psnr)
print(f"\nworst PSNR across {len(pairs) // 2} rig(s): {worst_psnr:.2f}dB")
