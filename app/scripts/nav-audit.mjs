/* 一次性排查:把 src 里所有跳转目标跟 app.config 注册过的页面核一遍。
   跑法: node scripts/nav-audit.mjs */
import fs from 'node:fs';
import path from 'node:path';

const cfg = fs.readFileSync('src/app.config.ts', 'utf8');
// 主包在 `pages: [...]`,分包在 `subPackages: [{ root, pages }]` —— 后者的条目是**相对 root** 的,
// 拼起来才是真实路径。不拼的话每个训练子页都会被报成「未注册」(第一版就栽在这儿)。
const slice = (from, to) => cfg.slice(cfg.indexOf(from), cfg.indexOf(to));
const pages = [...slice('pages: [', 'subPackages:').matchAll(/'([^']+)'/g)].map((m) => m[1]);
const subBlock = slice('subPackages:', 'preloadRule:');
const root = (subBlock.match(/root:\s*'([^']+)'/) || [])[1] || '';
for (const m of subBlock.matchAll(/'([a-z0-9-]+\/index)'/g)) pages.push(`${root}/${m[1]}`);
const tabBlock = (cfg.match(/tabBar:\s*\{[\s\S]*?list:\s*\[([\s\S]*?)\]\s*\}/) || [])[1] || '';
const tabs = [...tabBlock.matchAll(/pagePath:\s*'([^']+)'/g)].map((m) => m[1]);

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(e.name)) files.push(p);
  }
})('src');

/* `navigate` 是 @/utils/nav 那层兜底 —— 全站跳转都从它走,所以它和裸的 Taro.* 一样要查。
   `Taro.navigateTo` 也能被 `navigateTo` 这条命中(\b 在 . 和 n 之间成立)。 */
const CALLS = /\b(navigate|navigateTo|redirectTo|switchTab|reLaunch)\s*\(|href:\s*'([^']+)'/g;
const rows = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*(\*|\/\/)/.test(line)) return;
    for (const m of line.matchAll(CALLS)) {
      const kind = m[1] ? m[1] : 'href';
      let url = m[2] ?? null;
      if (!url) {
        const rest = line.slice(m.index + m[0].length);
        const u = rest.match(/'([^']+)'/);
        if (u) url = u[1];
      }
      // 取到的不一定是地址:`switchTab({url:`/${t}`}).catch(() => showToast({title:'…'}))`
      // 里括号后头第一个引号串是那句提示。没有 `/` 的不可能是路由,直接跳过。
      if (!url || url.startsWith('http') || !url.includes('/')) continue;
      rows.push({ f: f + ':' + (i + 1), kind, url });
    }
  });
}

const clean = (u) => u.replace(/^\/+/, '').split('?')[0];
const flags = [];
for (const r of rows) {
  if (r.url.includes('${') || r.url.includes('`')) { flags.push(['VAR', r, '']); continue; }
  const c = clean(r.url);
  if (!pages.includes(c)) flags.push(['未注册', r, c]);
  else if (r.kind === 'navigateTo' && tabs.includes(c)) flags.push(['tab 页不能用 navigateTo', r, c]);
  else if (r.kind === 'switchTab' && !tabs.includes(c)) flags.push(['非 tab 页不能用 switchTab', r, c]);
}

console.log('tabBar:', tabs.join(' | '));
console.log('跳转点:', rows.length, '  可疑:', flags.length);
for (const [why, r, c] of flags) console.log(`[${why}] ${r.f}  ${r.kind}("${r.url}")${c ? ' → ' + c : ''}`);
