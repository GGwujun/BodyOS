#!/usr/bin/env node
/**
 * 生成「目标肌群示意图」—— 给**没有演示图**的动作兜底。
 *
 * ## 它现在还剩下什么用
 * 当初写它,是因为演示图只有 142/1324(上游 Everkinetic 就 289 个动作,对不上)。
 * 现在演示图换成了 Gym visual 那批 GIF,**1324/1324 全覆盖**(见 build-exercise-gifs.mjs),
 * 所以库里的动作不会再走到这张图 —— 会走到的只有自定义动作,以及「哪天那批 GIF 撤了」。
 * 保留它的理由就是后者:那是唯一接得住的东西。
 *
 * ## 为什么是「示意图」而不是「找更多图」
 * 免费来源就这么大(gymvisual / free-exercise-db 的图有授权问题,不能用),
 * 硬凑数量只能靠放宽匹配 —— 那是拿**别人的动作图**冒充,配错一张就是教错一个动作。
 * 所以这里换一条路:**自己画**。画一张按「主要肌群」点亮的身体图 —— 它回答的是
 * 「这个动作练哪儿」,和「这个动作怎么做」是两个正交的问题,不冒充后者。
 * 详细取舍见 docs/03-埋点方案.md 旁边那份图谱说明。
 *
 * ## 为什么只有 19 张
 * 我们库里 `target`(主要肌群)一共就 19 个取值 —— 图按肌群出,不按动作出。
 * 1182 个动作共用这 19 张,是因为同一个肌群的动作,「练哪儿」本来就一样。
 * 这也让这个脚本的输出小到可以进版本库(19 个小文件),不需要构建期下载任何东西。
 *
 * ## 用法
 *   node scripts/build-muscle-figures.mjs           # 重建图 + 索引
 *   node scripts/build-muscle-figures.mjs --check   # 只打印会写哪些文件
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const LIB_FILE = resolve(HERE, 'exercises-raw.json');
const FIG_DIR = resolve(REPO, 'server/media/figure');
const OUT_TS = resolve(HERE, '../src/pkg-exercise/data/muscle-figures.ts');

const check = process.argv.includes('--check');

// ── 颜色 ────────────────────────────────────────────────────────────────
// 底色是身体的「纸」,高亮是品牌绿。两个色号都跟 App 的 $color-primary 一致,
// 不然图里的绿和按钮的绿差一点,看着像两个不同的绿。
const BODY = '#E7EBEF';
const BODY_EDGE = '#D3DAE1';
const HOT = '#00A878';

// ── 身体几何 ────────────────────────────────────────────────────────────
// 画法:躯干/头用形状,四肢用**粗圆头描边**的线段 —— 线段天生有圆角,不需要
// 为每条肢体单独调贝塞尔,改姿势也只是改两个端点。200×352 的画布,
// 中线 x=100,左右镜像(x' = 200 - x)。
const W = 200;
const H = 352;
const mir = (x) => W - x;

/** 一条肢体:圆头粗线 */
const limb = (x1, y1, x2, y2, w, color) =>
  `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
/** 左右各来一条 */
const limbs = (x1, y1, x2, y2, w, color) => limb(x1, y1, x2, y2, w, color) + limb(mir(x1), y1, mir(x2), y2, w, color);
const ell = (cx, cy, rx, ry, color, rot) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}"${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`;

const TORSO = 'M63 80 C66 110 72 122 79 156 C82 170 70 180 67 196 C64 210 80 219 100 219 '
  + 'C120 219 136 210 133 196 C130 180 118 170 121 156 C128 122 134 110 137 80 '
  + 'C118 69 82 69 63 80 Z';

/** 底子:一个不带任何肌群的裸身体。两种视角(正面/背面)共用 —— 剪影本来就是同一个 */
const body = () => [
  `<path d="${TORSO}" fill="${BODY}" stroke="${BODY_EDGE}" stroke-width="1.5"/>`,
  ell(100, 34, 16.5, 19.5, BODY),
  `<path d="M92 48 L108 48 L108 62 L92 62 Z" fill="${BODY}"/>`,
  // 肩头这一块不能少:上臂是根线段,起点落在躯干肩上,不补这一块的话手臂和身体之间
  // 会留一道豁口 —— 19 张图里有 18 张没点亮这一处,豁口就一直在
  ell(63, 88, 15, 13, BODY) + ell(mir(63), 88, 15, 13, BODY),
  limbs(62, 92, 49, 148, 20, BODY),       // 上臂
  limbs(49, 148, 43, 200, 15, BODY),      // 前臂
  ell(42, 208, 8.5, 10.5, BODY, -8),      // 手
  limbs(87, 198, 83, 266, 27, BODY),      // 大腿
  limbs(83, 266, 81, 322, 19, BODY),      // 小腿
  ell(78, 330, 11.5, 6.5, BODY, -10),     // 脚
  ell(mir(42), 208, 8.5, 10.5, BODY, 8),
  ell(mir(78), 330, 11.5, 6.5, BODY, 10),
].join('\n  ');

