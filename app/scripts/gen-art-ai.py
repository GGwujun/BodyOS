"""
第四轮:AI 生图(智谱 CogView)。

前三轮 PIL 手绘全部被毙 —— 手写程序画图的上限就在那儿。这轮直接用
server/.env 里现成的 ZHIPU_API_KEY 调 CogView 生成插画级 hero 背景,
一次出 8 张、四种风格各两张,铺开给用户挑。

跑法: python scripts/gen-art-ai.py   → scripts/art-preview-ai/
注意: key 只从 ../server/.env 读,不进代码、不打印、不提交。
"""

import json
import os
import ssl
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, 'art-preview-ai')
ENV_PATH = os.path.join(HERE, '..', '..', 'server', '.env')
API = 'https://open.bigmodel.cn/api/paas/v4/images/generations'
CTX = ssl.create_default_context()

W, H = 750, 420
CREAM = (247, 244, 235)

# (文件名短号, 标签, prompt) —— 四个风格家族 × 各 2 张
PROMPTS = [
    ('1', '3D 晨雾山丘 · 体积光',
     '竖版插画风格的横幅背景:清晨连绵起伏的柔软山丘,层叠晨雾,翡翠绿到薄荷绿的渐变天空,'
     '一轮金色朝阳在山后发光,柔和的体积光,细腻颗粒质感,高级感极简设计,治愈系,'
     '画面上部留出干净的浅色区域。不要出现任何文字、字母、数字、水印、边框、人物。'),
    ('2', '3D 晨雾山丘 · 深色版',
     '横幅背景插画:深夜绿到墨绿渐变的层叠山峦剪影,山间飘着发光的雾气,远处一点暖金色光斑,'
     '极简高级感,柔和细腻,颗粒质感,适合手机应用顶部背景。'
     '不要出现任何文字、字母、数字、水印、边框、人物。'),
    ('3', '流体渐变 · 薄荷金',
     '抽象流体艺术横幅背景:翡翠绿、薄荷绿、鼠尾草绿与一抹暖金色的丝绸般流体渐变,'
     '颜色过渡柔滑如绸缎,高级极简的现代应用壁纸,细腻噪点质感,上部明亮留白。'
     '不要出现任何文字、字母、数字、水印、边框。'),
    ('4', '流体渐变 · 深绿绸',
     '抽象横幅背景:深翡翠绿底色上流动的半透明丝绸缎带,薄荷绿和金色的柔光沿缎带流动,'
     '深邃高级,现代极简壁纸,细腻颗粒。不要出现任何文字、字母、数字、水印、边框。'),
    ('5', '极简插画 · 雾山日出',
     '极简扁平插画横幅背景:层叠的绿色山峦从浅薄荷渐变到深翡翠,山与山之间是干净的雾面,'
     '右上一轮简约金色太阳,大量留白,北欧设计感,干净优雅。'
     '不要出现任何文字、字母、数字、水印、边框、人物。'),
    ('6', '极简插画 · 波纹叶影',
     '极简横幅背景:奶油色底,翡翠绿和鼠尾草绿的大片柔和有机形状互相交叠,像风吹过的叶影,'
     '一点点金色点缀,莫兰迪色系,优雅安静,大量留白,适合健康应用顶部。'
     '不要出现任何文字、字母、数字、水印、边框。'),
    ('7', '软雕塑 · 有机圆润形状',
     '3D 软雕塑风格横幅背景:几组圆润饱满的有机形状轻轻漂浮,薄荷绿、奶油白、鼠尾草绿和'
     '暖金色,柔和影棚光,哑光陶土质感,极简高级,构图疏朗,上部留白。'
     '不要出现任何文字、字母、数字、水印、边框、人物。'),
    ('8', '软雕塑 · 翡翠玻璃',
     '3D 渲染横幅背景:半透明翡翠绿玻璃质感的圆润山丘与一颗金色小球,柔和景深,'
     '青绿色渐变背景,高级产品设计渲染图,干净极简。'
     '不要出现任何文字、字母、数字、水印、边框、人物。'),
]

