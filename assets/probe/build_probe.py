"""
build_probe.py - procedural sci-fi "probe" droid for Mesh.

Run (headless):
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python build_probe.py
Options after `--`:
    --no-previews   skip the 5 preview stills
    --no-sprites    skip the 96-frame yaw sprite sheet (12 x 8 cells of 192 px)
    --only NAME     render just one preview (front_3q|side_left|side_right|rear|bottom)

Builds the whole scene from an empty file, saves probe.blend next to this script,
renders previews into ./preview/ and the sprite sheet into ../../renderer/probe/probe_sheet.png.

Conventions: +Z up, the face (orange eye) looks toward -Y, robot's left side = +X.
Sphere radius 0.5.
"""
import bpy, bmesh, math, os, sys, time, glob
import numpy as np
from mathutils import Vector, Matrix, Euler, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
PREVIEW_DIR = os.path.join(HERE, "preview")
SPRITE_DIR = os.path.join(REPO, "renderer", "probe")
BLEND_PATH = os.path.join(HERE, "probe.blend")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_PREVIEWS = "--no-previews" not in argv
DO_SPRITES = "--no-sprites" not in argv
ONLY = argv[argv.index("--only") + 1] if "--only" in argv else None

R = 0.5
FRAMES, SHEET_COLS = 96, 12   # sprite sheet: 96 yaw frames, 12 columns x 8 rows
TAU = math.tau


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c) + (1.0,)


BLUE_HEX, RED_HEX, YEL_HEX, GUN_HEX = "#2E9FD8", "#E3342B", "#F2C318", "#2A2D31"
BLUE_PAINT_HEX = "#1496DC"   # authored a bit more saturated than #2E9FD8 to survive AgX
DARK_SHELL_HEX = "#333B45"
BLUE, RED, YELLOW, GUN = srgb(BLUE_HEX), srgb(RED_HEX), srgb(YEL_HEX), srgb(GUN_HEX)
CHROME, SILVER = srgb("#B8BCC0"), srgb("#9EA3A8")
CYAN, ORANGE, ENGINE = srgb("#6FE6FF"), srgb("#FF9A1F"), srgb("#BFEFFF")

# ----------------------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = scene.collection

root = bpy.data.objects.new("Probe", None)
coll.objects.link(root)


def link(obj, parent=root):
    coll.objects.link(obj)
    obj.parent = parent
    return obj


# ----------------------------------------------------------------------------- materials
def _nodes(mat):
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return nt, nt.nodes, nt.links


def sock(node, name, typ, out=False):
    for s in (node.outputs if out else node.inputs):
        if s.name == name and s.type == typ:
            return s
    raise KeyError(name)


def mixc(N, L, fac, a, b):
    m = N.new("ShaderNodeMix"); m.data_type = "RGBA"
    for s, v in ((sock(m, "Factor", "VALUE"), fac), (sock(m, "A", "RGBA"), a), (sock(m, "B", "RGBA"), b)):
        if isinstance(v, bpy.types.NodeSocket): L.new(v, s)
        else: s.default_value = v
    return sock(m, "Result", "RGBA", True)


def mixf(N, L, fac, a, b):
    m = N.new("ShaderNodeMix"); m.data_type = "FLOAT"
    for s, v in ((sock(m, "Factor", "VALUE"), fac), (sock(m, "A", "VALUE"), a), (sock(m, "B", "VALUE"), b)):
        if isinstance(v, bpy.types.NodeSocket): L.new(v, s)
        else: s.default_value = v
    return sock(m, "Result", "VALUE", True)


def math_(N, L, op, a, b=None, clamp=False):
    m = N.new("ShaderNodeMath"); m.operation = op; m.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None: continue
        if isinstance(v, bpy.types.NodeSocket): L.new(v, m.inputs[i])
        else: m.inputs[i].default_value = v
    return m.outputs[0]


def ramp(N, L, inp, stops):
    r = N.new("ShaderNodeValToRGB")
    L.new(inp, r.inputs[0])
    els = r.color_ramp.elements
    while len(els) > len(stops):
        els.remove(els[-1])
    while len(els) < len(stops):
        els.new(0.5)
    for e, (p, c) in zip(els, stops):
        e.position = p
        e.color = c if len(c) == 4 else (c[0], c[0], c[0], 1)
    return r


def worn_mat(name, color, rough=0.36, metallic=0.0, wear=1.0, grime=0.45, wear_col=SILVER,
             base_socket_fn=None, extra_wear_fn=None, normal_fn=None, coat=0.0, noise_scale=16.0):
    """Principled paint with procedural edge-wear (bevel-normal mask x noise) and AO grime."""
    mat = bpy.data.materials.new(name)
    nt, N, L = _nodes(mat)
    out = N.new("ShaderNodeOutputMaterial")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    L.new(bsdf.outputs[0], out.inputs[0])
    tc = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = noise_scale
    noise.inputs["Detail"].default_value = 8
    noise.inputs["Roughness"].default_value = 0.7
    L.new(tc.outputs["Object"], noise.inputs["Vector"])
    # edge mask
    bev = N.new("ShaderNodeBevel"); bev.samples = 6
    bev.inputs["Radius"].default_value = 0.012
    geo = N.new("ShaderNodeNewGeometry")
    dot = N.new("ShaderNodeVectorMath"); dot.operation = "DOT_PRODUCT"
    L.new(bev.outputs[0], dot.inputs[0]); L.new(geo.outputs["Normal"], dot.inputs[1])
    edge = math_(N, L, "SUBTRACT", 1.0, dot.outputs["Value"])
    edge = math_(N, L, "MULTIPLY", edge, 9.0 * wear)
    nf = math_(N, L, "MULTIPLY", noise.outputs["Fac"], 2.0)
    t = math_(N, L, "MULTIPLY", edge, nf)
    wear_ramp = ramp(N, L, t, [(0.45, (0,)), (0.6, (1,))])
    wmask = wear_ramp.outputs[0]
    if extra_wear_fn:
        wmask = math_(N, L, "MAXIMUM", wmask, extra_wear_fn(N, L, tc))
    base = base_socket_fn(N, L, tc) if base_socket_fn else color
    # subtle hand-painted value variation
    var = ramp(N, L, noise.outputs["Fac"], [(0.3, (0.82,)), (0.7, (1.05,))])
    tint = N.new("ShaderNodeMix"); tint.data_type = "RGBA"; tint.blend_type = "MULTIPLY"
    sock(tint, "Factor", "VALUE").default_value = 1.0
    if isinstance(base, bpy.types.NodeSocket): L.new(base, sock(tint, "A", "RGBA"))
    else: sock(tint, "A", "RGBA").default_value = base
    L.new(var.outputs[0], sock(tint, "B", "RGBA"))
    col = mixc(N, L, wmask, sock(tint, "Result", "RGBA", True), wear_col)
    # AO grime
    ao = N.new("ShaderNodeAmbientOcclusion"); ao.samples = 8
    ao.inputs["Distance"].default_value = 0.06
    aor = ramp(N, L, ao.outputs["AO"], [(0.0, (1 - grime,)), (1.0, (1,))])
    mul = N.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"
    sock(mul, "Factor", "VALUE").default_value = 1.0
    L.new(col, sock(mul, "A", "RGBA")); L.new(aor.outputs[0], sock(mul, "B", "RGBA"))
    L.new(sock(mul, "Result", "RGBA", True), bsdf.inputs["Base Color"])
    L.new(mixf(N, L, wmask, metallic, 1.0), bsdf.inputs["Metallic"])
    rr = math_(N, L, "MULTIPLY_ADD", noise.outputs["Fac"], 0.15)
    rr.node.inputs[2].default_value = rough - 0.07
    L.new(mixf(N, L, wmask, rr, 0.3), bsdf.inputs["Roughness"])
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.15
    if normal_fn:
        L.new(normal_fn(N, L, tc), bsdf.inputs["Normal"])
    return mat


