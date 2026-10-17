#!/usr/bin/env node
/**
 * 生成动作演示图(动画 GIF):把数据集里的 gif 落到 server/media/ex/,并写出
 * app/src/pkg-exercise/data/exercise-media.ts(库里 id → 图)。
 *
 * ## ⚠️ 授权:这批图**不是**自由的,上线前必须自己去拿许可
 * 图是 **© Gym visual — https://gymvisual.com/**。数据集仓库(hasaneyldrm/exercises-dataset)
 * 里的 NOTICE 写得很直白:上游拿到的是**它自己的**书面许可,**clone 那个仓库不会给你任何
 * 媒体授权**,要自行去 Gym visual 取得。署名要求是每条用法都得带着
 * `© Gym visual — https://gymvisual.com/`(客户端那行署名在 howto/HowTo.tsx 的 DemoImage 里,
 * 别删)。所以这个脚本**能重跑、能出图,但不能替你把授权办了** —— 详见 THIRD-PARTY-NOTICES.md 第 3 节。
 *
 * ## 为什么不用老的 Everkinetic 静态图了
 * 那套是**两张静止图交替**(放松位 / 发力位),要 289 个动作对 1324 条库,靠别名表硬凑,
 * 只配上 142 条,而且用户看到的「演示」其实是两张不动的画 —— 一句话:「这就不像在动」。
 * 换成 GIF 之后一个动作一张、自带循环,1324 条**一条不落**。
 *
 * ## 为什么是逐张抓、而不是下整包
 * 一开始写的是「下 tar.gz 整包(131MB)再解包」—— 一次请求,听着更省事。实测放弃:
 *   - 这台机器的**总带宽就是这个瓶颈**(实测单连接 ~30–80 KB/s,多开几个连接也不过
 *     50–60 KB/s 聚合),整包要跑一个多小时;
 *   - 更要紧的是**整包不可续传**:中间断一次,一个小时的进度全没了
 *     (上一次就是这么断的)。逐张抓断在哪一张都只亏一张。
 * 所以:一张一个请求、直接写盘、**已经下好且非空的直接跳过**。断了就再跑一次这个脚本,
 * 它只补缺的那些。并发压到 4 —— 更高会被 jsDelivr 限流(实测一次并发 8 全挂)。
 *
 * ## 用法
 *   node scripts/build-exercise-gifs.mjs            # 重建(已经下好的图不会重下,随时可以中断重跑)
 *   node scripts/build-exercise-gifs.mjs --fetch    # 重新拉上游清单快照(动作 id → gif 地址)
 *   node scripts/build-exercise-gifs.mjs --check    # 只报覆盖率,不下载不写文件
 *
 * 清单快照 scripts/gymvisual-index.json 进了版本库:一是让脚本离线可重跑,
 * 二是让「哪条动作配的哪张图」能和上游对质(和上游那份 13MB 的 exercises.json 等价,
 * 只留下我们要的三个字段)。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const INDEX_FILE = resolve(HERE, 'gymvisual-index.json');
const LIB_FILE = resolve(HERE, 'exercises-raw.json');
const MEDIA_DIR = resolve(REPO, 'server/media/ex');
const OUT_TS = resolve(HERE, '../src/pkg-exercise/data/exercise-media.ts');

const REPO_SLUG = 'hasaneyldrm/exercises-dataset';
// 全走 jsDelivr,不用 raw.githubusercontent:后者在这台机器上**直接 fetch failed**
// (上一回也是下到 3.5MB 就断)。jsDelivr 是同一份内容的镜像,通、且稳。
const CDN = `https://cdn.jsdelivr.net/gh/${REPO_SLUG}@main`;
const INDEX_URL = `${CDN}/data/exercises.json`;

/** 一次挂几个请求。实测并发 8 会整批被 jsDelivr 限流(全挂),4 是稳的上限 */
const CONCURRENCY = 4;

const has = (n) => process.argv.includes(`--${n}`);

