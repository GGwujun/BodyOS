"""
页面背景图生成器(纯 PIL/numpy,不依赖手绘图)。

为什么要有这个脚本:四张背景(首页页头、训练页头、页脚小景、我的页叶子)
在参考稿里都是**水彩山峦 / 叶脉**那一路,直接画几何多边形会显得像拼贴。
这里用「平滑山脊 + 低频噪声 + 雾气 + 纸纹」去模拟水彩的层叠,
叶子则用参数曲线勾形、渐变填色、主脉/侧脉分层描线。

产出:
  assets/home-hero.png      750×420
  assets/training-hero.png  750×520
  assets/quote-bg.png       750×300
  assets/profile-leaves.png 750×620

运行:  python scripts/gen-art.py
"""

import math
import os

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets')
S = 3  # 超采样倍数

PAPER = (247, 244, 235)
MIST = (255, 253, 247)


# ---------------------------------------------------------------- 基础工具
def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def value_noise(w, h, scale, seed, octaves=3):
    """低频分形噪声(0~1)。用来给色块加纸纹/水渍,不是逐像素白噪。"""
    rng = np.random.default_rng(seed)
    total = np.zeros((h, w), dtype=np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        gw = max(2, int(w / scale / (1.7 ** o)) + 3)
        gh = max(2, int(h / scale / (1.7 ** o)) + 3)
        grid = rng.random((gh, gw)).astype(np.float32)
        layer = Image.fromarray((grid * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        total += amp * (np.asarray(layer, dtype=np.float32) / 255.0)
        norm += amp
        amp *= 0.55
    return total / norm


def put_rgba(canvas, color, alpha):
    """把 (r,g,b) + 0~1 alpha 贴到画布上。"""
    layer = np.zeros((canvas.height, canvas.width, 4), dtype=np.uint8)
    layer[:, :, 0], layer[:, :, 1], layer[:, :, 2] = color
    layer[:, :, 3] = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    return Image.alpha_composite(canvas, Image.fromarray(layer, 'RGBA'))


def fade_edges(canvas, left=0.0, bottom=0.03, right=0.0):
    w, h = canvas.size
    a = np.asarray(canvas.getchannel('A'), dtype=np.float32) / 255.0
    if bottom:
        y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
        a *= smoothstep((1 - y) / bottom)
    if left:
        x = np.linspace(0, 1, w, dtype=np.float32)[None, :]
        a *= 1 - left + left * smoothstep(x / 0.5)
    if right:
        x = np.linspace(0, 1, w, dtype=np.float32)[None, :]
        a *= 1 - right + right * smoothstep((1 - x) / 0.5)
    canvas.putalpha(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), 'L'))
    return canvas


# ---------------------------------------------------------------- 山脊
def ridge_mask(w, h, base, bumps, slope=0.0, wobble=0.012, seed=1):
    """
    一条山脊的实心遮罩。
    bumps: [(高度比例, 中心 x 比例, 宽度比例)] —— 高斯峰,叠出山形;
    wobble: 低频起伏,让山脊线不是一条数学曲线。
    """
    xs = np.arange(w, dtype=np.float32) / w
    ys = np.full_like(xs, base) - slope * (xs - 0.5)
    for amp, mu, sigma in bumps:
        ys -= amp * np.exp(-((xs - mu) ** 2) / (2 * sigma ** 2))
    rng = np.random.default_rng(seed)
    for f, amp in ((1.3, 0.5), (2.7, 0.3), (5.1, 0.2)):
        ys += wobble * amp * np.sin(2 * math.pi * f * xs + rng.uniform(0, 6.28))
    ys = np.clip(ys, 0.02, 1.02) * h

    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    pts = [(0, h)] + [(float(x), float(y)) for x, y in zip(range(w), ys)] + [(w, h)]
    d.polygon(pts, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.6 * S))
    return mask


