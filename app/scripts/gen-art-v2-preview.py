"""
顶部背景图 · 第二轮设计稿生成器(纯 PIL/numpy,与 gen-art.py 同族但独立产出)。

为什么另开一个文件:这一轮只出「候选方向」给用户挑,不落 assets/,
输出全部进 scripts/art-preview/ —— 定稿后把选中分支搬进 gen-art.py 正式接管。

四个方向(都对齐品牌:暖纸底 #f7f4eb / 主绿 #176b55 / 卡片白 #fffefa):
  A 等高线   「身体的地形图」— 分形场的等值线 + 一条高亮主绿等高线 + 坐标点
  B 一笔律动  心电脉搏从左起笔,松成一道山脊 — 锥形笔触单线
  C 能量日出  同心弧像升起的太阳,也是 App 里能量环的呼应 — 弧长=进度
  D 折纸层林  硬边剪纸层峦 + 帐篷/树群/金日,告别雾蒙蒙

运行: python scripts/gen-art-v2-preview.py   (输出 scripts/art-preview/*.png)
"""

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), 'art-preview')
S = 3  # 超采样:矢量感全靠 3x 画完再 LANCZOS 缩回

W, H = 750, 420
PAPER = (247, 244, 235)
EMERALD = (23, 107, 85)
SAGE = (168, 195, 176)
GOLD = (216, 170, 74)


# ---------------------------------------------------------------- 基础工具
def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def value_noise(w, h, scale, seed, octaves=3):
    """低频分形噪声 0~1(gen-art.py 同款思路,给纸纹和场地用)。
    插值用余弦而不是 smoothstep:smoothstep 在格点处导数为零,会出「梯田」平台,
    等值线跟着长直角 —— 第一版 A 稿的等高线发碎就是这么来的。"""
    rng = np.random.default_rng(seed)
    total = np.zeros((h, w), dtype=np.float32)
    amp, freq = 1.0, 1.0 / scale
    norm = 0.0
    for _ in range(octaves):
        gw, gh = max(2, int(w * freq) + 2), max(2, int(h * freq) + 2)
        grid = rng.random((gh, gw)).astype(np.float32)
        xi = np.clip((np.arange(w) * freq).astype(int), 0, gw - 2)
        yi = np.clip((np.arange(h) * freq).astype(int), 0, gh - 2)
        xf = 0.5 - 0.5 * np.cos(np.pi * ((np.arange(w) * freq) - xi))
        yf = 0.5 - 0.5 * np.cos(np.pi * ((np.arange(h) * freq) - yi))
        a = grid[np.ix_(yi, xi)]
        b = grid[np.ix_(yi, xi + 1)]
        c = grid[np.ix_(yi + 1, xi)]
        dd = grid[np.ix_(yi + 1, xi + 1)]
        layer = (a * (1 - xf) + b * xf) * (1 - yf)[:, None] + (c * (1 - xf) + dd * xf) * yf[:, None]
        total += layer * amp
        norm += amp
        amp *= 0.5
        freq *= 2.1
    return total / norm


def paper_grain(size, seed=7, alpha=9):
    """纸纹:暖纸上极轻的噪点,让大色块不至于像塑料。"""
    w, h = size
    n = value_noise(w, h, 90, seed, octaves=4)
    grain = Image.new('RGBA', size, (0, 0, 0, 0))
    px = np.zeros((h, w, 4), dtype=np.uint8)
    px[..., 0], px[..., 1], px[..., 2] = 120, 110, 96
    px[..., 3] = (n * alpha).astype(np.uint8)
    grain.putdata(list(map(tuple, px.reshape(-1, 4))))
    return grain


def blank():
    return Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))


def finish(img, preview_path):
    """超采样缩回 + 纸纹 + 透版存档 + 合成纸底预览。"""
    img = img.resize((W, H), Image.LANCZOS)
    img = Image.alpha_composite(img, paper_grain((W, H)))
    img.save(preview_path + '.png')
    bg = Image.new('RGB', (W, H), PAPER)
    bg.paste(img, (0, 0), img)
    bg.save(preview_path + '-on-paper.png')
    return img