// ── 清单 ────────────────────────────────────────────────────────────────
async function readIndex() {
  if (has('fetch') || !existsSync(INDEX_FILE)) {
    process.stdout.write(`[gif] 拉上游清单 ${INDEX_URL}\n`);
    const r = await fetch(INDEX_URL);
    if (!r.ok) throw new Error(`拉清单失败:HTTP ${r.status}`);
    const all = await r.json();
    // 只留匹配要用的字段。name 留着是为了 --check 时能把「我们叫 A、它叫 B」摆出来
    const entries = all
      .map((e) => ({ id: String(e.id), name: e.name, gif: e.gif_url || e.gifUrl || null }))
      .filter((e) => e.id && e.gif);
    const slim = {
      _note: `动作演示图清单快照(上游 data/exercises.json 的裁剪版)。上游:https://github.com/${REPO_SLUG}`
        + ' —— 媒体 © Gym visual(https://gymvisual.com/),上游许可不传递给下游。由 scripts/build-exercise-gifs.mjs --fetch 更新。',
      upstream: `https://github.com/${REPO_SLUG}`,
      fetchedAt: new Date().toISOString().slice(0, 10),
      count: entries.length,
      entries
    };
    writeFileSync(INDEX_FILE, JSON.stringify(slim, null, 1), 'utf8');
    console.log(`[gif] 清单快照:${entries.length} 条(原始 ${all.length} 条,没 gif 地址的已剔除)`);
    return slim;
  }
  return JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
}

// ── 下载 ────────────────────────────────────────────────────────────────
/** 落盘名:上游 gif_url 的文件名本身(`0001-2gPfomN.gif`)—— 带的是**它的**素材 id,
 *  照抄才好溯源(文件名不是我们起的,就别自己起) */
const baseName = (gif) => String(gif).split('/').pop();

/** 取一张图,失败退避重试 3 次(断流在这条线路上是常态,重试比整轮重跑便宜) */
async function grab(gif) {
  const url = `${CDN}/${gif}`;
  let last = '';
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      last = `HTTP ${r.status}`;
      // 404 重试没有意义(上游搬过文件),直接认输
      if (r.status === 404) break;
    } catch (e) { last = e.message; }
    await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
  }
  throw new Error(last);
}

/**
 * 并发跑一批任务,边跑边报进度。
 *
 * 进度**必须打出来**:这条线路下一轮要跑十几分钟且随时可能断,没有进度就只能干等,
 * 分不清「在下」和「卡死了」。所以每下完一张就原地刷一行。
 */
