# Gate for rescale_rig_glb.py: prove the only thing that changed is the scale.
#
# WHY THIS IS NOT verify_rig_transcode.py. That tool proves BYTE IDENTITY of every
# accessor, which is the right bar for a texture re-encode and the wrong bar here:
# a scale fix is REQUIRED to change POSITION, node translations, inverse bind
# matrices and translation channels. Running the byte-identity gate over a rescale
# would fail on exactly the four things that were supposed to change and say
# nothing about the thirteen clips.
#
# So this splits the file in two and applies a different test to each half:
#
#   HASHED - must be byte-identical. Keyframe TIMES (a scale must not retime a
#   performance), rotation channel values, scale channel values, NORMAL,
#   TEXCOORD_0, JOINTS_0, WEIGHTS_0, indices, the 3x3 linear blocks of every
#   inverse bind matrix, every node's rotation and scale, the node hierarchy and
#   names, and every embedded image.
#
#   MEASURED - must have moved by the factor, and by nothing else. POSITION, node
#   translations, inverse bind matrix translation columns, and translation channel
#   values. Each is checked elementwise and the WORST relative error is reported,
#   so "scaled by 100" is a measurement rather than an assertion.
#
# The two halves together are the proof: if a clip had been dropped, retimed, or
# had its rotations resampled, it would show up in the hashed half; if the scale
# had been applied unevenly - to the mesh but not the skeleton, which is the exact
# defect class this repo keeps hitting - it would show up in the measured half.
#
# Run:
#   python3 assets/pipeline/verify_rig_rescale.py --factor 100 before.glb after.glb
import argparse
import hashlib
import json
import struct
import sys

COMPONENT_BYTES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


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
    accessor = document["accessors"][index]
    view_index = accessor.get("bufferView")
    if view_index is None:
        return b""
    view = document["bufferViews"][view_index]
    element = COMPONENT_BYTES[accessor["componentType"]] * TYPE_COUNT[accessor["type"]]
    stride = view.get("byteStride") or element
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    if stride == element:
        return binary[start : start + element * accessor["count"]]
    out = bytearray()
    for i in range(accessor["count"]):
        offset = start + i * stride
        out += binary[offset : offset + element]
    return bytes(out)


def accessor_floats(document, binary, index):
    accessor = document["accessors"][index]
    if accessor["componentType"] != 5126:
        return None
    blob = accessor_bytes(document, binary, index)
    return struct.unpack(f"<{len(blob) // 4}f", blob)


def digest(payload):
    return hashlib.sha256(payload).hexdigest()[:16]


def image_bytes(document, binary):
    out = []
    for image in document.get("images", []):
        view_index = image.get("bufferView")
        if view_index is None:
            out.append((image.get("name"), image.get("mimeType"), None))
            continue
        view = document["bufferViews"][view_index]
        start = view.get("byteOffset", 0)
        blob = binary[start : start + view["byteLength"]]
        out.append((image.get("name"), image.get("mimeType"), digest(blob)))
    return out


# ---------------------------------------------------------------- hashed half
UNSCALED_ATTRIBUTES = ("NORMAL", "TANGENT", "TEXCOORD_0", "TEXCOORD_1", "JOINTS_0", "WEIGHTS_0", "COLOR_0")