/** 每块肌群怎么点亮。key = target 的取值(和我们库里的一模一样) */
const MUSCLES = {
  // ── 正面 ──
  pectorals: { view: 'front', zh: '胸大肌', draw: () =>
    `<path d="M76 94 C86 86 114 86 124 94 C127 116 122 130 112 134 C104 136 96 134 88 134 C78 130 73 116 76 94 Z" fill="${HOT}"/>`
    + `<path d="M100 92 L100 133" stroke="${BODY}" stroke-width="3"/>` },
  abs: { view: 'front', zh: '腹直肌', draw: () =>
    `<rect x="86" y="138" width="28" height="38" rx="6" fill="${HOT}"/>`
    + `<path d="M100 140 L100 174 M86 150 L114 150 M86 163 L114 163" stroke="${BODY}" stroke-width="2.5"/>` },
  biceps: { view: 'front', zh: '肱二头肌', draw: () => limbs(61, 98, 53, 136, 17, HOT) },
  quads: { view: 'front', zh: '股四头肌', draw: () => limbs(88, 204, 85, 250, 24, HOT) },
  adductors: { view: 'front', zh: '大腿内收肌', draw: () => limbs(93, 206, 92, 248, 13, HOT) },
  abductors: { view: 'front', zh: '大腿外展肌', draw: () =>
    `<path d="M75 194 C70 212 72 226 79 238" stroke="${HOT}" stroke-width="13" stroke-linecap="round" fill="none"/>`
    + `<path d="M125 194 C130 212 128 226 121 238" stroke="${HOT}" stroke-width="13" stroke-linecap="round" fill="none"/>` },
  'serratus anterior': { view: 'front', zh: '前锯肌', draw: () =>
    `<path d="M71 126 C79 131 84 139 86 148" stroke="${HOT}" stroke-width="8" stroke-linecap="round" fill="none"/>`
    + `<path d="M129 126 C121 131 116 139 114 148" stroke="${HOT}" stroke-width="8" stroke-linecap="round" fill="none"/>` },
  'cardiovascular system': { view: 'front', zh: '心肺', draw: () =>
    `<path d="M100 158 C86 146 78 138 78 129 C78 121 84 116 91 116 C95 116 98 118 100 121 C102 118 105 116 109 116 C116 116 122 121 122 129 C122 138 114 146 100 158 Z" fill="${HOT}"/>` },
  delts: { view: 'front', zh: '三角肌', draw: () => ell(63, 88, 15, 13, HOT) + ell(mir(63), 88, 15, 13, HOT) },
  forearms: { view: 'front', zh: '前臂', draw: () => limbs(51, 152, 45, 196, 14, HOT) },

  // ── 背面 ──
  // 背面那几块(背阔肌、臀、腘绳肌、小腿)放正面就点错位置了 —— 胸前面并没有背阔肌。
  // 剪影一样,所以「翻个面」在这个画法里只等于「换一组高亮」。
  traps: { view: 'back', zh: '斜方肌', draw: () =>
    `<path d="M88 74 C96 88 104 88 112 74 C120 84 122 100 116 108 C106 116 94 116 84 108 C78 100 80 84 88 74 Z" fill="${HOT}"/>` },
  'upper back': { view: 'back', zh: '上背(菱形肌/中斜方)', draw: () =>
    `<path d="M82 106 C92 98 108 98 118 106 L116 142 C106 148 94 148 84 142 Z" fill="${HOT}"/>` },
  lats: { view: 'back', zh: '背阔肌', draw: () =>
    `<path d="M82 114 C76 138 78 160 86 170 C94 174 99 164 100 150 L100 116 Z" fill="${HOT}"/>`
    + `<path d="M118 114 C124 138 122 160 114 170 C106 174 101 164 100 150 L100 116 Z" fill="${HOT}"/>` },
  spine: { view: 'back', zh: '竖脊肌', draw: () =>
    `<path d="M100 84 L100 190" stroke="${HOT}" stroke-width="7" stroke-linecap="round"/>`
    + `<path d="M95 100 L105 100 M95 116 L105 116 M95 132 L105 132 M95 148 L105 148 M95 164 L105 164" stroke="${BODY}" stroke-width="2.5"/>` },
  'levator scapulae': { view: 'back', zh: '肩胛提肌', draw: () => limbs(92, 58, 82, 84, 9, HOT) },
  triceps: { view: 'back', zh: '肱三头肌', draw: () => limbs(61, 98, 53, 136, 16, HOT) },
  glutes: { view: 'back', zh: '臀大肌', draw: () => ell(88, 204, 14.5, 15, HOT) + ell(mir(88), 204, 14.5, 15, HOT) },
  hamstrings: { view: 'back', zh: '腘绳肌', draw: () => limbs(88, 226, 85, 262, 23, HOT) },
  calves: { view: 'back', zh: '小腿三头肌', draw: () => limbs(84, 268, 82, 300, 20, HOT) },
};