async function pool(jobs, size, onDone) {
  let next = 0, done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      await job();
      onDone(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
}

/** GIF 的两个魔数头 —— 只有这两种是有效的。JS 报错页/HTML 之类一律挡掉 */
function checkGif(buf) {
  const head = buf.subarray(0, 6).toString('latin1');
  if (head !== 'GIF87a' && head !== 'GIF89a') return `不是 GIF(头是 ${JSON.stringify(head)})`;
  // 平均值 95KB,小到 1KB 以下基本是占位图或截断
  if (buf.length < 1024) return `太小(${buf.length}B)`;
  return null;
}

// ── main ────────────────────────────────────────────────────────────────
const lib = JSON.parse(readFileSync(LIB_FILE, 'utf8')).entries;
const index = await readIndex();
const byId = new Map(index.entries.map((e) => [e.id, e]));

const picked = [];   // 我们库里配上图的
const missing = [];  // 库里没有图的(应该有 0 条)
for (const ex of lib) {
  const up = byId.get(String(ex.id));
  if (up) picked.push({ libId: String(ex.id), up, name: ex.name });
  else missing.push(`${ex.id} ${ex.name}`);
}
const unused = index.entries.filter((e) => !lib.some((x) => String(x.id) === e.id));

console.log(`[gif] 库里 ${lib.length} 条,配上图 ${picked.length} 条,没配上 ${missing.length} 条;`
  + ` 上游 ${index.entries.length} 条,我们用不到 ${unused.length} 条`);
if (missing.length) console.log(`[gif] !! 库里没配上图的:${missing.slice(0, 10).join('; ')}${missing.length > 10 ? ` …共 ${missing.length}` : ''}`);
if (unused.length) console.log(`[gif] 上游多出来的(我们库里没有):${unused.slice(0, 10).map((e) => `${e.id} ${e.name}`).join('; ')}${unused.length > 10 ? ` …共 ${unused.length}` : ''}`);

if (has('check')) {
  console.log('\n--- 清单 ---');
  for (const p of picked) console.log(`  ${p.libId}  ${baseName(p.up.gif)}  ${p.name}`);
  process.exit(0);
}

// 还差几张?全都在盘上就整个跳过下载(重跑这个脚本应该是秒回的)
mkdirSync(MEDIA_DIR, { recursive: true });
const onDisk = (n) => { const d = resolve(MEDIA_DIR, n); return existsSync(d) && statSync(d).size > 0; };
const lack = picked.filter((p) => !onDisk(baseName(p.up.gif)));
console.log(`[gif] 盘上已有 ${picked.length - lack.length} 张,缺 ${lack.length} 张`);

const kept = new Set();
const rejected = [];
let bytes = 0;
const t0 = Date.now();
if (lack.length) {
  let failed = 0;
  const jobs = lack.map((p) => async () => {
    const n = baseName(p.up.gif);
    const dest = resolve(MEDIA_DIR, n);
    try {
      const buf = await grab(p.up.gif);
      const bad = checkGif(buf);
      if (bad) { rejected.push(`${p.libId} ${n}:${bad}`); return; }
      writeFileSync(dest, buf);
    } catch (e) {
      failed++;
      rejected.push(`${p.libId} ${n}:取不到(${e.message})`);
    }
  });
  await pool(jobs, CONCURRENCY, (n) => {
    // \r 原地刷 —— 1324 行会把别的输出顶没
    const pct = ((n / jobs.length) * 100).toFixed(0);
    process.stdout.write(`\r[gif] 下载 ${n}/${jobs.length} (${pct}%)`);
  });
  process.stdout.write('\n');
  const secs = (Date.now() - t0) / 1000;
  console.log(`[gif] 下载完成,用时 ${(secs / 60).toFixed(1)} 分钟${failed ? `,失败 ${failed} 张(再跑一次这个脚本只补这些)` : ''}`);
}

// 把盘上已有的也算进「该留的」,不然下面清孤儿会把它们当垃圾
for (const p of picked) {
  const n = baseName(p.up.gif);
  if (onDisk(n)) { kept.add(n); bytes += statSync(resolve(MEDIA_DIR, n)).size; }
}
console.log(`[gif] 盘上共 ${kept.size}/${picked.length} 张,合计 ${(bytes / 1048576).toFixed(1)} MB → ${MEDIA_DIR}`);

if (rejected.length) {
  console.log(`[gif] !! ${rejected.length} 张没通过校验,已跳过(不许把坏图端上去):`);
  for (const r of rejected) console.log(`    ${r}`);
}

// ── 清孤儿 ──────────────────────────────────────────────────────────────
// 换图源、清单变了之后旧图留着既占地方又会让人以为还有用。这个目录是脚本自己建的、
// 里面只有上游素材(用户上传的照片在上一层,不在 ex/ 里),所以可以删 —— 但要打出来删了什么。
{
  const orphans = readdirSync(MEDIA_DIR).filter((f) => !kept.has(f) && statSync(resolve(MEDIA_DIR, f)).isFile());
  for (const f of orphans) unlinkSync(resolve(MEDIA_DIR, f));
  if (orphans.length) {
    const ext = {};
    for (const f of orphans) ext[f.split('.').pop()] = (ext[f.split('.').pop()] || 0) + 1;
    console.log(`[gif] 清掉 ${orphans.length} 张用不到的旧图(${Object.entries(ext).map(([k, v]) => `${k}×${v}`).join(', ')})`);
  }
}

// ── 写映射 ──────────────────────────────────────────────────────────────
const good = picked.filter((p) => kept.has(baseName(p.up.gif)));
const lines = good.map((p) => `  ${JSON.stringify(p.libId)}: ${JSON.stringify(baseName(p.up.gif))}, // ${p.name}`).join('\n');
const stamp = new Date().toISOString().slice(0, 10);
writeFileSync(OUT_TS, `/**
 * 动作演示图索引 —— 由 app/scripts/build-exercise-gifs.mjs 自动生成,请勿手改。
 *
 * 键是**我们库里的动作 id**,值是这个动作的**动画 GIF 文件名**(相对 /media/ex/)。
 * GIF 自带循环,一个动作一张,客户端直接摆上去就会动 —— 拼绝对地址见 engine/ex-media.ts。
 *
 * 媒体来源与授权:© Gym visual(https://gymvisual.com/),**不是自由素材**,
 * 上线前需自行取得许可。见 app/scripts/THIRD-PARTY-NOTICES.md 第 3 节。
 * 生成于 ${stamp},共 ${good.length} 条。
 */
export const EX_MEDIA: Record<string, string> = {
${lines}
};
`, 'utf8');
console.log(`[gif] 写出 ${OUT_TS}(${good.length} 条)`);
