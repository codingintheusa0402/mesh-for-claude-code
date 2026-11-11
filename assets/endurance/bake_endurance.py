"""
bake_endurance.py - turns endurance.blend (built by build_endurance.py) into a real-time 3-D model for Mesh.

Run (headless, after build_endurance.py):
    /Applications/Blender.app/Contents/MacOS/Blender -b endurance.blend --python bake_endurance.py
Options after `--`:  --size N   bake resolution (default 2048)

The procedural materials (panel seams, dents, streaky grime, AO dirt, worn edges, windows, nozzle glow) can't travel
in a glTF file, so they're baked: every part is joined into one mesh, unwrapped, and Cycles bakes albedo (colour incl.
the AO grime), a tangent-space normal map (seams + dents + hammering), roughness and emission into texture atlases.
The result is exported as ../../renderer/endurance/endurance.glb (Draco-compressed mesh, WebP textures), lit live in the app by three.js.
glTF is +Y up: the station axis (Blender +Z) becomes +Y, the top module (Blender +Y) becomes -Z.
"""
import bpy, bmesh, math, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "renderer", "endurance", "endurance.glb"))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SIZE = int(argv[argv.index("--size") + 1]) if "--size" in argv else 2048
t0 = time.time()
scene = bpy.context.scene

# ---- 1. one mesh: modifiers applied, world transforms baked in
bpy.ops.object.select_all(action="DESELECT")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
for o in meshes:                                              # one bevel segment is plenty at app size (half the vertices)
    for m in o.modifiers:
        if m.type == "BEVEL": m.segments = 1
bpy.ops.object.convert(target="MESH")
bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
ob.name = "Endurance"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5); bm.to_mesh(ob.data); bm.free()
me = ob.data
me.polygons.foreach_set("use_smooth", [p.use_smooth for p in me.polygons])
print(f"[bake] joined: {len(me.polygons)} faces, {len(me.materials)} materials")

# ---- 2. unwrap into one atlas
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, scale_to_bounds=True)
bpy.ops.uv.pack_islands(margin=0.002, rotate=True)
bpy.ops.object.mode_set(mode="OBJECT")

# ---- 3. bake targets
def img(name, size, noncolor=False, alpha=False):
    im = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=False)
    if noncolor: im.colorspace_settings.name = "Non-Color"
    return im

IM = {"albedo": img("End_albedo", SIZE), "normal": img("End_normal", SIZE, True),
      "rough": img("End_rough", SIZE // 2, True), "emit": img("End_emit", SIZE // 2)}

def set_target(im):
    for m in me.materials:
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
    print("[bake] GPU setup failed:", e)
cy.samples = 32
bk = scene.render.bake
bk.margin = 6; bk.use_clear = True
ob.select_set(True); bpy.context.view_layer.objects.active = ob

for key, kind, extra in (("albedo", "DIFFUSE", {"pass_filter": {"COLOR"}}), ("normal", "NORMAL", {"normal_space": "TANGENT"}),
                         ("rough", "ROUGHNESS", {}), ("emit", "EMIT", {})):
    ts = time.time(); set_target(IM[key])
    bpy.ops.object.bake(type=kind, **extra)
    print(f"[bake] {key}: {time.time() - ts:.1f}s")
    IM[key].filepath_raw = os.path.join(HERE, "preview", f"bake_{key}.png"); IM[key].file_format = "PNG"; IM[key].save()

# ---- 4. one plain material carrying the baked maps, then export
mat = bpy.data.materials.new("EnduranceBaked"); mat.use_nodes = True
nt = mat.node_tree; N, L = nt.nodes, nt.links
b = N.get("Principled BSDF")
def tex(im):
    n = N.new("ShaderNodeTexImage"); n.image = im; return n
L.new(tex(IM["albedo"]).outputs["Color"], b.inputs["Base Color"])
r = tex(IM["rough"]); L.new(r.outputs["Color"], b.inputs["Roughness"])
nm = N.new("ShaderNodeNormalMap"); L.new(tex(IM["normal"]).outputs["Color"], nm.inputs["Color"]); L.new(nm.outputs["Normal"], b.inputs["Normal"])
L.new(tex(IM["emit"]).outputs["Color"], b.inputs["Emission Color"]); b.inputs["Emission Strength"].default_value = 3.0
b.inputs["Metallic"].default_value = 0.12
me.materials.clear(); me.materials.append(mat)
for p in me.polygons: p.material_index = 0

for o in list(bpy.data.objects):
    if o is not ob: bpy.data.objects.remove(o, do_unlink=True)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=False, export_yup=True, export_apply=True,
                          export_image_format="WEBP", export_image_quality=86, export_texcoords=True, export_normals=True,
                          export_tangents=False, export_materials="EXPORT",
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                          export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12, export_cameras=False, export_lights=False)
print(f"[bake] {OUT}: {os.path.getsize(OUT) / 1e6:.2f} MB, total {time.time() - t0:.1f}s")