def chrome_mat(name, color=CHROME, rough=0.17):
    mat = bpy.data.materials.new(name)
    nt, N, L = _nodes(mat)
    out = N.new("ShaderNodeOutputMaterial"); bsdf = N.new("ShaderNodeBsdfPrincipled")
    L.new(bsdf.outputs[0], out.inputs[0])
    tc = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 30
    L.new(tc.outputs["Object"], noise.inputs["Vector"])
    ao = N.new("ShaderNodeAmbientOcclusion"); ao.inputs["Distance"].default_value = 0.05
    aor = ramp(N, L, ao.outputs["AO"], [(0.0, (0.5,)), (1.0, (1,))])
    m = N.new("ShaderNodeMix"); m.data_type = "RGBA"; m.blend_type = "MULTIPLY"
    sock(m, "Factor", "VALUE").default_value = 1.0
    sock(m, "A", "RGBA").default_value = color
    L.new(aor.outputs[0], sock(m, "B", "RGBA"))
    L.new(sock(m, "Result", "RGBA", True), bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = 1.0
    rr = math_(N, L, "MULTIPLY_ADD", noise.outputs["Fac"], 0.12)
    rr.node.inputs[2].default_value = rough - 0.06
    L.new(rr, bsdf.inputs["Roughness"])
    return mat


def emit_mat(name, color, strength):
    mat = bpy.data.materials.new(name)
    nt, N, L = _nodes(mat)
    out = N.new("ShaderNodeOutputMaterial"); em = N.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color; em.inputs["Strength"].default_value = strength
    L.new(em.outputs[0], out.inputs[0])
    return mat


def glossy_dark(name, color=(0.012, 0.014, 0.018, 1), rough=0.12):
    mat = bpy.data.materials.new(name)
    nt, N, L = _nodes(mat)
    out = N.new("ShaderNodeOutputMaterial"); b = N.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = color; b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = 1.0
    L.new(b.outputs[0], out.inputs[0])
    return mat


def hazard_mat(name, freq=26.0):
    def base(N, L, tc):
        sep = N.new("ShaderNodeSeparateXYZ"); L.new(tc.outputs["Object"], sep.inputs[0])
        s = math_(N, L, "ADD", sep.outputs[0], sep.outputs[1])
        s = math_(N, L, "ADD", s, sep.outputs[2])
        s = math_(N, L, "MULTIPLY", s, freq)
        s = math_(N, L, "FRACT", s)
        st = math_(N, L, "GREATER_THAN", s, 0.5)
        return mixc(N, L, st, YELLOW, srgb("#1A1A1C"))
    return worn_mat(name, YELLOW, rough=0.42, base_socket_fn=base, wear=1.2)


# ----------------------------------------------------------------------------- shell texture (numpy)
def vnoise(H, W, cy, cx, seed, octaves=4):
    rng = np.random.default_rng(seed)
    acc = np.zeros((H, W)); amp = 1.0; tot = 0
    for o in range(octaves):
        gy, gx = cy * 2 ** o, cx * 2 ** o
        g = rng.random((gy + 1, gx + 1))
        g[:, -1] = g[:, 0]  # wrap horizontally
        ys = np.linspace(0, gy, H, endpoint=False); xs = np.linspace(0, gx, W, endpoint=False)
        y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
        fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
        fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
        a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
        acc += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy)
        tot += amp; amp *= 0.5
    return acc / tot


def tangent_frame(c):
    c = np.asarray(c, float); c = c / np.linalg.norm(c)
    up = np.array([0, 0, 1.0])
    e1 = np.cross(up, c); e1 /= np.linalg.norm(e1)
    e2 = np.cross(c, e1)
    return c, e1, e2


BRACKET_LIGHTS = [(0.76, -0.62, 0.02), (0.80, -0.50, -0.22)]


def make_shell_textures(W=2048, H=1024):
    u = (np.arange(W) + 0.5) / W; v = (np.arange(H) + 0.5) / H
    LON, LAT = np.meshgrid((u - 0.5) * TAU, (v - 0.5) * math.pi)
    x = np.cos(LAT) * np.sin(LON); y = -np.cos(LAT) * np.cos(LON); z = np.sin(LAT)
    ax = np.abs(x)
    angF = np.arccos(np.clip(-y, -1, 1)); angB = np.arccos(np.clip(y, -1, 1))
    hexc = lambda h: np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    rad = math.radians
    # paint is authored slightly more saturated than the target because AgX desaturates
    col = np.empty((H, W, 3)); col[:] = hexc(BLUE_PAINT_HEX)
    side = (ax > 0.25) & (angF > rad(59)) & (angB > rad(62))
    # side: yellow band, grey plate under it, red triangle (pointing forward) with vent dots
    yb = side & (z > 0.10) & (z < 0.30) & (y > -0.05) & (y < 0.66)
    col[yb] = hexc(YEL_HEX)
    gp = side & (z > -0.16) & (z <= 0.10) & (y > -0.05) & (y < 0.66)
    col[gp] = hexc("#6F767D")
    Y, Z = y, z
    def edge(ax_, az, bx, bz):
        return (bx - ax_) * (Z - az) - (bz - az) * (Y - ax_)
    T, B1, B2 = (-0.14, 0.53), (0.46, 0.34), (0.46, 0.74)
    e1 = edge(*T, *B1); e2 = edge(*B1, *B2); e3 = edge(*B2, *T)
    tri = (ax > 0.3) & (((e1 >= 0) & (e2 >= 0) & (e3 >= 0)) | ((e1 <= 0) & (e2 <= 0) & (e3 <= 0)))
    col[tri] = hexc(RED_HEX)
    dots = np.zeros_like(tri)
    for row, zc in enumerate((0.505, 0.565)):
        for yc in np.linspace(-0.02 + row * 0.03, 0.40, 9 - row):
            dots |= (ax > 0.3) & ((y - yc) ** 2 + (z - zc) ** 2 < 0.012 ** 2)
    col[dots & tri] = hexc("#1B1B1D")
    # front: red arch framing the top of the face + narrow twin stripes along the top seam (the "Y")
    arch = (angF > rad(44.5)) & (angF < rad(57)) & (z > -0.14)
    stripe = (ax > 0.010) & (ax < 0.07) & (z > 0.25) & (y < 0.40) & (angF >= rad(44.5))
    col[arch | stripe] = hexc(RED_HEX)
    # dark gunmetal: rear cap, lower half (sides/back), belly; near-black face interior
    dark = (angB < rad(62)) | ((z < -0.16) & (angF > rad(58))) | (z < -0.55)
    col[dark] = hexc(DARK_SHELL_HEX)
    col[angF < rad(41)] = hexc("#121315")
    # red "[ ]" brackets around front-right lights
    P = np.stack([x, y, z], -1)
    for c in BRACKET_LIGHTS:
        c, t1, t2 = tangent_frame(c)
        near = (P @ c) > 0.9
        a = P @ t1 * R; b = P @ t2 * R
        s, w, arm = 0.034, 0.0045, 0.014
        br = (np.abs(np.abs(a) - s) < w) & (np.abs(b) < s + w)
        br |= (np.abs(np.abs(b) - s) < w) & (np.abs(a) > s - arm) & (np.abs(a) < s + w)
        col[near & br] = hexc(RED_HEX)
    # panel seams -> distance field (surface units)
    big = 9.0
    dist = np.full((H, W), big)
    def addd(dd, mask=None):
        nonlocal dist
        if mask is not None: dd = np.where(mask, dd, big)
        dist = np.minimum(dist, dd)
    for c in (0.74, -0.30, -0.58):
        addd(np.abs(LAT - math.asin(c)) * R)
    for c in (0.10, 0.30, -0.16):
        addd(np.abs(LAT - math.asin(c)) * R, side & (y > -0.05) & (y < 0.66))
    addd(np.abs(y + 0.05) * R, side & (z > -0.16) & (z < 0.74))
    addd(np.abs(y - 0.66) * R, side & (z > -0.16) & (z < 0.74))
    for c in (-2.25, -1.05, 1.05, 2.25):
        addd(np.abs(LON - c) * np.cos(LAT) * R, (z < 0.74) & (z > -0.3) & ~side)
    addd(ax * R, (z > 0.2) & (y < 0.4))
    addd(np.abs(angF - rad(44.5)) * R)
    addd(np.abs(angF - rad(57)) * R, z > -0.14)
    addd(np.abs(angB - rad(62)) * R)
    addd(np.abs(angB - rad(40)) * R)
    n_lo = vnoise(H, W, 8, 16, 1)
    n_mid = vnoise(H, W, 40, 80, 2)
    n_hi = vnoise(H, W, 120, 240, 3, octaves=2)
    seam = dist < 0.0024
    grime = np.exp(-dist / 0.010) * (0.45 + 0.55 * n_mid)
    col *= (1 - 0.40 * grime)[..., None]
    col *= (0.88 + 0.16 * n_lo)[..., None]
    col *= (0.94 + 0.10 * (z + 1) / 2)[..., None]  # painted top-light
    col[seam] *= 0.15
    # wear mask: chipped plate edges + sparse scratches
    chip = (dist < 0.010) & (n_hi * 0.7 + n_mid * 0.3 > 0.62) & ~seam
    chip |= (n_hi > 0.82) & (n_mid > 0.64)
    rng = np.random.default_rng(7)
    scr = np.zeros((H, W), bool)
    for _ in range(300):
        px, py = rng.random() * W, (0.12 + rng.random() * 0.76) * H
        ang = rng.random() * math.pi; ln = 6 + rng.random() * 28
        ts = np.linspace(-ln / 2, ln / 2, int(ln * 2))
        xs = ((px + np.cos(ang) * ts) % W).astype(int); ys = np.clip(py + np.sin(ang) * ts, 0, H - 1).astype(int)
        scr[ys, xs] = True
    wearm = np.maximum(chip.astype(float), scr.astype(float) * 0.45 * (n_mid > 0.45))
    # height: raised plates with bevelled edges falling into the seams
    height = np.clip(dist / 0.009, 0, 1) ** 0.5
    col = np.clip(col, 0, 1)
    def mk(name, arr3, noncolor):
        img = bpy.data.images.new(name, W, H, alpha=False)
        # colour space must be set BEFORE writing pixels (changing it regenerates the buffer)
        img.colorspace_settings.name = "Non-Color" if noncolor else "sRGB"
        rgba = np.concatenate([arr3, np.ones((H, W, 1))], -1).astype(np.float32)
        img.pixels.foreach_set(rgba.ravel())
        img.update()
        img.pack()
        assert img.packed_file is not None, name
        return img
    cimg = mk("shell_color", col, False)
    mimg = mk("shell_mask", np.stack([wearm, height, np.zeros_like(height)], -1), True)
    return cimg, mimg