def add_ridge(canvas, base, bumps, color, alpha, seed, slope=0.0, wobble=0.012, blur=1.6):
    w, h = canvas.size
    mask = ridge_mask(w, h, base, bumps, slope, wobble, seed)
    if blur != 1.6:
        mask = mask.filter(ImageFilter.GaussianBlur(blur * S))
    m = np.asarray(mask, dtype=np.float32) / 255.0
    # 水彩:大块色不匀 + 纸纹
    wash = value_noise(w, h, w // 6, seed + 40, 3)
    grain = value_noise(w, h, w // 90, seed + 80, 2)
    a = m * alpha * (0.72 + 0.56 * wash) * (0.94 + 0.12 * grain)
    canvas = put_rgba(canvas, color, np.clip(a, 0, 1))
    return canvas


def add_mist(canvas, cy, thickness, alpha, seed, x0=0.0, x1=1.0):
    w, h = canvas.size
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    x = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    band = np.exp(-((y - cy) ** 2) / (2 * thickness ** 2))
    horiz = smoothstep((x - x0) / 0.18) * smoothstep((x1 - x) / 0.18)
    n = value_noise(w, h, w // 5, seed, 3)
    a = band * horiz * (0.55 + 0.65 * n) * alpha
    return put_rgba(canvas, MIST, np.clip(a, 0, 1))


def add_glow(canvas, cx, cy, rx, ry, color, alpha, seed=5):
    w, h = canvas.size
    x = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
    n = value_noise(w, h, w // 4, seed, 2)
    a = np.exp(-d * 2.2) * (0.7 + 0.3 * n) * alpha
    return put_rgba(canvas, color, np.clip(a, 0, 1))


def add_paper_grain(canvas, amount=0.10, seed=0):
    """给已画好的东西罩一层极轻的纸纹(只调透明度,不加新颜色)。

    水彩的「手作感」一半来自色块边缘,另一半来自纸 —— 纯色块在手机上会显得像
    UI 组件而不是画。amount 别超过 .15,否则小图缩下来会露噪点。
    """
    w, h = canvas.size
    n = value_noise(w, h, max(2, w // 70), seed, 2) - 0.5
    a = np.asarray(canvas.getchannel('A'), dtype=np.float32) / 255.0
    a = np.clip(a * (1.0 + amount * 2.0 * n), 0, 1)
    canvas.putalpha(Image.fromarray((a * 255).astype(np.uint8), 'L'))
    return canvas


# ---------------------------------------------------------------- 叶子
def leaf_geometry(cx, cy, length, width_frac, angle, bend, n=96):
    """返回 (左缘, 右缘, 中轴) 三组点。angle 以屏幕坐标弧度计(0=向右, 正值向下)。"""
    ca, sa = math.cos(angle), math.sin(angle)
    left, right, spine = [], [], []
    for i in range(n + 1):
        t = i / n
        px = cx + ca * length * t - sa * bend * length * math.sin(math.pi * t)
        py = cy + sa * length * t + ca * bend * length * math.sin(math.pi * t)
        dx = ca * length - sa * bend * length * math.pi * math.cos(math.pi * t)
        dy = sa * length + ca * bend * length * math.pi * math.cos(math.pi * t)
        norm = math.hypot(dx, dy) or 1
        nx, ny = -dy / norm, dx / norm
        half = width_frac * length * (math.sin(math.pi * (t ** 0.98)) ** 0.9) * (1 - 0.2 * t)
        spine.append((px, py))
        left.append((px + nx * half, py + ny * half))
        right.append((px - nx * half, py - ny * half))
    return left, right, spine


def draw_leaf(canvas, cx, cy, length, width_frac, angle, bend, dark, light, alpha, seed=0,
              feather=1.1, outline=True):
    """
    一片叶子:渐变压暗/提亮 + 主脉 + 两级侧脉,整体再乘叶子形状遮罩。
    dark/light 是同一族绿的两端;alpha 是整片叶子的不透明度。
    feather 放大后叶子边缘更虚 —— 做页头背景时用它把叶子推到「远处」;
    outline 是叶缘那一圈亮边,只给前景的大叶子,虚景不要。
    """
    w, h = canvas.size
    left, right, spine = leaf_geometry(cx, cy, length, width_frac, angle, bend)
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).polygon(left + right[::-1], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather * S))
    m = np.asarray(mask, dtype=np.float32) / 255.0

    # 叶面:沿垂直方向做一层很轻的明暗,再铺一层大块水渍
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    xx = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    shade = np.clip(0.55 + 0.45 * (0.5 - yy), 0, 1)
    wash = value_noise(w, h, w // 8, seed + 11, 3)
    a = m * alpha * (0.86 + 0.24 * wash)
    layer = np.zeros((h, w, 4), dtype=np.uint8)
    for ch, lo, hi in ((0, dark[0], light[0]), (1, dark[1], light[1]), (2, dark[2], light[2])):
        layer[:, :, ch] = (lo + (hi - lo) * shade * 0.95).astype(np.uint8)
    layer[:, :, 3] = np.clip(a * 255, 0, 255).astype(np.uint8)
    canvas = Image.alpha_composite(canvas, Image.fromarray(layer, 'RGBA'))

    # 侧光:叶面不是一块平色 —— 左上受光、右下背光的极轻一层,叶子才有体积
    lightm = m * np.clip((0.62 - (xx * 0.55 + yy * 0.45)) * 1.7, 0, 1) * 0.22
    canvas = put_rgba(canvas, tuple(min(255, c + 26) for c in light), lightm)
    shadow = m * np.clip(((xx * 0.55 + yy * 0.45) - 0.62) * 1.5, 0, 1) * 0.18
    canvas = put_rgba(canvas, tuple(max(0, c - 10) for c in dark), shadow)

    # 叶脉画在一张透明图上,再整张裁进叶形里
    vein = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vein)
    vc = (min(255, light[0] + 24), min(255, light[1] + 24), min(255, light[2] + 24),
          int(60 * alpha + 18))
    if outline:
        # 叶缘一圈极细的亮边,让叶子从深绿底上「浮」起来。
        # 只有前景的大叶子需要它:远处那片虚叶再描边就成了贴纸
        rim = left + right[::-1] + [left[0]]
        vd.line(rim, fill=(vc[0], vc[1], vc[2], int(vc[3] * 0.55)),
                width=max(1, int(0.7 * S)), joint='curve')
    vd.line(spine, fill=vc, width=max(1, int(1.7 * S)), joint='curve')
    rng = np.random.default_rng(seed + 3)
    for i in range(7, len(spine) - 8, 7):
        for side in (-1, 1):
            t = i / (len(spine) - 1)
            sx, sy = spine[i]
            ex, ey = spine[min(len(spine) - 1, i + 9)]
            nx, ny = (sy - ey), (ex - sx)
            norm = math.hypot(nx, ny) or 1
            reach = width_frac * length * math.sin(math.pi * (t ** 0.9)) * 0.78 * side
            ctrl_x = sx + (ex - sx) * 0.55 + nx / norm * reach * 0.55
            ctrl_y = sy + (ey - sy) * 0.55 + ny / norm * reach * 0.55
            end_x = sx + (ex - sx) * 0.95 + nx / norm * reach
            end_y = sy + (ey - sy) * 0.95 + ny / norm * reach
            pts = []
            for k in range(9):
                u = k / 8
                px = (1 - u) ** 2 * sx + 2 * (1 - u) * u * ctrl_x + u * u * end_x
                py = (1 - u) ** 2 * sy + 2 * (1 - u) * u * ctrl_y + u * u * end_y
                pts.append((px, py))
            vd.line(pts, fill=vc, width=max(1, int(0.8 * S)))
            # 二级脉:从侧脉中段再分出去一小截
            if 0.25 < t < 0.75 and rng.random() < 0.7:
                mx = (sx + end_x) / 2
                my = (sy + end_y) / 2
                vd.line([(mx, my), (mx + (end_x - mx) * 0.75 + side * 3 * S,
                                    my + (end_y - my) * 0.75 + 2 * S)],
                        fill=(vc[0], vc[1], vc[2], int(vc[3] * 0.6)),
                        width=max(1, int(0.55 * S)))
    va = ImageChops.multiply(vein.getchannel('A'), mask)
    vein.putalpha(va)
    return Image.alpha_composite(canvas, vein)


def draw_stem(canvas, points, color, alpha, width):
    w, h = canvas.size
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.line(points, fill=color + (alpha,), width=width, joint='curve')
    return Image.alpha_composite(canvas, layer.filter(ImageFilter.GaussianBlur(0.4 * S)))


def draw_sprig(canvas, bx, by, length, angle, bend, count, leaf_len, width_frac,
               dark, light, alpha, seed=0):
    """
    一根小枝:主枝沿弧线伸出去,两侧交替长几片细叶。
    比「三片大叶子」更像植物 —— 参考稿页脚那种枝条就是这个密度。
    """
    w, h = canvas.size
    stem = []
    for i in range(25):
        t = i / 24
        px = bx + math.cos(angle) * length * t - math.sin(angle) * bend * length * math.sin(math.pi * t)
        py = by + math.sin(angle) * length * t + math.cos(angle) * bend * length * math.sin(math.pi * t)
        stem.append((px, py))
    canvas = draw_stem(canvas, stem, dark, int(alpha * 150), max(1, int(1.1 * S)))
    rng = np.random.default_rng(seed + 9)
    for i in range(count):
        t = 0.16 + 0.74 * i / max(1, count - 1)
        idx = min(len(stem) - 1, int(t * (len(stem) - 1)))
        sx, sy = stem[idx]
        # 沿枝条方向的切线
        tx, ty = stem[min(len(stem) - 1, idx + 2)]
        tangent = math.atan2(ty - sy, tx - sx)
        side = -1 if i % 2 == 0 else 1
        la = tangent + side * (1.05 + rng.uniform(-0.12, 0.12))
        tip = leaf_len * (0.78 + 0.34 * math.sin(math.pi * min(1.0, t * 1.2)))
        canvas = draw_leaf(canvas, sx, sy, tip, width_frac, la, side * 0.08,
                           dark, light, alpha * 0.95, seed + 30 + i)
    return canvas


# ---------------------------------------------------------------- 四张图
def make_home():
    w, h = 750 * S, 420 * S
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    # 五层山脊,峰一个比一个靠前、靠深 —— 参考稿那种「远山淡、近山绿」的层次。
    # 参考图整体是**高调**的:山最高的一层也只到页头中段,颜色压得很浅,
    # 文字压上去不需要额外蒙一层白。所以这里的 alpha 都比「看着够」再低一档,
    # 靠层数(不是靠深浅)拉出空间。
    c = add_ridge(c, 0.56, [(0.22, 0.42, 0.085), (0.26, 0.58, 0.08), (0.20, 0.72, 0.075),
                            (0.24, 0.86, 0.07), (0.15, 0.95, 0.065)],
                  (206, 219, 203), 0.34, 11, slope=0.05, wobble=0.008)
    c = add_mist(c, 0.58, 0.075, 0.55, 21, x0=0.26)
    c = add_ridge(c, 0.69, [(0.24, 0.46, 0.075), (0.28, 0.62, 0.08), (0.21, 0.78, 0.07),
                            (0.25, 0.92, 0.065)],
                  (191, 209, 188), 0.36, 12, slope=0.07, wobble=0.007)
    c = add_mist(c, 0.71, 0.06, 0.48, 22, x0=0.30)
    c = add_ridge(c, 0.83, [(0.21, 0.35, 0.09), (0.27, 0.54, 0.085), (0.19, 0.70, 0.075),
                            (0.25, 0.86, 0.08)],
                  (172, 196, 171), 0.33, 13, slope=0.09, wobble=0.006)
    c = add_ridge(c, 0.95, [(0.13, 0.42, 0.13), (0.17, 0.66, 0.12), (0.11, 0.88, 0.11)],
                  (160, 186, 161), 0.20, 14, slope=0.05, wobble=0.004)
    c = add_mist(c, 0.87, 0.05, 0.36, 23, x0=0.04)

    # 天光:右上角一点极淡的暖光,不是一颗太阳
    c = add_glow(c, 0.84, 0.16, 0.34, 0.40, (255, 251, 237), 0.34, 31)

    c = add_paper_grain(c, 0.08, 32)
    fade_edges(c, left=0.94, bottom=0.05)
    c = c.resize((600, 336), Image.LANCZOS)
    c.save(os.path.join(OUT, 'home-hero.png'), optimize=True)


def make_training():
    """训练页头:**大叶子框住,不是山水**。

    参考稿这一张是「植物从卡片两角探进来」,和首页那幅远山是同一套自然语言、
    但不是一个景 —— 首页在「开始今天」,训练页在「去做」。大叶子的包围感比
    远山更适合后者,所以这里只留叶子,把中间整块让给标题和按钮。
    """
    w, h = 750 * S, 520 * S
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    # 先铺枝,再压叶子 —— 枝从卡片右上角外伸进来,只露出很短一截
    c = draw_stem(c, [(w * 1.05, h * -0.03), (w * 0.94, h * 0.11), (w * 0.85, h * 0.28)],
                  (98, 141, 105), 70, max(1, int(1.9 * S)))

    # 叶子全用大 feather:它们是**景**,不是贴纸;只有最靠前的那两片才描边
    leaves = [
        # (cx, cy, len, width, angle, bend, dark, light, alpha, feather, outline, seed)
        (1.04, 0.01, 0.66, 0.190, 2.72, 0.06, (38, 82, 55), (156, 188, 144), 0.70, 1.7, True, 71),
        (1.10, 0.27, 0.55, 0.170, 3.05, 0.09, (42, 86, 59), (146, 179, 136), 0.54, 1.9, True, 72),
        (0.97, 0.47, 0.50, 0.150, 3.35, 0.08, (72, 116, 82), (172, 196, 159), 0.32, 2.1, False, 73),
        (1.12, 0.62, 0.42, 0.140, 2.85, 0.12, (50, 94, 66), (156, 186, 146), 0.26, 2.3, False, 74),
        (-0.03, 0.08, 0.52, 0.160, 0.56, 0.08, (80, 122, 88), (176, 200, 162), 0.17, 2.4, False, 75),
        (-0.04, 0.42, 0.38, 0.140, 0.96, 0.10, (76, 118, 85), (170, 196, 156), 0.13, 2.6, False, 76)
    ]
    for cx, cy, length, width, angle, bend, dark, light, alpha, feather, outline, seed in leaves:
        c = draw_leaf(c, w * cx, h * cy, h * length, width, angle, bend,
                      dark, light, alpha, seed, feather=feather, outline=outline)

    # 左上角一团几乎看不见的暖光:叶子那一侧是暗的,这一侧要有一点空气
    c = add_glow(c, 0.16, 0.16, 0.34, 0.38, (255, 252, 238), 0.40, 61)

    c = add_paper_grain(c, 0.07, 62)
    fade_edges(c, left=0.08, right=0.05, bottom=0.07)
    c = c.resize((600, 416), Image.LANCZOS)
    c.save(os.path.join(OUT, 'training-hero.png'), optimize=True)


def make_quote():
    """页脚小景:左山、右枝、中间留白。

    这张比页头小得多(widthFix 铺在 150px 高的卡上),细节会糊掉 ——
    所以只保留两个大形:左边一列山、右边一枝叶子。山故意**偏高、偏左**,
    右边的低下去,字落在中间才不会压在山脊线上。
    """
    w, h = 750 * S, 300 * S
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    # slope 为负 = 左边高、右边低(见 ridge_mask 的公式)
    c = add_ridge(c, 0.64, [(0.25, 0.10, 0.10), (0.21, 0.26, 0.09), (0.15, 0.42, 0.08),
                            (0.09, 0.58, 0.075)],
                  (196, 211, 193), 0.34, 81, slope=-0.06, wobble=0.006)
    c = add_mist(c, 0.66, 0.07, 0.46, 82, x0=0.0, x1=0.78)
    c = add_ridge(c, 0.79, [(0.21, 0.08, 0.09), (0.18, 0.24, 0.085), (0.13, 0.40, 0.08),
                            (0.08, 0.56, 0.075)],
                  (174, 195, 171), 0.36, 83, slope=-0.07, wobble=0.005)
    c = add_mist(c, 0.81, 0.055, 0.40, 84, x0=0.0, x1=0.82)
    c = add_ridge(c, 0.93, [(0.13, 0.14, 0.13), (0.11, 0.34, 0.12), (0.08, 0.54, 0.11)],
                  (163, 188, 161), 0.24, 85, slope=-0.04, wobble=0.004)

    # 两角各一小枝,中间整块留给字
    c = draw_sprig(c, w * -0.01, h * 1.05, h * 0.78, -0.62, -0.16, 4, h * 0.15, 0.10,
                   (128, 158, 129), (184, 201, 173), 0.20, 86)
    c = draw_sprig(c, w * 1.02, h * 0.10, h * 0.70, 2.50, 0.15, 5, h * 0.15, 0.10,
                   (118, 150, 120), (176, 194, 166), 0.28, 88)

    c = add_paper_grain(c, 0.08, 89)
    fade_edges(c, left=0.10, right=0.10, bottom=0.06)
    c = c.resize((600, 240), Image.LANCZOS)
    c.save(os.path.join(OUT, 'quote-bg.png'), optimize=True)


def make_profile():
    w, h = 750 * S, 620 * S
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0))

    # 叶子的位置**按参考稿**:从右上角的枝上向左下铺开,右下角再来一簇;
    # 左下角补两片很淡的,避免整块深绿只剩右上角有内容。
    # 这一页的叶子是**主体**,不是景:不用虚化,最外面那两片保留叶缘亮边,
    # 里面的几片去掉描边 —— 每片都描一圈,叠在一起会像剪纸。
    leaves = [
        # (cx, cy, len, width, angle, bend, dark, light, alpha, feather, outline, seed)
        (1.07, -0.06, 0.88, 0.170, 2.58, 0.06, (13, 50, 37), (112, 176, 140), 0.94, 1.2, True, 101),
        (1.10, 0.12, 0.76, 0.160, 2.16, 0.10, (11, 46, 33), (98, 164, 129), 0.88, 1.3, True, 102),
        (0.95, 0.03, 0.66, 0.150, 3.04, 0.08, (18, 60, 45), (120, 182, 147), 0.64, 1.6, False, 103),
        (1.08, 0.37, 0.70, 0.155, 2.38, 0.12, (10, 43, 31), (90, 156, 122), 0.80, 1.4, False, 104),
        (0.96, 0.29, 0.56, 0.135, 2.72, 0.14, (12, 48, 35), (96, 162, 128), 0.58, 1.7, False, 108),
        (0.87, 0.50, 0.46, 0.125, 3.20, 0.10, (16, 58, 43), (104, 168, 133), 0.42, 2.0, False, 109),
        (0.92, 0.62, 0.52, 0.140, 2.86, 0.10, (14, 52, 39), (108, 172, 137), 0.50, 1.8, False, 105),
        (-0.06, 1.03, 0.50, 0.140, -0.62, 0.10, (13, 50, 37), (100, 166, 131), 0.38, 2.1, False, 106),
        (0.10, 1.08, 0.40, 0.120, -0.95, 0.12, (16, 57, 43), (110, 174, 139), 0.28, 2.3, False, 107)
    ]
    for cx, cy, length, width, angle, bend, dark, light, alpha, feather, outline, seed in leaves:
        c = draw_leaf(c, w * cx, h * cy, h * length, width, angle, bend,
                      dark, light, alpha, seed, feather=feather, outline=outline)

    # 枝 / 叶柄
    c = draw_stem(c, [(w * 1.04, h * -0.02), (w * 0.93, h * 0.14), (w * 0.88, h * 0.34)],
                  (74, 138, 108), 130, int(2.2 * S))
    c = draw_stem(c, [(w * 1.02, h * 0.06), (w * 0.96, h * 0.22), (w * 0.99, h * 0.44)],
                  (66, 126, 99), 105, int(1.4 * S))

    # 极淡的颗粒,让大面积深绿上有一点画布质感
    c = add_paper_grain(c, 0.07, 120)
    c = c.resize((600, 496), Image.LANCZOS)
    c.save(os.path.join(OUT, 'profile-leaves.png'), optimize=True)


if __name__ == '__main__':
    make_home()
    make_training()
    make_quote()
    make_profile()
    print('art regenerated in', os.path.normpath(OUT))
