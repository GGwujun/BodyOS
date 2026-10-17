#!/usr/bin/env node
/**
 * 批量翻译动作库(英→中),产出 app/scripts/exercise-zh-cache.json,
 * 随后运行 build-exercise-lib.mjs 合并进 exercises.ts。
 *
 * 调用协议镜像 server/src/ai/zhipu.ts(智谱 Anthropic 兼容端点):
 *   POST {ZHIPU_BASE_URL}/v1/messages,x-api-key 鉴权,thinking 显式关闭。
 * 凭据从 server/.env 读取(ZHIPU_API_KEY / ZHIPU_BASE_URL / ZHIPU_MODEL),不落本目录。
 *
 * 特性:批 15 条/并发 3;JSON 解析失败自动对半拆批重试;逐批原子写缓存,可随时中断续跑。
 * 用法: node scripts/translate-exercises.mjs [--limit N](N=仅翻译前 N 条,冒烟用)
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_FILE = resolve(HERE, 'exercises-raw.json');
const CACHE_FILE = resolve(HERE, 'exercise-zh-cache.json');
const ENV_FILE = resolve(HERE, '../../server/.env');

const BATCH = 15;
const CONCURRENCY = 3;
const MAX_TOKENS = 8192;

// ── 配置 ────────────────────────────────────────────────────────────────
function loadEnv(file) {
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}
const env = loadEnv(ENV_FILE);
const API_KEY = env.ZHIPU_API_KEY;
const BASE = (env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/anthropic').replace(/\/$/, '');
const MODEL = env.ZHIPU_MODEL || 'glm-4.6';
if (!API_KEY) { console.error('[i18n] server/.env 缺 ZHIPU_API_KEY'); process.exit(1); }

const SYSTEM = `你是健身动作术语翻译器。把英文健身动作的名称和步骤翻译成简体中文,只输出 JSON。

规则:
1. 名称:使用中文健身圈通用叫法,简洁准确,一般不超过 12 个字。器械/姿态前缀前置。
2. 步骤:忠实翻译原文每一步,自然祈使句,保留次数/组数/角度等数字信息,不增删步骤含义,不添加注释。
3. 术语表(务必一致):barbell=杠铃 dumbbell=哑铃 cable=绳索 smith machine=史密斯机 kettlebell=壶铃 ez barbell=曲杆 bench press=卧推 incline=上斜 decline=下斜 squat=深蹲 lunge=弓步 deadlift=硬拉 row=划船 pulldown=下拉 pull-up=引体向上 push-up=俯卧撑 dip=双杠臂屈伸 curl=弯举 extension=屈伸 press=推举 raise=平举 fly=飞鸟 crunch=卷腹 plank=平板支撑 calf raise=提踵 hip thrust=臀桥 good morning=早安式 clean=翻举 snatch=抓举 jerk=挺举 alternate/alternating=交替 one-arm=单臂 single-leg=单腿 seated=坐姿 standing=站姿 lying=仰卧(按语境可作俯卧) close-grip=窄距 wide-grip=宽距 reverse=反向 assisted=助力 stretch=拉伸 SMR/foam roll=泡沫轴放松 stability/exercise ball=瑞士球 medicine ball=药球 band=弹力带 body weight=自重
4. 输入是一个 JSON 数组,元素形如 {"id":"0025","n":"barbell bench press","s":["步骤1","步骤2"]}。
5. 只输出一个 JSON 数组,与输入等长同序,元素形如 {"id":"0025","zh":"杠铃卧推","z":["中文步骤1","中文步骤2"]},不要输出任何其它文字、解释或代码围栏。`;

// ── 数据准备 ────────────────────────────────────────────────────────────
const raw = JSON.parse(readFileSync(RAW_FILE, 'utf8'));
const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};
const argLimit = (() => { const i = process.argv.indexOf('--limit'); return i >= 0 ? Number(process.argv[i + 1]) : Infinity; })();
const todo = raw.entries.filter((e) => !cache[e.id]?.name || !Array.isArray(cache[e.id]?.steps)).slice(0, Number.isFinite(argLimit) ? argLimit : undefined);
console.log(`[i18n] 总 ${raw.entries.length} 条,缓存已有 ${Object.keys(cache).length},本次待译 ${todo.length}(模型 ${MODEL})`);

function saveCache() {
  const tmp = CACHE_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(cache), 'utf8');
  renameSync(tmp, CACHE_FILE);
}

// ── 单批调用 ────────────────────────────────────────────────────────────
async function callZhipu(userText, timeoutMs) {
  const res = await fetch(`${BASE}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      system: SYSTEM,
      messages: [{ role: 'user', content: userText }],
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'disabled' }, // glm-4.6 默认输出 thinking 块,会耗尽 max_tokens
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`上游 ${res.status}: ${detail}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(`响应体错误: ${data.error.message ?? ''}`);
  const text = data.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error(`返回为空, stop_reason=${data.stop_reason}`);
  return text;
}

/** 翻译一批;JSON 解析失败则对半拆批重试(下限 3 条/批)。返回成功条数。 */
async function translateBatch(batch, depth = 0) {
  const payload = JSON.stringify(batch.map((e) => ({ id: e.id, n: e.name, s: e.steps })));
  let out;
  try {
    const raw = await callZhipu(payload, 180_000);
    const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const start = cleaned.indexOf('['), end = cleaned.lastIndexOf(']');
    out = JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    if (batch.length > 3 && depth < 3) {
      console.log(`[i18n] 批解析失败(${err.message.slice(0, 80)}),对半拆批重试`);
      const mid = Math.floor(batch.length / 2);
      return (await translateBatch(batch.slice(0, mid), depth + 1)) + (await translateBatch(batch.slice(mid), depth + 1));
    }
    console.error(`[i18n] 批最终失败(${batch.length} 条): ${err.message.slice(0, 120)}`);
    return 0;
  }
  const byId = new Map(batch.map((e) => [e.id, e]));
  let ok = 0;
  for (const it of out) {
    const src = byId.get(it?.id);
    const nameOk = typeof it?.zh === 'string' && it.zh.trim() && it.zh.length <= 30;
    const stepsOk = Array.isArray(it?.z) && it.z.length >= 1 && it.z.length <= 15 && it.z.every((s) => typeof s === 'string' && s.trim());
    if (!src || !nameOk || !stepsOk) continue;
    cache[src.id] = { name: it.zh.trim(), steps: it.z.map((s) => s.trim()) };
    ok++;
  }
  saveCache();
  return ok;
}

// ── 并发调度(简单工作池) ─────────────────────────────────────────────────
const batches = [];
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
let doneBatches = 0, translated = 0;
const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
  while (batches.length) {
    const b = batches.shift();
    if (!b) break;
    translated += await translateBatch(b);
    doneBatches++;
    console.log(`[i18n] 进度 ${doneBatches}/${doneBatches + batches.length} 批,累计译成 ${translated} 条`);
  }
});
await Promise.all(workers);
console.log(`[i18n] 完成:本次译成 ${translated}/${todo.length};缓存共 ${Object.keys(cache).length}/${raw.entries.length}。下一步: node scripts/build-exercise-lib.mjs 合并中文`);
