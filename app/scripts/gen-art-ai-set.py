"""
定了方向:第 3 张「流体渐变·薄荷金」当主视觉,全站 hero 用同族变体。

这个脚本把剩下三个槽位各生成 2 张候选(训练页/语录底/我的页),
外加每日分享扎心卡的竖版底图,全部沿用同一套流体渐变语言:
  薄荷绿 / 翡翠绿 / 鼠尾草绿 + 一抹暖金,上部明亮留白(现有深色文字不用改)。

跑法: python scripts/gen-art-ai.py 先跑过; python scripts/gen-art-ai-set.py
输出: scripts/art-preview-ai/set/ 下按槽位分目录
"""

import io
import json
import os
import ssl
import time
import urllib.request

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, 'art-preview-ai', 'set')
ENV_PATH = os.path.join(HERE, '..', '..', 'server', '.env')
API = 'https://open.bigmodel.cn/api/paas/v4/images/generations'
CTX = ssl.create_default_context()

NO_TEXT = '画面中不要出现任何文字、字母、数字、水印、边框、logo、人物。'

# (槽位, 目标尺寸, 源尺寸, prompt 变体列表) —— 每槽 2 张候选
SLOTS = [
    ('training', (750, 520), '1344x768', [
        '抽象流体艺术横幅背景:翡翠绿、薄荷绿、鼠尾草绿的丝绸流体,一条暖金色光带斜贯画面,'
        '流动感舒展有力,上部明亮留白,高级极简现代应用背景,细腻噪点质感。' + NO_TEXT,
        '抽象流体艺术横幅背景:薄荷绿与翡翠绿的大气流体回旋,远处一抹暖金渐入,'
        '像风吹起的绸缎,上部三分之二明亮干净,高级极简,细腻颗粒。' + NO_TEXT,
    ]),
    ('quote', (750, 300), '1440x720', [
        '抽象流体艺术背景:薄荷绿与鼠尾草绿的柔和横向流体渐变,极淡的暖金点缀在边缘,'
        '画面安静空灵,中部大面积柔和留白,极简高级。' + NO_TEXT,
        '抽象流体艺术背景:浅奶油底上极淡的薄荷绿流体晕染,像晨雾漫过水面,'
        '中心几乎纯色留白,边缘一层淡金光,安静极简。' + NO_TEXT,
    ]),
    ('profile', (750, 620), '1152x864', [
        '抽象流体艺术背景:奶油色与薄荷绿、鼠尾草绿的柔光流体,大面积留白,轻盈通透,'
        '一点点暖金点缀,极简优雅。' + NO_TEXT,
        '抽象流体艺术背景:淡薄荷绿与鼠尾草绿的丝滑渐变,如清晨薄纱,'
        '上部明亮干净,下部颜色渐浓,一点暖金流光,极简高级。' + NO_TEXT,
    ]),
    ('daily', (750, 1334), '768x1344', [
        '竖版抽象流体艺术背景:薄荷绿、鼠尾草绿与暖金的柔滑渐变,上部和中部大面积明亮留白'
        '留给文字,下部颜色稍浓,细腻颗粒质感,高级极简。' + NO_TEXT,
        '竖版抽象流体艺术背景:淡奶油与薄荷绿的流体晕染自上而下渐深,底部一抹暖金,'
        '中部干净空灵,高级极简,细腻噪点。' + NO_TEXT,
    ]),
]

MODEL_CHAIN = ['cogview-3-flash', 'cogview-4', 'cogview-3']


def load_key():
    with open(ENV_PATH, encoding='utf-8') as f:
        for line in f:
            if line.strip().startswith('ZHIPU_API_KEY='):
                return line.strip().split('=', 1)[1].strip().strip('"\'')
    raise SystemExit('server/.env 里没找到 ZHIPU_API_KEY')


def gen(key, model, prompt, size):
    body = json.dumps({'model': model, 'prompt': prompt, 'size': size}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120, context=CTX) as r:
        data = json.loads(r.read())
    with urllib.request.urlopen(data['data'][0]['url'], timeout=120, context=CTX) as r:
        return r.read()


def crop_resize(raw, tw, th):
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    tr = tw / th
    if im.width / im.height > tr:      # 源太宽 → 裁两侧
        nw = round(im.height * tr)
        x0 = (im.width - nw) // 2
        im = im.crop((x0, 0, x0 + nw, im.height))
    else:                              # 源太高 → 裁上下(偏上保留,下缘留浓色)
        nh = round(im.width / tr)
        y0 = (im.height - nh) // 2
        im = im.crop((0, y0, im.width, y0 + nh))
    return im.resize((tw, th), Image.LANCZOS)


def strip():
    """把 set/ 下所有槽位候选拼成一张总览图。"""
    import numpy as np
    pad, lab = 26, 46
    entries = []
    for slot, (tw, th), _, _ in SLOTS:
        for i in (1, 2):
            p = os.path.join(OUT, f'{slot}-{i}.png')
            if os.path.exists(p):
                entries.append((f'{slot}-{i}', Image.open(p)))
    Wt = 750 + pad * 2
    Ht = pad + sum(lab + im.height + pad for _, im in entries)
    sheet = Image.new('RGB', (Wt, Ht), (247, 244, 235))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 30)
    except OSError:
        font = ImageFont.load_default()
    y = pad
    for name, im in entries:
        d.text((pad, y + 6), name, fill=(40, 70, 58), font=font)
        y += lab
        sheet.paste(im, (pad, y))
        d.rectangle([pad, y, pad + im.width, y + im.height], outline=(223, 216, 200), width=2)
        y += im.height + pad
    sheet.save(os.path.join(OUT, 'set-strip.png'))
    print('总览 →', os.path.join(OUT, 'set-strip.png'))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    key = load_key()
    ok = None
    for slot, (tw, th), size, prompts in SLOTS:
        for i, prompt in enumerate(prompts, 1):
            for model in [m for m in ([ok] + MODEL_CHAIN) if m]:
                try:
                    raw = gen(key, model, prompt, size)
                    ok = model
                    break
                except Exception as e:  # noqa: BLE001
                    print(f'[{model}] {slot}-{i} 失败: {e}')
                    time.sleep(3)
            else:
                continue
            crop_resize(raw, tw, th).save(os.path.join(OUT, f'{slot}-{i}.png'))
            print(f'[{model}] {slot}-{i} OK → {tw}x{th}')
            time.sleep(2)
    strip()
