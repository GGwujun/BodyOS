/* 生成深色模式的 tabBar 选中态图标(*-active-dark.png)——
   跑法: node scripts/build-tabbar-dark.mjs

   为什么只做选中态:未选中图标本来就是灰绿(#8A958F),在深色标签栏
   (#1C211D)上对比度还有 5:1,两套模式共用一张就行;选中态是压深的
   森林绿 #176B55,在深色底上 ≈1.7:1,几乎看不见 —— 那五张必须换亮的。

   为什么不重新画:五张图标的字形不是同一批工具画的(只有「训练」是
   build-tabbar-icon.mjs 现画的),重画等于重出一套资产;这里只**换色**:
   解码 → 把所有非透明像素的颜色换成目标色、alpha 原样保留(抗锯齿边
   还是平滑的)→ 重新编码。零依赖,zlib 是 Node 自带。 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ---------- PNG 解码(只支持 8 位 RGBA、非隔行 —— 本目录的图标全是这个格式) ---------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8;
  let w = 0, h = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error(`只支持 8 位 RGBA,实际 bitDepth=${data[8]} colorType=${data[9]}`);
      if (data[12] !== 0) throw new Error('隔行 PNG 不支持');
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));

  /* 反滤波(Sub/Up/Average/Paeth 四种都可能有,逐行按左/上邻居还原) */
  const stride = w * 4;
  const out = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x];
      const left = x >= 4 ? out[rowStart + x - 4] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const ul = y > 0 && x >= 4 ? out[prevStart + x - 4] : 0;
      let v;
      if (ft === 0) v = cur;
      else if (ft === 1) v = cur + left;
      else if (ft === 2) v = cur + up;
      else if (ft === 3) v = cur + ((left + up) >> 1);
      else if (ft === 4) v = cur + paeth(left, up, ul);
      else throw new Error(`未知滤波类型 ${ft}`);
      out[rowStart + x] = v & 0xff;
    }
  }
  return { rgba: out, w, h };
}

/* ---------- PNG 编码(和 build-tabbar-icon.mjs 同一套) ---------- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 换色 ---------- */
const DIR = path.join('src', 'assets', 'tabbar');
const NAMES = ['home', 'record', 'train', 'trends', 'profile'];
/* 深色主色 —— 和 styles/tokens.scss 深色段的 --color-primary 同值,改那边记得同步 */
const DARK_ACTIVE = '#3fa584';

const r = parseInt(DARK_ACTIVE.slice(1, 3), 16);
const g = parseInt(DARK_ACTIVE.slice(3, 5), 16);
const b = parseInt(DARK_ACTIVE.slice(5, 7), 16);

for (const name of NAMES) {
  const src = path.join(DIR, `${name}-active.png`);
  const { rgba, w, h } = decodePng(fs.readFileSync(src));
  let touched = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    touched++;
  }
  const out = path.join(DIR, `${name}-active-dark.png`);
  fs.writeFileSync(out, encodePng(rgba, w, h));
  console.log(`wrote ${out}(换色像素 ${touched})`);
}