# ---------------------------------------------------------------- A 等高线
def opt_a():
    """等值线用 marching squares:场 = 两个高斯山包 + 分形细皱,线出自插值边点。"""
    img = blank()
    d = ImageDraw.Draw(img)
    gw, gh = 190, 106  # 网格够细,等值线的折点才不显
    xs = np.linspace(0, 1, gw)
    ys = np.linspace(0, 1, gh)
    X, Y = np.meshgrid(xs, ys)
    field = (
        0.58 * np.exp(-(((X - 0.63) ** 2) / 0.16 + ((Y - 0.40) ** 2) / 0.11))
        + 0.34 * np.exp(-(((X - 0.16) ** 2) / 0.10 + ((Y - 0.78) ** 2) / 0.09))
        + 0.07 * value_noise(gw, gh, 26, seed=11)
    )
    # 轻抹两遍平滑,去掉格点级的最后一点棱
    for _ in range(2):
        p = np.pad(field, 1, mode='edge')
        field = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:] + 2 * field) / 6
    levels = np.linspace(0.20, 0.70, 6)
    hi = 2  # 高亮那条主绿等高线(层距拉大,陡坡处的线不再扎堆)

    def seg(p1, p2, color, width):
        d.line([p1, p2], fill=color, width=width)

    for li, lv in enumerate(levels):
        major = li == hi
        color = EMERALD + (222,) if major else SAGE + (135 if li % 2 else 105,)
        width = (8 if major else 5) * S // 3  # 最终 ~2.7px / 1.7px,细线在缩略图里会断成虚线
        for j in range(gh - 1):
            for i in range(gw - 1):
                c = [field[j, i] > lv, field[j, i + 1] > lv, field[j + 1, i + 1] > lv, field[j + 1, i] > lv]
                case = sum(b << k for k, b in enumerate(c))
                if case in (0, 15):
                    continue
                x0, x1 = i / (gw - 1) * W * S, (i + 1) / (gw - 1) * W * S
                y0, y1 = j / (gh - 1) * H * S, (j + 1) / (gh - 1) * H * S
                v00, v10, v11, v01 = field[j, i], field[j, i + 1], field[j + 1, i + 1], field[j + 1, i]

                def lerp(a, va, b, vb):
                    t = (lv - va) / (vb - va) if vb != va else 0.5
                    return a + (b - a) * t

                top = (lerp(x0, v00, x1, v10), y0)
                right = (x1, lerp(y0, v10, y1, v11))
                bottom = (lerp(x0, v01, x1, v11), y1)
                left = (x0, lerp(y0, v00, y1, v01))
                edges = {1: [(top, right)], 2: [(right, bottom)], 3: [(top, bottom)], 4: [(bottom, left)],
                         5: [(top, left), (bottom, right)], 6: [(right, left)], 7: [(top, left)],
                         8: [(top, left)], 9: [(right, left)], 10: [(top, right), (bottom, left)],
                         11: [(bottom, left)], 12: [(left, bottom)], 13: [(right, bottom)], 14: [(top, right)]}
                for p1, p2 in edges[case]:
                    seg(p1, p2, color, width)

    # 坐标点:落在高亮等高线上 —— 沿主峰正上方的竖线,从画顶往下找 field 第一次穿过该等值线处
    icol = int(0.63 * (gw - 1))
    col = field[:, icol]
    lv_hi = levels[hi]
    cross = next((j for j in range(gh) if col[j] > lv_hi), None)
    frac = 0.20 if cross is None else cross / (gh - 1)
    cx, cy = int(0.63 * W * S), int(frac * H * S)
    r = 6 * S
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=EMERALD + (238,))
    r2 = 11 * S
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], outline=EMERALD + (150,), width=int(1.4 * S))
    return finish(img, os.path.join(OUT, 'opt-a-contour'))


