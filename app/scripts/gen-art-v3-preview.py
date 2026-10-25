"""
第三轮顶部背景 · 壁纸级全幅色彩。

前两轮被毙的教训:
  水彩山峦(第一版 assets) —— 「没创意」;
  纸上线稿(v2 等高线/单线/剪纸) —— 「丑」,根子是素:细线 + 大留白,在手机
  上一英寸的地方看就是「程序员手绘」。
这轮换赛道:不再往纸上画线,直接做**整片色彩 + 光效 + 纵深**的壁纸,并且
在预览里叠一行真实页面的问候文案 —— 预览即页面顶部的样子,不再是裸图。

A 晨光山脊  深绿晨空渐变,雾里四层山,金日在层后发光,鸟两点
B 呼吸光环  深绿底三道发光粗弧(呼吸/心率环的放大),金色进度段,星屑
C 流体薄荷  浅色向:奶油底上大团薄荷/鼠尾草/金晕,大理石般的柔光
D 丝绸波光  深绿底上的丝绸缎带 + 沿缎高光 + 星点

运行: python scripts/gen-art-v3-preview.py  → scripts/art-preview-v3/
"""

import math
import os

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), 'art-preview-v3')
S = 2                      # 超采样 2x:大量高斯模糊本身就在抗锯齿,3x 没必要
W, H = 750, 420

DEEP = (10, 52, 38)
EMERALD = (23, 107, 85)
TEAL = (47, 163, 135)
MINT = (127, 216, 184)
GOLD = (216, 170, 74)
SAGE = (168, 195, 176)
CREAM = (247, 244, 235)


# ---------------------------------------------------------------- 基础工具
def vgrad(w, h, stops):
    """竖向多段渐变 → RGB 图。stops = [(pos, (r,g,b)), ...] 按 y 从上到下。"""
    ys = np.linspace(0, 1, h)
    cols = np.stack([
        np.interp(ys, [p for p, _ in stops], [c[ch] for _, c in stops])
        for ch in range(3)
    ], axis=1)                                   # (h,3)
    arr = np.repeat(cols[:, None, :], w, axis=1).astype(np.float32)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def screen_glow(base, shape_rgba, blur):
    """把形状层高斯模糊后以「滤色」叠到底图上 —— 发光感的全部秘密。"""
    g = shape_rgba.filter(ImageFilter.GaussianBlur(blur))
    black = Image.new('RGB', base.size, (0, 0, 0))
    black.paste(g, (0, 0), g)
    return ImageChops.screen(base, black)


def grain(img, seed=7, strength=4):
    """正负双向细噪点:大色块的「胶片感」,没有它渐变会显得像塑料。"""
    w, h = img.size
    rng = np.random.default_rng(seed)
    n = (rng.standard_normal((h, w, 1)) * strength).repeat(3, axis=2)
    arr = np.asarray(img).astype(np.float32) + n
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def overlay(base, shape_rgba):
    return Image.alpha_composite(base.convert('RGBA'), shape_rgba).convert('RGB')


def label_text(img, dark_bg=True):
    """叠一行真实首页顶部会出现的文案,预览即成品。"""
    top = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(top)
    try:
        f1 = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 40)
        f2 = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
    except OSError:
        f1 = f2 = ImageFont.load_default()
    ink = (255, 255, 255, 235) if dark_bg else (16, 77, 58, 235)
    d.text((44, 40), '早安,今天轻一点', font=f1, fill=ink)
    d.text((46, 96), '10月25日 · 周日 · 身体正在变好', font=f2, fill=ink)
    if dark_bg:  # 白字底下垫一点软影,保证浅色区域上也能读
        shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
        ds = ImageDraw.Draw(shadow)
        ds.text((44, 40), '早安,今天轻一点', font=f1, fill=(4, 20, 14, 120))
        ds.text((46, 96), '10月25日 · 周日 · 身体正在变好', font=f2, fill=(4, 20, 14, 110))
        shadow = shadow.filter(ImageFilter.GaussianBlur(6))
        top = Image.alpha_composite(shadow, top)
    return overlay(img, top)


def finish(img, name, dark_bg=True):
    img = grain(img, seed=hash(name) % 9999)
    img.save(os.path.join(OUT, name + '.png'))
    label_text(img, dark_bg).save(os.path.join(OUT, name + '-with-text.png'))
    return img