MODEL_CHAIN = ['cogview-4', 'cogview-3-flash', 'cogview-3']


def load_key():
    with open(ENV_PATH, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith('ZHIPU_API_KEY='):
                return line.split('=', 1)[1].strip().strip('"\'')
    raise SystemExit('server/.env 里没找到 ZHIPU_API_KEY')


def gen(key, model, prompt, size='1344x768'):
    body = json.dumps({'model': model, 'prompt': prompt, 'size': size}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=120, context=CTX) as r:
        data = json.loads(r.read())
    url = data['data'][0]['url']
    with urllib.request.urlopen(url, timeout=120, context=CTX) as r:
        return r.read()


def to_hero(png_bytes, name, label):
    """下载图 → 裁成 750×420(1.786:1) → 判断文字明暗 → 叠问候文案。"""
    import io
    im = Image.open(io.BytesIO(png_bytes)).convert('RGB')
    tw = 1344
    th = round(tw * H / W)                      # 752,1344×768 只裁十几像素
    x0 = (im.width - tw) // 2
    y0 = (im.height - th) // 2
    im = im.crop((x0, y0, x0 + tw, y0 + th)).resize((W, H), Image.LANCZOS)
    im.save(os.path.join(OUT, f'{name}.png'))

    # 文字落点在上部:取左上区域亮度决定墨色
    zone = np.asarray(im)[:150, :460].astype(float).mean()
    dark_bg = zone < 140

    top = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(top)
    try:
        f1 = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 40)
        f2 = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
    except OSError:
        f1 = f2 = ImageFont.load_default()
    ink = (255, 255, 255, 240) if dark_bg else (16, 77, 58, 240)
    if dark_bg:
        shadow = Image.new('RGBA', im.size, (0, 0, 0, 0))
        ds = ImageDraw.Draw(shadow)
        ds.text((44, 40), '早安,今天轻一点', font=f1, fill=(4, 20, 14, 130))
        ds.text((46, 96), '10月25日 · 周日 · 身体正在变好', font=f2, fill=(4, 20, 14, 120))
        shadow = shadow.filter(ImageFilter.GaussianBlur(6))
        top = Image.alpha_composite(shadow, top)
    d.text((44, 40), '早安,今天轻一点', font=f1, fill=ink)
    d.text((46, 96), '10月25日 · 周日 · 身体正在变好', font=f2, fill=ink)
    Image.alpha_composite(im.convert('RGBA'), top).convert('RGB').save(
        os.path.join(OUT, f'{name}-with-text.png'))
    return im, label


def strip(items):
    lab, pad = 70, 30
    sheet = Image.new('RGB', (W + pad * 2, pad + sum(lab + H + pad for _ in items)), CREAM)
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 36)
    except OSError:
        font = ImageFont.load_default()
    y = pad
    for im, label in items:
        d.text((pad, y + 8), label, fill=(40, 70, 58), font=font)
        y += lab
        sheet.paste(im, (pad, y))
        d.rectangle([pad, y, pad + W, y + H], outline=(223, 216, 200), width=2)
        y += H + pad
    sheet.save(os.path.join(OUT, 'all-options.png'))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    key = load_key()
    ok_model = None
    items = []
    for name, label, prompt in PROMPTS:
        for model in [ok_model] + [m for m in MODEL_CHAIN if m != ok_model]:
            if not model:
                continue
            try:
                raw = gen(key, model, prompt)
                ok_model = model
                print(f'[{model}] {label} OK')
                break
            except Exception as e:  # noqa: BLE001 —— 逐张试探,失败的记下来继续
                print(f'[{model}] {label} 失败: {e}')
        else:
            continue
        items.append(to_hero(raw, name, label))
    if not items:
        raise SystemExit('一张都没生成成功')
    strip(items)
    print('AI 候选已生成 →', OUT, f'(共 {len(items)} 张)')