def unscaled_signature(document, binary):
    """Everything a pure uniform scale must leave bit-for-bit alone."""
    signature = {}

    for mesh_index, mesh in enumerate(document.get("meshes", [])):
        name = mesh.get("name", mesh_index)
        for primitive_index, primitive in enumerate(mesh.get("primitives", [])):
            attributes = primitive.get("attributes") or {}
            for attribute in UNSCALED_ATTRIBUTES:
                if attribute in attributes:
                    index = attributes[attribute]
                    signature[f"mesh {name}#{primitive_index} {attribute}"] = (
                        document["accessors"][index]["count"],
                        digest(accessor_bytes(document, binary, index)),
                    )
            if primitive.get("indices") is not None:
                index = primitive["indices"]
                signature[f"mesh {name}#{primitive_index} INDICES"] = (
                    document["accessors"][index]["count"],
                    digest(accessor_bytes(document, binary, index)),
                )

    for animation in document.get("animations", []):
        name = animation.get("name", "?")
        rows = []
        for channel in animation.get("channels", []):
            sampler = animation["samplers"][channel["sampler"]]
            path = channel["target"].get("path")
            times = accessor_bytes(document, binary, sampler["input"])
            row = [
                channel["target"].get("node"),
                path,
                sampler.get("interpolation", "LINEAR"),
                document["accessors"][sampler["input"]]["count"],
                digest(times),
            ]
            # Rotation and scale are scale-invariant, so their VALUES are part of
            # the hashed half. Translation values belong to the measured half, but
            # its keyframe COUNT and TIMES are hashed here regardless.
            if path in ("rotation", "scale", "weights"):
                row.append(digest(accessor_bytes(document, binary, sampler["output"])))
            rows.append(tuple(row))
        signature[f"anim {name}"] = sorted(rows, key=lambda r: (str(r[0]), str(r[1])))

    for index, skin in enumerate(document.get("skins", [])):
        matrices = skin.get("inverseBindMatrices")
        linear = None
        if matrices is not None:
            values = accessor_floats(document, binary, matrices)
            # Strip the translation column (lanes 12,13,14) from each MAT4.
            kept = []
            for base in range(0, len(values), 16):
                kept.extend(values[base : base + 12])
                kept.append(values[base + 15])
            linear = digest(struct.pack(f"<{len(kept)}f", *kept))
        signature[f"skin {skin.get('name', index)}"] = {
            "joints": list(skin.get("joints", [])),
            "skeleton": skin.get("skeleton"),
            "ibm3x3": linear,
        }

    signature["nodes"] = [
        (
            node.get("name"),
            tuple(round(v, 7) for v in node.get("rotation", (0, 0, 0, 1))),
            tuple(round(v, 7) for v in node.get("scale", (1, 1, 1))),
            node.get("mesh"),
            node.get("skin"),
            tuple(node.get("children", [])),
        )
        for node in document.get("nodes", [])
    ]
    signature["images"] = image_bytes(document, binary)
    signature["materials"] = json.dumps(document.get("materials", []), sort_keys=True)
    signature["textures"] = json.dumps(document.get("textures", []), sort_keys=True)
    signature["scenes"] = json.dumps(document.get("scenes", []), sort_keys=True)
    return signature


# -------------------------------------------------------------- measured half
def worst_ratio_error(before, after, factor):
    """Largest relative deviation of after/before from `factor`.

    Values at or near zero carry no ratio information, so they are compared on an
    absolute floor instead - which still catches a value that should have stayed
    zero and did not.
    """
    worst = 0.0
    where = None
    floor = 1e-9
    for index, (b, a) in enumerate(zip(before, after)):
        expected = b * factor
        if abs(expected) < floor:
            error = abs(a)
            scaled = error
        else:
            error = abs(a - expected) / abs(expected)
            scaled = error
        if scaled > worst:
            worst = scaled
            where = (index, b, a, expected)
    return worst, where


