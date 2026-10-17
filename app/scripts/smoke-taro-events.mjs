/**
 * 扫全库:有没有把事件处理函数写成**可能不是函数**的表达式。
 *
 * ## 为什么值得一条专门的套件
 * 这个错误**在代码里看不出来**,在 H5 上也不复现,只有小程序端跑起来才炸,
 * 而且炸的现场离病根很远:抛异常的是 Taro 的 `removeEventListener`,
 * 报的是 `Cannot read property '_num' of undefined`,打在屏幕上的是
 * 「这个弹层点了没反应」。**不查就没有人会猜到这里** —— 上一回就是这么查了一下午。
 *
 * 原理(全文见 `src/utils/taro-events.ts`):Taro 3.6 的 `setEvent` 在「函数 → 非函数」
 * 时走 `removeEventListener(name, oldValue)`(没传 `sideEffect: false`),于是运行时
 * 要把节点降级成 `pure-text`,而别名表里**没有 `PureText`** → 崩。
 *
 * ## 查什么
 * 事件属性(`onClick`/`onInput`/… )的值,如果**整段不是函数字面量**,再看它是不是
 * 这两种收尾成「非函数」的写法:
 *   - `cond ? fn : undefined` / `: null` / `: false`
 *   - `cond && fn`(cond 为假时值就是 `false`)
 * 命中就报。`() => …`、`function …`、`handleSave` 这类一律放过(裸标识符可能为
 * undefined,但那是另一回事,静态查不出来也不该全禁)。
 *
 * 用法:
 *   node scripts/smoke-taro-events.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.tsx')) files.push(p);
  }
})(SRC);

/**
 * 先把注释抹成等长空白(保留换行)再扫。
 *
 * 不是洁癖:这个陷阱的**说明文字本身**就长着那副样子(注释里写「别写成
 * `onClick={cond ? fn : undefined}`」),不抹掉的话每条讲这件事的注释都会被自己抓出来,
 * 而一个天天误报的检查等于没有。
 */
function stripComments(src) {
  let out = '', i = 0;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const q = src[i];
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        j++;
      }
      out += src.slice(i, j);
      i = j;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

/** 从 `{` 开始配对取到整个属性值表达式(JSX 里允许嵌套对象/函数体) */
function exprAfter(src, i) {
  let depth = 0, str = null, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (str) {
      if (c === '\\') { j++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(i + 1, j); }
  }
  return null;
}

// 事件属性名。onXxxCapture 之类一并覆盖
const EVT = /\bon[A-Z][A-Za-z]*\s*=\s*\{/g;

/** 整段就是一个函数字面量吗(箭头函数 / function / 包起来的表达式形式) */
const isFnLiteral = (e) => {
  const t = e.trim();
  if (/^(async\s+)?function\b/.test(t)) return true;
  if (/^(async\s+)?\([^)]*\)\s*=>/.test(t)) return true;
  // 单参数箭头:x => …(但不能是 `a && b` 这种没有 => 的)
  if (/^[A-Za-z_$][\w$]*\s*=>/.test(t)) return true;
  return false;
};

/**
 * `&&` 是不是在**顶层**?
 *
 * 光看「这段里有没有 `&&`」会把 `onIf(a && b, fn)` 也抓出来 —— 那个 `&&` 是 `onIf`
 * 的**实参**,整段表达式的值是 `onIf(...)` 的返回值,一个妥妥的函数。
 * 括号/方括号/花括号里的 `&&` 属于内层表达式,和作为事件值的那一层无关。
 */
function topLevelHas(expr, op) {
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && expr.startsWith(op, i)) return true;
  }
  return false;
}

/** 扫一段源码,给出命中的 `{行, 属性名, 表达式}` */
function scan(src) {
  const s = stripComments(src);
  const out = [];
  EVT.lastIndex = 0;
  let m;
  while ((m = EVT.exec(s))) {
    const expr = exprAfter(s, s.indexOf('{', m.index));
    if (expr == null) continue;
    if (isFnLiteral(expr)) continue;
    const flat = expr.replace(/\s+/g, ' ').trim();
    // 三元以非函数收尾
    const ternaryBad = /\?(?:[^?]*?):\s*(undefined|null|false)\s*$/.test(flat);
    // 顶层 &&(整段里没有 `?` 也没有 `=>`,那就是短路表达式的值)
    const andBad = !flat.includes('?') && !flat.includes('=>') && topLevelHas(flat, '&&');
    if (ternaryBad || andBad) {
      out.push({ line: s.slice(0, m.index).split('\n').length, prop: m[0].replace(/\s*=.*$/, ''), expr: flat });
    }
  }
  return out;
}

// ── 先证明这把尺子量得出东西 ────────────────────────────────────────────
// 一个「今天恰好没有犯规」的检查和一个「压根不工作」的检查,输出一模一样。
// 所以拿几条已知的样本先对一遍再拿去扫全库。
{
  const BAD = [
    'onClick={failed ? load : undefined}',
    'onClick={cond ? fn : null}',
    'onClick={cond ? fn : false}',
    'onPress={ok && save}',
    'onInput={locked && onEdit}'
  ];
  const GOOD = [
    'onClick={() => { if (failed) load(); }}',
    'onClick={onIf(failed, load)}',
    'onClick={handleSave}',
    'onClick={e => e.stopPropagation()}',
    'onClick={async () => { await save(); }}',
    'onClick={function () { go(); }}',
    // `&&` 在实参里 —— 整段的值是 onIf 的返回值,是函数。
    // (曾经把这条误报过:那把尺子只看「有没有 `&&`」,不看它在哪一层)
    'onClick={onIf(a && b, load)}',
    // 注释里写着这个陷阱的**说明文字**,不该被抓
    '/* 别写成 onClick={cond ? fn : undefined} */\n<Text onClick={onIf(cond, fn)} />',
    '<Text className={on ? "a" : "b"} onClick={go}>x</Text>'
  ];
  const missed = BAD.filter((s) => scan(s).length === 0);
  const noise = GOOD.filter((s) => scan(s).length > 0);
  ok('这把尺子量得出该量出来的(4 种收尾成非函数的写法)', missed.length === 0, missed.join(' | '));
  ok('也不误报(函数字面量、裸标识符、注释里的例子)', noise.length === 0, noise.join(' | '));
}

const hits = [];
for (const f of files) {
  for (const h of scan(readFileSync(f, 'utf8'))) {
    hits.push(`${relative(SRC, f).replace(/\\/g, '/')}:${h.line}  ${h.prop}={${h.expr}}`);
  }
}

ok('扫到了源码文件(扫 0 个文件也会「全过」,这一条防的是这个)', files.length > 20, `${files.length} 个 .tsx`);
ok('没有「事件值可能不是函数」的写法(会把整棵子树点废)', hits.length === 0, hits.join('\n      '));

console.log(
  hits.length
    ? '\n改法:事件永远绑着,条件写进函数体 —— onClick={() => { if (cond) fn(); }} 或用 utils/taro-events 的 onIf(cond, fn)'
    : `\n检查了 ${files.length} 个文件里所有事件属性`
);
console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
