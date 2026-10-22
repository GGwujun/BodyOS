#!/usr/bin/env node
/**
 * 生成「身体肌群图」的几何数据 —— 从 MuscleMap(MIT)的路径里摊平成多边形。
 *
 * 为什么不用图片:
 *   同一张图要在两种页面上按五个色档同时给七个大组上色(恢复/容量两种口径),
 *   还要有选中描边。预渲染成 PNG 就是 7 组 × 5 档 × 2 面 + 选中态的一堆文件,
 *   进分包就是几百 KB;而真正的形状数据摊平后只有几十 KB。
 *
 * 为什么是 Canvas 而不是 SVG:
 *   小程序没有内联 SVG;`<Image src="data:image/svg+xml…">` 在不同基础库上并不可靠。
 *   Canvas 2D 是唯一能按任意配色实时重画、同时保持解剖轮廓的路子。
 *
 * 几何来源:scripts/vendor/muscle-map-body-paths.mjs(MuscleMap, MIT, 见
 * scripts/THIRD-PARTY-NOTICES.md 第 3.2 节)。脚本只搬几何,不搬 openGym 的 AGPL 代码。
 *
 * 用法:
 *   node scripts/build-body-map.mjs           # 写入 src/pkg-exercise/muscles/body-geometry.ts
 *   node scripts/build-body-map.mjs --check   # 只打印统计
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/pkg-exercise/muscles/body-geometry.ts');
const check = process.argv.includes('--check');

// Windows 上动态 import 绝对路径必须转成 file://,否则会被当成 `e:` 协议
const VENDOR = pathToFileURL(resolve(HERE, 'vendor/muscle-map-body-paths.mjs')).href;
const paths = (await import(VENDOR)).default;

/** 七个大组 → MuscleMap 的细分肌肉(和 engine/muscles.ts 的 GROUP_OF 一一对应) */
const GROUP_MUSCLES = {
  chest: ['chest'],
  back: ['trapezius', 'upper-back', 'lower-back'],
  shoulder: ['deltoids', 'serratus'],
  arm: ['biceps', 'triceps', 'forearm'],
  core: ['abs', 'obliques'],
  leg: ['gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors'],
  calf: ['calves', 'tibialis']
};

/** 只当剪影画、不参与统计的部位 */
const INERT = ['head', 'hair', 'neck', 'hands', 'feet', 'knees', 'ankles'];

// ── SVG path → 折线 ─────────────────────────────────────────────────────

function arcPoints(x0, y0, rx, ry, phiDeg, largeArc, sweep, x, y) {
  if (!rx || !ry) return [[x, y]];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const sign = largeArc !== sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = angle(
    (x1p - cxp) / rx, (y1p - cyp) / ry,
    (-x1p - cxp) / rx, (-y1p - cyp) / ry
  );
  if (!sweep && dtheta > 0) dtheta -= Math.PI * 2;
  if (sweep && dtheta < 0) dtheta += Math.PI * 2;
  const n = Math.max(2, Math.ceil(Math.abs(dtheta) / (Math.PI / 18)));
  const out = [];
  for (let k = 1; k <= n; k++) {
    const t = theta1 + (dtheta * k) / n;
    out.push([
      cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx,
      sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy
    ]);
  }
  out[out.length - 1] = [x, y];
  return out;
}