def shell_material(cimg, mimg):
    cache = {}
    def uv(N, L, tc):
        if "uv" in cache: return cache["uv"]
        nrm = N.new("ShaderNodeVectorMath"); nrm.operation = "NORMALIZE"
        L.new(tc.outputs["Object"], nrm.inputs[0])
        sep = N.new("ShaderNodeSeparateXYZ"); L.new(nrm.outputs[0], sep.inputs[0])
        ny = math_(N, L, "MULTIPLY", sep.outputs[1], -1.0)
        lon = math_(N, L, "ARCTAN2", sep.outputs[0], ny)
        uu = math_(N, L, "MULTIPLY_ADD", lon, 1 / TAU); uu.node.inputs[2].default_value = 0.5
        lat = math_(N, L, "ARCSINE", sep.outputs[2])
        vv = math_(N, L, "MULTIPLY_ADD", lat, 1 / math.pi); vv.node.inputs[2].default_value = 0.5
        comb = N.new("ShaderNodeCombineXYZ")
        L.new(uu, comb.inputs[0]); L.new(vv, comb.inputs[1])
        cache["uv"] = comb.outputs[0]
        return cache["uv"]
    def tex(N, L, tc, img):
        key = img.name
        if key in cache: return cache[key]
        t = N.new("ShaderNodeTexImage"); t.image = img; t.interpolation = "Linear"
        L.new(uv(N, L, tc), t.inputs[0])
        cache[key] = t
        return t
    def base(N, L, tc):
        return tex(N, L, tc, cimg).outputs["Color"]
    def extra(N, L, tc):
        sep = N.new("ShaderNodeSeparateColor"); L.new(tex(N, L, tc, mimg).outputs["Color"], sep.inputs[0])
        cache["sep"] = sep
        return sep.outputs[0]
    def normal(N, L, tc):
        sep = cache.get("sep")
        if sep is None:
            sep = N.new("ShaderNodeSeparateColor"); L.new(tex(N, L, tc, mimg).outputs["Color"], sep.inputs[0])
        b = N.new("ShaderNodeBump")
        b.inputs["Strength"].default_value = 0.9; b.inputs["Distance"].default_value = 0.006
        L.new(sep.outputs[1], b.inputs["Height"])
        return b.outputs[0]
    return worn_mat("Shell", BLUE, rough=0.26, base_socket_fn=base, extra_wear_fn=extra,
                    normal_fn=normal, wear=0.8, grime=0.5, coat=0.35)


# ----------------------------------------------------------------------------- geometry helpers
def bm_box(bm, center, size, rot=None):
    M = Matrix.Translation(Vector(center)) @ ((rot or Matrix()).to_4x4()) @ Matrix.Diagonal((*size, 1))
    return bmesh.ops.create_cube(bm, size=1.0, matrix=M)["verts"]


def bm_cyl(bm, center, r, depth, rot=None, segs=24, r2=None):
    M = Matrix.Translation(Vector(center)) @ ((rot or Matrix()).to_4x4())
    return bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                                 radius1=r, radius2=r if r2 is None else r2, depth=depth, matrix=M)["verts"]


def bm_ring(bm, r_in, r_out, depth, segs=32, M=None, phase=0.0):
    """Annulus along local Z."""
    M = M or Matrix()
    vs = []
    for k in range(segs):
        a = phase + TAU * k / segs
        ca, sa = math.cos(a), math.sin(a)
        for rr, zz in ((r_out, depth / 2), (r_in, depth / 2), (r_out, -depth / 2), (r_in, -depth / 2)):
            vs.append(bm.verts.new(M @ Vector((rr * ca, rr * sa, zz))))
    for k in range(segs):
        k2 = (k + 1) % segs
        o_t, i_t, o_b, i_b = [vs[4 * k + j] for j in range(4)]
        O_t, I_t, O_b, I_b = [vs[4 * k2 + j] for j in range(4)]
        for f in ((o_t, O_t, I_t, i_t), (o_b, i_b, I_b, O_b), (o_t, o_b, O_b, O_t), (i_t, I_t, I_b, i_b)):
            bm.faces.new(f)
    return vs


def finish(name, bm, mats, bevel=0.004, smooth_cyl=True, parent=root, matfn=None, segments=2):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if matfn:
        for f in bm.faces:
            f.material_index = matfn(f)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    if smooth_cyl:
        # smooth faces that belong to round surfaces (small dihedral angles to neighbours)
        bm2 = bmesh.new(); bm2.from_mesh(me)
        for f in bm2.faces:
            angs = [e.calc_face_angle(0.0) for e in f.edges if len(e.link_faces) == 2]
            small = [a for a in angs if 0.01 < a < math.radians(25)]
            f.smooth = len(small) >= 2 and len(f.verts) == 4
        bm2.to_mesh(me); bm2.free()
    obj = bpy.data.objects.new(name, me)
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
        me.materials.append(m)
    link(obj, parent)
    if bevel:
        bv = obj.modifiers.new("Bevel", "BEVEL")
        bv.width = bevel; bv.segments = segments; bv.limit_method = "ANGLE"
        bv.angle_limit = math.radians(30)
    return obj


