"""
build_endurance.py - the Endurance (Interstellar) ring station for Mesh: the probe docks and sleeps on its hub.

Run (headless):
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python build_endurance.py
Options after `--`:
    --no-previews   skip the preview stills
    --no-sprites    skip the spin sprite sheet
    --only NAME     render just one preview (front|oblique|detail)

Builds the scene from an empty file, saves endurance.blend next to this script, renders previews into ./preview/
and the sprite sheet into ../../renderer/endurance/endurance_sheet.webp (+ endurance.json for the renderer).

Layout (as in the film's "forward view" diagram): 12 modules on a ring of radius 1, every 30 deg, joined by short
communicating tunnels through round ring-airlock knuckles; one spoke runs across the ring through the core docking
hub, which carries 2 Landers and 2 Rangers. Module types going round: habitat, landing pod, engine (the 3 white
nozzle discs), habitat ... - repeated so the station looks the same after half a turn (the sprite covers 180 deg).
Conventions: +Z = station axis (toward the camera in the front view), ring in the XY plane, module at +Y on top.
"""
import bpy, bmesh, math, os, sys, time, glob, json, random
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
PREVIEW_DIR = os.path.join(HERE, "preview")
SPRITE_DIR = os.path.join(REPO, "renderer", "endurance")
BLEND_PATH = os.path.join(HERE, "endurance.blend")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_PREVIEWS = "--no-previews" not in argv
DO_SPRITES = "--no-sprites" not in argv
ONLY = argv[argv.index("--only") + 1] if "--only" in argv else None

TAU = math.tau
RR = 1.0                                  # ring radius (module centres)
MW, MH, MD = 0.36, 0.30, 0.46             # module: tangential width, radial height, axial depth
FRAMES, SHEET_COLS, CELL = 48, 8, 320     # half a turn in 48 frames, 8 x 6 sheet of 320 px
ELEV = math.radians(32)                   # camera tilt off the axis (0 = straight down the axis)
t0 = time.time()


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c) + (1.0,)


WHITE, OFFWHITE, GREY, LGREY = srgb("#EDEDE8"), srgb("#DADBD5"), srgb("#8B9096"), srgb("#AEB2B6")
DARK, BLACKISH = srgb("#2A2D32"), srgb("#141619")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = scene.collection
root = bpy.data.objects.new("Endurance", None)
coll.objects.link(root)


def link(obj, parent=root):
    coll.objects.link(obj); obj.parent = parent; return obj


# ----------------------------------------------------------------------------- material helpers
def _nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    return nt, nt.nodes, nt.links


def sock(node, name, typ, out=False):
    for s in (node.outputs if out else node.inputs):
        if s.name == name and s.type == typ: return s
    raise KeyError(name)


def math_(N, L, op, a, b=None, clamp=False):
    m = N.new("ShaderNodeMath"); m.operation = op; m.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None: continue
        if isinstance(v, bpy.types.NodeSocket): L.new(v, m.inputs[i])
        else: m.inputs[i].default_value = v
    return m.outputs[0]


def mixc(N, L, fac, a, b, blend="MIX"):
    m = N.new("ShaderNodeMix"); m.data_type = "RGBA"; m.blend_type = blend
    for s, v in ((sock(m, "Factor", "VALUE"), fac), (sock(m, "A", "RGBA"), a), (sock(m, "B", "RGBA"), b)):
        if isinstance(v, bpy.types.NodeSocket): L.new(v, s)
        else: s.default_value = v
    return sock(m, "Result", "RGBA", True)


def ramp(N, L, inp, stops):
    r = N.new("ShaderNodeValToRGB"); L.new(inp, r.inputs[0])
    els = r.color_ramp.elements
    while len(els) > len(stops): els.remove(els[-1])
    while len(els) < len(stops): els.new(0.5)
    for e, (p, c) in zip(els, stops):
        e.position = p; e.color = c if len(c) == 4 else (c[0], c[0], c[0], 1)
    return r.outputs[0]


