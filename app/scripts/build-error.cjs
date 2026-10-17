/**
 * 临时排障用:`taro build` 失败时会把一组 webpack 错误当成 unhandled rejection 丢掉,
 * 终端上只剩一句 `rejected with the reason "[object Array]"` —— 真正的报错看不见。
 * 这个 preload 只是把那个数组摊开打出来,不改任何构建行为。
 *
 *   NODE_OPTIONS=--require=./scripts/build-error.cjs npm run build:weapp
 */
process.on('unhandledRejection', (reason) => {
  const out = [];
  const walk = (r) => {
    if (Array.isArray(r)) { r.forEach(walk); return; }
    if (r && typeof r === 'object') {
      if (r.message) out.push(String(r.message));
      else if (r.stack) out.push(String(r.stack));
      if (r.details) out.push(String(r.details));
      if (r.moduleName) out.push(`module: ${r.moduleName}`);
    } else {
      out.push(String(r));
    }
  };
  walk(reason);
  console.error('\n=== 真正的构建报错 ===\n' + out.join('\n---\n') + '\n=== 结束 ===');
  process.exit(1);
});