def orient(d, spin=0.0):
    d = Vector(d).normalized()
    q = d.to_track_quat("Z", "Y")
    return (q.to_matrix() @ Matrix.Rotation(spin, 3, "Z"))


def surf(d, r=R):
    return Vector(d).normalized() * r


def Rx(a): return Matrix.Rotation(math.radians(a), 3, "X")
def Ry(a): return Matrix.Rotation(math.radians(a), 3, "Y")
def Rz(a): return Matrix.Rotation(math.radians(a), 3, "Z")


# ----------------------------------------------------------------------------- build
t0 = time.time()
cimg, mimg = make_shell_textures()
M_SHELL = shell_material(cimg, mimg)
M_BLUE = worn_mat("BluePaint", srgb(BLUE_PAINT_HEX), rough=0.26, coat=0.35)
M_GUN = worn_mat("Gunmetal", srgb("#25282C"), rough=0.6, metallic=0.35, wear=1.2, wear_col=srgb("#8E949A"))
M_DARK = worn_mat("DarkMetal", srgb("#1E2023"), rough=0.5, metallic=0.4, wear=0.9, wear_col=srgb("#7C8288"))
M_CHROME = chrome_mat("Chrome", rough=0.24)
M_CHROME_B = chrome_mat("ChromeBright", srgb("#DDE1E5"), 0.2)
M_CHROME_D = chrome_mat("ChromeDark", srgb("#6E7378"), 0.25)
M_HAZ = hazard_mat("Hazard")
M_GREY = worn_mat("GreyPlate", srgb("#7D848B"), rough=0.4, metallic=0.5)
M_RED = worn_mat("RedPaint", RED, rough=0.3)
M_BLACK = glossy_dark("Black", (0.003, 0.003, 0.004, 1), 0.4)
M_GLASS = glossy_dark("GlossDark")
M_CYAN = emit_mat("LED_Cyan", CYAN, 9.0)
M_ORANGE = emit_mat("Eye_Orange", ORANGE, 14.0)
M_ORANGE_HOT = emit_mat("Eye_Hot", srgb("#FFC24A"), 26.0)
M_ENGINE = emit_mat("Engine", ENGINE, 14.0)
M_ENGINE_CORE = emit_mat("EngineCore", srgb("#F2FCFF"), 35.0)
M_HUB = worn_mat("Hub", srgb("#1A1A1A"), rough=0.45, metallic=0.6, wear=0.8)

# --- shell: smooth sphere minus face + engine recesses
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=R)
shell = finish("Shell", bm, M_SHELL, bevel=0, smooth_cyl=False)
for p in shell.data.polygons: p.use_smooth = True
cutters = bpy.data.collections.new("Cutters")
scene.collection.children.link(cutters)
def cutter(name, r, y0, y1):
    bm = bmesh.new()
    bm_cyl(bm, (0, (y0 + y1) / 2, 0), r, abs(y1 - y0), Rx(90), segs=64)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); cutters.objects.link(o); o.parent = root
    o.hide_render = True; o.display_type = "WIRE"
    return o
cutter("CutFront", 0.30, -0.8, -0.37)
cutter("CutRear", 0.33, 0.31, 0.8)
bo = shell.modifiers.new("Recesses", "BOOLEAN")
bo.operation = "DIFFERENCE"; bo.operand_type = "COLLECTION"; bo.collection = cutters; bo.solver = "EXACT"
bv = shell.modifiers.new("Bevel", "BEVEL"); bv.width = 0.006; bv.segments = 2
bv.limit_method = "ANGLE"; bv.angle_limit = math.radians(35)

# --- 1. front face: thick stepped dark rim with notched top + angular "ears", glowing amber eye
FACE = Rx(90).to_4x4()
def at_y(y): return Matrix.Translation((0, y, 0)) @ FACE
bm = bmesh.new()
bm_ring(bm, 0.29, 0.355, 0.09, segs=12, M=at_y(-0.40), phase=math.pi / 12)       # outer segmented frame
bm_ring(bm, 0.255, 0.305, 0.06, segs=24, M=at_y(-0.41), phase=math.pi / 24)      # inner step
bm_ring(bm, 0.235, 0.26, 0.03, segs=32, M=at_y(-0.385))                           # innermost lip
for a in (-14, -5, 5, 14):                                                         # notched teeth on top
    rot = Ry(a)
    bm_box(bm, rot @ Vector((0, -0.452, 0.315)), (0.03, 0.02, 0.05), rot)
for sgn in (1, -1):                                                                # angular ears at 10 & 2 o'clock
    rot = Ry(-50 * sgn)
    bm_box(bm, rot @ Vector((0, -0.415, 0.36)), (0.12, 0.07, 0.07), rot)
    rot = Ry(-125 * sgn)
    bm_box(bm, rot @ Vector((0, -0.405, 0.35)), (0.08, 0.06, 0.06), rot)
finish("FaceRing", bm, M_GUN, bevel=0.005)

bm = bmesh.new()                                    # cyan slit lights round the interior
for k in range(8):
    a = TAU * k / 8 + math.pi / 8
    rot = Ry(-math.degrees(a))
    bm_box(bm, rot @ Vector((0, -0.374, 0.215)), (0.014, 0.012, 0.045), rot)
finish("FaceSlits", bm, M_CYAN, bevel=0)

bm = bmesh.new()                                    # glowing turbine ring behind blades
bm_ring(bm, 0.075, 0.150, 0.02, segs=48, M=at_y(-0.378))
finish("EyeGlow", bm, M_ORANGE, bevel=0, smooth_cyl=False)
bm = bmesh.new()
bm_ring(bm, 0.085, 0.13, 0.01, segs=48, M=at_y(-0.392))
finish("EyeGlowHot", bm, M_ORANGE_HOT, bevel=0, smooth_cyl=False)
bm = bmesh.new()                                    # 20 radial dark blades -> 20 glowing slots
for k in range(20):
    a = TAU * k / 20
    rot = Ry(-math.degrees(a))
    bm_box(bm, rot @ Vector((0, -0.398, 0.112)), (0.008, 0.016, 0.076), rot)
bm_ring(bm, 0.150, 0.185, 0.045, segs=48, M=at_y(-0.398))      # dark rim around the eye
bm_ring(bm, 0.062, 0.078, 0.035, segs=32, M=at_y(-0.40))
finish("EyeBlades", bm, M_HUB, bevel=0.002)
bm = bmesh.new()                                    # hub
bm_cyl(bm, (0, -0.41, 0), 0.065, 0.06, Rx(90), segs=24)
bm_cyl(bm, (0, -0.445, 0), 0.045, 0.03, Rx(90), segs=8)
bm_cyl(bm, (0, -0.462, 0), 0.02, 0.02, Rx(90), segs=16)
for k in range(4):
    rot = Ry(45 + 90 * k)
    bm_box(bm, rot @ Vector((0, -0.44, 0.052)), (0.016, 0.02, 0.018), rot)
finish("EyeHub", bm, M_HUB, bevel=0.003)
eye_l = bpy.data.lights.new("EyeLight", "POINT"); eye_l.energy = 6; eye_l.color = (1.0, 0.6, 0.2)
eye_l.shadow_soft_size = 0.1
link(bpy.data.objects.new("EyeLight", eye_l)).location = (0, -0.5, 0)

