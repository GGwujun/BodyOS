/* 生成 tabBar 的「训练」图标(哑铃)——
   跑法: node scripts/build-tabbar-icon.mjs

   为什么是自己画而不是拿一张图:tabBar 的 iconPath **只吃本地图片文件**(png/jpg),
   喂不了 @taroify 那套图标字体,也喂不了 svg。仓库里没有画图工具链(sharp/canvas 都没有),
   为一个图标装一套原生依赖不值当 —— 而且那套东西在 CI/别人的机器上还得重新编。
   所以这儿自己算:哑铃就是三个圆角矩形,圆角矩形的**有符号距离**有闭式解,
   并集取 min,描边就是 |sdf| < 半笔宽。三十行,零依赖,和另外几个图标同一副长相。

   两个颜色:未选中 #9AA3AF、选中 #10B981 —— 和 app.config.ts 里 tabBar 那两个字段
   是同一对值,改那边记得改这儿。 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ---------- PNG 编码 ---------- */
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
/** rgba: Buffer(宽 × 高 × 4)。8 位 RGBA、无隔行 —— 小程序读这个格式最省事 */
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;      // 位深
  ihdr[9] = 6;      // 色彩类型 6 = RGBA
  // 10..12 保持 0:压缩/滤波/隔行都用默认
  // 每行前面那个 0 是滤波类型(None)—— 图标是平涂 + 抗锯齿边,过滤压不出多少东西
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

/* ---------- 形状 ---------- */
/** 圆角矩形的有符号距离:负=在里面,正=在外面,0=正好压在边上 */
function sdfRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/* 哑铃 = 一根横杆 + 两头各一块配片。并集取 min(几个形状拼起来时,
   min 在外侧是准的,正好是描边要看的那一侧)。
   坐标按 81×81 画布给,和另外几个图标一样,字形占中间约 55% */
const SIZE = 81;
const C = SIZE / 2;
const STROKE = 2.6;      // 和其他几个图标的笔宽对齐(它们是 2.5 上下)
const BAR = { hw: 13, hh: 3.2, r: 3.2 };              // 横杆
const PLATE = { dx: 14.8, hw: 5, hh: 12.4, r: 4.2 };  // 两头配片,dx 是离中心的距离
const sdfDumbbell = (x, y) => Math.min(
  sdfRoundRect(x, y, C, C, BAR.hw, BAR.hh, BAR.r),
  sdfRoundRect(x, y, C - PLATE.dx, C, PLATE.hw, PLATE.hh, PLATE.r),
  sdfRoundRect(x, y, C + PLATE.dx, C, PLATE.hw, PLATE.hh, PLATE.r)
);

/* 一个形状不管并集多复杂,描边都只是「离边界不到半个笔宽」那一圈 —— 不用去求并集的路径 */
const inside = (x, y) => Math.abs(sdfDumbbell(x, y)) < STROKE / 2;

/**
 * 描边 → 逐像素覆盖率。**4×4 超采样**:81px 的图标上,2.6px 宽的线占了很大比例,
 * 不超采样的话圆弧和斜角全是台阶(而且是最显眼的那种,因为整个图标就是线的组合)。
 */
const SS = 4;
function coverage(x, y) {
  let hit = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hit++;
    }
  }
  return hit / (SS * SS);
}

function render(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const a = coverage(x, y);
      const i = (y * SIZE + x) * 4;
      // 预乘没有必要(小程序不做预乘),直接写颜色 + 覆盖率当 alpha
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(buf, SIZE, SIZE);
}

const OUT = path.join('src', 'assets', 'tabbar');
fs.writeFileSync(path.join(OUT, 'train.png'), render('#9AA3AF'));
fs.writeFileSync(path.join(OUT, 'train-active.png'), render('#10B981'));
console.log('wrote', path.join(OUT, 'train.png'), '+ train-active.png', `${SIZE}x${SIZE}`);