/** 一条 path 的所有子路径(已是折线,坐标是 viewBox 绝对坐标) */
function parsePath(d) {
  const out = [];
  let cur = [];
  let i = 0;
  let cmd = '';
  let cx = 0, cy = 0, sx = 0, sy = 0;

  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const number = () => {
    skip();
    const start = i;
    if (d[i] === '+' || d[i] === '-') i++;
    while (i < d.length && /[0-9]/.test(d[i])) i++;
    if (d[i] === '.') {
      i++;
      while (i < d.length && /[0-9]/.test(d[i])) i++;
    }
    if (d[i] === 'e' || d[i] === 'E') {
      i++;
      if (d[i] === '+' || d[i] === '-') i++;
      while (i < d.length && /[0-9]/.test(d[i])) i++;
    }
    return Number(d.slice(start, i));
  };
  const flag = () => {
    skip();
    return d[i++] === '1' ? 1 : 0;
  };
  const push = (x, y) => {
    const n = cur.length;
    if (n >= 2 && Math.abs(cur[n - 2] - x) < 0.01 && Math.abs(cur[n - 1] - y) < 0.01) return;
    cur.push(x, y);
  };
  const finish = () => {
    if (cur.length >= 6) out.push(cur);
    cur = [];
  };
  const cubic = (x1, y1, x2, y2, x, y) => {
    const n = 14;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      const px = u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x;
      const py = u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y;
      push(px, py);
    }
  };
  const quad = (x1, y1, x, y) => {
    const n = 10;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      push(u * u * cx + 2 * u * t * x1 + t * t * x, u * u * cy + 2 * u * t * y1 + t * t * y);
    }
  };

  while (i < d.length) {
    skip();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) {
      cmd = d[i++];
      if (cmd === 'Z' || cmd === 'z') {
        push(sx, sy);
        finish();
        cx = sx; cy = sy;
        continue;
      }
    }
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();

    if (C === 'M' || C === 'L') {
      const x = number();
      const y = number();
      if (C === 'M') {
        finish();
        cx = rel ? cx + x : x;
        cy = rel ? cy + y : y;
        sx = cx; sy = cy;
        push(cx, cy);
        cmd = rel ? 'l' : 'L';
      } else {
        cx = rel ? cx + x : x;
        cy = rel ? cy + y : y;
        push(cx, cy);
      }
    } else if (C === 'H') {
      const x = number();
      cx = rel ? cx + x : x;
      push(cx, cy);
    } else if (C === 'V') {
      const y = number();
      cy = rel ? cy + y : y;
      push(cx, cy);
    } else if (C === 'C') {
      const x1 = number(), y1 = number(), x2 = number(), y2 = number(), x = number(), y = number();
      const ax = rel ? cx + x1 : x1, ay = rel ? cy + y1 : y1;
      const bx = rel ? cx + x2 : x2, by = rel ? cy + y2 : y2;
      const ex = rel ? cx + x : x, ey = rel ? cy + y : y;
      cubic(ax, ay, bx, by, ex, ey);
      cx = ex; cy = ey;
    } else if (C === 'Q') {
      const x1 = number(), y1 = number(), x = number(), y = number();
      const ax = rel ? cx + x1 : x1, ay = rel ? cy + y1 : y1;
      const ex = rel ? cx + x : x, ey = rel ? cy + y : y;
      quad(ax, ay, ex, ey);
      cx = ex; cy = ey;
    } else if (C === 'A') {
      const rx = number(), ry = number(), rot = number();
      const large = flag();
      const sweep = flag();
      const x = number(), y = number();
      const ex = rel ? cx + x : x, ey = rel ? cy + y : y;
      for (const [px, py] of arcPoints(cx, cy, rx, ry, rot, large, sweep, ex, ey)) push(px, py);
      cx = ex; cy = ey;
    } else {
      throw new Error(`不认识的 path 命令: ${cmd}`);
    }
  }
  finish();
  return out;
}

