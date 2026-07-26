# Gate for transcode_static_textures.py: prove the only thing that changed is the
# image bytes.
#
# verify_rig_transcode.py answers this for a rigged character, where the risk is
# a lost clip, bone or weight. A static interior shell or prop kit has no skin, so
# the equivalent question is narrower and can be proved harder:
#
#   1. Every accessor resolves to a byte-identical payload. That covers positions,
#      normals, tangents, UVs, indices and animation samplers at once, and it is
#      independent of where repack() chose to move each view.
#   2. Every bufferView that is NOT an image is byte-identical. This is the strong
#      form of "only the image changed": it leaves no room for a payload that was
#      re-derived to the same accessor values but a different encoding.
#   3. Materials are deep-equal apart from alphaMode/alphaCutoff, and the only
#      movement allowed there is toward OPAQUE. A silent roughness or
#      baseColorFactor change would be a visual regression that no size number
#      would reveal.
#   4. Node hierarchy, transforms, mesh->material wiring, texture->image/sampler
#      wiring, animation channels and the extension list all match exactly.
#
# Images are expected to differ, so they are reported rather than compared: name
# and count must match, mimeType may change, and the byte delta is printed.
#
# --measure additionally decodes both sides of every re-encoded image and reports
# the error. That is deliberately here rather than only in the sweep that chose
# the quality: sips does not always return identical JPEG bytes for identical
# input, so a sweep figure describes a JPEG that was encoded during the sweep,
# not the one that shipped. Measuring the stored bytes is the only figure that
# describes the published file. An image whose bytes did not change is asserted
# to be byte-identical, which is the claim worth making about a normal map that
# was deliberately left as PNG.
#
# Run:
#   python3 assets/pipeline/verify_static_transcode.py [--measure] before.glb after.glb
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_glb_textures import png_decode  # noqa: E402
from transcode_static_textures import (  # noqa: E402
    angular_error,
    image_roles,
    jpeg_to_samples,
    photometric_error,
)
from verify_rig_transcode import accessor_bytes, digest, node_signature, read_glb  # noqa: E402

ALPHA_KEYS = ("alphaMode", "alphaCutoff")


def accessor_signature(document, binary):
    signature = {}
    for index, accessor in enumerate(document.get("accessors", [])):
        signature[index] = (
            accessor.get("type"),
            accessor.get("componentType"),
            accessor.get("count"),
            accessor.get("normalized", False),
            digest(accessor_bytes(document, binary, index)),
        )
    return signature


def non_image_views(document, binary):
    """Every bufferView except the ones holding an embedded image, byte-for-byte."""
    image_views = {
        image.get("bufferView")
        for image in document.get("images", [])
        if image.get("bufferView") is not None
    }
    signature = {}
    for index, view in enumerate(document.get("bufferViews", [])):
        if index in image_views:
            continue
        start = view.get("byteOffset", 0)
        payload = binary[start : start + view["byteLength"]]
        signature[index] = (view["byteLength"], view.get("byteStride"), view.get("target"), digest(payload))
    return signature


def mesh_signature(document):
    signature = {}
    for index, mesh in enumerate(document.get("meshes", [])):
        signature[f"{index}:{mesh.get('name')}"] = [
            (
                sorted((primitive.get("attributes") or {}).items()),
                primitive.get("indices"),
                primitive.get("material"),
                primitive.get("mode"),
            )
            for primitive in mesh.get("primitives", [])
        ]
    return signature


def material_signature(document):
    """Every material field except the alpha keys, which are reported separately."""
    signature = {}
    for index, material in enumerate(document.get("materials", [])):
        stripped = {key: value for key, value in material.items() if key not in ALPHA_KEYS}
        signature[f"{index}:{material.get('name')}"] = json.dumps(stripped, sort_keys=True)
    return signature


def animation_signature(document, binary):
    signature = {}
    for index, animation in enumerate(document.get("animations", [])):
        channels = []
        for channel in animation.get("channels", []):
            sampler = animation["samplers"][channel["sampler"]]
            channels.append(
                (
                    channel["target"].get("node"),
                    channel["target"].get("path"),
                    sampler.get("interpolation", "LINEAR"),
                    digest(accessor_bytes(document, binary, sampler["input"])),
                    digest(accessor_bytes(document, binary, sampler["output"])),
                )
            )
        signature[f"{index}:{animation.get('name')}"] = sorted(
            channels, key=lambda c: (str(c[0]), str(c[1]))
        )
    return signature


def texture_signature(document):
    return [
        (texture.get("source"), texture.get("sampler"), json.dumps(texture.get("extensions"), sort_keys=True))
        for texture in document.get("textures", [])
    ]


def compare(label, before, after, failures):
    if before == after:
        print(f"  PASS {label}")
        return
    failures.append(label)
    print(f"  FAIL {label}")
    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(set(before) | set(after), key=str):
            if before.get(key) != after.get(key):
                print(f"       {key}: before={before.get(key)} after={after.get(key)}")
    else:
        print(f"       before={before}\n       after ={after}")


def image_payload(document, binary, image):
    view = document["bufferViews"][image["bufferView"]]
    start = view.get("byteOffset", 0)
    return binary[start : start + view["byteLength"]]


def samples(mime, blob):
    return png_decode(blob) if "png" in (mime or "") else jpeg_to_samples(blob)