# ---------------------------------------------------------------- B 一笔律动
def opt_b():
    """单线:左 1/3 心电脉冲(两个尖峰),随后松成山脊;锥形笔触=沿路径变半径的圆。"""
    img = blank()
    d = ImageDraw.Draw(img)

    def path_y(t):
        # t∈[0,1]: 0.10-0.28 两拍脉冲(上尖+下尖),之后正弦山脊缓下来
        pulse = 0.0
        for center, height, widthp, sign in ((0.13, -0.16, 0.014, -1), (0.155, 0.22, 0.008, 1), (0.19, -0.05, 0.010, -1), (0.235, 0.18, 0.009, 1)):
            pulse += sign * height * math.exp(-((t - center) ** 2) / widthp)
        ridge = 0.10 * math.sin(t * 5.1 + 1.2) * smoothstep(np.array((t - 0.30) / 0.12)) + 0.055 * math.sin(t * 9.3 + 0.4) * smoothstep(np.array((t - 0.34) / 0.2))
        base = -0.045 * smoothstep(np.array(t / 0.25))  # 起笔略抬
        return 0.56 + pulse + ridge + base

    def draw_stroke(alpha, color, radius_scale, dy=0.0):
        n = 900
        for k in range(n):
            t = k / (n - 1)
            x = (0.05 + t * 0.90) * W * S
            y = path_y(t) * H * S + dy * S
            w = (1.05 + 2.0 * math.sin(math.pi * t) ** 1.3) * radius_scale * S
            d.ellipse([x - w, y - w, x + w, y + w], fill=color + (alpha,))

    draw_stroke(64, SAGE, 1.5, dy=8)      # 底下那道虚影
    draw_stroke(232, EMERALD, 1.0)        # 主笔
    # 落点处的金色小日
    ex, ey = 0.905 * W * S, path_y(1.0) * H * S
    r = 8.5 * S
    d.ellipse([ex - r, ey - r - 4 * S, ex + r, ey + r - 4 * S], fill=GOLD + (225,))
    return finish(img, os.path.join(OUT, 'opt-b-pulse-line'))


# ---------------------------------------------------------------- C 能量日出
def opt_c():
    """日出扇面:圆心钉在右下角,弧只在朝左上的 90° 扇区里画 —— 半径封顶保证不裁边。
    每环弧长不同(像进度),底轨极淡,圆头帽;角上一枚半升的金日做焦点。"""
    img = blank()
    d = ImageDraw.Draw(img)
    cx, cy = W * S, H * S  # 正角落:扇面天然「从角上升起」
    A0, A1 = 182.0, 272.0  # 可见扇区(°),272° 直上方向离画顶还有余量
    rings = [
        (125, 0.05, 0.95, GOLD, 222),
        (192, 0.18, 0.72, (47, 160, 140), 210),
        (259, 0.10, 0.86, EMERALD, 218),
        (326, 0.30, 0.55, (133, 178, 155), 195),
        (393, 0.02, 0.40, (196, 214, 198), 165),
    ]
    for r, a0, sweep, color, alpha in rings:
        width = 13 * S
        bbox = [cx - r * S, cy - r * S, cx + r * S, cy + r * S]
        d.arc(bbox, A0, A1, fill=color + (40,), width=width)  # 底轨:整段扇区极淡
        s_start, s_end = A0 + a0 * (A1 - A0), A0 + (a0 + sweep) * (A1 - A0)
        d.arc(bbox, s_start, s_end, fill=color + (alpha,), width=width)
        for ang in (s_start, s_end):  # 圆头帽:半径=半宽,盖住 butt 端面
            px = cx + r * S * math.cos(math.radians(ang))
            py = cy + r * S * math.sin(math.radians(ang))
            rr = width / 2
            d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=color + (alpha,))
    # 两道超大虚弧当余晖(允许出血到画外,读作光晕不像断线)
    for r in (470, 560):
        d.arc([cx - r * S, cy - r * S, cx + r * S, cy + r * S], A0, A1,
              fill=SAGE + (26,), width=6 * S)
    # 角上半升的金日
    sr = 46 * S
    d.ellipse([cx - sr, cy - sr, cx + sr, cy + sr], fill=GOLD + (235,))
    return finish(img, os.path.join(OUT, 'opt-c-energy-rings'))