def measured_rows(document, binary):
    """The four quantities a uniform scale must move, as flat float lists."""
    rows = {}
    for mesh_index, mesh in enumerate(document.get("meshes", [])):
        name = mesh.get("name", mesh_index)
        for primitive_index, primitive in enumerate(mesh.get("primitives", [])):
            index = (primitive.get("attributes") or {}).get("POSITION")
            if index is not None:
                rows[f"mesh {name}#{primitive_index} POSITION"] = accessor_floats(
                    document, binary, index
                )
    for index, skin in enumerate(document.get("skins", [])):
        matrices = skin.get("inverseBindMatrices")
        if matrices is None:
            continue
        values = accessor_floats(document, binary, matrices)
        translations = []
        for base in range(0, len(values), 16):
            translations.extend(values[base + 12 : base + 15])
        rows[f"skin {skin.get('name', index)} IBM translation"] = tuple(translations)
    node_translations = []
    for node in document.get("nodes", []):
        node_translations.extend(node.get("translation", (0.0, 0.0, 0.0)))
    rows["node translations"] = tuple(node_translations)
    for animation in document.get("animations", []):
        name = animation.get("name", "?")
        values = []
        for channel in sorted(
            animation.get("channels", []),
            key=lambda c: (str(c["target"].get("node")), str(c["target"].get("path"))),
        ):
            if channel["target"].get("path") != "translation":
                continue
            sampler = animation["samplers"][channel["sampler"]]
            values.extend(accessor_floats(document, binary, sampler["output"]))
        if values:
            rows[f"anim {name} translation values"] = tuple(values)
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("before")
    parser.add_argument("after")
    parser.add_argument("--factor", type=float, required=True)
    parser.add_argument(
        "--tolerance",
        type=float,
        default=1e-6,
        help="max relative error allowed on a scaled value (float32 round-trip)",
    )
    args = parser.parse_args()

    before_doc, before_bin, before_size = read_glb(args.before)
    after_doc, after_bin, after_size = read_glb(args.after)

    print(f"=== {args.before}")
    print(f"    -> {args.after}")
    print(f"    {before_size / 1048576:.2f}MB -> {after_size / 1048576:.2f}MB   factor {args.factor:g}")

    failures = []

    print("\n  HASHED - must be byte-identical")
    before_clips = sorted(a.get("name") for a in before_doc.get("animations", []))
    after_clips = sorted(a.get("name") for a in after_doc.get("animations", []))
    if before_clips == after_clips:
        print(f"    PASS clip set ({len(after_clips)}): {', '.join(after_clips)}")
    else:
        failures.append("clip set")
        print(f"    FAIL clip set  before={before_clips}\n                   after ={after_clips}")

    before_sig = unscaled_signature(before_doc, before_bin)
    after_sig = unscaled_signature(after_doc, after_bin)
    for key in sorted(set(before_sig) | set(after_sig)):
        if before_sig.get(key) == after_sig.get(key):
            print(f"    PASS {key}")
        else:
            failures.append(key)
            print(f"    FAIL {key}")
            b, a = before_sig.get(key), after_sig.get(key)
            if isinstance(b, list) and isinstance(a, list) and len(b) == len(a):
                for i, (bb, aa) in enumerate(zip(b, a)):
                    if bb != aa:
                        print(f"         [{i}] before={bb}\n              after ={aa}")
            else:
                print(f"         before={str(b)[:300]}\n         after ={str(a)[:300]}")

    print(f"\n  MEASURED - must have moved by exactly {args.factor:g}")
    before_rows = measured_rows(before_doc, before_bin)
    after_rows = measured_rows(after_doc, after_bin)
    for key in sorted(set(before_rows) | set(after_rows)):
        before_values = before_rows.get(key)
        after_values = after_rows.get(key)
        if before_values is None or after_values is None or len(before_values) != len(after_values):
            failures.append(key)
            print(
                f"    FAIL {key}: count "
                f"{len(before_values) if before_values else 'missing'} -> "
                f"{len(after_values) if after_values else 'missing'}"
            )
            continue
        worst, where = worst_ratio_error(before_values, after_values, args.factor)
        ok = worst <= args.tolerance
        if not ok:
            failures.append(key)
        detail = ""
        if where and not ok:
            detail = f"  worst at [{where[0]}]: {where[1]:.9g} -> {where[2]:.9g}, expected {where[3]:.9g}"
        print(
            f"    {'PASS' if ok else 'FAIL'} {key}: {len(after_values)} floats, "
            f"worst relative error {worst:.3g}{detail}"
        )

    print("\nVERDICT", "PASS - scale changed, nothing else" if not failures else f"FAIL {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