def hull_mat(name, color, rough=0.48, panel=4.5, dents=1.0, grime=0.35, wear=1.0, metallic=0.0):
    """Painted hull: panel seams (brick texture -> darker lines + bump), shallow dents (voronoi bump), streaky grime,
    AO dirt in the corners, edge wear (bevel-normal mask x noise) showing grey metal."""
    mat = bpy.data.materials.new(name)
    nt, N, L = _nodes(mat)
    out = N.new("ShaderNodeOutputMaterial"); b = N.new("ShaderNodeBsdfPrincipled"); L.new(b.outputs[0], out.inputs[0])
    tc = N.new("ShaderNodeTexCoord"); obj = tc.outputs["Object"]
    # panel seams
    br = N.new("ShaderNodeTexBrick"); L.new(obj, br.inputs["Vector"])
    br.inputs["Scale"].default_value = panel; br.inputs["Mortar Size"].default_value = 0.012
    br.inputs["Mortar Smooth"].default_value = 0.2; br.inputs["Bias"].default_value = 0.0
    br.offset = 0.5; br.squash = 1.6
    seam = br.outputs["Fac"]                               # 1 in the mortar (the seam)
    # big low-frequency grime + fine speckle
    n1 = N.new("ShaderNodeTexNoise"); L.new(obj, n1.inputs["Vector"]); n1.inputs["Scale"].default_value = 3.0; n1.inputs["Detail"].default_value = 6
    n2 = N.new("ShaderNodeTexNoise"); L.new(obj, n2.inputs["Vector"]); n2.inputs["Scale"].default_value = 40.0; n2.inputs["Detail"].default_value = 4
    # streaks along the axis (stretched noise)
    mp = N.new("ShaderNodeMapping"); L.new(obj, mp.inputs["Vector"]); mp.inputs["Scale"].default_value = (14, 14, 1.5)
    n3 = N.new("ShaderNodeTexNoise"); L.new(mp.outputs[0], n3.inputs["Vector"]); n3.inputs["Scale"].default_value = 2.0
    g = math_(N, L, "MULTIPLY", n1.outputs["Fac"], n3.outputs["Fac"])
    gr = ramp(N, L, g, [(0.18, (1.0,)), (0.42, (1 - 0.32 * grime,))])
    sp = ramp(N, L, n2.outputs["Fac"], [(0.35, (0.93,)), (0.65, (1.03,))])
    col = mixc(N, L, 1.0, color, gr, "MULTIPLY")
    col = mixc(N, L, 1.0, col, sp, "MULTIPLY")
    col = mixc(N, L, math_(N, L, "MULTIPLY", seam, 0.3), col, srgb("#5A5E64"))    # faint seams
    # AO dirt
    ao = N.new("ShaderNodeAmbientOcclusion"); ao.samples = 8; ao.inputs["Distance"].default_value = 0.05
    aor = ramp(N, L, ao.outputs["AO"], [(0.0, (1 - 0.6 * grime,)), (1.0, (1,))])
    col = mixc(N, L, 1.0, col, aor, "MULTIPLY")
    # edge wear
    bev = N.new("ShaderNodeBevel"); bev.samples = 6; bev.inputs["Radius"].default_value = 0.006
    geo = N.new("ShaderNodeNewGeometry")
    dot = N.new("ShaderNodeVectorMath"); dot.operation = "DOT_PRODUCT"
    L.new(bev.outputs[0], dot.inputs[0]); L.new(geo.outputs["Normal"], dot.inputs[1])
    edge = math_(N, L, "MULTIPLY", math_(N, L, "SUBTRACT", 1.0, dot.outputs["Value"]), 10.0 * wear)
    wmask = ramp(N, L, math_(N, L, "MULTIPLY", edge, math_(N, L, "MULTIPLY", n2.outputs["Fac"], 2.0)), [(0.45, (0,)), (0.6, (1,))])
    wsep = N.new("ShaderNodeSeparateColor"); L.new(wmask, wsep.inputs[0])
    col = mixc(N, L, wsep.outputs[0], col, GREY)
    L.new(col, b.inputs["Base Color"])
    b.inputs["Metallic"].default_value = metallic
    rr = math_(N, L, "MULTIPLY_ADD", n2.outputs["Fac"], 0.18); rr.node.inputs[2].default_value = rough - 0.09
    L.new(rr, b.inputs["Roughness"])
    # bump: seams sunk in, dents, fine hammering
    vo = N.new("ShaderNodeTexVoronoi"); L.new(obj, vo.inputs["Vector"]); vo.inputs["Scale"].default_value = 11.0
    dent = ramp(N, L, vo.outputs["Distance"], [(0.0, (0.0,)), (0.45, (1.0,))])
    ds = N.new("ShaderNodeSeparateColor"); L.new(dent, ds.inputs[0])
    h = math_(N, L, "ADD", math_(N, L, "MULTIPLY", ds.outputs[0], 0.5 * dents), math_(N, L, "MULTIPLY", n2.outputs["Fac"], 0.15))
    h = math_(N, L, "SUBTRACT", h, math_(N, L, "MULTIPLY", seam, 1.2))
    bm = N.new("ShaderNodeBump"); bm.inputs["Strength"].default_value = 0.22; bm.inputs["Distance"].default_value = 0.004
    L.new(h, bm.inputs["Height"]); L.new(bm.outputs[0], b.inputs["Normal"])
    return mat