# ---------------------------------------------------------------- D 折纸层林
def opt_d():
    """硬边剪纸:四层山,每层顶部一条深色压边,最上层帐篷+树群,左上金日,两笔飞鸟。"""
    img = blank()
    d = ImageDraw.Draw(img)
    layers = [
        (0.52, (231, 239, 226), (208, 222, 204), 21),
        (0.63, (195, 216, 198), (168, 196, 176), 24),
        (0.75, (147, 185, 155), (120, 162, 132), 27),
        (0.88, (78, 138, 109), (58, 116, 90), 30),
    ]
    for li, (base, fill, edge, seed) in enumerate(layers):
        yy = base * H * S
        pts = []
        for k in range(0, W * S + 6 * S, 6 * S):
            t = k / (W * S)
            y = yy - (math.sin(t * (5.2 + li * 2.2) + seed) * (0.030 + 0.012 * li)
                      + math.sin(t * (11.7 + li * 3.1) + seed * 2.3) * 0.012
                      + math.sin(t * (2.1 + li) + seed * 0.7) * (0.045 - 0.008 * li)) * H * S
            pts.append((k, y))
        poly = pts + [(W * S, H * S), (0, H * S)]
        d.polygon(poly, fill=fill + (255,))
        # 压边:沿顶边一条深色线,剪纸的「切边」
        d.line(pts, fill=edge + (255,), width=int(2.2 * S), joint='curve')

    # 最上层细节:帐篷 + 树群(全在最深那层之上)
    gy = 0.80 * H * S
    tent = [(0.50 * W * S, gy - 0.115 * H * S), (0.558 * W * S, gy + 0.012 * H * S), (0.442 * W * S, gy + 0.012 * H * S)]
    d.polygon(tent, fill=(40, 88, 68, 255))
    d.line([(0.50 * W * S, gy - 0.115 * H * S), (0.512 * W * S, gy - 0.045 * H * S)], fill=(247, 244, 235, 230), width=int(1.8 * S))
    for tx, th in ((0.36, 0.050), (0.405, 0.066), (0.60, 0.058), (0.645, 0.044)):
        bx = tx * W * S
        d.polygon([(bx, gy - th * H * S), (bx + 0.014 * W * S, gy + 0.012 * H * S), (bx - 0.014 * W * S, gy + 0.012 * H * S)], fill=(33, 80, 62, 255))
    # 金日(先晕后日,两层淡金圈让它像发光而不是贴纸) + 飞鸟
    sx, sy, sr = 0.175 * W * S, 0.185 * H * S, 0.042 * W * S
    for hr, ha in ((1.9, 26), (1.42, 48)):
        d.ellipse([sx - sr * hr, sy - sr * hr, sx + sr * hr, sy + sr * hr], fill=GOLD + (ha,))
    d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=GOLD + (230,))
    for bx, by, s in ((0.30, 0.16, 1.0), (0.345, 0.125, 0.8)):
        x, y = bx * W * S, by * H * S
        w, r = 9 * S * s, 4.5 * S * s
        d.arc([x - w, y - r, x, y + r], 200, 340, fill=(60, 90, 76, 210), width=int(1.6 * S))
        d.arc([x, y - r, x + w, y + r], 200, 340, fill=(60, 90, 76, 210), width=int(1.6 * S))
    return finish(img, os.path.join(OUT, 'opt-d-papercut'))


# ---------------------------------------------------------------- 拼版
def contact_sheet(images):
    """2×2 带标签的选稿大图(直接给用户看这张就够)。"""
    cw, ch, pad, label_h = 640, 358, 26, 54
    sheet = Image.new('RGB', (cw * 2 + pad * 3, (ch + label_h) * 2 + pad * 3), PAPER)
    d = ImageDraw.Draw(sheet)
    from PIL import ImageFont
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
    except OSError:
        font = ImageFont.load_default()
    titles = ['A 等高线 · 身体的地形图', 'B 一笔律动 · 脉搏松成山脊',
              'C 能量日出 · 会升起的进度环', 'D 折纸层林 · 硬边剪纸层峦']
    for idx, (im, title) in enumerate(zip(images, titles)):
        col, row = idx % 2, idx // 2
        x = pad + col * (cw + pad)
        y = pad + row * (ch + label_h + pad)
        # 透明稿必须先垫纸底再贴:直接 paste RGBA 会把透明区的 RGB(纸纹色)露出来,
        # 整版变成灰橄榄「迷彩底」—— 第一版联络图的伪缺陷就是这么来的
        cell = Image.new('RGB', (cw, ch), PAPER)
        im2 = im.resize((cw, ch), Image.LANCZOS)
        cell.paste(im2, (0, 0), im2)
        sheet.paste(cell, (x, y))
        d.rectangle([x, y, x + cw, y + ch], outline=(223, 216, 200), width=1)
        d.text((x + 2, y + ch + 14), title, fill=(60, 80, 70), font=font)
    sheet.save(os.path.join(OUT, 'contact-sheet.png'))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    a = opt_a()
    b = opt_b()
    c = opt_c()
    d_ = opt_d()
    contact_sheet([a, b, c, d_])
    print('预览已生成 →', OUT)
    for f in sorted(os.listdir(OUT)):
        print('  ', f)
