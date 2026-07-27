# Report the PBR material wiring of every rigged character, one row per material.
#
# WHY THIS EXISTS. Four rigs shipped with their whole-body albedo wired into the
# EMISSIVE slot at emissiveFactor 1,1,1. Emissive is light-independent, so those
# four rendered at full albedo brightness while the rest of the unlit scene went
# black - the owner's report was "all the npcs glow BRIGHT, but you literally
# cannot see anything else at all". It also silently defeats crowd tinting, because
# RiggedCharacter.tsx clones the material and multiplies `.color` only, never
# `.emissive` or `.emissiveMap`, and metallicFactor 1 kills the diffuse term that
# the tint does colour.
#
# None of that errors, and none of it is visible in a file listing. The only way to
# see it is to read the material wiring across the whole cast at once, which is
# what this prints - including whether the emissive texture is the SAME image as
# the base colour, since a whole-body albedo used as emissive is the defect whereas
# a small dedicated lantern mask would be legitimate.
#
# Usage:
#   python3 assets/pipeline/probe_rig_materials.py apps/web/public/world/characters/*.glb
import json
import struct
import sys


def read_glb(path):
    with open(path, "rb") as handle:
        data = handle.read()
    json_length = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20 : 20 + json_length].decode("utf-8").strip())


def image_of(document, texture_reference):
    if not texture_reference:
        return None
    index = texture_reference.get("index")
    if index is None:
        return None
    texture = (document.get("textures") or [])[index]
    return texture.get("source")


def main(paths):
    print(
        f"{'file':26} {'material':22} {'emissiveFactor':>16} {'emisTex':>8} "
        f"{'baseTex':>8} {'same?':>6} {'metal':>6} {'rough':>6}  alphaMode"
    )
    suspects = []
    for path in paths:
        document = read_glb(path)
        name = path.split("/")[-1].replace(".glb", "")
        images = document.get("images") or []
        for index, material in enumerate(document.get("materials") or []):
            pbr = material.get("pbrMetallicRoughness") or {}
            factor = material.get("emissiveFactor", [0, 0, 0])
            emissive_image = image_of(document, material.get("emissiveTexture"))
            base_image = image_of(document, pbr.get("baseColorTexture"))
            same = (
                "SAME"
                if emissive_image is not None and emissive_image == base_image
                else ("diff" if emissive_image is not None else "-")
            )
            metal = pbr.get("metallicFactor", 1.0)
            rough = pbr.get("roughnessFactor", 1.0)
            lit = max(factor) > 0
            print(
                f"{name:26} {str(material.get('name', index))[:22]:22} "
                f"{str([round(v, 3) for v in factor]):>16} "
                f"{str(emissive_image) if emissive_image is not None else '-':>8} "
                f"{str(base_image) if base_image is not None else '-':>8} "
                f"{same:>6} {metal:>6} {rough:>6}  {material.get('alphaMode', 'OPAQUE')}"
                + ("   <== GLOWS" if lit and emissive_image is not None else "")
            )
            if lit and emissive_image is not None:
                size = None
                if emissive_image < len(images):
                    view = images[emissive_image].get("bufferView")
                    if view is not None:
                        size = document["bufferViews"][view]["byteLength"]
                suspects.append((name, index, same, size))
    if suspects:
        print(f"\n{len(suspects)} material(s) render light-independently:")
        for name, index, same, size in suspects:
            note = (
                "emissive texture IS the base colour: a whole body glowing, not a lamp"
                if same == "SAME"
                else "emissive texture differs from base colour: check whether it is a real light source"
            )
            mb = f"{size / 1048576:.2f}MB" if size else "?"
            print(f"  {name} material[{index}] ({mb}): {note}")
    else:
        print("\nno material renders light-independently.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
