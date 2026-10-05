const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  const errors = [];
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText||'')));

  await page.goto('http://127.0.0.1:8080/', { waitUntil: 'networkidle2', timeout: 20000 }).catch(e => errors.push('GOTO: '+e.message));
  await new Promise(r => setTimeout(r, 2000));

  const info = await page.evaluate(() => ({
    title: document.title,
    appHTML: (document.querySelector('#app')||{}).innerHTML?.length || 0,
    bodyText: document.body.innerText.slice(0, 200)
  }));
  console.log('=== 页面错误 ==='); errors.forEach(e => console.log(e));
  console.log('=== console 日志 ==='); logs.slice(-15).forEach(l => console.log(l));
  console.log('=== DOM ===', JSON.stringify(info, null, 2));
  await browser.close();
})();
