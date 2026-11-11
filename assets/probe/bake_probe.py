"""
bake_probe.py - the probe as a real-time 3-D model for the Endurance's build bay (Mesh rebuilds a lost probe).

Run (headless, after build_probe.py):
    /Applications/Blender.app/Contents/MacOS/Blender -b probe.blend --python bake_probe.py
Options after `--`:  --size N   bake resolution (default 2048)

Unlike the Endurance (one joined mesh), the parts stay separate so they can be assembled one by one: every part is
converted (modifiers and the shell's boolean cuts applied), unwrapped together into ONE shared atlas, and Cycles bakes
albedo (incl. the AO grime and edge wear), tangent-space normals, roughness and emission into it. The parts are then
grouped under empties named G_<assembly> — shell, face, jaw, bracketL/R, podL/R, clamp, engine — which is what the
app's assembly animation moves. Exported as ../../renderer/probe/probe.glb (Draco mesh, WebP textures).
glTF is +Y up: the probe's face (Blender -Y) looks toward +Z, its left side (+X) stays +X.
"""
import bpy, bmesh, math, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "renderer", "probe", "probe.glb"))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SIZE = int(argv[argv.index("--size") + 1]) if "--size" in argv else 2048
t0 = time.time()
scene = bpy.context.scene


def group_of(name):
    side = "L" if name.endswith("+1") else "R" if name.endswith("-1") else ""
    if name.startswith(("Face", "Eye", "LED")): return "face"
    if name.startswith("Jaw"): return "jaw"
    if name.startswith("Pod"): return "pod" + side
    if name.startswith(("Bracket", "Fin", "Handle", "Port+", "Port-", "PortCap", "PortHole")): return "bracket" + side
    if name.startswith("Clamp"): return "clamp"
    if name.startswith("Engine"): return "engine"
    return "shell"


# ---- 1. apply modifiers (incl. the boolean cuts), drop the cutters, flatten the hierarchy
bpy.ops.object.select_all(action="DESELECT")
cutters = [o for o in bpy.data.objects if o.type == "MESH" and not o.data.materials]
parts = [o for o in bpy.data.objects if o.type == "MESH" and o.data.materials]
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.convert(target="MESH")
for c in cutters: bpy.data.objects.remove(c, do_unlink=True)
parts = [o for o in bpy.data.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o.type != "MESH": bpy.data.objects.remove(o, do_unlink=True)
print(f"[probe-bake] {len(parts)} parts, {sum(len(o.data.polygons) for o in parts)} faces")

# ---- 2. one shared atlas for all parts (multi-object edit packs every part's islands together)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, scale_to_bounds=True)
bpy.ops.uv.pack_islands(margin=0.002, rotate=True)
bpy.ops.object.mode_set(mode="OBJECT")


def img(name, size, noncolor=False):
    im = bpy.data.images.new(name, size, size, alpha=False)
    if noncolor: im.colorspace_settings.name = "Non-Color"
    return im


IM = {"albedo": img("Probe_albedo", SIZE), "normal": img("Probe_normal", SIZE, True),
      "rough": img("Probe_rough", SIZE // 2, True), "emit": img("Probe_emit", SIZE // 2)}
mats = {m for o in parts for m in o.data.materials if m}


def set_target(im):
    for m in mats:
        nt = m.node_tree
        n = nt.nodes.get("BakeTarget") or nt.nodes.new("ShaderNodeTexImage")
        n.name = "BakeTarget"; n.image = im; n.select = True; nt.nodes.active = n


scene.render.engine = "CYCLES"
cy = scene.cycles
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for dv in prefs.devices: dv.use = (dv.type == "METAL")
    cy.device = "GPU"
except Exception as e:
    print("[probe-bake] GPU setup failed:", e)
cy.samples = 32
bk = scene.render.bake; bk.margin = 6; bk.use_clear = True
for key, kind, extra in (("albedo", "DIFFUSE", {"pass_filter": {"COLOR"}}), ("normal", "NORMAL", {"normal_space": "TANGENT"}),
                         ("rough", "ROUGHNESS", {}), ("emit", "EMIT", {})):
    ts = time.time(); set_target(IM[key])
    bpy.ops.object.bake(type=kind, **extra)
    print(f"[probe-bake] {key}: {time.time() - ts:.1f}s")

# ---- 3. one material with the baked maps; the parts grouped for assembly
mat = bpy.data.materials.new("ProbeBaked"); mat.use_nodes = True
N, L = mat.node_tree.nodes, mat.node_tree.links
b = N.get("Principled BSDF")
def tex(im):
    n = N.new("ShaderNodeTexImage"); n.image = im; return n
L.new(tex(IM["albedo"]).outputs["Color"], b.inputs["Base Color"])
L.new(tex(IM["rough"]).outputs["Color"], b.inputs["Roughness"])
nm = N.new("ShaderNodeNormalMap"); L.new(tex(IM["normal"]).outputs["Color"], nm.inputs["Color"]); L.new(nm.outputs["Normal"], b.inputs["Normal"])
L.new(tex(IM["emit"]).outputs["Color"], b.inputs["Emission Color"]); b.inputs["Emission Strength"].default_value = 3.0
b.inputs["Metallic"].default_value = 0.25
groups = {}
for o in parts:
    o.data.materials.clear(); o.data.materials.append(mat)
    g = group_of(o.name)
    if g not in groups:
        e = bpy.data.objects.new("G_" + g, None); scene.collection.objects.link(e); groups[g] = e
    o.parent = groups[g]
print("[probe-bake] groups:", {g: len([o for o in parts if o.parent is e]) for g, e in groups.items()})

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=False, export_yup=True, export_apply=True,
                          export_image_format="WEBP", export_image_quality=86, export_texcoords=True, export_normals=True,
                          export_tangents=False, export_materials="EXPORT",
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                          export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12,
                          export_cameras=False, export_lights=False)
print(f"[probe-bake] {OUT}: {os.path.getsize(OUT) / 1e6:.2f} MB, total {time.time() - t0:.1f}s")
