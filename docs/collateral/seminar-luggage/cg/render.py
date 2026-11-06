"""講演スライド用の 3DCG（Blender / bpy）。人物は描かず「物」だけを、黒背景のスタジオ光で撮る。

  python3 cg/render.py s01 [--w 1920 --h 1080 --samples 96] [--out photos/s01.jpg]
  python3 cg/render.py all

シーン:
  s01 床を埋め尽くす大量のスーツケース（Over Luggage）
  s02 ローラーコンベアで運ばれていくスーツケース（人と別のルート）
  s03 駅ホームの端、点字ブロックの横のスーツケース
  s05 石のカウンターに置かれた紙のショッピングバッグ
  s07 ショッピングバッグと、白いラベルを貼った配送箱
  s08 霧の中に続く鳥居

構図はスライドの文字位置（slides.json の anchor）を避けて組んである。
画像に文字は入れない。
"""
import argparse
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

DIR = Path(__file__).resolve().parent.parent
BG = 10 / 255  # スライド背景 #0A0A0A


# ---------------------------------------------------------------- 基本
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8
    sc.render.film_transparent = False
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        try:
            sc.view_settings.look = "Medium High Contrast"
        except TypeError:
            pass
    world = bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0
    return sc


def mat(name, color, rough=0.4, metal=0.0, coat=0.0, emit=None, emit_strength=0.0, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    for key in ("Coat Weight", "Clearcoat"):
        if key in b.inputs:
            b.inputs[key].default_value = coat
            break
    for key in ("Specular IOR Level", "Specular"):
        if key in b.inputs:
            b.inputs[key].default_value = spec
            break
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_strength
    return m


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


def box(name, size, loc, material, bevel=0.0, segs=4, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = o.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segs
        mod.limit_method = "NONE"
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth() if bevel else None
    return o


def cyl(name, r, depth, loc, material, rot=(0, 0, 0), verts=48):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return o


def parent_all(objs, name):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        o.parent = root
    return root


def bake(root):
    """部品（子オブジェクト）を 1 つのメッシュに焼き込む。以後は bpy.data で軽く複製できる"""
    vl = bpy.context.view_layer
    kids = [c for c in root.children]
    bpy.ops.object.select_all(action="DESELECT")
    for c in kids:
        c.select_set(True)
    vl.objects.active = kids[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    o = vl.objects.active
    loc, rot = root.location.copy(), root.rotation_euler.copy()
    bpy.data.objects.remove(root)
    o.location, o.rotation_euler = loc, rot
    return o


def clone(src, name, loc, rot_z=0.0, scale=1.0, color=None):
    o = bpy.data.objects.new(name, src.data)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (0, 0, rot_z)
    o.scale = (scale, scale, scale)
    if color:
        o.color = (*srgb(color), 1)
    return o


def object_color_mat(name, rough=0.22, coat=0.6):
    """色はオブジェクトごと（Object Info の Color）。同じ形を色違いで大量に並べる用"""
    m = mat(name, (0.2, 0.2, 0.2), rough=rough, coat=coat)
    nt = m.node_tree
    info = nt.nodes.new("ShaderNodeObjectInfo")
    nt.links.new(info.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    return m


def area(name, loc, target, size, power, color=(1, 1, 1), shape="RECTANGLE", size_y=None):
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power
    d.color = color
    d.shape = shape
    d.size = size
    if size_y:
        d.size_y = size_y
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.visible_camera = False
    look_at(o, target)
    return o


def spot(name, loc, target, power, angle=40, blend=0.6, color=(1, 1, 1), radius=0.2):
    d = bpy.data.lights.new(name, "SPOT")
    d.energy = power
    d.color = color
    d.spot_size = math.radians(angle)
    d.spot_blend = blend
    d.shadow_soft_size = radius
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    look_at(o, target)
    return o


def look_at(o, target):
    v = Vector(target) - o.location
    o.rotation_euler = v.to_track_quat("-Z", "Y").to_euler()


def camera(loc, target, lens=50, dof=None, fstop=2.8, shift=(0, 0)):
    c = bpy.data.cameras.new("Cam")
    c.lens = lens
    c.shift_x, c.shift_y = shift
    if dof:
        c.dof.use_dof = True
        c.dof.focus_distance = dof
        c.dof.aperture_fstop = fstop
    o = bpy.data.objects.new("Cam", c)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    look_at(o, target)
    bpy.context.scene.camera = o
    return o


def floor(material, size=60, z=0.0):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    o = bpy.context.active_object
    o.name = "Floor"
    o.data.materials.append(material)
    return o


def fog(density, color=(1, 1, 1), size=40, z=0):
    """空間全体にうすい霧（光の筋と奥行きを出す）"""
    bpy.ops.mesh.primitive_cube_add(size=size, location=(0, 0, z))
    o = bpy.context.active_object
    o.name = "Fog"
    m = bpy.data.materials.new("Fog")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = density
    vol.inputs["Color"].default_value = (*color, 1)
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    o.data.materials.append(m)
    o.visible_shadow = False
    return o


# ---------------------------------------------------------------- 小物
def suitcase(name, loc, rot_z=0.0, scale=1.0, color="#3A3D42", rough=0.22, handle_up=False, seed=0, shell_mat=None):
    """ハードシェルのスーツケース（縦リブ・ジッパー帯・伸縮ハンドル・4輪）"""
    s = scale
    W, D, H = 0.44 * s, 0.27 * s, 0.68 * s
    z0 = 0.06 * s  # 車輪の高さ
    shell = shell_mat or mat(f"{name}_shell", srgb(color), rough=rough, coat=0.6)
    dark = mat(f"{name}_dark", srgb("#141414"), rough=0.5)
    metal = mat(f"{name}_metal", srgb("#B8BCC2"), rough=0.25, metal=1.0)
    parts = []
    # 前後のシェル（間にジッパー帯）
    gap = 0.012 * s
    for side in (-1, 1):
        parts.append(box(f"{name}_half", (W, D / 2 - gap / 2, H), (0, side * (D / 4 + gap / 4), z0 + H / 2), shell, bevel=0.05 * s, segs=6))
    parts.append(box(f"{name}_zip", (W - 0.03 * s, gap * 1.6, H - 0.03 * s), (0, 0, z0 + H / 2), dark, bevel=0.03 * s, segs=4))
    # 縦リブ（前面）
    for i in range(-2, 3):
        parts.append(box(f"{name}_rib", (0.022 * s, 0.012 * s, H * 0.78), (i * W * 0.17, -D / 2 - 0.002 * s, z0 + H / 2), shell, bevel=0.006 * s, segs=3))
    # 伸縮ハンドルのハウジングとグリップ
    hz = z0 + H + (0.32 * s if handle_up else 0.012 * s)
    for x in (-W * 0.3, W * 0.3):
        if handle_up:
            parts.append(cyl(f"{name}_rod", 0.009 * s, 0.34 * s, (x, D * 0.32, z0 + H + 0.16 * s), metal))
    parts.append(box(f"{name}_grip", (W * 0.66, 0.035 * s, 0.03 * s), (0, D * 0.32, hz), dark, bevel=0.012 * s))
    # 上部の持ち手
    parts.append(box(f"{name}_top", (W * 0.36, 0.03 * s, 0.025 * s), (0, -D * 0.05, z0 + H + 0.012 * s), dark, bevel=0.01 * s))
    # 4輪（ダブルキャスター）
    for x in (-W / 2 + 0.05 * s, W / 2 - 0.05 * s):
        for y in (-D / 2 + 0.04 * s, D / 2 - 0.04 * s):
            parts.append(box(f"{name}_caster", (0.05 * s, 0.05 * s, 0.03 * s), (x, y, z0 - 0.006 * s), dark, bevel=0.01 * s))
            for dx in (-0.014, 0.014):
                parts.append(cyl(f"{name}_wheel", 0.024 * s, 0.014 * s, (x + dx * s, y, 0.026 * s), dark, rot=(0, math.pi / 2, 0), verts=32))
    root = parent_all(parts, name)
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    return root


def shopping_bag(name, loc, rot_z=0.0, size=(0.36, 0.14, 0.42), color="#E9E4DC", rope="#1A1A1A"):
    """紙のショッピングバッグ（口を少し開け、ロープの持ち手）"""
    W, D, H = size
    paper = mat(f"{name}_paper", srgb(color), rough=0.75, spec=0.3)
    inner = mat(f"{name}_inner", srgb("#BDB6AA"), rough=0.85)
    cord = mat(f"{name}_rope", srgb(rope), rough=0.6)
    parts = []
    t = 0.003
    # 側面4枚（中空）
    parts.append(box(f"{name}_f", (W, t, H), (0, -D / 2, H / 2), paper, bevel=0.0015, segs=2))
    parts.append(box(f"{name}_b", (W, t, H), (0, D / 2, H / 2), paper, bevel=0.0015, segs=2))
    parts.append(box(f"{name}_l", (t, D, H), (-W / 2, 0, H / 2), paper, bevel=0.0015, segs=2))
    parts.append(box(f"{name}_r", (t, D, H), (W / 2, 0, H / 2), paper, bevel=0.0015, segs=2))
    parts.append(box(f"{name}_bottom", (W, D, t), (0, 0, t / 2), paper))
    parts.append(box(f"{name}_in", (W - 0.008, D - 0.008, 0.002), (0, 0, H - 0.05), inner))
    # 上端の折り返し（厚み）
    parts.append(box(f"{name}_rim_f", (W, 0.006, 0.04), (0, -D / 2 + 0.003, H - 0.02), paper))
    parts.append(box(f"{name}_rim_b", (W, 0.006, 0.04), (0, D / 2 - 0.003, H - 0.02), paper))
    # 側面の折り目（マチの縦の谷）
    crease = mat(f"{name}_crease", srgb(color), rough=0.75)
    crease.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*[v * 0.72 for v in srgb(color)], 1)
    for x in (-W / 2 - 0.0005, W / 2 + 0.0005):
        parts.append(box(f"{name}_cr", (0.001, 0.003, H * 0.92), (x, 0, H * 0.48), crease))
    # ロープの持ち手（前後）
    for y in (-D / 2 - 0.004, D / 2 + 0.004):
        curve = bpy.data.curves.new(f"{name}_rope", "CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = 0.0045
        curve.bevel_resolution = 4
        sp = curve.splines.new("BEZIER")
        sp.bezier_points.add(2)
        pts = [(-W * 0.22, y, H - 0.035), (0, y, H + 0.13), (W * 0.22, y, H - 0.035)]
        for bp, p in zip(sp.bezier_points, pts):
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = "AUTO"
        o = bpy.data.objects.new(f"{name}_rope", curve)
        bpy.context.scene.collection.objects.link(o)
        o.data.materials.append(cord)
        parts.append(o)
    root = parent_all(parts, name)
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    return root


def parcel(name, loc, rot_z=0.0, size=(0.46, 0.34, 0.26)):
    """段ボールの配送箱（テープと、文字のない白いラベル）"""
    W, D, H = size
    card = mat(f"{name}_card", srgb("#B48A5E"), rough=0.8, spec=0.25)
    tape = mat(f"{name}_tape", srgb("#C79A6B"), rough=0.35, spec=0.6)
    label = mat(f"{name}_label", srgb("#F4F3EF"), rough=0.55)
    parts = [box(f"{name}_box", (W, D, H), (0, 0, H / 2), card, bevel=0.006, segs=3)]
    parts.append(box(f"{name}_tape", (0.06, D + 0.002, 0.0015), (0, 0, H + 0.0006), tape))
    parts.append(box(f"{name}_tape2", (0.06, 0.0015, 0.08), (0, -D / 2 - 0.0006, H - 0.04), tape))
    parts.append(box(f"{name}_label", (0.15, 0.1, 0.0012), (W * 0.24, -D * 0.12, H + 0.0008), label, rot=(0, 0, math.radians(-3))))
    root = parent_all(parts, name)
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    return root


def torii(name, loc, rot_z=0.0, s=1.0, red="#C8442A"):
    """鳥居（柱・貫・笠木・島木）。柱の下は黒"""
    verm = mat(f"{name}_red", srgb(red), rough=0.55)
    black = mat(f"{name}_black", srgb("#101010"), rough=0.5)
    span, hgt = 1.9 * s, 2.7 * s
    parts = []
    for x in (-span / 2, span / 2):
        parts.append(cyl(f"{name}_post", 0.11 * s, hgt, (x, 0, hgt / 2), verm, verts=32))
        parts.append(cyl(f"{name}_foot", 0.125 * s, 0.32 * s, (x, 0, 0.16 * s), black, verts=32))
    parts.append(box(f"{name}_nuki", (span + 0.36 * s, 0.13 * s, 0.14 * s), (0, 0, hgt * 0.78), verm))
    parts.append(box(f"{name}_shimaki", (span + 0.62 * s, 0.2 * s, 0.13 * s), (0, 0, hgt + 0.02 * s), verm))
    parts.append(box(f"{name}_kasagi", (span + 0.9 * s, 0.26 * s, 0.11 * s), (0, 0, hgt + 0.15 * s), black, bevel=0.02 * s))
    root = parent_all(parts, name)
    root.location = loc
    root.rotation_euler = (0, 0, rot_z)
    return root


# ---------------------------------------------------------------- シーン
PALETTE = ["#2E3136", "#3B3F45", "#1F2226", "#5A5E64", "#8C9096", "#2A3442", "#4A4036", "#6E6A64", "#C9C6C0", "#23262B"]


def scene_s01():
    """大量のスーツケースが床を埋め尽くす。画面下 30% は暗い床（文字を載せる）"""
    floor(mat("floor", srgb("#0C0C0C"), rough=0.22))
    rnd = random.Random(7)
    shell = object_color_mat("shell_any")
    tpl = {h: bake(suitcase(f"tpl{h}", (0, -50, 0), handle_up=h, shell_mat=shell)) for h in (False, True)}
    for o in tpl.values():
        o.hide_render = True
    for row in range(14):
        for col in range(24):
            x = (col - 11.5) * 0.6 + rnd.uniform(-0.12, 0.12) + (0.3 if row % 2 else 0)
            y = 3.0 + row * 0.58 + rnd.uniform(-0.1, 0.1)
            clone(tpl[rnd.random() < 0.55], f"sc{row}_{col}", (x, y, 0), rot_z=rnd.uniform(-0.45, 0.45),
                  scale=rnd.choice([0.82, 0.95, 1.08, 1.12]), color=rnd.choice(PALETTE))
    spot("pool", (0.6, 4.0, 6.5), (0.8, 5.2, 0), 9000, angle=52, blend=1.0, color=(1.0, 0.95, 0.88), radius=0.6)
    area("rim", (0.5, 12.0, 2.6), (0.6, 3.5, 0.5), 5.0, 2600, color=(0.85, 0.9, 1.0))
    area("key", (-3.5, -1.0, 3.0), (0.5, 2.5, 0.4), 2.5, 420)
    fog(0.0008)
    camera((-0.2, -3.4, 2.05), (0.7, 4.6, 0.35), lens=40, dof=6.2, fstop=3.5)


def scene_s02():
    """ローラーコンベアで運ばれるスーツケース。文字は左下"""
    floor(mat("floor", srgb("#141414"), rough=0.4))
    steel = mat("steel", srgb("#9DA2A8"), rough=0.28, metal=1.0)
    frame = mat("frame", srgb("#26292D"), rough=0.45, metal=0.6)
    L = 14
    r0 = cyl("roller", 0.028, 0.9, (1.2, -2, 0.62), steel, rot=(0, math.pi / 2, 0), verts=24)
    for i in range(1, int(L / 0.12)):
        o = bpy.data.objects.new(f"roller{i}", r0.data)
        bpy.context.scene.collection.objects.link(o)
        o.location = (1.2, -2 + i * 0.12, 0.62)
        o.rotation_euler = r0.rotation_euler
    for x in (0.73, 1.67):
        box("rail", (0.05, L, 0.12), (x, -2 + L / 2, 0.64), frame, bevel=0.008)
    for i in range(10):
        for x in (0.75, 1.65):
            box("leg", (0.05, 0.05, 0.58), (x, -1.6 + i * 1.4, 0.29), frame)
    suitcase("main", (1.2, 1.1, 0.65), rot_z=math.radians(90), scale=1.12, color="#2E3136", seed=1)
    suitcase("far", (1.2, 3.4, 0.65), rot_z=math.radians(90), scale=1.0, color="#8C9096", seed=2)
    suitcase("far2", (1.2, 5.6, 0.65), rot_z=math.radians(90), scale=1.05, color="#2A3442", seed=3)
    area("key", (3.4, -0.5, 3.2), (1.2, 1.4, 0.8), 2.0, 700)
    spot("top", (1.2, 2.0, 4.5), (1.2, 2.6, 0.6), 2600, angle=50, blend=1.0, color=(1.0, 0.94, 0.86), radius=0.5)
    area("rim", (-1.0, 9.0, 2.0), (1.2, 3.0, 0.8), 4.0, 900)
    fog(0.0025)
    camera((-0.6, -2.2, 1.55), (1.25, 2.0, 0.85), lens=45, dof=3.6, fstop=2.8)


def scene_s03():
    """駅ホームの端。点字ブロックと白線の横にスーツケース。文字は上"""
    concrete = mat("concrete", srgb("#3A3B3D"), rough=0.6)
    floor(concrete)
    yellow = mat("tactile", srgb("#E3B21A"), rough=0.55)
    white = mat("edgeline", srgb("#D8D8D4"), rough=0.5)
    pit = mat("pit", srgb("#050505"), rough=0.9)
    # ホームの縁（右側が線路へ落ちる）
    box("pit", (6, 40, 1.4), (3.95 + 3, 8, -0.7), pit)
    box("lip", (0.25, 40, 0.06), (3.85, 8, 0.0), mat("lip", srgb("#7A7C7E"), rough=0.6))
    box("edge", (0.12, 40, 0.004), (3.55, 8, 0.002), white)
    # 点字ブロック（警告ブロック：点状）
    parts = [box("tile", (0.3, 0.29, 0.008), (0, 0, 0.004), yellow)]
    for a in range(5):
        for b in range(5):
            parts.append(cyl("dot", 0.012, 0.01, (-0.12 + a * 0.06, -0.12 + b * 0.06, 0.013), yellow, verts=12))
    tile = bake(parent_all(parts, "tile"))
    tile.location = (3.1, -1.8, 0)
    for j in range(-5, 70):
        clone(tile, f"tile{j}", (3.1, j * 0.3, 0))
    suitcase("sc", (2.55, 1.6, 0), rot_z=math.radians(-18), scale=1.12, color="#2E3136", handle_up=True)
    area("sky", (5.5, 10.0, 5.0), (2.8, 2.0, 0), 10.0, 900, color=(0.75, 0.85, 1.0))
    spot("key", (1.2, 0.2, 3.4), (2.7, 1.7, 0.3), 2200, angle=34, blend=0.9, color=(1.0, 0.9, 0.78), radius=0.4)
    for k in range(6):  # ホーム屋根の照明が奥へ続く
        spot(f"roof{k}", (2.6, 4 + k * 4.0, 3.6), (2.9, 4 + k * 4.0, 0), 700, angle=60, blend=1.0, color=(1.0, 0.95, 0.88), radius=0.3)
    fog(0.004)
    camera((1.35, -1.9, 0.78), (2.95, 3.6, 0.2), lens=40, dof=3.9, fstop=4.0)


def scene_s05():
    """石のカウンターの上の紙袋。文字は左下"""
    floor(mat("floor", srgb("#0E0E0E"), rough=0.5))
    stone = mat("stone", srgb("#2C2B29"), rough=0.22, coat=0.3)
    box("counter", (3.6, 0.9, 0.9), (1.2, 0.3, 0.45), stone, bevel=0.01)
    shopping_bag("bag", (1.45, 0.3, 0.9), rot_z=math.radians(-38), color="#D9D2C5")
    spot("key", (2.4, -0.8, 2.4), (1.45, 0.3, 1.05), 700, angle=26, blend=0.9, color=(1.0, 0.93, 0.84), radius=0.3)
    area("rim", (0.6, 1.6, 1.7), (1.45, 0.3, 1.1), 1.2, 160, color=(0.9, 0.95, 1.0))
    area("fill", (-1.5, -2.0, 1.5), (1.45, 0.3, 1.0), 2.0, 25)
    camera((0.35, -2.25, 1.4), (1.2, 0.3, 1.08), lens=50, dof=2.6, fstop=2.8)


def scene_s07():
    """紙袋と配送箱。購入品が荷物（配送）に変わる。文字は左下"""
    floor(mat("floor", srgb("#0E0E0E"), rough=0.5))
    stone = mat("stone", srgb("#2C2B29"), rough=0.22, coat=0.3)
    box("counter", (3.6, 0.9, 0.9), (1.2, 0.3, 0.45), stone, bevel=0.01)
    shopping_bag("bag", (1.28, 0.36, 0.9), rot_z=math.radians(-30), color="#D9D2C5")
    parcel("box", (1.86, 0.22, 0.9), rot_z=math.radians(14))
    spot("key", (2.6, -0.9, 2.6), (1.55, 0.3, 1.0), 900, angle=32, blend=0.9, color=(1.0, 0.93, 0.84), radius=0.35)
    area("rim", (0.8, 1.8, 1.8), (1.55, 0.3, 1.1), 1.5, 200, color=(0.9, 0.95, 1.0))
    area("fill", (-1.5, -2.0, 1.5), (1.55, 0.3, 1.0), 2.0, 25)
    camera((0.45, -2.4, 1.42), (1.38, 0.3, 1.04), lens=45, dof=2.75, fstop=2.8)


def scene_s08():
    """霧の中に続く鳥居。夕方の斜光。文字は左下"""
    ground = mat("ground", srgb("#2A2622"), rough=0.85)
    floor(ground, size=200)
    stone = mat("path", srgb("#4A4640"), rough=0.7)
    box("path", (1.2, 120, 0.02), (0.9, 50, 0.01), stone)
    t0 = bake(torii("t0", (0.9, 1.5, 0), s=1.0))
    for i in range(1, 36):
        clone(t0, f"t{i}", (0.9, 1.5 + i * 0.85, 0))
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.0
    sun.color = (1.0, 0.72, 0.45)
    sun.angle = math.radians(2)
    so = bpy.data.objects.new("sun", sun)
    bpy.context.scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(72), 0, math.radians(-125))
    area("end", (0.9, 34, 2.0), (0.9, 0, 1.2), 4.0, 6000, color=(1.0, 0.78, 0.55))
    fog(0.06, color=(1.0, 0.9, 0.8), size=120, z=0)
    camera((0.25, -2.4, 1.15), (1.0, 8.0, 1.6), lens=32, dof=4.5, fstop=4.0)


SCENES = {"s01": scene_s01, "s02": scene_s02, "s03": scene_s03, "s05": scene_s05, "s07": scene_s07, "s08": scene_s08}


def render(name, w, h, samples, out):
    sc = reset()
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.cycles.samples = samples
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = "16"
    SCENES[name]()
    tmp = Path(out).with_suffix(".raw.png")
    sc.render.filepath = str(tmp)
    bpy.ops.render.render(write_still=True)
    return tmp


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("scene")
    ap.add_argument("--w", type=int, default=1920)
    ap.add_argument("--h", type=int, default=1080)
    ap.add_argument("--samples", type=int, default=96)
    ap.add_argument("--out", default=None)
    a = ap.parse_args(sys.argv[1:])
    names = list(SCENES) if a.scene == "all" else [a.scene]
    for n in names:
        out = a.out or str(DIR / "cg" / "renders" / f"{n}.png")
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        print("rendered", render(n, a.w, a.h, a.samples, out))
