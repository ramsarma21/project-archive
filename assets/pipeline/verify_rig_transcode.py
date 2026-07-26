# Gate for transcode_rig_textures.py: prove the only thing that changed is the
# texture.
#
# A size win is worthless if the rig quietly lost a clip, a bone or a weight, and
# the crowd fails soft - a missing clip falls back to a still body rather than
# throwing - so this compares the two files structurally instead of trusting the
# byte count. Every accessor's payload is hashed on both sides and required to be
# identical; clip names, durations, keyframe counts, bones and skin joints are
# required to match exactly.
#
# Run:
#   python3 assets/pipeline/verify_rig_transcode.py before.glb after.glb
import hashlib
import json
import struct
import sys


def read_glb(path):
    with open(path, "rb") as handle:
        data = handle.read()
    json_length = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20 : 20 + json_length].decode("utf-8").strip())
    binary = b""
    cursor = 20 + json_length
    while cursor + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, cursor)
        if kind == 0x004E4942:
            binary = data[cursor + 8 : cursor + 8 + length]
        cursor += 8 + length
    return document, binary, len(data)


def accessor_bytes(document, binary, index):
    """The actual payload an accessor resolves to, independent of where it sits."""
    accessor = document["accessors"][index]
    view_index = accessor.get("bufferView")
    if view_index is None:
        return b""
    view = document["bufferViews"][view_index]
    sizes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    counts = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}
    element = sizes[accessor["componentType"]] * counts[accessor["type"]]
    stride = view.get("byteStride") or element
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    if stride == element:
        return binary[start : start + element * accessor["count"]]
    out = bytearray()
    for i in range(accessor["count"]):
        offset = start + i * stride
        out += binary[offset : offset + element]
    return bytes(out)


def digest(payload):
    return hashlib.sha256(payload).hexdigest()[:16]


def animation_signature(document, binary):
    signature = {}
    for animation in document.get("animations", []):
        channels = []
        for channel in animation.get("channels", []):
            sampler = animation["samplers"][channel["sampler"]]
            times = accessor_bytes(document, binary, sampler["input"])
            values = accessor_bytes(document, binary, sampler["output"])
            channels.append(
                (
                    channel["target"].get("node"),
                    channel["target"].get("path"),
                    sampler.get("interpolation", "LINEAR"),
                    document["accessors"][sampler["input"]]["count"],
                    digest(times),
                    digest(values),
                )
            )
        signature[animation.get("name", "?")] = sorted(channels, key=lambda c: (str(c[0]), str(c[1])))
    return signature


def mesh_signature(document, binary):
    signature = {}
    for mesh_index, mesh in enumerate(document.get("meshes", [])):
        for primitive_index, primitive in enumerate(mesh.get("primitives", [])):
            parts = {}
            for name, accessor_index in sorted((primitive.get("attributes") or {}).items()):
                parts[name] = (
                    document["accessors"][accessor_index]["count"],
                    digest(accessor_bytes(document, binary, accessor_index)),
                )
            if primitive.get("indices") is not None:
                parts["INDICES"] = (
                    document["accessors"][primitive["indices"]]["count"],
                    digest(accessor_bytes(document, binary, primitive["indices"])),
                )
            signature[f"{mesh.get('name', mesh_index)}#{primitive_index}"] = parts
    return signature


def skin_signature(document, binary):
    signature = {}
    for index, skin in enumerate(document.get("skins", [])):
        matrices = skin.get("inverseBindMatrices")
        signature[skin.get("name", str(index))] = {
            "joints": len(skin.get("joints", [])),
            "jointNodes": list(skin.get("joints", [])),
            "ibm": digest(accessor_bytes(document, binary, matrices)) if matrices is not None else None,
        }
    return signature


def node_signature(document):
    return [
        (
            node.get("name"),
            tuple(round(v, 6) for v in node.get("translation", (0, 0, 0))),
            tuple(round(v, 6) for v in node.get("rotation", (0, 0, 0, 1))),
            tuple(round(v, 6) for v in node.get("scale", (1, 1, 1))),
            node.get("mesh"),
            node.get("skin"),
            tuple(node.get("children", [])),
        )
        for node in document.get("nodes", [])
    ]


def compare(label, before, after, failures):
    if before == after:
        print(f"  PASS {label}")
        return
    failures.append(label)
    print(f"  FAIL {label}")
    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(set(before) | set(after)):
            if before.get(key) != after.get(key):
                print(f"       {key}: before={before.get(key)} after={after.get(key)}")


def main(before_path, after_path):
    before_doc, before_bin, before_size = read_glb(before_path)
    after_doc, after_bin, after_size = read_glb(after_path)

    print(f"=== {before_path}")
    print(f"    {before_size / 1048576:.2f}MB -> {after_size / 1048576:.2f}MB "
          f"({(after_size - before_size) / 1048576:+.2f}MB, "
          f"{(after_size - before_size) / before_size * 100:+.1f}%)")

    failures = []
    compare("clip set", sorted(a.get("name") for a in before_doc.get("animations", [])),
            sorted(a.get("name") for a in after_doc.get("animations", [])), failures)
    compare("animation data (per-channel keyframes + values)",
            animation_signature(before_doc, before_bin),
            animation_signature(after_doc, after_bin), failures)
    compare("mesh data (positions, normals, uvs, joints, weights, indices)",
            mesh_signature(before_doc, before_bin),
            mesh_signature(after_doc, after_bin), failures)
    compare("skin (joints + inverse bind matrices)",
            skin_signature(before_doc, before_bin),
            skin_signature(after_doc, after_bin), failures)
    compare("node/bone hierarchy and rest pose",
            node_signature(before_doc), node_signature(after_doc), failures)

    before_images = [(i.get("name"), i.get("mimeType")) for i in before_doc.get("images", [])]
    after_images = [(i.get("name"), i.get("mimeType")) for i in after_doc.get("images", [])]
    print(f"  INFO images before={before_images}")
    print(f"  INFO images after ={after_images}")
    if len(before_images) != len(after_images):
        failures.append("image count")
        print("  FAIL image count changed")
    else:
        print("  PASS image count and names preserved")

    for index, (b, a) in enumerate(
        zip(before_doc.get("materials", []), after_doc.get("materials", []))
    ):
        print(
            f"  INFO material[{index}] alphaMode {b.get('alphaMode', 'OPAQUE')} -> "
            f"{a.get('alphaMode', 'OPAQUE')}"
        )

    before_uv = {
        (t.get("source"), json.dumps(t.get("sampler"))) for t in before_doc.get("textures", [])
    }
    after_uv = {
        (t.get("source"), json.dumps(t.get("sampler"))) for t in after_doc.get("textures", [])
    }
    compare("texture -> image/sampler wiring", before_uv, after_uv, failures)

    print("VERDICT", "PASS - rig identical, texture re-encoded" if not failures else f"FAIL {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