# --- 2. lower jaw: big chunky dark block assembly reaching forward/down
bm = bmesh.new()
bm_box(bm, (0, -0.33, -0.40), (0.22, 0.22, 0.16))           # root block into the shell
bm_box(bm, (0, -0.44, -0.34), (0.20, 0.12, 0.12))           # upper mount under the face ring
bm_box(bm, (0, -0.47, -0.50), (0.18, 0.16, 0.18))           # middle block
bm_box(bm, (0.105, -0.44, -0.47), (0.035, 0.22, 0.22))      # side cheek plates
bm_box(bm, (-0.105, -0.44, -0.47), (0.035, 0.22, 0.22))
bm_box(bm, (0, -0.50, -0.635), (0.15, 0.16, 0.10))          # bottom vent block
bm_box(bm, (0, -0.40, -0.60), (0.12, 0.10, 0.08))
jaw = finish("Jaw", bm, M_GUN, bevel=0.006)
bm = bmesh.new()
for sx in (-0.035, 0.035):                                  # two square slots
    bm_box(bm, (sx, -0.581, -0.64), (0.042, 0.006, 0.042))
for k in range(6):                                          # rivet holes along the sides
    for sx in (-0.123, 0.123):
        bm_cyl(bm, (sx, -0.52 + k * 0.03, -0.55), 0.006, 0.006, Ry(90), segs=8)
    for sx in (-0.076, 0.076):
        bm_cyl(bm, (sx, -0.55 + k * 0.022, -0.66), 0.005, 0.006, Ry(90), segs=8)
finish("JawHoles", bm, M_BLACK, bevel=0)
bm = bmesh.new()                                            # chrome nozzle on top-front + hex collar
bm_cyl(bm, (0, -0.55, -0.33), 0.045, 0.08, Rx(90), segs=24)
bm_cyl(bm, (0, -0.60, -0.33), 0.036, 0.03, Rx(90), segs=24)
finish("JawNozzle", bm, M_CHROME, bevel=0.002)
bm = bmesh.new()
bm_cyl(bm, (0, -0.515, -0.33), 0.068, 0.05, Rx(90), segs=6)
finish("JawCollar", bm, M_GUN, bevel=0.004)
bm = bmesh.new()
bm_cyl(bm, (0, -0.616, -0.33), 0.024, 0.01, Rx(90), segs=16)
finish("JawNozzleHole", bm, M_BLACK, bevel=0)

# --- 3. side cylindrical ports (lower-left / lower-right of the face)
for sx in (1, -1):
    d = Vector((0.66 * sx, -0.58, -0.48)).normalized()
    rot = orient(d)
    def P(off): return d * off
    bm = bmesh.new()
    bm_cyl(bm, P(0.49), 0.095, 0.06, rot, segs=28)
    bm_cyl(bm, P(0.56), 0.08, 0.10, rot, segs=28)
    bm_cyl(bm, P(0.62), 0.074, 0.025, rot, segs=28)
    finish(f"Port{sx:+d}", bm, M_CHROME, bevel=0.003)
    bm = bmesh.new()
    bm_ring(bm, 0.04, 0.068, 0.03, segs=28, M=Matrix.Translation(P(0.635)) @ rot.to_4x4())
    finish(f"PortCap{sx:+d}", bm, M_GUN, bevel=0.002)
    bm = bmesh.new()
    bm_cyl(bm, P(0.63), 0.04, 0.02, rot, segs=24)
    finish(f"PortHole{sx:+d}", bm, M_GLASS, bevel=0)

# --- 4. side wing pods: big trapezoid armour panels (built for +X, mirrored)
def pod(sx):
    bm = bmesh.new()
    pts = [  # inner face (x=0.34) and outer face (x=0.92), swept back, top slanting down outward
        (0.34, -0.34, -0.21), (0.34, 0.26, -0.21), (0.34, 0.26, 0.07), (0.34, -0.34, 0.07),
        (0.92, -0.10, -0.12), (0.92, 0.16, -0.12), (0.92, 0.16, -0.04), (0.92, -0.10, -0.04)]
    vs = [bm.verts.new((sx * p[0], p[1], p[2])) for p in pts]
    for f in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (3, 2, 6, 7), (0, 3, 7, 4), (1, 5, 6, 2)):
        bm.faces.new([vs[i] for i in f])
    def mf(f):
        n = f.normal
        return 0 if abs(n.z) > 0.5 else 1   # blue top AND blue underside (ref4)
    finish(f"Pod{sx:+d}", bm, [M_BLUE, M_GUN], bevel=0.008, matfn=mf, smooth_cyl=False)
    slope = math.degrees(math.atan2(0.07 + 0.04, 0.58)) * sx
    def on_top(xx, yy, sz, mat, name, rot_extra=None, lift=0.004):
        ztop = 0.07 - (xx - 0.34) * (0.11 / 0.58)
        r = Ry(slope) @ (rot_extra or Matrix.Identity(3))
        b = bmesh.new(); bm_box(b, (sx * xx, yy, ztop + lift), sz, r)
        return finish(name, b, mat, bevel=0.002)
    # dark frame strips along the top edges
    on_top(0.63, 0.205, (0.56, 0.04, 0.012), M_GUN, f"PodEdgeBack{sx:+d}")
    on_top(0.86, 0.03, (0.04, 0.22, 0.012), M_GUN, f"PodEdgeOuter{sx:+d}")
    on_top(0.70, 0.04, (0.16, 0.10, 0.006), M_HAZ, f"PodHazard{sx:+d}", lift=0.002)
    on_top(0.47, 0.12, (0.09, 0.08, 0.02), M_GREY, f"PodHatch{sx:+d}")
    on_top(0.47, -0.12, (0.10, 0.03, 0.01), M_GLASS, f"PodSlot{sx:+d}", lift=0.006)
    b = bmesh.new()
    zt = 0.07 - (0.58 - 0.34) * (0.11 / 0.58)
    bm_ring(b, 0.018, 0.03, 0.012, segs=20, M=Matrix.Translation((sx * 0.58, 0.14, zt + 0.004)) @ Ry(slope).to_4x4())
    finish(f"PodRing{sx:+d}", b, M_GREY, bevel=0.001)
    b = bmesh.new()                                                     # spike pointing out/back
    v0 = b.verts.new((sx * 1.15, 0.24, -0.08))
    base = [b.verts.new((sx * 0.90, 0.06, -0.08)), b.verts.new((sx * 0.90, 0.12, -0.065)),
            b.verts.new((sx * 0.90, 0.16, -0.08)), b.verts.new((sx * 0.90, 0.12, -0.095))]
    for i in range(4):
        b.faces.new((v0, base[i], base[(i + 1) % 4]))
    b.faces.new(base[::-1])
    finish(f"PodSpike{sx:+d}", b, M_DARK, bevel=0, smooth_cyl=False)
    b = bmesh.new()                                                     # gun barrel at the front underside
    bm_cyl(b, (sx * 0.60, -0.22, -0.20), 0.026, 0.34, Rx(90), segs=20)
    bm_cyl(b, (sx * 0.60, -0.36, -0.20), 0.036, 0.04, Rx(90), segs=20)
    bm_box(b, (sx * 0.60, -0.08, -0.17), (0.09, 0.12, 0.06))
    finish(f"PodGun{sx:+d}", b, M_DARK, bevel=0.003)
    b = bmesh.new()
    bm_cyl(b, (sx * 0.60, -0.391, -0.20), 0.017, 0.004, Rx(90), segs=16)
    finish(f"PodGunHole{sx:+d}", b, M_BLACK, bevel=0)
POD_TILT = 18.0   # extra outward-down tilt so the blue face reads in side views (ref2/ref5)
for sx in (1, -1):
    before = set(bpy.data.objects)
    pod(sx)
    piv = bpy.data.objects.new(f"PodPivot{sx:+d}", None); link(piv)
    piv.location = (sx * 0.34, 0.0, -0.07)
    for o in set(bpy.data.objects) - before - {piv}:
        o.parent = piv
        o.matrix_parent_inverse = Matrix.Translation(-piv.location)
    piv.rotation_euler = (0.0, math.radians(POD_TILT) * sx, 0.0)

