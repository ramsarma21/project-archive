# Diagnose the normal-map glTF export bug: build a normal image several ways,
# export a tiny GLB, reimport, and print the normal image's mean pixel value.
# A correct tangent normal is mostly (0.5,0.5,1.0); mean ~0 means it exported BLACK.
# Run: blender --background --python test_normal_export.py -- <workdir>
import bpy, os, sys
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1 :]
WORK = os.path.abspath(argv[0]); os.makedirs(WORK, exist_ok=True)
N = 256

# a normal field with a little relief so it's not perfectly flat
h = np.zeros((N, N), np.float32)
h[::16, :] = 1.0
gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
nx, ny, nz = -gx * 2.0, -gy * 2.0, np.ones_like(h)
inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
NRM = np.stack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5], 2)  # (N,N,3)
print("source normal mean", NRM.reshape(-1, 3).mean(0))


def img_from(name, rgb):
    h_, w_ = rgb.shape[:2]
    rgba = np.concatenate([rgb, np.ones((h_, w_, 1))], 2)
    im = bpy.data.images.new(name, width=w_, height=h_, alpha=True)
    im.pixels.foreach_set(np.flipud(rgba).astype(np.float32).reshape(-1))
    return im


def method_generated_packed(name):
    im = img_from(name, NRM); im.colorspace_settings.name = "Non-Color"; im.pack()
    return im


def method_save_reload(name):
    im = img_from(name, NRM); im.colorspace_settings.name = "Non-Color"
    p = os.path.join(WORK, name + ".png"); im.filepath_raw = p; im.file_format = "PNG"; im.save()
    b = bpy.data.images.load(p); b.colorspace_settings.name = "Non-Color"; b.pack(); return b


def method_render_colormgmt_off(name):
    # save via save_render but with the display transform set to Raw so no bake
    im = img_from(name, NRM); im.colorspace_settings.name = "Non-Color"
    sc = bpy.context.scene
    old = sc.view_settings.view_transform
    try:
        sc.view_settings.view_transform = "Raw"
    except TypeError:
        sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGB"
    p = os.path.join(WORK, name + ".png"); im.save_render(p)
    sc.view_settings.view_transform = old
    b = bpy.data.images.load(p); b.colorspace_settings.name = "Non-Color"; b.pack(); return b


def method_file_nopack(name):
    im = img_from(name, NRM); im.colorspace_settings.name = "Non-Color"
    p = os.path.join(WORK, name + ".png"); im.filepath_raw = p; im.file_format = "PNG"; im.save()
    b = bpy.data.images.load(p); b.colorspace_settings.name = "Non-Color"  # file-backed, NOT packed
    return b


COLOR = np.zeros((N, N, 3), np.float32); COLOR[:] = (0.6, 0.3, 0.2)  # control base colour


def read_means():
    means = {}
    for im in bpy.data.images:
        if im.size[0] == 0 or im.name == "Render Result":
            continue
        buf = np.zeros(im.size[0] * im.size[1] * 4, np.float32)
        im.pixels.foreach_get(buf)
        means[im.name] = buf.reshape(-1, 4)[:, :3].mean(0)
    return means


def test(mk, label):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_plane_add(size=2)
    obj = bpy.context.active_object
    obj.data.uv_layers.new(name="UVMap")
    nimg = mk("nrm_" + label)
    cimg = img_from("col_" + label, COLOR)  # generated+packed control
    cimg.pack()
    mat = bpy.data.materials.new("m"); mat.use_nodes = True; nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    ctex = nt.nodes.new("ShaderNodeTexImage"); ctex.image = cimg
    nt.links.new(ctex.outputs["Color"], bsdf.inputs["Base Color"])
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = nimg
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    obj.data.materials.append(mat)
    out = os.path.join(WORK, f"t_{label}.glb")
    bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_image_format="AUTO")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=out)
    print(f"[{label}] reimported means:", {k: [round(float(x), 3) for x in v] for k, v in read_means().items()})


test(method_generated_packed, "generated_packed")
test(method_save_reload, "save_reload")
test(method_file_nopack, "file_nopack")
