/**
 * 「练哪儿」示意图的冒烟测试 —— 覆盖、图对不对、有没有真的点亮。
 *
 * 和 smoke-media.mjs(演示图)是一对,但钉的东西不一样。演示图那套查的是**配错图**;
 * 这一套的图是自己按肌群生成的,不会配错人,它怕的是另外三类**静默**事故:
 *   1. 库里冒出一个没画过的肌群 —— 那个肌群下的几十条动作全掉回「没有图」,
 *      而页面不报错、不空白,只是**少了一块**,没人会发现;
 *   2. 磁盘上的图和索引不是同一次生成的 —— 改了画法没重跑,页面拿到的还是旧图;
 *   3. 图在、身体在、**高亮没了** —— 那个动作就变成一张「练哪儿都不亮」的灰人,
 *      比没有图更让人困惑。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-figure.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FIG_DIR = resolve(HERE, '../../server/media/figure');

const F = require('../.smoke/pkg-exercise/engine/ex-figure.js');
const { MUSCLE_FIGURES } = require('../.smoke/pkg-exercise/data/muscle-figures.js');
const { EXERCISES } = require('../.smoke/pkg-exercise/data/exercises.js');
const { demoUrl } = require('../.smoke/pkg-exercise/engine/ex-media.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

// 生成脚本里那个绿,和 App 的 $color-primary 是同一个色号。写死在这里是故意的:
// 图里那个绿一旦和 App 的绿不是一个绿,页面上一眼就看出来,而机器不查就没人查
const HOT = '#00a878';

const keys = Object.keys(MUSCLE_FIGURES);

section('覆盖:库里的每一个动作都要答得出「练哪儿」');
{
  const targets = [...new Set(EXERCISES.map((e) => e.target).filter(Boolean))];
  const uncovered = targets.filter((t) => !MUSCLE_FIGURES[t]);
  // 这条是**最重要的一条**:库里加了新肌群而没补图,受影响的是那个肌群下的所有动作
  ok('库里出现的每个肌群都有图(没有哪个肌群掉回「没有图」)', uncovered.length === 0,
    uncovered.join(', '));

  const withTarget = EXERCISES.filter((e) => e.target);
  const noFigure = withTarget.filter((e) => !F.figureUrl(e.target));
  ok('标了肌群的动作,每个都拿得到图', noFigure.length === 0,
    noFigure.slice(0, 3).map((e) => `${e.id} ${e.target}`).join(' | '));
  ok('没标肌群的动作(自定义动作可以留空)给的是 null,不是空串', F.figureUrl('') === null && F.figureUrl(undefined) === null);

  // 兜底的覆盖面。
  // 这条的含义**换过一次**:以前演示图只有 142 条,这张肌群图要接住剩下的 1182 条,
  // 所以那时钉的是「没有演示图的动作占多数」。现在演示图 1324/1324 全覆盖
  // (见 smoke-media),这张图对**库里的动作**已经走不到了 —— 唯一走到的是
  // 自定义动作,而那类动作本来就没有 target,也就不会问图。
  // 留着这条断言是为了那个「万一」:演示图那批撤了(授权/换源),每个标了肌群的动作
  // 必须仍然拿得到图,而不是掉回一块空白。
  const noDemo = EXERCISES.filter((e) => !demoUrl(e.id));
  ok('万一演示图没了,标了肌群的动作照样有兜底的图',
    noDemo.filter((e) => e.target && !F.figureUrl(e.target)).length === 0,
    `当前没有演示图的有 ${noDemo.length} 条`);
}

section('索引本身');
{
  ok('图和库对得上(键都是库里真的有的肌群,没有拼错的多余项)',
    keys.every((k) => EXERCISES.some((e) => e.target === k)),
    keys.filter((k) => !EXERCISES.some((e) => e.target === k)).join(', '));
  const badView = keys.filter((k) => MUSCLE_FIGURES[k].view !== 'front' && MUSCLE_FIGURES[k].view !== 'back');
  ok('每项都标了正面还是背面', badView.length === 0, badView.join(', '));
  ok('文件名不重名(重名就是两张图互相覆盖)', new Set(keys.map((k) => MUSCLE_FIGURES[k].file)).size === keys.length);
  ok('文件名都是 .svg', keys.every((k) => MUSCLE_FIGURES[k].file.endsWith('.svg')));

  // 背面那几块肌肉点在正面上就是**画错了**,而且要错就错一片。挑最不会认错的几个钉住
  for (const [m, v] of [['lats', 'back'], ['glutes', 'back'], ['traps', 'back'], ['hamstrings', 'back'], ['pectorals', 'front'], ['abs', 'front']]) {
    if (!MUSCLE_FIGURES[m]) continue;
    ok(`${m} 画在${v === 'back' ? '背' : '正'}面`, MUSCLE_FIGURES[m].view === v, MUSCLE_FIGURES[m].view);
  }
}

section('盘上真的有这些图(索引有、盘上没有 = 页面一张空白)');
{
  ok('图目录在(缺了就先跑 node scripts/build-muscle-figures.mjs)', existsSync(FIG_DIR), FIG_DIR);
  const onDisk = existsSync(FIG_DIR) ? new Set(readdirSync(FIG_DIR)) : new Set();
  const missing = keys.filter((k) => !onDisk.has(MUSCLE_FIGURES[k].file));
  ok('每张图都在盘上', missing.length === 0, missing.map((k) => MUSCLE_FIGURES[k].file).join(', '));

  const referenced = new Set(keys.map((k) => MUSCLE_FIGURES[k].file));
  const orphans = [...onDisk].filter((f) => !referenced.has(f));
  ok('没有多余的孤儿文件(画法改过、索引换了而旧图还留着)', orphans.length === 0, orphans.slice(0, 5).join(', '));

  const tooSmall = [...referenced].filter((f) => onDisk.has(f) && statSync(resolve(FIG_DIR, f)).size < 512);
  ok('没有小到不像图的文件', tooSmall.length === 0, tooSmall.join(', '));
}

section('图本身画对了');
{
  const read = (k) => readFileSync(resolve(FIG_DIR, MUSCLE_FIGURES[k].file), 'utf8');
  const broken = [], noHot = [], noBox = [];
  for (const k of keys) {
    const s = read(k);
    // 高亮没了的那一类:身体还在、绿没了,读者看到的是「这个动作哪儿都不练」
    if (!s.toLowerCase().includes(HOT)) noHot.push(k);
    if (!/viewBox="[^"]+"/.test(s)) noBox.push(k);
    if (!/<path|<ellipse/.test(s)) broken.push(k);
  }
  ok('每张图里都有点亮的那块肌肉(绿没了 = 这个动作哪儿都不练)', noHot.length === 0, noHot.join(', '));
  ok('每张都有 viewBox(widthFix 撑高靠它)', noBox.length === 0, noBox.join(', '));
  ok('每张都真的画了东西', broken.length === 0, broken.join(', '));

  // 小程序 image 的两条硬限制(见官方文档):不吃 <style>、不吃百分比单位。
  // 自己画的图很容易顺手写个 style="fill:...",那在小程序里是**静默不生效**
  const withStyle = keys.filter((k) => /<style/i.test(read(k)));
  const withPercent = keys.filter((k) => /%/.test(read(k).replace(/viewBox="[^"]*"/g, '')));
  ok('没有 <style> 元素(小程序 image 不认,会静默不生效)', withStyle.length === 0, withStyle.join(', '));
  ok('没有百分比单位(同上)', withPercent.length === 0, withPercent.join(', '));

  // 不同肌群的图必须两两不同:一样就是复制粘贴时漏改了高亮 ——「练胸」和「练背」
  // 给出同一张图,而它看上去完全正常,只有对着两个动作比才会发现
  const byContent = new Map();
  for (const k of keys) {
    const c = read(k);
    byContent.set(c, [...(byContent.get(c) ?? []), k]);
  }
  const same = [...byContent.values()].filter((g) => g.length > 1);
  ok('不同肌群的图不是同一张', same.length === 0, same.map((g) => g.join('=')).join(' | '));
}

section('返回的是站点相对地址(要过 mediaUrl 才能用)');
{
  const one = F.figureUrl('pectorals');
  ok('以 /media/figure/ 开头(和后端 express.static 挂在 /media 上的那一行对得上)',
    !!one && one.startsWith('/media/figure/'), String(one));
  ok('是相对地址,不是插了域名的绝对地址', !!one && !/^https?:/.test(one));
  ok('不同肌群给不同的文件', F.figureUrl('pectorals') !== F.figureUrl('lats'));
  ok('正面/背面标注读得出来', F.figureView('lats') === '背面' && F.figureView('abs') === '正面',
    `${F.figureView('lats')} / ${F.figureView('abs')}`);
  ok('不认识的肌群给 null(不是拼一个不存在的地址出来)', F.figureUrl('not-a-muscle') === null);
}

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