# --- 5. upper side brackets: boxy open frames (hole along Y), angled outward, rear-ish
for sx in (1, -1):
    C = Vector((0.47 * sx, 0.30, 0.33))
    rot = Ry(42 * sx)
    M4 = Matrix.Translation(C) @ rot.to_4x4()
    bm = bmesh.new()
    w, h, dpt, t = 0.24, 0.19, 0.28, 0.045
    for c, s in (((0, 0, h / 2 - t / 2), (w, dpt, t)), ((0, 0, -h / 2 + t / 2), (w, dpt, t)),
                 ((w / 2 - t / 2, 0, 0), (t, dpt, h)), ((-w / 2 + t / 2, 0, 0), (t, dpt, h))):
        bm_box(bm, M4 @ Vector(c), s, rot)
    bm_box(bm, M4 @ Vector((-0.05 * sx, -0.02, -h / 2 - 0.05)), (0.14, 0.18, 0.12), rot)   # pylon into shell
    finish(f"Bracket{sx:+d}", bm, M_GUN, bevel=0.006)
    bm = bmesh.new()
    bm_box(bm, M4 @ Vector((0, dpt / 2 + 0.002, h / 2 - t / 2)), (w, 0.006, t * 0.7), rot)
    bm_box(bm, M4 @ Vector((0, dpt / 2 + 0.002, -h / 2 + t / 2)), (w, 0.006, t * 0.7), rot)
    bm_box(bm, M4 @ Vector((0, 0, h / 2 + 0.002)), (w * 0.85, dpt * 0.6, 0.006), rot)
    finish(f"BracketHazard{sx:+d}", bm, M_HAZ, bevel=0.001)
    bm = bmesh.new()
    bm_box(bm, M4 @ Vector((w / 2 + 0.002, 0, 0)), (0.006, dpt * 0.7, h * 0.6), rot)
    finish(f"BracketPanel{sx:+d}", bm, M_BLUE, bevel=0.002)

# --- 6. rear engine: big ribbed dark ring around a strongly glowing blue-white disc
REAR = Rx(-90).to_4x4()
def at_ry(y): return Matrix.Translation((0, y, 0)) @ REAR
bm = bmesh.new()
bm_ring(bm, 0.31, 0.43, 0.10, segs=24, M=at_ry(0.31), phase=math.pi / 24)    # outer armoured collar
bm_ring(bm, 0.20, 0.235, 0.05, segs=32, M=at_ry(0.33))                         # inner ring
for k in range(16):                                  # triangular teeth on the inner edge of the collar
    a = TAU * k / 16
    def pt(r, aa, yy): return (r * math.cos(aa), yy, r * math.sin(aa))
    tip = bm.verts.new(pt(0.265, a, 0.35)); tq = bm.verts.new(pt(0.265, a, 0.31))
    p1 = bm.verts.new(pt(0.312, a - 0.09, 0.35)); p2 = bm.verts.new(pt(0.312, a + 0.09, 0.35))
    q1 = bm.verts.new(pt(0.312, a - 0.09, 0.31)); q2 = bm.verts.new(pt(0.312, a + 0.09, 0.31))
    for f in ((tip, p1, p2), (tq, q2, q1), (tip, tq, q1, p1), (tip, p2, q2, tq), (p1, q1, q2, p2)):
        bm.faces.new(f)
for k in range(8):                                   # ribs across the recess floor
    a = TAU * k / 8 + math.pi / 8
    rot = Ry(-math.degrees(a))
    bm_box(bm, rot @ Vector((0, 0.315, 0.27)), (0.03, 0.03, 0.08), rot)
finish("EngineRing", bm, M_GUN, bevel=0.003)
bm = bmesh.new()
bm_cyl(bm, (0, 0.315, 0), 0.14, 0.01, Rx(90), segs=64)
finish("EngineGlow", bm, M_ENGINE, bevel=0, smooth_cyl=False)
bm = bmesh.new()
bm_cyl(bm, (0, 0.322, 0), 0.085, 0.006, Rx(90), segs=48)
finish("EngineCore", bm, M_ENGINE_CORE, bevel=0, smooth_cyl=False)
bm = bmesh.new()
for r in (0.095, 0.115, 0.14):
    bm_ring(bm, r, r + 0.006, 0.012, segs=64, M=at_ry(0.322))
finish("EngineRings", bm, M_DARK, bevel=0)
eng_l = bpy.data.lights.new("EngineLight", "POINT"); eng_l.energy = 25; eng_l.color = (0.75, 0.93, 1.0)
eng_l.shadow_soft_size = 0.15
link(bpy.data.objects.new("EngineLight", eng_l)).location = (0, 0.45, 0)

# --- 7. top-rear clamp: chunky chrome block, two parallel thick flat plates, big open C/rectangle
bm = bmesh.new()
bm_box(bm, (0, 0.40, 0.300), (0.24, 0.22, 0.20))              # chunky base block on the upper rear
bm_box(bm, (0, 0.52, 0.320), (0.20, 0.10, 0.14))
for sx in (-0.07, 0.07):
    bm_box(bm, (sx, 0.79, 0.440), (0.05, 0.58, 0.07))         # top bar of the C
    bm_box(bm, (sx, 0.87, 0.180), (0.05, 0.42, 0.06))         # bottom bar of the C
    bm_box(bm, (sx, 1.05, 0.310), (0.05, 0.07, 0.32))         # closed rear end
    bm_box(bm, (sx, 0.69, 0.180), (0.05, 0.06, 0.10))         # hook lip (open front of the C)
    bm_box(bm, (sx, 0.68, 0.340), (0.05, 0.30, 0.035))        # inner prongs from the base
    bm_box(bm, (sx, 0.68, 0.280), (0.05, 0.30, 0.035))
    for k in range(3):                                       # small notches along the top
        bm_box(bm, (sx, 0.60 + 0.12 * k, 0.48), (0.055, 0.03, 0.014))
finish("ClampArms", bm, M_CHROME_B, bevel=0.008)

# --- 8. bottom: plating, hatches, bolts, small fins
for i, d in enumerate(((0.16, 0.06, -1), (-0.16, 0.06, -1))):
    dd = Vector(d).normalized()
    bm = bmesh.new(); bm_box(bm, surf(dd, 0.497), (0.08, 0.15, 0.024), orient(dd))
    finish(f"Hatch{i}", bm, M_DARK, bevel=0.004)
bm = bmesh.new()
dd = Vector((0, 0.35, -0.94)).normalized()
bm_box(bm, surf(dd, 0.49), (0.34, 0.20, 0.03), orient(dd))
finish("BellyPlate", bm, M_GUN, bevel=0.005)
bm = bmesh.new()
for d in ((0.1, -0.08, -0.99), (-0.1, -0.08, -0.99), (0.08, 0.2, -0.97), (-0.08, 0.2, -0.97),
          (0.32, 0.05, -0.92), (-0.32, 0.05, -0.92)):
    dd = Vector(d).normalized()
    bm_cyl(bm, surf(dd, 0.5), 0.014, 0.012, orient(dd), segs=12)
finish("Bolts", bm, M_CHROME_D, bevel=0.001)
for sx in (1, -1):
    bm = bmesh.new()
    rot = Ry(-28 * sx)
    pts = [(-0.01, 0.24, 0.0), (-0.01, 0.38, 0.0), (-0.01, 0.40, -0.08), (-0.01, 0.33, -0.09),
           (0.01, 0.24, 0.0), (0.01, 0.38, 0.0), (0.01, 0.40, -0.08), (0.01, 0.33, -0.09)]
    O = Vector((0.16 * sx, 0.04, -0.40))
    vs = [bm.verts.new(O + rot @ Vector(p)) for p in pts]
    for f in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([vs[i] for i in f])
    finish(f"Fin{sx:+d}", bm, M_GUN, bevel=0.004, smooth_cyl=False)