def measure_image(before_mime, before_blob, after_mime, after_blob, role):
    """What did this image actually cost, measured on the bytes that shipped?"""
    if before_blob == after_blob:
        return "unchanged, byte-identical"
    before = samples(before_mime, before_blob)
    after = samples(after_mime, after_blob)
    if (before["width"], before["height"]) != (after["width"], after["height"]):
        return (
            f"RESOLUTION CHANGED {before['width']}x{before['height']} -> "
            f"{after['width']}x{after['height']}"
        )
    error = photometric_error(before, after)
    text = (
        f"meanErr={error['mean']:.3f}/255 maxErr={error['max']}/255 "
        f"PSNR={error['psnr']:.2f}dB"
    )
    if role == "normal":
        angle = angular_error(before, after)
        if angle:
            text += (
                f"  angle mean={angle['mean']:.3f}deg p95={angle['p95']:.2f}deg "
                f"max={angle['max']:.2f}deg"
            )
    return text


def main(before_path, after_path, do_measure=False):
    before_doc, before_bin, before_size = read_glb(before_path)
    after_doc, after_bin, after_size = read_glb(after_path)

    print(f"=== {os.path.basename(before_path)}")
    print(
        f"    {before_size / 1048576:.2f}MB -> {after_size / 1048576:.2f}MB "
        f"({(after_size - before_size) / 1048576:+.2f}MB, "
        f"{(after_size - before_size) / before_size * 100:+.1f}%)"
    )

    failures = []
    compare(
        "accessor payloads (positions, normals, tangents, uvs, indices, samplers)",
        accessor_signature(before_doc, before_bin),
        accessor_signature(after_doc, after_bin),
        failures,
    )
    compare(
        "every non-image bufferView, byte-for-byte",
        non_image_views(before_doc, before_bin),
        non_image_views(after_doc, after_bin),
        failures,
    )
    compare("node hierarchy and transforms", node_signature(before_doc), node_signature(after_doc), failures)
    compare("mesh primitives and material wiring", mesh_signature(before_doc), mesh_signature(after_doc), failures)
    compare(
        "materials (every field except alphaMode/alphaCutoff)",
        material_signature(before_doc),
        material_signature(after_doc),
        failures,
    )
    compare("texture -> image/sampler wiring", texture_signature(before_doc), texture_signature(after_doc), failures)
    compare(
        "animation channels and keyframe data",
        animation_signature(before_doc, before_bin),
        animation_signature(after_doc, after_bin),
        failures,
    )
    compare(
        "extensions used/required",
        (sorted(before_doc.get("extensionsUsed", [])), sorted(before_doc.get("extensionsRequired", []))),
        (sorted(after_doc.get("extensionsUsed", [])), sorted(after_doc.get("extensionsRequired", []))),
        failures,
    )

    # alphaMode may move, but only toward OPAQUE.
    for index, (before, after) in enumerate(
        zip(before_doc.get("materials", []), after_doc.get("materials", []))
    ):
        was = before.get("alphaMode", "OPAQUE")
        now = after.get("alphaMode", "OPAQUE")
        if was == now:
            continue
        if now == "OPAQUE":
            print(f"  INFO material[{index}] alphaMode {was} -> OPAQUE (allowed: alpha was not real)")
        else:
            failures.append(f"material[{index}] alphaMode {was} -> {now}")
            print(f"  FAIL material[{index}] alphaMode {was} -> {now} is not a relaxation")

    before_images = before_doc.get("images", [])
    after_images = after_doc.get("images", [])
    if len(before_images) != len(after_images):
        failures.append("image count")
        print(f"  FAIL image count {len(before_images)} -> {len(after_images)}")
    else:
        print(f"  PASS image count preserved ({len(before_images)})")
        roles = image_roles(after_doc)
        for index, (before, after) in enumerate(zip(before_images, after_images)):
            if before.get("name") != after.get("name"):
                failures.append(f"image[{index}] name")
                print(f"  FAIL image[{index}] name {before.get('name')} -> {after.get('name')}")
                continue
            before_blob = image_payload(before_doc, before_bin, before)
            after_blob = image_payload(after_doc, after_bin, after)
            delta = len(after_blob) - len(before_blob)
            changed = "" if delta == 0 else f" ({delta / 1048576:+.2f}MB)"
            print(
                f"  INFO image[{index}] {before.get('name')} "
                f"{before.get('mimeType')} {len(before_blob) / 1048576:.2f}MB -> "
                f"{after.get('mimeType')} {len(after_blob) / 1048576:.2f}MB{changed}"
            )
            if do_measure:
                role = next(iter(sorted(roles.get(index, {}))), None)
                print(
                    f"       {measure_image(before.get('mimeType'), before_blob, after.get('mimeType'), after_blob, role)}"
                )

    print(
        "VERDICT",
        "PASS - geometry, materials and animation identical; only image bytes changed"
        if not failures
        else f"FAIL {failures}",
    )
    return 1 if failures else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("before")
    parser.add_argument("after")
    parser.add_argument(
        "--measure",
        action="store_true",
        help="also decode each re-encoded image and report the error actually shipped",
    )
    args = parser.parse_args()
    sys.exit(main(args.before, args.after, args.measure))
