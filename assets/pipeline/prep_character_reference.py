#!/usr/bin/env python3
"""Prepare a full-body character reference for Meshy Image-to-3D.

The problem this solves: a full-body concept on a large white field starves the
face of pixels. Meshy then reconstructs a mushy, low-detail face. This tool does
NOT touch the pixels of the subject (no generative change, no recolour): it only
finds the near-white border around the whole silhouette, crops it away with a
safe padding that keeps every hair wisp and both feet, recenters the subject on a
clean white square canvas, and upscales with a high-quality (LANCZOS) filter plus
a conservative unsharp mask. The result stays full-body and front-facing; the
face simply occupies far more of the frame.

Run:
  python prep_character_reference.py in.png out.png \
      [--target 1280] [--pad-frac 0.06] [--white-thresh 14] [--sharpen 60]

Reports the detected subject bounding box, crop, and final canvas so the crop is
auditable rather than magic.
"""
import argparse
import json
import sys

import numpy as np
from PIL import Image, ImageFilter


def subject_bbox(rgb: np.ndarray, white_thresh: int, min_run_frac: float):
    """Bounding box of the non-white subject.

    A pixel counts as "subject" when any channel sits meaningfully below white
    (255 - min_channel > white_thresh). This catches the faint bluish glow and
    hair wisps, not just the solid body. Isolated specks are then rejected by
    requiring each retained row/column to carry more than a small fraction of the
    peak foreground count, so a stray compression dot in the margin cannot widen
    the box.
    """
    min_channel = rgb.min(axis=2)
    mask = (255 - min_channel.astype(np.int16)) > white_thresh

    row_counts = mask.sum(axis=1)
    col_counts = mask.sum(axis=0)
    row_floor = max(2, int(row_counts.max() * min_run_frac))
    col_floor = max(2, int(col_counts.max() * min_run_frac))

    rows = np.where(row_counts > row_floor)[0]
    cols = np.where(col_counts > col_floor)[0]
    if rows.size == 0 or cols.size == 0:
        raise SystemExit("prep: no subject detected (image looks entirely white)")
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1, mask


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--target", type=int, default=1280, help="final square canvas side in px")
    ap.add_argument("--pad-frac", type=float, default=0.06, help="padding around subject, fraction of subject height")
    ap.add_argument("--white-thresh", type=int, default=14, help="how far below white counts as subject")
    ap.add_argument("--min-run-frac", type=float, default=0.02, help="reject rows/cols below this fraction of peak")
    ap.add_argument("--sharpen", type=int, default=60, help="unsharp mask percent (0 disables)")
    ap.add_argument("--sharpen-radius", type=float, default=1.4)
    args = ap.parse_args()

    src = Image.open(args.input).convert("RGBA")
    # Flatten onto white so any transparency reads as background, matching how a
    # near-white concept plate is meant to look.
    flat = Image.new("RGBA", src.size, (255, 255, 255, 255))
    flat.alpha_composite(src)
    rgb_img = flat.convert("RGB")
    rgb = np.asarray(rgb_img)

    x0, y0, x1, y1, _ = subject_bbox(rgb, args.white_thresh, args.min_run_frac)
    sub_w, sub_h = x1 - x0, y1 - y0

    # Padding is expressed against subject HEIGHT (the dominant dimension for a
    # standing figure) so a thin body still gets a sensible margin on all sides,
    # keeping hair crown and feet clear of the canvas edge.
    pad = max(4, int(sub_h * args.pad_frac))
    cx0 = max(0, x0 - pad)
    cy0 = max(0, y0 - pad)
    cx1 = min(rgb_img.width, x1 + pad)
    cy1 = min(rgb_img.height, y1 + pad)
    crop = rgb_img.crop((cx0, cy0, cx1, cy1))

    # Square white canvas sized to the padded crop's longest side, subject
    # centered. Keeps the whole body in frame while removing the wasteful side
    # margins that were starving the face of resolution.
    side = max(crop.width, crop.height)
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    canvas.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))

    # High-quality upscale, then a conservative unsharp mask to restore edge
    # crispness lost to interpolation. This never invents features; it only
    # accentuates existing ones (eyes, lapels, hair strands).
    out = canvas.resize((args.target, args.target), Image.LANCZOS)
    if args.sharpen > 0:
        out = out.filter(
            ImageFilter.UnsharpMask(radius=args.sharpen_radius, percent=args.sharpen, threshold=2)
        )

    out.save(args.output, "PNG")

    report = {
        "input": args.input,
        "input_size": [rgb_img.width, rgb_img.height],
        "subject_bbox": [x0, y0, x1, y1],
        "subject_size": [sub_w, sub_h],
        "pad_px": pad,
        "crop_box": [cx0, cy0, cx1, cy1],
        "canvas_side": side,
        "target": args.target,
        "upscale_factor": round(args.target / side, 3),
        "sharpen_percent": args.sharpen,
        "output": args.output,
    }
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