# ---------------------------------------------------------------- A 晨光山脊
def opt_a():
    """晨空:上深下亮的绿渐变;金日先发光,山层从后往前压上来(远的淡、近的深)。"""
    w, h = W * S, H * S
    base = vgrad(w, h, [
        (0.00, (7, 36, 27)),
        (0.42, (14, 78, 58)),
        (0.66, (30, 118, 88)),
        (0.84, (84, 158, 116)),
        (1.00, (151, 198, 152)),
    ])

    # 金日:光晕(滤色)先上,日轮后画 —— 山层会盖在光上,纵深感就出来了
    sx, sy, sr = 0.60 * w, 0.46 * h, 30 * S
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([sx - sr * 2.4, sy - sr * 2.4, sx + sr * 2.4, sy + sr * 2.4],
                                 fill=GOLD + (110,))
    base = screen_glow(base, glow, 50 * S)

    # 四层山:远的贴近天色,近的压成深剪影 —— 空气透视
    layers = [
        (0.56, (128, 174, 128), 150, 0.055, 0.9, 2.1),
        (0.64, (88, 141, 106), 185, 0.075, 1.3, 3.7),
        (0.75, (47, 101, 76), 225, 0.095, 1.1, 2.9),
        (0.88, (16, 62, 46), 255, 0.115, 1.6, 4.3),
    ]
    for i, (ybase, col, alpha, amp, f1, f2) in enumerate(layers):
        lay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        pts = []
        for k in range(0, w + 8 * S, 8 * S):
            t = k / w
            y = ybase * h - (amp * math.sin(t * f1 * 2 * math.pi + i * 1.9)
                             + amp * 0.45 * math.sin(t * f2 * 2 * math.pi + i * 0.7)) * h
            pts.append((k, y))
        d.polygon(pts + [(w, h), (0, h)], fill=col + (alpha,))
        base = overlay(base, lay)

    # 日轮本体(山层之后,压出「挂在山后」的感觉)+ 两点飞鸟
    sun = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sun).ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=(244, 208, 122, 255))
    base = overlay(base, sun)
    birds = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    db = ImageDraw.Draw(birds)
    for bx, by, sc in ((0.30, 0.22, 1.0), (0.35, 0.17, 0.75)):
        x, y = bx * w, by * h
        wing = 10 * S * sc
        db.arc([x - wing, y - wing * 0.5, x, y + wing * 0.5], 200, 340, fill=(230, 240, 232, 190), width=2 * S)
        db.arc([x, y - wing * 0.5, x + wing, y + wing * 0.5], 200, 340, fill=(230, 240, 232, 190), width=2 * S)
    base = overlay(base, birds)
    return finish(base, 'v3-a-dawn-ridges', dark_bg=True)


# ---------------------------------------------------------------- B 呼吸光环
def opt_b():
    """三道粗弧从右下升起来,弧自带辉光;中环一段金色=进度,散几粒星屑。"""
    w, h = W * S, H * S
    base = vgrad(w, h, [
        (0.00, (7, 42, 31)),
        (0.62, (13, 72, 55)),
        (1.00, (22, 102, 78)),
    ])
    cx, cy = 0.76 * w, 1.34 * h
    rings = [
        (0.40 * w, MINT, 200, 16, None),
        (0.55 * w, TEAL, 215, 17, (0.18, 0.34)),   # (起点比例,弧长比例) 金色进度段
        (0.70 * w, (74, 158, 124), 190, 18, None),
    ]
    A0, A1 = 183.0, 275.0
    arc_lay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(arc_lay)
    for r, col, alpha, wid, seg in rings:
        bbox = [cx - r, cy - r, cx + r, cy + r]
        d.arc(bbox, A0, A1, fill=col + (alpha,), width=wid * S)
        if seg:
            a2, a3 = A0 + seg[0] * (A1 - A0), A0 + (seg[0] + seg[1]) * (A1 - A0)
            d.arc(bbox, a2, a3, fill=GOLD + (235,), width=wid * S)
            for ang in (a2, a3):
                px, py = cx + r * math.cos(math.radians(ang)), cy + r * math.sin(math.radians(ang))
                rr = wid * S / 2
                d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=GOLD + (245,))
    base = screen_glow(base, arc_lay, 16 * S)   # 辉光
    base = overlay(base, arc_lay)               # 清晰的本体压在辉光上

    # 星屑:左上散几粒,大小/透明度错开
    spark = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ds = ImageDraw.Draw(spark)
    rng = np.random.default_rng(21)
    for _ in range(16):
        x = rng.uniform(0.04, 0.62) * w
        y = rng.uniform(0.05, 0.55) * h
        r = rng.uniform(1.5, 4.5) * S
        a = int(rng.uniform(50, 130))
        ds.ellipse([x - r, y - r, x + r, y + r], fill=(215, 240, 226, a))
    base = overlay(base, spark.filter(ImageFilter.GaussianBlur(1.2 * S)))
    return finish(base, 'v3-b-glow-rings', dark_bg=True)


