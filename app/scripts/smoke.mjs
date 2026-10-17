/**
 * 跑全部冒烟套件。用法:`npm run smoke` 或 `npm run smoke -- timed`(关键词过滤)。
 *
 * 为什么每套单独起一个进程、按**退出码**判定:这些套件跑的是 engine 里的纯函数,
 * 它们会往 `Module._load` 上挂拦截器来假装 `@tarojs/taro` 存在 —— 同一进程里跑第二套,
 * 第一套的桩还挂在上面,后面那套其实没测到自己以为在测的东西。分开跑还有一个好处:
 * 一套崩了不影响别的套件继续给出结论。
 *
 * 编译(tsc -p tsconfig.smoke.json)+ 跑 = 一条命令,不用记得先编译。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const smokeDir = join(root, '.smoke');
const keyword = process.argv[2] ?? '';

// 上一轮的产物先删掉:tsc 不会清理已改名/已删除的源文件留下的旧 js,
// 那些旧文件还留着上一版的行为,跑起来会给出一个没人能解释的结论。
rmSync(smokeDir, { recursive: true, force: true });

const tsc = spawnSync('npx tsc -p tsconfig.smoke.json', { cwd: root, shell: true, encoding: 'utf8' });
if (tsc.status !== 0) {
  console.log('冒烟编译失败:\n' + (tsc.stdout || '') + (tsc.stderr || ''));
  process.exit(1);
}

const files = readdirSync(join(root, 'scripts'))
  .filter((f) => f.startsWith('smoke-') && f.endsWith('.mjs') && (!keyword || f.includes(keyword)))
  .sort();

if (!files.length) {
  console.log(keyword ? `没有匹配「${keyword}」的冒烟套件` : 'scripts/ 下没有冒烟套件');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const failed = [];
for (const f of files) {
  const r = spawnSync(`node scripts/${f}`, {
    cwd: root, shell: true, encoding: 'utf8', timeout: 120000
  });
  if (r.status === 0) {
    pass++;
    continue;
  }
  fail++;
  failed.push(f);
  console.log(`\n===== FAIL ${f} =====`);
  // 只留最后几行:失败信息在尾巴上,前面几百行 PASS 刷屏会把结论顶走
  console.log((r.stdout || r.stderr || '').split('\n').slice(-30).join('\n').trim());
  if (r.error) console.log(`(${r.error.message})`);
}
console.log(`\nsmoke: ${pass} passed, ${fail} failed`);
if (failed.length) console.log('失败的套件:' + failed.join(', '));
process.exit(fail ? 1 : 0);
