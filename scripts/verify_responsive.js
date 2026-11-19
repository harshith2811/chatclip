import { spawn } from 'node:child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const BASE_URL = 'http://localhost:3001';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await wait(300);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const data = await res.json();
      wsUrl = data.webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch {}
  }

  if (!wsUrl) {
    chromeProc.kill();
    throw new Error('Could not connect to Chrome CDP');
  }

  const ws = new WebSocket(wsUrl);
  let msgId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    }
  };

  await new Promise((resolve) => { ws.onopen = resolve; });

  function send(method, params = {}) {
    const id = msgId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  const target = await send('Target.createTarget', { url: BASE_URL });
  const pageWs = new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${target.targetId}`);

  let pageMsgId = 1;
  const pagePending = new Map();

  pageWs.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pagePending.has(data.id)) {
      const { resolve, reject } = pagePending.get(data.id);
      pagePending.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    }
  };

  await new Promise((resolve) => { pageWs.onopen = resolve; });

  function pageSend(method, params = {}) {
    const id = pageMsgId++;
    return new Promise((resolve, reject) => {
      pagePending.set(id, { resolve, reject });
      pageWs.send(JSON.stringify({ id, method, params }));
    });
  }

  await pageSend('Page.enable');
  await pageSend('Runtime.enable');

  async function evaluate(code) {
    const res = await pageSend('Runtime.evaluate', {
      expression: code,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  const viewports = [
    // Mobile
    { width: 320, height: 568, category: 'Mobile' },
    { width: 360, height: 640, category: 'Mobile' },
    { width: 375, height: 667, category: 'Mobile' },
    { width: 390, height: 844, category: 'Mobile' },
    { width: 430, height: 932, category: 'Mobile' },
    { width: 480, height: 800, category: 'Mobile' },
    // Tablet
    { width: 768, height: 1024, category: 'Tablet' },
    { width: 820, height: 1180, category: 'Tablet' },
    { width: 900, height: 1200, category: 'Tablet' },
    { width: 1024, height: 768, category: 'Tablet' },
    // Desktop
    { width: 1280, height: 800, category: 'Desktop' },
    { width: 1366, height: 768, category: 'Desktop' },
    { width: 1440, height: 900, category: 'Desktop' },
    { width: 1600, height: 900, category: 'Desktop' },
    { width: 1920, height: 1080, category: 'Desktop' },
    // Ultra-wide
    { width: 2560, height: 1440, category: 'Ultra-wide' },
  ];

  console.log('================================================================================');
  console.log('             RESPONSIVE OVERFLOW CERTIFICATION MATRIX                           ');
  console.log('================================================================================');
  console.log(' Width   Height  Category    scrollWidth  clientWidth  Delta  Pass/Fail');
  console.log('--------------------------------------------------------------------------------');

  let allPassed = true;

  for (const vp of viewports) {
    await pageSend('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.width < 768,
    });
    await wait(150);

    const dims = await evaluate(`
      ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      })
    `);

    const delta = dims.scrollWidth - dims.clientWidth;
    const passed = delta <= 0;
    if (!passed) allPassed = false;

    const passStr = passed ? '✅ PASS' : '❌ FAIL';
    console.log(
      ` ${String(vp.width).padEnd(7)} ` +
      `${String(vp.height).padEnd(7)} ` +
      `${vp.category.padEnd(11)} ` +
      `${String(dims.scrollWidth).padEnd(12)} ` +
      `${String(dims.clientWidth).padEnd(12)} ` +
      `${String(delta).padEnd(6)} ` +
      `${passStr}`
    );
  }

  console.log('================================================================================');
  console.log(`Certification Result: ${allPassed ? 'ALL VIEWPORTS COMPLIANT (ZERO OVERFLOW)' : 'FAILURES DETECTED'}`);
  console.log('================================================================================');

  pageWs.close();
  ws.close();
  chromeProc.kill();
  process.exit(allPassed ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