def plain_mat(name, color, rough=0.4, metallic=0.0, coat=0.0, emit=None, estr=0.0):
    mat = bpy.data.materials.new(name)
    nt, N, L = _nodes(mat)
    out = N.new("ShaderNodeOutputMaterial"); b = N.new("ShaderNodeBsdfPrincipled"); L.new(b.outputs[0], out.inputs[0])
    tc = N.new("ShaderNodeTexCoord")
    n = N.new("ShaderNodeTexNoise"); L.new(tc.outputs["Object"], n.inputs["Vector"]); n.inputs["Scale"].default_value = 30
    v = ramp(N, L, n.outputs["Fac"], [(0.3, (0.85,)), (0.7, (1.08,))])
    L.new(mixc(N, L, 1.0, color, v, "MULTIPLY"), b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metallic
    if coat: b.inputs["Coat Weight"].default_value = coat; b.inputs["Coat Roughness"].default_value = 0.1
    if emit: b.inputs["Emission Color"].default_value = emit; b.inputs["Emission Strength"].default_value = estr
    return mat


def honeycomb_mat(name):
    """The Ranger's black heat-shield tiles: voronoi cells with light seams."""
    mat = bpy.data.materials.new(name)
    nt, N, L = _nodes(mat)
    out = N.new("ShaderNodeOutputMaterial"); b = N.new("ShaderNodeBsdfPrincipled"); L.new(b.outputs[0], out.inputs[0])
    tc = N.new("ShaderNodeTexCoord")
    vo = N.new("ShaderNodeTexVoronoi"); vo.feature = "DISTANCE_TO_EDGE"; L.new(tc.outputs["Object"], vo.inputs["Vector"])
    vo.inputs["Scale"].default_value = 70
    edge = ramp(N, L, vo.outputs["Distance"], [(0.0, (1.0,)), (0.05, (0.0,))])
    es = N.new("ShaderNodeSeparateColor"); L.new(edge, es.inputs[0])
    L.new(mixc(N, L, es.outputs[0], BLACKISH, srgb("#9A9EA4")), b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.35; b.inputs["Coat Weight"].default_value = 0.5
    bm = N.new("ShaderNodeBump"); bm.inputs["Strength"].default_value = 0.3; L.new(es.outputs[0], bm.inputs["Height"]); L.new(bm.outputs[0], b.inputs["Normal"])
    return mat


M_HULL = hull_mat("Hull", WHITE)
M_HULL2 = hull_mat("HullOff", OFFWHITE, panel=7.0, dents=1.3, grime=0.5)
M_GREY = hull_mat("GreyMetal", GREY, rough=0.38, metallic=0.6, panel=16.0, grime=0.6)
M_DARK = plain_mat("DarkPanel", DARK, rough=0.55)
M_LGREY = hull_mat("LightGrey", LGREY, rough=0.5, panel=12.0, grime=0.4)
M_BLACK = plain_mat("Black", BLACKISH, rough=0.3, coat=0.4)
M_GLASS = plain_mat("Window", srgb("#0B1118"), rough=0.06, coat=1.0, emit=srgb("#5A7896"), estr=0.06)
M_NOZZLE = plain_mat("NozzleGlow", srgb("#FFFFFF"), rough=0.3, emit=srgb("#FFFFFF"), estr=6.0)
M_HONEY = honeycomb_mat("Honeycomb")
M_RED = plain_mat("NavRed", srgb("#FF2A2A"), emit=srgb("#FF3B30"), estr=8.0)
M_GREEN = plain_mat("NavGreen", srgb("#2AFF6A"), emit=srgb("#34FF6E"), estr=8.0)


# ----------------------------------------------------------------------------- geometry helpers
def box(bm, c, s, R=None):
    M = Matrix.Translation(Vector(c)) @ ((R or Matrix()).to_4x4()) @ Matrix.Diagonal((*s, 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=M)


def cyl(bm, c, r, depth, R=None, segs=24, r2=None):
    M = Matrix.Translation(Vector(c)) @ ((R or Matrix()).to_4x4())
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth, matrix=M)


def ring(bm, c, r_in, r_out, depth, R=None, segs=28):
    M = Matrix.Translation(Vector(c)) @ ((R or Matrix()).to_4x4())
    vs = []
    for k in range(segs):
        a = TAU * k / segs; ca, sa = math.cos(a), math.sin(a)
        for rr, zz in ((r_out, depth / 2), (r_in, depth / 2), (r_out, -depth / 2), (r_in, -depth / 2)):
            vs.append(bm.verts.new(M @ Vector((rr * ca, rr * sa, zz))))
    for k in range(segs):
        k2 = (k + 1) % segs
        o_t, i_t, o_b, i_b = [vs[4 * k + j] for j in range(4)]
        O_t, I_t, O_b, I_b = [vs[4 * k2 + j] for j in range(4)]
        for f in ((o_t, O_t, I_t, i_t), (o_b, i_b, I_b, O_b), (o_t, o_b, O_b, O_t), (i_t, I_t, I_b, i_b)):
            bm.faces.new(f)


def finish(name, bm, mat, parent, bevel=0.003, segments=2, smooth_round=True):
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    if smooth_round:
        b2 = bmesh.new(); b2.from_mesh(me)
        for f in b2.faces:
            angs = [e.calc_face_angle(0.0) for e in f.edges if len(e.link_faces) == 2]
            f.smooth = len([a for a in angs if 0.01 < a < math.radians(25)]) >= 2 and len(f.verts) == 4
        b2.to_mesh(me); b2.free()
    o = bpy.data.objects.new(name, me); me.materials.append(mat); link(o, parent)
    if bevel:
        bv = o.modifiers.new("Bevel", "BEVEL"); bv.width = bevel; bv.segments = segments
        bv.limit_method = "ANGLE"; bv.angle_limit = math.radians(30)
    return o


class Parts:
    """One bmesh per material, flushed into objects under a parent empty."""
    def __init__(self, name, parent, M):
        self.name, self.parent = name, bpy.data.objects.new(name, None)
        coll.objects.link(self.parent); self.parent.parent = parent; self.parent.matrix_basis = M
        self.bms = {}

    def __getitem__(self, mat):
        return self.bms.setdefault(mat.name, (bmesh.new(), mat))[0]

    def done(self, bevels=None):
        for key, (bm, mat) in self.bms.items():
            if len(bm.verts): finish(f"{self.name}_{key}", bm, mat, self.parent, bevel=(bevels or {}).get(key, 0.003))
            else: bm.free()


def Rz(a): return Matrix.Rotation(a, 3, "Z")
def Rx(a): return Matrix.Rotation(a, 3, "X")
def Ry(a): return Matrix.Rotation(a, 3, "Y")


# ----------------------------------------------------------------------------- modules
# local frame: x = along the ring (tangential), y = radially outward, z = along the station axis (front = +z)
def face_greebles(P, rnd, cx, cy, w, h, z, n=10, out=1):
    """Small boxes / vents / pipes scattered on a face rectangle (in the face's x,y; z = the face plane)."""
    for _ in range(n):
        gw, gh = rnd.uniform(0.012, 0.05), rnd.uniform(0.01, 0.04)
        x = cx + rnd.uniform(-w / 2 + gw / 2, w / 2 - gw / 2); y = cy + rnd.uniform(-h / 2 + gh / 2, h / 2 - gh / 2)
        d = rnd.uniform(0.004, 0.018)
        box(P[rnd.choice([M_DARK, M_GREY, M_HULL2, M_DARK])], (x, y, z + out * d / 2), (gw, gh, d))


def window_grid(P, cx, cy, cols, rows, s, gap, z):
    for i in range(cols):
        for j in range(rows):
            x = cx + (i - (cols - 1) / 2) * (s + gap); y = cy + (j - (rows - 1) / 2) * (s + gap)
            box(P[M_GREY], (x, y, z + 0.003), (s + 0.008, s + 0.008, 0.006))
            box(P[M_GLASS], (x, y, z + 0.006), (s, s, 0.004))


def module(i, kind, phi, seed):
    rnd = random.Random(seed)
    M = Matrix.Translation((RR * math.cos(phi), RR * math.sin(phi), 0)) @ Rz(phi - math.pi / 2).to_4x4()
    P = Parts(f"Mod{i:02d}_{kind}", root, M)
    W, H, D = MW, MH, MD
    if kind == "pod": W, H, D = MW * 0.94, MH * 0.92, MD * 0.9
    box(P[M_HULL if kind != "pod" else M_HULL2], (0, 0, 0), (W, H, D))
    zf = D / 2
    # --- front face (+z): what the camera sees most
    if kind == "engine":
        box(P[M_LGREY], (0, 0, zf + 0.006), (W * 0.86, H * 0.84, 0.012))
        for k in range(3):                                    # the three nozzle discs in a cluster
            a = math.pi / 2 + k * TAU / 3
            c = (math.cos(a) * 0.058, math.sin(a) * 0.058 - 0.005)
            ring(P[M_GREY], (c[0], c[1], zf + 0.02), 0.05, 0.062, 0.028)
            cyl(P[M_BLACK], (c[0], c[1], zf + 0.012), 0.052, 0.012, segs=32)
            cyl(P[M_NOZZLE], (c[0], c[1], zf + 0.026), 0.046, 0.004, segs=32)
        face_greebles(P, rnd, 0, -H * 0.36, W * 0.8, H * 0.12, zf + 0.012, n=6)
    else:
        box(P[M_LGREY], (0, 0, zf + 0.004), (W * 0.84, H * 0.8, 0.008))
        for sx in (-1, 1):                                     # two raised panels, one carrying a window grid
            box(P[M_HULL], (sx * W * 0.2, H * 0.06, zf + 0.012), (W * 0.32, H * 0.56, 0.01))
        if kind == "hab":
            window_grid(P, -W * 0.2, H * 0.12, 2, 3, 0.024, 0.012, zf + 0.017)
        else:
            box(P[M_GREY], (W * 0.2, H * 0.08, zf + 0.02), (W * 0.22, H * 0.36, 0.008))
        face_greebles(P, rnd, 0, -H * 0.33, W * 0.78, H * 0.14, zf + 0.008, n=9)
    # --- outer face (+y): vertical strip panels and a window strip (habitats)
    yo = H / 2
    for k in range(4):
        x = -W * 0.36 + k * W * 0.24
        box(P[M_HULL2 if k % 2 else M_GREY], (x, yo + 0.005, rnd.uniform(-0.04, 0.04)), (W * 0.18, 0.01, D * rnd.uniform(0.55, 0.8)))
    if kind == "hab":
        for k in range(5): box(P[M_GLASS], (-W * 0.3 + k * W * 0.15, yo + 0.011, D * 0.3), (0.03, 0.004, 0.05))
    # --- inner face (-y, toward the hub): hatches, piping, small boxes
    yi = -H / 2
    box(P[M_LGREY], (0, yi - 0.004, 0), (W * 0.6, 0.008, D * 0.6))
    cyl(P[M_GREY], (0, yi - 0.012, -D * 0.15), 0.03, 0.01, Rx(math.pi / 2))
    for k in range(5):
        box(P[rnd.choice([M_GREY, M_HULL2, M_DARK])], (rnd.uniform(-W * 0.4, W * 0.4), yi - 0.01, rnd.uniform(-D * 0.4, D * 0.4)), (rnd.uniform(0.02, 0.06), 0.02, rnd.uniform(0.02, 0.07)))
    # --- sides (+-x): the tunnel port, a few boxes
    for sx in (-1, 1):
        xs = sx * W / 2
        cyl(P[M_GREY], (xs + sx * 0.008, 0, 0), 0.045, 0.016, Ry(math.pi / 2), segs=24)
        for k in range(3):
            box(P[rnd.choice([M_DARK, M_GREY])], (xs + sx * 0.006, rnd.uniform(-H * 0.4, H * 0.4), rnd.uniform(-D * 0.4, D * 0.4)), (0.012, rnd.uniform(0.02, 0.05), rnd.uniform(0.02, 0.08)))
    # --- back face (-z)
    box(P[M_DARK], (0, 0, -D / 2 - 0.004), (W * 0.7, H * 0.7, 0.008))
    face_greebles(P, rnd, 0, 0, W * 0.8, H * 0.8, -D / 2 - 0.008, n=6, out=-1)
    # (the blinking nav lights are drawn by the renderer: a red and a green one would break the half-turn loop)
    P.done({M_GLASS.name: 0.001, M_NOZZLE.name: 0})


# 12 modules, the film's layout; 180-degree symmetric so a half turn loops
KINDS = ["hab", "pod", "engine", "hab", "engine", "pod"] * 2
for i, kind in enumerate(KINDS):
    module(i, kind, math.pi / 2 - i * TAU / 12, 1000 + (i % 6) * 17)

# ----------------------------------------------------------------------------- ring airlocks + communicating tunnels
for i in range(12):
    phi = math.pi / 2 - (i + 0.5) * TAU / 12
    M = Matrix.Translation((RR * 0.985 * math.cos(phi), RR * 0.985 * math.sin(phi), 0)) @ Rz(phi - math.pi / 2).to_4x4()
    P = Parts(f"Lock{i:02d}", root, M)
    cyl(P[M_HULL], (0, 0, 0), 0.058, 0.17, segs=28)                               # the knuckle, axis along the station
    ring(P[M_GREY], (0, 0, 0.062), 0.05, 0.062, 0.022)                             # front collar
    cyl(P[M_DARK], (0, 0, 0.086), 0.04, 0.006, segs=28)                            # the round hatch
    cyl(P[M_GREY], (0, 0, 0.09), 0.012, 0.006, segs=16)
    ring(P[M_GREY], (0, 0, -0.062), 0.05, 0.062, 0.022)
    cyl(P[M_HULL2], (0, 0.05, 0), 0.026, 0.05, Rx(math.pi / 2), segs=16)          # small radial port
    for sx in (-1, 1):                                                             # tunnels to both neighbours
        cyl(P[M_HULL2], (sx * 0.075, 0, 0), 0.03, 0.06, Ry(math.pi / 2), segs=20)
        ring(P[M_GREY], (sx * 0.06, 0, 0), 0.03, 0.036, 0.012, Ry(math.pi / 2), segs=20)
    P.done({M_DARK.name: 0.001})

# ----------------------------------------------------------------------------- spoke + core docking hub
P = Parts("Spoke", root, Matrix())
for sy in (-1, 1):
    y = 0.17
    k = 0
    while y < RR - MH / 2 - 0.01:
        L = 0.07 if k % 3 else 0.11
        if k % 3 == 2:                                                             # a box segment
            box(P[M_HULL], (0, sy * (y + L / 2), 0), (0.1, L, 0.1))
            box(P[M_DARK], (0, sy * (y + L / 2), 0.052), (0.07, L * 0.7, 0.006))
        else:
            cyl(P[M_HULL2], (0, sy * (y + L / 2), 0), 0.042, L, Rx(math.pi / 2), segs=20)
        ring(P[M_GREY], (0, sy * (y + L), 0), 0.04, 0.055, 0.014, Rx(math.pi / 2), segs=20)
        y += L + 0.012; k += 1
hub_back, hub_front = -0.22, 0.3
cyl(P[M_HULL], (0, 0, (hub_back + hub_front) / 2), 0.13, hub_front - hub_back, segs=36)    # the hub drum, along the axis
for z in (-0.15, 0.0, 0.16): ring(P[M_GREY], (0, 0, z), 0.128, 0.145, 0.025, segs=36)
ring(P[M_GREY], (0, 0, hub_front + 0.005), 0.06, 0.1, 0.02, segs=36)                # docking collar (the probe sits here)
cyl(P[M_DARK], (0, 0, hub_front + 0.004), 0.06, 0.012, segs=36)
cyl(P[M_GREY], (0, 0, hub_front + 0.012), 0.03, 0.01, segs=24)
for a in range(8):
    aa = a * TAU / 8 + 0.2
    box(P[M_DARK], (math.cos(aa) * 0.133, math.sin(aa) * 0.133, 0.07), (0.03, 0.03, 0.08), Rz(aa))
P.done({M_DARK.name: 0.001})


def lander(name, ang):
    """Chunky angular lander, docked against the hub."""
    M = Rz(ang).to_4x4() @ Matrix.Translation((0.3, 0, 0.03))
    P = Parts(name, root, M)
    bm = P[M_HULL2]
    box(bm, (0, 0, 0), (0.2, 0.16, 0.2))
    box(P[M_HULL], (0.08, 0, 0), (0.08, 0.2, 0.16))
    box(P[M_DARK], (-0.02, 0, 0.104), (0.14, 0.11, 0.008))
    box(P[M_GLASS], (0.07, 0, 0.1), (0.05, 0.08, 0.01))
    for sy in (-1, 1):
        box(P[M_GREY], (0, sy * 0.09, -0.02), (0.16, 0.02, 0.12))
        cyl(P[M_DARK], (-0.05, sy * 0.1, 0.05), 0.02, 0.02, Rx(math.pi / 2), segs=14)
    box(P[M_GREY], (-0.125, 0, 0), (0.05, 0.08, 0.08))                        # docking adapter
    P.done({M_HULL2.name: 0.012, M_HULL.name: 0.01})


def ranger(name, ang):
    """The Ranger: a sleek black arrowhead with a white back, docked nose-out."""
    M = Rz(ang).to_4x4() @ Matrix.Translation((0.32, 0, 0.04))
    P = Parts(name, root, M)
    bm = P[M_HONEY]
    pts = [(0.2, 0, 0), (-0.08, 0.11, 0), (-0.14, 0.09, 0), (-0.14, -0.09, 0), (-0.08, -0.11, 0)]
    top = [bm.verts.new((x, y, 0.035 if i else 0.012)) for i, (x, y, _) in enumerate(pts)]
    bot = [bm.verts.new((x, y, -0.03 if i else -0.01)) for i, (x, y, _) in enumerate(pts)]
    bm.faces.new(top); bm.faces.new(bot[::-1])
    for k in range(5):
        k2 = (k + 1) % 5; bm.faces.new((top[k], bot[k], bot[k2], top[k2]))
    box(P[M_HULL], (-0.05, 0, 0.045), (0.12, 0.12, 0.02))                     # white spine
    box(P[M_GLASS], (0.06, 0, 0.032), (0.05, 0.05, 0.012))
    cyl(P[M_GREY], (-0.155, 0.05, 0), 0.022, 0.03, Ry(math.pi / 2), segs=14)   # engines
    cyl(P[M_GREY], (-0.155, -0.05, 0), 0.022, 0.03, Ry(math.pi / 2), segs=14)
    P.done({M_HONEY.name: 0.004})


lander("LanderA", math.radians(45)); lander("LanderB", math.radians(225))
ranger("RangerA", math.radians(135)); ranger("RangerB", math.radians(315))
print(f"[endurance] built in {time.time() - t0:.1f}s, {len([o for o in bpy.data.objects if o.type == 'MESH'])} meshes")

# ----------------------------------------------------------------------------- world, lights, camera
world = bpy.data.worlds.new("Space"); scene.world = world
nt, N, L = _nodes(world)
wo = N.new("ShaderNodeOutputWorld"); bg = N.new("ShaderNodeBackground")
bg.inputs["Color"].default_value = (0.03, 0.032, 0.045, 1); bg.inputs["Strength"].default_value = 1.0
L.new(bg.outputs[0], wo.inputs[0])

target = bpy.data.objects.new("Target", None); coll.objects.link(target)
cam_d = bpy.data.cameras.new("Cam"); cam_d.type = "ORTHO"
cam = bpy.data.objects.new("Cam", cam_d); coll.objects.link(cam); scene.camera = cam
tr = cam.constraints.new("TRACK_TO"); tr.target = target; tr.track_axis = "TRACK_NEGATIVE_Z"; tr.up_axis = "UP_Y"
CAM_DIST = 10.0


def place_camera(d, ortho):
    cam.location = Vector(d).normalized() * CAM_DIST; cam_d.ortho_scale = ortho


def sun(name, d, energy, color, angle=0.6):
    ld = bpy.data.lights.new(name, "SUN"); ld.energy = energy; ld.color = color; ld.angle = math.radians(angle)
    o = bpy.data.objects.new(name, ld); coll.objects.link(o)
    o.rotation_euler = Vector(d).normalized().to_track_quat("Z", "Y").to_euler()
    return o


# the film look: one hard sun (deep shadows between the modules), a dim cool bounce, a thin rim from behind
sun("Key", (-0.75, 0.45, 0.45), 7.0, (1.0, 0.97, 0.92), 0.5)
sun("Fill", (0.7, -0.5, 0.3), 0.5, (0.72, 0.8, 1.0), 4)
sun("Rim", (0.4, 0.8, -0.6), 1.6, (0.8, 0.88, 1.0), 2)

scene.render.engine = "CYCLES"
cy = scene.cycles
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for dv in prefs.devices: dv.use = (dv.type == "METAL")
    cy.device = "GPU"
except Exception as e:
    print("[endurance] GPU setup failed, CPU:", e)
cy.use_adaptive_sampling = True; cy.use_denoising = True
cy.max_bounces = 6; cy.glossy_bounces = 3; cy.diffuse_bounces = 3
scene.render.film_transparent = True
scene.render.use_persistent_data = True
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Base Contrast"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.render.image_settings.compression = 100


def render_to(path):
    scene.render.filepath = path; bpy.ops.render.render(write_still=True)


os.makedirs(PREVIEW_DIR, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

pts = [o.matrix_world @ Vector(c) for o in bpy.data.objects if o.type == "MESH" for c in o.bound_box]
rh = max(math.hypot(p.x, p.y) for p in pts); zh = max(abs(p.z) for p in pts)
FRONT = (0, -math.sin(ELEV), math.cos(ELEV))
ORTHO = 2 * (rh + 0.04)

stats = {}
if DO_PREVIEWS:
    t1 = time.time()
    scene.render.resolution_x = scene.render.resolution_y = int(argv[argv.index("--res") + 1]) if "--res" in argv else 1024
    cy.samples = 128; cy.adaptive_threshold = 0.02
    views = {"front": (FRONT, ORTHO), "oblique": ((0.55, -0.45, 0.7), ORTHO * 1.02), "detail": ((0.25, -0.35, 0.9), 1.1)}
    for name, (d, sc) in views.items():
        if ONLY and name != ONLY: continue
        if name == "detail": target.location = (0.55, 0.55, 0)
        place_camera(Vector(d) + target.location / CAM_DIST, sc)
        render_to(os.path.join(PREVIEW_DIR, name + ".png"))
        target.location = (0, 0, 0)
    stats["previews"] = time.time() - t1

if DO_SPRITES and not ONLY:
    t2 = time.time()
    os.makedirs(SPRITE_DIR, exist_ok=True)
    S = CELL
    scene.render.resolution_x = scene.render.resolution_y = S
    cy.samples = 64; cy.adaptive_threshold = 0.03
    place_camera(FRONT, ORTHO)
    for f in range(FRAMES):                                   # clockwise as seen from the front, half a turn
        root.rotation_euler = (0, 0, -math.pi * f / FRAMES)
        render_to(os.path.join(SPRITE_DIR, f"frame_{f:03d}.png"))
    root.rotation_euler = (0, 0, 0)
    stats["sprites"] = time.time() - t2
    cols, rows = SHEET_COLS, FRAMES // SHEET_COLS
    sheet = np.zeros((rows * S, cols * S, 4), np.float32)
    for f in range(FRAMES):
        p = os.path.join(SPRITE_DIR, f"frame_{f:03d}.png")
        im = bpy.data.images.load(p)
        px = np.empty(S * S * 4, np.float32); im.pixels.foreach_get(px)
        c, r = f % cols, f // cols
        y0 = (rows - 1 - r) * S
        sheet[y0:y0 + S, c * S:(c + 1) * S] = px.reshape(S, S, 4)
        bpy.data.images.remove(im)
    out = bpy.data.images.new("endurance_sheet", cols * S, rows * S, alpha=True)
    out.alpha_mode = "STRAIGHT"; out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = os.path.join(SPRITE_DIR, "endurance_sheet.png"); out.file_format = "PNG"; out.save()
    for p in glob.glob(os.path.join(SPRITE_DIR, "frame_*.png")): os.remove(p)
    # ship it as WebP (~1 MB instead of ~7): the iPhone loads it over Tailscale
    import subprocess, shutil
    cw = shutil.which("cwebp") or "/opt/homebrew/bin/cwebp"
    png = out.filepath_raw
    if os.path.exists(cw) and subprocess.run([cw, "-q", "88", "-alpha_q", "100", "-m", "6", "-quiet", png, "-o", png[:-4] + ".webp"]).returncode == 0:
        os.remove(png); print(f"[endurance] webp {os.path.getsize(png[:-4] + '.webp') / 1e6:.2f} MB")
    # what the renderer needs to place things on the sprite (nav lights, the docking port)
    meta = {"frames": FRAMES, "cols": cols, "cell": S, "turn": 180, "ortho": ORTHO, "ringR": RR, "elev": math.degrees(ELEV),
            "hubFront": hub_front, "navLights": [{"module": 3, "color": "green"}, {"module": 9, "color": "red"}]}
    with open(os.path.join(SPRITE_DIR, "endurance.json"), "w") as fh: json.dump(meta, fh, indent=1)
    print(f"[endurance] sheet {os.path.getsize(out.filepath_raw) / 1e6:.2f} MB, ortho {ORTHO:.3f}")

print("[endurance] timings:", {k: round(v, 1) for k, v in stats.items()}, "total", round(time.time() - t0, 1))