# ---------------------------------------------------------------- C 流体薄荷
def opt_c():
    """浅色向:奶油底 + 四团大柔晕(薄荷/鼠尾草/金/一点深绿),大理石柔光板。"""
    w, h = W * S, H * S
    base = vgrad(w, h, [(0.0, (245, 243, 234)), (1.0, (240, 237, 226))])

    def blob(cx, cy, r, col, alpha):
        lay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(lay).ellipse([cx - r, cy - r, cx + r, cy + r], fill=col + (alpha,))
        return lay.filter(ImageFilter.GaussianBlur(r * 0.55))

    for cx, cy, r, col, a in (
        (0.16 * w, 0.34 * h, 0.42 * w, MINT, 92),
        (0.82 * w, 0.16 * h, 0.36 * w, SAGE, 105),
        (0.64 * w, 0.78 * h, 0.32 * w, GOLD, 70),
        (0.34 * w, 0.92 * h, 0.24 * w, EMERALD, 42),
        (0.55 * w, 0.10 * h, 0.20 * w, MINT, 46),
    ):
        base = overlay(base, blob(cx, cy, r, col, a))

    # 暗角:四周轻压 6%,大色块才不「飘」
    vig = Image.new('L', (w, h), 0)
    ImageDraw.Draw(vig).rectangle([-w * 0.25, -h * 0.25, w * 1.25, h * 1.25], fill=70)
    dv = ImageDraw.Draw(vig)
    dv.ellipse([-w * 0.18, -h * 0.3, w * 1.18, h * 1.3], fill=0)
    vig = vig.filter(ImageFilter.GaussianBlur(60 * S))
    dark = Image.new('RGB', (w, h), (214, 208, 192))
    base = Image.composite(dark, base, vig)
    return finish(base, 'v3-c-fluid-mint', dark_bg=False)


# ---------------------------------------------------------------- D 丝绸波光
def opt_d():
    """三条绸带斜贯而过,带内一道沿缎高光;滤色叠出丝绸的「透光」。"""
    w, h = W * S, H * S
    base = vgrad(w, h, [
        (0.00, (8, 45, 34)),
        (0.70, (17, 88, 65)),
        (1.00, (25, 111, 83)),
    ])

    def band(c0, amp1, f1, p1, amp2, f2, p2, thick, col, alpha):
        """绸带 = 两条同频曲线夹出的封闭形;中心线另画一条亮线做高光。"""
        lay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        top, bot, mid = [], [], []
        for k in range(0, w + 6 * S, 6 * S):
            t = k / w
            yc = (c0 + amp1 * math.sin(t * f1 * 2 * math.pi + p1)
                  + amp2 * math.sin(t * f2 * 2 * math.pi + p2)) * h
            th = thick * (0.75 + 0.25 * math.sin(t * 2.6 * math.pi + p1)) * h
            top.append((k, yc - th))
            bot.append((k, yc + th))
            mid.append((k, yc))
        d.polygon(top + bot[::-1], fill=col + (alpha,))
        d.line(mid, fill=(235, 255, 245, alpha + 45), width=5 * S)
        return lay

    lay1 = band(0.36, 0.085, 1.15, 0.4, 0.045, 2.6, 1.9, 0.085, MINT, 80)
    lay2 = band(0.62, 0.10, 0.95, 2.6, 0.05, 2.2, 0.4, 0.10, (206, 236, 218), 62)
    lay3 = band(0.86, 0.07, 1.35, 4.4, 0.04, 3.1, 2.8, 0.07, GOLD, 46)
    silk = Image.alpha_composite(lay1, lay2)
    silk = Image.alpha_composite(silk, lay3)
    base = screen_glow(base, silk, 14 * S)   # 绸带的透光
    base = overlay(base, silk.filter(ImageFilter.GaussianBlur(2 * S)))  # 本体收一点点软边

    spark = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ds = ImageDraw.Draw(spark)
    rng = np.random.default_rng(33)
    for _ in range(12):
        x = rng.uniform(0.05, 0.95) * w
        y = rng.uniform(0.05, 0.5) * h
        r = rng.uniform(1.2, 3.2) * S
        ds.ellipse([x - r, y - r, x + r, y + r], fill=(225, 245, 232, int(rng.uniform(60, 120))))
    base = overlay(base, spark.filter(ImageFilter.GaussianBlur(1 * S)))
    return finish(base, 'v3-d-silk-waves', dark_bg=True)


# ---------------------------------------------------------------- 拼版
def strip(images):
    lab, pad = 70, 30
    Wt = W + pad * 2
    Ht = pad + sum(lab + im.height + pad for im in images)
    sheet = Image.new('RGB', (Wt, Ht), CREAM)
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 36)
    except OSError:
        font = ImageFont.load_default()
    titles = ['A 晨光山脊 · 雾里四层山,日从山后亮', 'B 呼吸光环 · 发光的环,金色是进度',
              'C 流体薄荷 · 浅色大理石柔光', 'D 丝绸波光 · 缎带透光']
    y = pad
    for im, t in zip(images, titles):
        d.text((pad, y + 8), t, fill=(40, 70, 58), font=font)
        y += lab
        sheet.paste(im, (pad, y))
        d.rectangle([pad, y, pad + im.width, y + im.height], outline=(223, 216, 200), width=2)
        y += im.height + pad
    sheet.save(os.path.join(OUT, 'all-options.png'))
    return sheet


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    strip([opt_a(), opt_b(), opt_c(), opt_d()])
    print('v3 预览已生成 →', OUT)
    for f in sorted(os.listdir(OUT)):
        print('  ', f)
