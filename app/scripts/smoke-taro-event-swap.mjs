/**
 * 扫全库:有没有**同一个位置上的三元分支,一边有事件属性、另一边没有**。
 *
 * ## 和 smoke-taro-events.mjs 是什么关系
 * 那个查的是**一个表达式的值**可能不是函数(`onClick={cond ? fn : undefined}`);
 * 这个查的是**两个分支本来是两个元素**,值那一层每个分支都是好函数,
 * 却因为 React 的调和规则被当成同一个节点去**改** props,于是事件属性被摘掉。
 *
 * ```tsx
 * // 值那一层挑不出毛病,崩的却是这一行
 * {water != null
 *   ? <Text>读到啦</Text>                     // ← 没有 onClick
 *   : <Text onClick={onIf(failed, load)}>…</Text>}
 * ```
 *
 * 同一个位置、同一个标签的两个分支,React 认成**同一个节点**,只改 props。
 * `water` 一从 null 变成有值,`onClick` 就从**函数变成了「没有」** ——
 * Taro 3.6 的 `setEvent` 在那个方向上走 `removeEventListener(name, oldValue)`,
 * 没传 `sideEffect: false`,于是要把节点降级成 `pure-text`,而别名表里没有 `PureText`
 * → `Cannot read property '_num' of undefined`,异常抛在 commit 阶段,
 * 被 error boundary 接住,**整棵子树就此废掉**(详细机制见 src/utils/taro-events.ts)。
 *
 * ## 为什么用 TS 的 AST 而不是正则
 * 这条规则是**结构**上的(两个分支 + 标签名 + 属性集),不是文本上的。
 * 正则要数清「这个 `:` 属于哪个 `?`,中间隔了几层括号/JSX/字符串」——
 * 那是写半个 parser。项目里本来就有 typescript,直接拿它的 AST 更短也更准。
 *
 * ## 判定
 * 三元(或 `&&` 的等价形状)的两个分支都解析出 JSX 标签,且:
 *   ① 标签名一样(React 才会认成同一个节点);
 *   ② 两边的事件属性**名字集合不同** —— 少了的那一边就是被摘掉的那一个。
 * 命中就报。两边都没有事件属性、或两边事件属性完全一致 → 放过。
 *
 * 用法:
 *   node scripts/smoke-taro-event-swap.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`);
};

/** 事件属性:onClick / onInput / onLongPress…(不做白名单,`on` + 大写开头即可) */
const isEventAttr = (name) => /^on[A-Z]/.test(name);

/** 把这个节点剥到 JSX 元素本身(跳过括号、as、非空断言) */
function asJsx(node) {
  let n = node;
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n))) n = n.expression;
  return n && (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) ? n : null;
}
const openingOf = (el) => (ts.isJsxElement(el) ? el.openingElement : el);
const tagNameOf = (el) => openingOf(el).tagName.getText().replace(/\s+/g, '');
/** 这个元素身上挂了哪些事件属性名 */
function eventProps(el) {
  return [...new Set(openingOf(el).attributes.properties
    .filter(ts.isJsxAttribute)
    .map((a) => a.name.getText())
    .filter(isEventAttr))].sort();
}

/** 扫一段源码,给出 `{行, 标签, 多出来的, 少掉的}` */
function scan(text) {
  const sf = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  (function visit(node) {
    if (ts.isConditionalExpression(node)) {
      const a = asJsx(node.whenTrue);
      const b = asJsx(node.whenFalse);
      if (a && b && tagNameOf(a) === tagNameOf(b)) {
        const ea = eventProps(a);
        const eb = eventProps(b);
        const onlyA = ea.filter((x) => !eb.includes(x));
        const onlyB = eb.filter((x) => !ea.includes(x));
        if (onlyA.length || onlyB.length) {
          out.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            tag: tagNameOf(a),
            // 分支顺序照 JSX 里写的:`?` 那支在前
            hasA: ea, hasB: eb, onlyA, onlyB
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

// ── 先证明这把尺子量得出东西 ────────────────────────────────────────────
// 「今天恰好没有犯规」和「压根不工作」输出一模一样,所以先拿已知样本对一遍。
{
  const BAD = [
    // 本次线上崩的就是这一形状(喝水那一行)
    '{water != null ? (<Text className="p">读到啦</Text>) : (<Text className="p" onClick={f}>重试</Text>)}',
    '{ok ? <View onClick={tap}>A</View> : <View>B</View>}',
    '{ok ? <Text>A</Text> : <Text onClick={f}>B</Text>}',
    // 两边都挂了事件、但挂的不是同一个 —— 少的那个同样会被摘掉
    '{ok ? <Text onClick={a}>A</Text> : <Text onLongPress={b}>B</Text>}',
    // 带子元素的写法
    '{ok ? <View onClick={tap}><Text>x</Text></View> : <View><Text>y</Text></View>}'
  ];
  const GOOD = [
    // 同一个元素、条件写在属性值里 —— 这正是修好后的写法
    '<Text className={ok ? "p" : "p is-failed"} onClick={onIf(ok, f)}>{ok ? "读到啦" : "重试"}</Text>',
    // 标签不一样:React 会卸载旧的、挂新的,不会去摘 props
    '{ok ? <View onClick={f}>A</View> : <Text>B</Text>}',
    // 两边事件属性完全一样
    '{ok ? <Text onClick={f}>A</Text> : <Text onClick={f}>B</Text>}',
    // 两边都没有事件属性
    '{ok ? <Text>A</Text> : <Text>B</Text>}',
    // 单选分支:一个位置有、另一个位置没有,是插入/移除,不是改 props
    '<View>{ok && <Text onClick={f}>A</Text>}{!ok && <Text>B</Text>}</View>',
    // 非 JSX 的三元
    '{ok ? a() : b()}'
  ];
  const missed = BAD.filter((s) => scan(s).length === 0);
  const noise = GOOD.filter((s) => scan(s).length > 0);
  ok('这把尺子量得出该量出来的(同标签两分支事件属性不等)', missed.length === 0, missed.join(' | '));
  ok('也不误报(同一个元素 / 标签不同 / 属性一致 / 插入移除)', noise.length === 0, noise.join(' | '));
}

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.tsx')) files.push(p);
  }
})(SRC);

const hits = [];
for (const f of files) {
  for (const h of scan(readFileSync(f, 'utf8'))) {
    const what = h.onlyA.length
      ? `左边有 ${h.onlyA.join('/')}、右边没有`
      : `右边有 ${h.onlyB.join('/')}、左边没有`;
    hits.push(`${relative(SRC, f).replace(/\\/g, '/')}:${h.line}  <${h.tag}>  ${what}`);
  }
}

// 扫 0 个文件也会「全过」,这一条防的是这个
ok('扫到了源码文件', files.length > 20, `${files.length} 个 .tsx`);
ok('没有「同位置两个分支事件属性不一致」的写法(会把整棵子树点废)', hits.length === 0, hits.join('\n      '));

console.log(
  hits.length
    ? '\n改法:合成**同一个元素** —— 标签只写一遍,事件永远绑着,条件写进 className 和函数体里'
    : `\n检查了 ${files.length} 个文件里的所有三元分支`
);
console.log(`\n${fail ? `❌ ${fail} 个用例失败` : '✅ 全部通过'}`);
process.exit(fail ? 1 : 0);
