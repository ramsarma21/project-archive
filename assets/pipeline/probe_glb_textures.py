# Extract a GLB's embedded textures and measure whether each alpha channel
# carries anything. Same question probe_cast_textures.py answers, but with the
# standard library only, so it runs on machines without Blender or numpy.
#
# A Meshy bake commonly returns an RGBA albedo whose alpha is opaque apart from
# a handful of stray pixels. That forces PNG (lossless, huge) over JPEG. But a
# character with genuine cutout geometry (hair cards, lace, a net) DOES need it,
# so each one is measured before anything is changed.
#
# Run:
#   python3 assets/pipeline/probe_glb_textures.py character.glb [more.glb ...]
#   python3 assets/pipeline/probe_glb_textures.py --dump OUTDIR character.glb
import json
import os
import struct
import sys
import zlib

OPAQUE = 254  # of 255; matches the 0.996 float threshold used by the Blender probe
NOISE_SHARE = 0.001


def glb_parts(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:4] != b"glTF":
        raise ValueError(f"{path} is not a binary glTF")
    json_length = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20 : 20 + json_length].decode("utf-8").strip())
    binary = b""
    cursor = 20 + json_length
    while cursor + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, cursor)
        if kind == 0x004E4942:
            binary = data[cursor + 8 : cursor + 8 + length]
        cursor += 8 + length
    return document, binary


def image_blobs(document, binary):
    """Yield (index, name, mime, bytes) for every image embedded in the BIN chunk."""
    views = document.get("bufferViews", [])
    for index, image in enumerate(document.get("images", [])):
        view_index = image.get("bufferView")
        if view_index is None:
            continue
        view = views[view_index]
        start = view.get("byteOffset", 0)
        blob = binary[start : start + view["byteLength"]]
        yield index, image.get("name", f"image{index}"), image.get("mimeType", "?"), blob


def png_chunks(blob):
    cursor = 8
    while cursor + 8 <= len(blob):
        (length,) = struct.unpack_from(">I", blob, cursor)
        kind = blob[cursor + 4 : cursor + 8]
        yield kind, blob[cursor + 8 : cursor + 8 + length]
        cursor += 12 + length


CHANNELS_FOR_COLOR_TYPE = {0: 1, 2: 3, 4: 2, 6: 4}


def png_decode(blob):
    """Unfilter an 8-bit non-interlaced PNG into flat samples.

    Raises for the exotic encodings (interlaced, 16-bit, palette) this cast never
    produces, rather than returning something subtly wrong.
    """
    header = None
    idat = bytearray()
    for kind, payload in png_chunks(blob):
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", payload[:13])
        elif kind == b"IDAT":
            idat += payload
        elif kind == b"IEND":
            break
    width, height, depth, color_type, _, _, interlace = header
    channels = CHANNELS_FOR_COLOR_TYPE.get(color_type)
    if channels is None or depth != 8 or interlace != 0:
        raise ValueError(
            f"unsupported PNG: colorType={color_type} depth={depth} interlace={interlace}"
        )

    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    previous = bytearray(stride)
    pixels = bytearray()
    cursor = 0
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        line = bytearray(raw[cursor : cursor + stride])
        cursor += stride
        if filter_type == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filter_type == 2:
            for i in range(stride):
                line[i] = (line[i] + previous[i]) & 0xFF
        elif filter_type == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xFF
        elif filter_type == 4:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                up = previous[i]
                upper_left = previous[i - channels] if i >= channels else 0
                estimate = left + up - upper_left
                da, db, dc = (
                    abs(estimate - left),
                    abs(estimate - up),
                    abs(estimate - upper_left),
                )
                nearest = left if (da <= db and da <= dc) else (up if db <= dc else upper_left)
                line[i] = (line[i] + nearest) & 0xFF
        elif filter_type != 0:
            raise ValueError(f"unknown PNG filter {filter_type}")
        pixels += line
        previous = line

    return {"width": width, "height": height, "channels": channels, "pixels": pixels}


def png_alpha_stats(blob):
    """Report what a PNG's alpha channel actually carries.

    Returns alpha=None when the image has no alpha channel at all.
    """
    image = png_decode(blob)
    channels = image["channels"]
    if channels not in (2, 4):
        return {
            "width": image["width"],
            "height": image["height"],
            "color_type": channels,
            "alpha": None,
        }
    below = 0
    minimum = 255
    for value in image["pixels"][channels - 1 :: channels]:
        if value < OPAQUE:
            below += 1
            if value < minimum:
                minimum = value
    total = image["width"] * image["height"]
    return {
        "width": image["width"],
        "height": image["height"],
        "color_type": 6 if channels == 4 else 4,
        "alpha": {
            "below": below,
            "total": total,
            "share": below / total,
            "min": minimum if below else 255,
        },
    }


def main(argv):
    dump = None
    if argv and argv[0] == "--dump":
        dump = argv[1]
        os.makedirs(dump, exist_ok=True)
        argv = argv[2:]

    for path in argv:
        document, binary = glb_parts(path)
        stem = os.path.splitext(os.path.basename(path))[0]
        print(f"=== {os.path.basename(path)}")
        materials = document.get("materials", [])
        for index, name, mime, blob in image_blobs(document, binary):
            label = f"  img[{index}] {name} {mime} {len(blob) / 1024 / 1024:.2f}MB"
            if dump:
                extension = "png" if "png" in mime else "jpg"
                out = os.path.join(dump, f"{stem}.img{index}.{extension}")
                with open(out, "wb") as handle:
                    handle.write(blob)
            if "png" not in mime:
                print(f"{label} -> already JPEG, nothing to reclaim")
                continue
            stats = png_alpha_stats(blob)
            if stats["alpha"] is None:
                print(f"{label} {stats['width']}x{stats['height']} colorType={stats['color_type']}")
                print("    VERDICT SAFE_TO_JPEG (no alpha channel; PNG is pure overhead)")
                continue
            alpha = stats["alpha"]
            print(f"{label} {stats['width']}x{stats['height']} RGBA")
            print(
                f"    alphaMin={alpha['min']}/255 nonOpaque={alpha['below']} "
                f"of {alpha['total']} ({alpha['share'] * 100:.4f}%)"
            )
            if alpha["below"] == 0:
                print("    VERDICT SAFE_TO_JPEG (fully opaque)")
            elif alpha["share"] < NOISE_SHARE:
                print(f"    VERDICT SAFE_TO_JPEG (bake noise: {alpha['below']} stray pixels)")
            else:
                print("    VERDICT KEEP_ALPHA")
        for index, material in enumerate(materials):
            print(
                f"  material[{index}] {material.get('name', '?')} "
                f"alphaMode={material.get('alphaMode', 'OPAQUE')} "
                f"doubleSided={material.get('doubleSided', False)}"
            )


if __name__ == "__main__":
    main(sys.argv[1:])
