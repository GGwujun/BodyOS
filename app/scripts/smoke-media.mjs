/**
 * 动作演示图(GIF)的冒烟测试 —— 索引、盘上的图、库里那条动作,三者对得上吗。
 *
 * 这一套钉的不是「功能对不对」,而是**配错图 / 缺图**这一类事故。它的来源是:
 *   1. 索引里的 id 打错了 / 库里那条动作被删了改号了 —— 表现在:索引指着一个不存在的动作;
 *   2. 图没下下来(或者下载时校验没过被跳过)—— 表现在:索引里有、盘上没有;
 *   3. **两个动作指向同一个文件** —— id 查错一位就会这样,页面上一张图挂在两个动作名下,
 *      看着完全正常,只有把两个动作摆一起才发现「怎么长得一模一样」。
 * 这三条都是**静默**的:接口 200、文件也在、页面能打开,就是图不对。所以必须机器来查。
 *
 * 上一版查的是「同一个动作的几帧宽高比一致」(那时是两张静止图交替放,容器靠第一帧撑高)。
 * 换成 GIF 之后一个动作一张图、widthFix 撑高,那条已经不是问题了 —— 删掉比留着强,
 * 留一条永远为真的断言等于没有断言。
 *
 * 用法:
 *   npx tsc -p tsconfig.smoke.json
 *   node scripts/smoke-media.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = resolve(HERE, '../../server/media/ex');

const M = require('../.smoke/pkg-exercise/engine/ex-media.js');
const { EX_MEDIA } = require('../.smoke/pkg-exercise/data/exercise-media.js');
const { EXERCISES } = require('../.smoke/pkg-exercise/data/exercises.js');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

const libIds = new Set(EXERCISES.map((e) => e.id));
const ids = Object.keys(EX_MEDIA);

/** GIF 头:0-2 是 "GIF",3-5 是版本,6-7 宽、8-9 高(小端 uint16)。头不对就是坏文件 */
function gifInfo(f) {
  const p = resolve(MEDIA_DIR, f);
  if (!existsSync(p)) return null;
  const b = readFileSync(p);
  const sig = b.toString('latin1', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  if (b.length < 10) return null;
  return { w: b.readUInt16LE(6), h: b.readUInt16LE(8), bytes: b.length };
}

section('索引本身');
{
  const expect = EXERCISES.length;
  // 上游 1324 条和我们库一一对应。宁可写成「>= 库里的 99%」而不是写死 1324:
  // 以后库里加一条动作,不该因为这条断言把测试搞红;但掉一大片就是脚本退化了,必须红
  ok('覆盖率没掉(库里的动作几乎每条都有图)', ids.length >= expect * 0.99,
    `${ids.length} / ${expect}`);
  const dangling = ids.filter((id) => !libIds.has(id));
  ok('每个 id 都能在动作库里找到(没有指着一个不存在的动作)', dangling.length === 0,
    dangling.slice(0, 5).join(', '));

  const nonGif = ids.filter((id) => !EX_MEDIA[id].endsWith('.gif'));
  ok('值都是 .gif 文件名(不是数组、不是别的格式 —— 那说明跑成了老的生成脚本)',
    nonGif.length === 0, nonGif.slice(0, 5).map((i) => `${i}=${EX_MEDIA[i]}`).join(', '));

  const noLib = EXERCISES.filter((e) => M.hasDemo(e.id)).length;
  ok('hasDemo 和索引条数对得上', noLib === ids.length, `${noLib} vs ${ids.length}`);
}

section('没有演示图时不许瞎报');
{
  // 库里现在一条不缺,能走到的只有「不在表里」的那几条:自定义动作和根本不存在的 id。
  // 自定义动作是用户运行时建的、不在 EXERCISES 里,所以这里**造一个** c- id 来问
  ok('自定义动作(c- 开头)没有演示图', !M.hasDemo('c-1755500000000'));
  ok('压根不存在的 id 给 null(不是拼一个不存在的地址出来)', M.demoUrl('999999') === null);
  ok('空 id 也给 null', M.demoUrl('') === null);

  const misses = EXERCISES.filter((e) => !EX_MEDIA[e.id]);
  ok('库里没配图的都老老实实不报有图', misses.every((e) => !M.hasDemo(e.id)),
    `库里缺图 ${misses.length} 条`);
}

section('盘上真的有这些图(索引有、盘上没有 = 页面一张空白)');
{
  ok('媒体目录在(缺了就先跑 node scripts/build-exercise-gifs.mjs)',
    existsSync(MEDIA_DIR), MEDIA_DIR);
  const onDisk = existsSync(MEDIA_DIR) ? new Set(readdirSync(MEDIA_DIR)) : new Set();
  const missing = ids.filter((id) => !onDisk.has(EX_MEDIA[id]));
  ok('每张图都在盘上', missing.length === 0, missing.slice(0, 5).join(', '));

  const referenced = new Set(ids.map((id) => EX_MEDIA[id]));
  const orphans = [...onDisk].filter((f) => !referenced.has(f));
  ok('没有多余的孤儿文件(换过图源、索引变了而旧图还留着)',
    orphans.length === 0, `${orphans.length} 个,例如 ${orphans.slice(0, 5).join(', ')}`);
}

section('图本身是能看的 GIF(下载被截断 / 端上来一个 HTML 错误页都在这里现形)');
{
  const broken = [], tiny = [], weird = [];
  const ratios = [];
  for (const id of ids) {
    const g = gifInfo(EX_MEDIA[id]);
    if (!g) { broken.push(`${id} ${EX_MEDIA[id]}`); continue; }
    if (g.bytes < 1024) tiny.push(`${EX_MEDIA[id]}(${g.bytes}B)`);
    // 宽高得是正数、得像张图。Gym visual 那批实测在 400×400 上下,区间给宽点,
    // 只拦「读出来是 0 / 65535」这种解析错位
    if (g.w < 50 || g.h < 50 || g.w > 4000 || g.h > 4000) weird.push(`${EX_MEDIA[id]}(${g.w}×${g.h})`);
    ratios.push(g.w / g.h);
  }
  ok('每张都有合法的 GIF 头(坏文件/HTML 错误页混进来就会红)', broken.length === 0,
    broken.slice(0, 5).join(', '));
  ok('没有小到不像图的文件', tiny.length === 0, tiny.slice(0, 5).join(', '));
  ok('每张都量得出正常的长宽', weird.length === 0, weird.slice(0, 5).join(', '));

  const total = [...new Set(ids.map((i) => EX_MEDIA[i]))]
    .reduce((n, f) => n + (existsSync(resolve(MEDIA_DIR, f)) ? statSync(resolve(MEDIA_DIR, f)).size : 0), 0);
  ok('总体量在我们预期的量级(几十 MB 以上;小了一个数量级就是下丢了大半)',
    total > 40 * 1048576, `${(total / 1048576).toFixed(1)} MB`);
  const nonSquare = ratios.filter((r) => Math.abs(r - 1) > 0.02).length;
  console.log(`      长宽比:${ratios.length - nonSquare} 张正方、${nonSquare} 张不是(只是记录,不断言 ——`
    + ' 客户端用的是 aspectFit,比例不一样不会拉变形)');

  // 这条钉的是**客户端那个写死的 180px**(见 howto/index.scss):
  // 上游这批实测就是 180×180,所以按原生尺寸摆、不铺满卡片。哪天换了图源、
  // 分辨率掉下去,页面上会**变糊** —— 而糊图是没人会去查的那一类退化
  const small = ids.filter((id) => {
    const g = gifInfo(EX_MEDIA[id]);
    return !g || Math.min(g.w, g.h) < 150;
  });
  ok('短边都不小于 150px(客户端按 180px 摆,源图比这小就会糊)', small.length === 0,
    small.slice(0, 5).map((id) => `${EX_MEDIA[id]}`).join(', '));
}

section('图**会动**(用户投诉过两次的就是这个:端上去一堆静止图)');
{
  // 数 Graphics Control Extension(0x21 0xF9),一帧一个。
  //
  // 这是**启发式**而不是真解析 LZW:数据段里凑巧出现这两个字节也会被数进去。
  // 但用在这里正好 —— 它只会把帧数**数多**,不会把一张真静止的图数成十几帧,
  // 所以「少于 4 帧」这条断言不会被假阴性绕过。要精确数字得写 GIF 解析器,不值当。
  const frames = (f) => {
    const b = readFileSync(resolve(MEDIA_DIR, f));
    let n = 0;
    for (let i = 0; i < b.length - 1; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9) n++;
    return n;
  };
  const counts = ids.map((id) => frames(EX_MEDIA[id]));
  const still = ids.filter((id, k) => counts[k] < 4);
  ok('每张都是多帧的(单帧 = 又是一张静止图,那就白换了)', still.length === 0,
    still.slice(0, 5).map((id) => `${EX_MEDIA[id]}(${(counts[ids.indexOf(id)] ?? 0)}帧)`).join(', '));
  const sorted = [...counts].sort((a, b) => a - b);
  console.log(`      帧数:最少 ${sorted[0]}、中位 ${sorted[Math.floor(sorted.length / 2)]}、最多 ${sorted[sorted.length - 1]}`);
}

section('一个动作一张图 —— 两个动作指向同一个文件就是 id 查错了');
{
  const byFile = new Map();
  for (const id of ids) {
    const f = EX_MEDIA[id];
    byFile.set(f, [...(byFile.get(f) ?? []), id]);
  }
  const shared = [...byFile.values()].filter((g) => g.length > 1);
  ok('没有哪张图被两个动作共用', shared.length === 0,
    shared.slice(0, 3).map((g) => g.join('=')).join(' | '));
  ok('文件名和动作 id 对得上(文件名是上游的,前缀那 4 位就是它的动作号)',
    ids.every((id) => EX_MEDIA[id].startsWith(id)),
    ids.filter((id) => !EX_MEDIA[id].startsWith(id)).slice(0, 5)
      .map((id) => `${id}→${EX_MEDIA[id]}`).join(', '));
}

section('返回的是站点相对地址(要过 mediaUrl 才能用)');
{
  const one = ids[0];
  const url = M.demoUrl(one);
  ok('是字符串,不是数组(上一版给的是帧数组)', typeof url === 'string', String(url));
  ok('以 /media/ex/ 开头(和后端 express.static 挂在 /media 上的那一行对得上)',
    url.startsWith('/media/ex/'), url);
  ok('是相对地址,不是插了域名的绝对地址', !/^https?:/.test(url));
  const other = M.demoUrl(ids[1]);
  ok('每个动作给的是自己的图', url !== other, `${url} vs ${other}`);
}

console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