# --- 9. surface details
def led(name, d, r=0.013):
    dd = Vector(d).normalized(); rot = orient(dd)
    bm = bmesh.new(); bm_ring(bm, r, r + 0.011, 0.014, segs=20, M=Matrix.Translation(surf(dd, 0.497)) @ rot.to_4x4())
    finish(name + "Ring", bm, M_GUN, bevel=0.001)
    bm = bmesh.new(); bm_cyl(bm, surf(dd, 0.499), r, 0.01, rot, segs=16)
    finish(name, bm, M_CYAN, bevel=0)
LEDS = BRACKET_LIGHTS + [(-0.30, -0.62, 0.55), (0.30, -0.62, 0.55), (0.35, -0.25, 0.85),
                         (0.85, 0.1, -0.45), (-0.85, 0.1, -0.45), (0.45, 0.72, 0.30), (-0.45, 0.72, 0.30),
                         (0.3, 0.85, -0.35), (-0.3, 0.85, -0.35), (0.62, 0.55, 0.45),
                         (0.10, -0.38, -0.92), (-0.10, -0.38, -0.92), (-0.76, -0.62, 0.02)]
for i, d in enumerate(LEDS):
    led(f"LED{i:02d}", d, 0.017 if i in (12, 13) else 0.013)
# portholes (two big, two small, upper front)
for i, (d, r) in enumerate((((0.36, -0.52, 0.62), 0.042), ((-0.36, -0.52, 0.62), 0.042),
                            ((0.16, -0.30, 0.86), 0.03), ((-0.16, -0.30, 0.86), 0.03))):
    dd = Vector(d).normalized(); rot = orient(dd)
    bm = bmesh.new(); bm_ring(bm, r * 0.7, r, 0.024, segs=24, M=Matrix.Translation(surf(dd, 0.497)) @ rot.to_4x4())
    finish(f"PortholeRim{i}", bm, M_GUN, bevel=0.002)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=10, radius=r * 0.75,
                              matrix=Matrix.Translation(surf(dd, 0.495)) @ rot.to_4x4() @ Matrix.Diagonal((1, 1, 0.55, 1)))
    o = finish(f"Porthole{i}", bm, M_GLASS, bevel=0, smooth_cyl=False)
    for p in o.data.polygons: p.use_smooth = True
# small rectangular hatches on the blue shell
for i, (d, sz, sp) in enumerate((((0.55, -0.15, 0.75), (0.07, 0.05, 0.012), 0.2), ((-0.55, -0.15, 0.75), (0.07, 0.05, 0.012), -0.2),
                                  ((0.0, 0.25, 0.97), (0.06, 0.05, 0.012), 0.0))):
    dd = Vector(d).normalized()
    bm = bmesh.new(); bm_box(bm, surf(dd, 0.499), sz, orient(dd, sp))
    finish(f"SmallHatch{i}", bm, M_BLUE, bevel=0.003)
# chrome "II" handles in front of the yellow band
for sx in (1, -1):
    dd = Vector((0.92 * sx, -0.22, 0.26)).normalized(); rot = orient(dd)
    bm = bmesh.new()
    bm_box(bm, surf(dd, 0.5) + rot @ Vector((0, 0, 0.006)), (0.085, 0.06, 0.012), rot)
    for off in (-0.016, 0.016):
        bm_box(bm, surf(dd, 0.5) + rot @ Vector((off, 0, 0.018)), (0.012, 0.05, 0.02), rot)
    finish(f"Handle{sx:+d}", bm, M_CHROME, bevel=0.002)
# vent slits on the front-right and front-left
for sx in (1, -1):
    dd = Vector((0.62 * sx, -0.66, -0.12)).normalized(); rot = orient(dd)
    bm = bmesh.new()
    for k in range(3):
        bm_box(bm, surf(dd, 0.497) + rot @ Vector((0, 0.025 - k * 0.022, 0)), (0.07, 0.009, 0.01), rot)
    finish(f"Vents{sx:+d}", bm, M_BLACK, bevel=0)
# rear: cyan slits + round vents on the dark shell
bm = bmesh.new()
for sx in (1, -1):
    dd = Vector((0.55 * sx, 0.8, -0.05)).normalized()
    bm_box(bm, surf(dd, 0.5), (0.012, 0.06, 0.008), orient(dd))
finish("RearSlits", bm, M_CYAN, bevel=0)
bm = bmesh.new()
for a in (200, 230, 310, 340):
    dd = Vector((0.62 * math.cos(math.radians(a)), 0.78, 0.62 * math.sin(math.radians(a)))).normalized()
    bm_cyl(bm, surf(dd, 0.497), 0.018, 0.012, orient(dd), segs=16)
finish("RearVents", bm, M_BLACK, bevel=0)

print(f"[probe] built scene in {time.time() - t0:.1f}s, {len([o for o in bpy.data.objects if o.type == 'MESH'])} meshes")

# ----------------------------------------------------------------------------- world, lights, camera
world = bpy.data.worlds.new("Studio"); scene.world = world
nt, N, L = _nodes(world)
wo = N.new("ShaderNodeOutputWorld"); bg = N.new("ShaderNodeBackground")
tc = N.new("ShaderNodeTexCoord"); sep = N.new("ShaderNodeSeparateXYZ")
L.new(tc.outputs["Generated"], sep.inputs[0])
wr = ramp(N, L, math_(N, L, "MULTIPLY_ADD", sep.outputs[2], 0.5) if False else sep.outputs[2],
          [(0.3, (0.07, 0.075, 0.08, 1)), (0.55, (0.3, 0.31, 0.33, 1)), (0.9, (0.9, 0.93, 0.97, 1))])