const VIEW_ZH = { front: '正面', back: '背面' };

function svg(view, draw) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- BodyOS 自绘肌群示意图。不来自任何第三方图库,无署名义务 -->
  <g>
  ${body()}
  </g>
  <g>
  ${draw()}
  </g>
</svg>
`;
}

const slug = (t) => t.trim().toLowerCase().replace(/\s+/g, '-');

// ── 跑 ──────────────────────────────────────────────────────────────────
const raw = JSON.parse(readFileSync(LIB_FILE, 'utf8'));
const entries = raw.entries || raw;
const targets = [...new Set(entries.map((e) => e.target).filter(Boolean))].sort();

const missing = targets.filter((t) => !MUSCLES[t]);
if (missing.length) {
  // 库里出了新的 target 就是这里没画 —— 与其悄悄回退成「没有图」,不如当场停下
  console.error(`[figure] 库里出现了没画过的肌群:${missing.join(', ')}`);
  console.error('[figure] 请在 MUSCLES 里补一块,别让这些动作掉回「没有图」');
  process.exit(1);
}

const unused = Object.keys(MUSCLES).filter((k) => !targets.includes(k));

if (check) {
  console.log(`[figure] 库里 target ${targets.length} 种,会写 ${targets.length} 个文件到 server/media/figure/`);
  for (const t of targets) console.log(`  ${slug(t)}.svg  ${MUSCLES[t].view === 'back' ? '背面' : '正面'}  ${MUSCLES[t].zh}`);
  if (unused.length) console.log(`[figure] 画了但库里没用到的:${unused.join(', ')}(不算错,留着备用)`);
  process.exit(0);
}

if (!existsSync(FIG_DIR)) mkdirSync(FIG_DIR, { recursive: true });
for (const t of targets) {
  writeFileSync(resolve(FIG_DIR, `${slug(t)}.svg`), svg(MUSCLES[t].view, MUSCLES[t].draw));
}

const rows = targets.map((t) =>
  `  ${JSON.stringify(t)}: { file: ${JSON.stringify(`${slug(t)}.svg`)}, view: ${JSON.stringify(MUSCLES[t].view)}, zh: ${JSON.stringify(MUSCLES[t].zh)} },`);

const ts = `/* 由 scripts/build-muscle-figures.mjs 生成 —— 不要手改,改脚本重跑。
 *
 * 动作**没有演示图**时兜底的那张「练哪儿」示意图:按主要肌群(target)点亮的身体图,
 * 画在 server/media/figure/,一个肌群一张。
 *
 * 为什么按肌群而不是按动作:库里 ${entries.length} 条动作的 target 只有 ${targets.length} 种,
 * 而同一个肌群的动作「练哪儿」本来就是一回事。19 张图覆盖全部动作。
 *
 * 自己画的图,没有第三方署名义务 —— 这一点和演示图(exercise-media.ts,© Gym visual)
 * 不一样,两边的署名/说明文案也因此不同,别混。
 *
 * 演示图现在 ${entries.length} 条全覆盖,所以这张图基本轮不到(它是兜底)。
 */
export type MuscleFigure = { file: string; view: 'front' | 'back'; zh: string };

export const MUSCLE_FIGURES: Record<string, MuscleFigure> = {
${rows.join('\n')}
};
`;

writeFileSync(OUT_TS, ts);
console.log(`[figure] 写好 ${targets.length} 张图 → server/media/figure/`);
console.log(`[figure] 索引 → src/pkg-exercise/data/muscle-figures.ts`);
if (unused.length) console.log(`[figure] 画了但库里没用到的:${unused.join(', ')}`);