/** Ramer–Douglas–Peucker:曲线采样点很多,不简化会让生成文件白胖一圈 */
function simplify(points, tolerance) {
  if (points.length <= 6) return points;
  const pts = [];
  for (let i = 0; i < points.length; i += 2) pts.push([points[i], points[i + 1]]);
  const n = pts.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const rdp = (a, b) => {
    if (b <= a + 1) return;
    const [x1, y1] = pts[a];
    const [x2, y2] = pts[b];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    let best = -1, bestD = tolerance;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      // 首尾重合(闭合轮廓)时,直线退化成一个点,按点到点距离算
      const d = len < 1e-6
        ? Math.hypot(px - x1, py - y1)
        : Math.abs(dy * (px - x1) - dx * (py - y1)) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best < 0) return;
    keep[best] = 1;
    rdp(a, best);
    rdp(best, b);
  };
  const closed = Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]) < 0.01;
  if (closed) {
    // 闭合轮廓不能直接拿首尾当基线,先找到离起点最远的那一点,两侧各简化一次
    let far = 1, farD = -1;
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
      if (d > farD) { farD = d; far = i; }
    }
    keep[far] = 1;
    rdp(0, far);
    rdp(far, n - 1);
  } else {
    rdp(0, n - 1);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    out.push(Math.round(pts[i][0] * 10) / 10, Math.round(pts[i][1] * 10) / 10);
  }
  return out;
}

const round1 = (n) => Math.round(n * 10) / 10;

// ── 组装 ────────────────────────────────────────────────────────────────

const sides = {};
let totalPoints = 0;
for (const side of ['front', 'back']) {
  const view = paths.male[side];
  const [vx, vy] = view.vb.split(/\s+/).map(Number);
  const inert = [];
  for (const key of INERT) {
    for (const d of view.p[key] ?? []) {
      for (const poly of parsePath(d)) {
        const s = simplify(poly, 0.45);
        totalPoints += s.length / 2;
        inert.push(s);
      }
    }
  }
  const groups = {};
  for (const [group, keys] of Object.entries(GROUP_MUSCLES)) {
    const polys = [];
    for (const key of keys) {
      for (const d of view.p[key] ?? []) {
        for (const poly of parsePath(d)) {
          const s = simplify(poly, 0.45);
          totalPoints += s.length / 2;
          polys.push(s);
        }
      }
    }
    if (polys.length) groups[group] = polys;
  }
  sides[side] = {
    view: { x: vx, y: vy, w: 727, h: 1280 },
    inert,
    groups
  };
}

const stat = Object.entries(sides).map(([side, s]) => {
  const groups = Object.entries(s.groups).map(([g, polys]) =>
    `${g}:${polys.reduce((n, p) => n + p.length / 2, 0)}`).join(' ');
  return `${side} inert:${s.inert.reduce((n, p) => n + p.length / 2, 0)} ${groups}`;
});

if (check) {
  console.log(stat.join('\n'));
  console.log(`总点数 ${totalPoints}`);
  process.exit(0);
}

const body = JSON.stringify(sides);
const ts = `/* 由 scripts/build-body-map.mjs 生成 —— 不要手改,改脚本重跑。
 *
 * 身体肌群图的几何数据:从 MuscleMap(MIT, Copyright (c) 2026 Melih Colpan)的
 * SVG 路径摊平、简化而来。只取形状,不取任何 AGPL 代码。
 * 许可全文与来源见 scripts/THIRD-PARTY-NOTICES.md 第 3.2 节。
 *
 * 每个多边形是一个扁平数组 [x0, y0, x1, y1, …],坐标是各自 viewBox 的绝对坐标。
 */
import type { MuscleGroup } from '../engine/muscles';

export type BodySide = 'front' | 'back';
export interface BodyView { x: number; y: number; w: number; h: number }
export interface BodySideGeometry {
  view: BodyView;
  /** 头/手/脚/膝/踝/颈 —— 只当剪影,不参与统计 */
  inert: number[][];
  /** 七个大组各自的多边形(有的面没有某个组,例如背面没有胸和腹) */
  groups: Partial<Record<MuscleGroup, number[][]>>;
}

export const BODY_GEOMETRY: Record<BodySide, BodySideGeometry> = ${body};
`;

writeFileSync(OUT, ts);
const bytes = Buffer.byteLength(ts);
console.log(stat.join('\n'));
console.log(`总点数 ${totalPoints} → ${OUT} (${(bytes / 1024).toFixed(1)} KB)`);