L.new(wr.outputs[0], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 0.9
L.new(bg.outputs[0], wo.inputs[0])

target = bpy.data.objects.new("Target", None); coll.objects.link(target)
cam_d = bpy.data.cameras.new("Cam"); cam_d.type = "ORTHO"
cam = bpy.data.objects.new("Cam", cam_d); coll.objects.link(cam); scene.camera = cam
tr = cam.constraints.new("TRACK_TO"); tr.target = target; tr.track_axis = "TRACK_NEGATIVE_Z"; tr.up_axis = "UP_Y"
CAM_DIST = 8.0


def add_light(name, kind, loc_cam, energy, color, size):
    ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
    if kind == "AREA": ld.shape = "DISK"; ld.size = size
    o = bpy.data.objects.new(name, ld); coll.objects.link(o)
    o.parent = cam; o.location = loc_cam
    c = o.constraints.new("TRACK_TO"); c.target = target; c.track_axis = "TRACK_NEGATIVE_Z"; c.up_axis = "UP_Y"
    return o

# lights live in camera space so every view gets the same studio rig
# camera local: X right, Y up, -Z toward the subject (subject at z=-CAM_DIST)
add_light("Key", "AREA", (-3.0, 3.2, -CAM_DIST + 3.6), 850, (1.0, 0.97, 0.92), 2.5)
add_light("Rim", "AREA", (2.2, 2.0, -CAM_DIST - 3.2), 1400, (0.62, 0.82, 1.0), 2.0)
add_light("Rim2", "AREA", (-2.6, -0.5, -CAM_DIST - 2.8), 600, (0.7, 0.85, 1.0), 2.0)
add_light("Fill", "AREA", (3.6, -0.6, -CAM_DIST + 2.5), 380, (0.85, 0.9, 1.0), 5.0)
add_light("Bounce", "AREA", (0.0, -3.5, -CAM_DIST + 1.0), 120, (0.9, 0.9, 1.0), 4.0)


def place_camera(direction, ortho):
    d = Vector(direction).normalized()
    cam.location = target.location + d * CAM_DIST
    cam_d.ortho_scale = ortho
    if abs(d.z) > 0.98:   # avoid gimbal on straight top/bottom views
        tr.up_axis = "UP_Y"


# ----------------------------------------------------------------------------- render settings
scene.render.engine = "CYCLES"
cy = scene.cycles
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for dv in prefs.devices: dv.use = (dv.type == "METAL")
    cy.device = "GPU"
except Exception as e:
    print("[probe] GPU setup failed, CPU:", e)
cy.use_adaptive_sampling = True
cy.use_denoising = True
cy.max_bounces = 8; cy.glossy_bounces = 4; cy.diffuse_bounces = 3; cy.transparent_max_bounces = 4
scene.render.film_transparent = True
scene.render.use_persistent_data = True
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Punchy"
scene.view_settings.exposure = 0.0
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.render.image_settings.compression = 100


GLOW = {}


def setup_glow():
    """Compositor bloom for the eye / engine / LEDs. The glow is also written into alpha so the
    halo survives on a transparent background (alpha = max(object alpha, glow luminance))."""
    try:
        ng = bpy.data.node_groups.new("ProbeComp", "CompositorNodeTree")
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        scene.compositing_node_group = ng
        N, L = ng.nodes, ng.links
        rl = N.new("CompositorNodeRLayers")
        gl = N.new("CompositorNodeGlare")
        gl.inputs["Type"].default_value = "Bloom"
        gl.inputs["Quality"].default_value = "High"
        gl.inputs["Threshold"].default_value = 2.0
        gl.inputs["Strength"].default_value = 0.4
        gl.inputs["Size"].default_value = 0.6
        L.new(rl.outputs["Image"], gl.inputs["Image"])
        glow = gl.outputs.get("Glare")
        bw = N.new("CompositorNodeRGBToBW")
        L.new(glow, bw.inputs[0])
        sep = N.new("CompositorNodeSeparateColor"); L.new(rl.outputs["Image"], sep.inputs[0])
        k = N.new("ShaderNodeMath"); k.operation = "MULTIPLY"; k.use_clamp = True
        L.new(bw.outputs[0], k.inputs[0]); k.inputs[1].default_value = 1.6
        GLOW["alpha_gain"] = k.inputs[1]
        mx = N.new("ShaderNodeMath"); mx.operation = "MAXIMUM"
        L.new(sep.outputs["Alpha"], mx.inputs[0]); L.new(k.outputs[0], mx.inputs[1])
        # drop the faint far haze completely (<3% opacity) so the background stays clean
        gt = N.new("ShaderNodeMath"); gt.operation = "GREATER_THAN"
        L.new(mx.outputs[0], gt.inputs[0]); gt.inputs[1].default_value = 0.03
        am = N.new("ShaderNodeMath"); am.operation = "MULTIPLY"
        L.new(mx.outputs[0], am.inputs[0]); L.new(gt.outputs[0], am.inputs[1])
        cm = N.new("ShaderNodeMix"); cm.data_type = "RGBA"; cm.blend_type = "MULTIPLY"
        sock(cm, "Factor", "VALUE").default_value = 1.0
        L.new(gl.outputs["Image"], sock(cm, "A", "RGBA")); L.new(gt.outputs[0], sock(cm, "B", "RGBA"))
        sa = N.new("CompositorNodeSetAlpha")
        sa.inputs["Type"].default_value = "Replace Alpha"
        L.new(sock(cm, "Result", "RGBA", True), sa.inputs["Image"]); L.new(am.outputs[0], sa.inputs["Alpha"])
        out = N.new("NodeGroupOutput")
        L.new(sa.outputs[0], out.inputs[0])
        print("[probe] compositor glow on")
    except Exception as e:
        print("[probe] compositor glow skipped:", e)


setup_glow()


def render_to(path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# pack textures & save
os.makedirs(PREVIEW_DIR, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0  # no probe.blend1 backups
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
print("[probe] saved", BLEND_PATH)

stats = {}
if DO_PREVIEWS:
    t1 = time.time()
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    cy.samples = 96; cy.adaptive_threshold = 0.02
    views = {
        "front_3q": ((0.85, -1.0, 0.62), 2.25),
        "side_left": ((1.0, -0.12, 0.25), 2.3),     # robot's left (+X) side
        "side_right": ((-1.0, -0.12, 0.25), 2.3),   # robot's right (-X) side
        "rear": ((0.18, 1.0, 0.32), 2.2),
        "bottom": ((0.05, 0.35, -1.0), 2.3)   # front at the bottom of the image, like ref4,
    }
    for name, (d, sc) in views.items():
        if ONLY and name != ONLY: continue
        place_camera(d, sc)
        ts = time.time()
        render_to(os.path.join(PREVIEW_DIR, name + ".png"))
        print(f"[probe] preview {name}: {time.time() - ts:.1f}s")
    stats["previews"] = time.time() - t1

if DO_SPRITES and not ONLY:
    t2 = time.time()
    os.makedirs(SPRITE_DIR, exist_ok=True)
    S = 192
    # at sprite size the bloom halo would be a big semi-transparent blob around the model:
    # keep the bloom inside the silhouette only (alpha = object alpha)
    if "alpha_gain" in GLOW: GLOW["alpha_gain"].default_value = 0.0
    scene.render.resolution_x = scene.render.resolution_y = S
    cy.samples = 64; cy.adaptive_threshold = 0.03
    elev = math.radians(15)
    # compute a scale that fits the model through the whole spin
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in bpy.data.objects:
        if o.type == "MESH" and not o.hide_render:
            pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    rh = max(math.hypot(p.x, p.y) for p in pts)
    zmin = min(p.z for p in pts); zmax = max(p.z for p in pts)
    zc = (zmin + zmax) / 2
    target.location = (0, 0, zc)
    half_v = (zmax - zmin) / 2 * math.cos(elev) + rh * math.sin(elev)
    ortho = 2 * max(rh, half_v) * 1.04
    place_camera((0, -math.cos(elev), math.sin(elev)), ortho)
    for f in range(FRAMES):   # frame 0 faces the camera, frame FRAMES/4 faces right
        root.rotation_euler = (0, 0, TAU * f / FRAMES)
        render_to(os.path.join(SPRITE_DIR, f"frame_{f:03d}.png"))
    root.rotation_euler = (0, 0, 0)
    target.location = (0, 0, 0)
    stats["sprites"] = time.time() - t2
    # pack 8x4 sheet
    cols, rows = SHEET_COLS, FRAMES // SHEET_COLS
    sheet = np.zeros((rows * S, cols * S, 4), np.float32)
    for f in range(FRAMES):
        p = os.path.join(SPRITE_DIR, f"frame_{f:03d}.png")
        im = bpy.data.images.load(p)
        px = np.empty(S * S * 4, np.float32); im.pixels.foreach_get(px)
        px = px.reshape(S, S, 4)                       # bottom-up rows
        c, r = f % cols, f // cols
        y0 = (rows - 1 - r) * S                        # sheet row 0 at the top
        sheet[y0:y0 + S, c * S:(c + 1) * S] = px
        bpy.data.images.remove(im)
    out = bpy.data.images.new("probe_sheet", cols * S, rows * S, alpha=True)
    out.alpha_mode = "STRAIGHT"
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = os.path.join(SPRITE_DIR, "probe_sheet.png")
    out.file_format = "PNG"
    out.save()
    for p in glob.glob(os.path.join(SPRITE_DIR, "frame_*.png")):
        os.remove(p)
    print(f"[probe] sheet {os.path.getsize(out.filepath_raw) / 1e6:.2f} MB, ortho {ortho:.3f}")

print("[probe] timings:", {k: round(v, 1) for k, v in stats.items()}, "total", round(time.time() - t0, 1))
