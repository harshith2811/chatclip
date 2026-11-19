import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const BASE_URL = 'http://localhost:3001';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log('[Capture] Launching Chrome headless...');
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore' });

  // Wait for remote debugging port
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await wait(300);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const data = await res.json();
      wsUrl = data.webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch {
      // retry
    }
  }

  if (!wsUrl) {
    chromeProc.kill();
    throw new Error('Failed to connect to Chrome CDP.');
  }

  console.log('[Capture] Connected to Chrome DevTools Protocol');
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

  await new Promise((resolve) => {
    ws.onopen = resolve;
  });

  function send(method, params = {}) {
    const id = msgId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Create new target / page
  const target = await send('Target.createTarget', { url: BASE_URL });
  const targetWsUrl = `ws://127.0.0.1:${PORT}/devtools/page/${target.targetId}`;
  const pageWs = new WebSocket(targetWsUrl);

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

  await new Promise((resolve) => {
    pageWs.onopen = resolve;
  });

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

  async function takeScreenshot(outputPath) {
    const res = await pageSend('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    fs.writeFileSync(outputPath, Buffer.from(res.data, 'base64'));
    console.log(`[Capture] Saved: ${path.relative(rootDir, outputPath)}`);
  }

  // Workspaces to capture
  const workspaces = [
    { id: 'discovery', label: 'Discovery' },
    { id: 'studio', label: 'Studio' },
    { id: 'editor', label: 'Editor' },
    { id: 'projects', label: 'Projects' },
    { id: 'publishing', label: 'Publishing' },
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'settings', label: 'Settings' },
  ];

  const viewports = [
    { name: 'Desktop', width: 1440, height: 900, isMobile: false },
    { name: 'Mobile', width: 390, height: 844, isMobile: true },
  ];

  const themes = ['Light', 'Dark'];

  for (const vp of viewports) {
    console.log(`\n--- Capturing Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);
    await pageSend('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.isMobile,
    });

    for (const theme of themes) {
      console.log(`  Setting theme: ${theme}`);
      const isDark = theme === 'Dark';

      // Set theme via DOM & localStorage
      await evaluate(`
        localStorage.setItem('theme', '${isDark ? 'dark' : 'light'}');
        if (${isDark}) {
          document.documentElement.classList.add('dark');
          document.documentElement.style.colorScheme = 'dark';
        } else {
          document.documentElement.classList.remove('dark');
          document.documentElement.style.colorScheme = 'light';
        }
      `);
      await wait(300);

      const targetDir = path.join(rootDir, 'artifacts', 'ui-audit', `${vp.name}-${theme}`);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      for (const ws of workspaces) {
        // Switch tab via Zustand store or click
        await evaluate(`
          const state = window.__UI_STORE__ || {};
          // Try clicking the navigation button
          const buttons = Array.from(document.querySelectorAll('button'));
          const targetBtn = buttons.find(b => b.textContent && b.textContent.includes('${ws.label}'));
          if (targetBtn) {
            targetBtn.click();
          } else {
            // Find mobile nav buttons
            const navButtons = Array.from(document.querySelectorAll('nav button, aside button, main button'));
            const match = navButtons.find(b => b.textContent && b.textContent.includes('${ws.label}'));
            if (match) match.click();
          }
        `);
        // Wait for potential dynamic chunk loading
        await wait(600);

        // Verify horizontal overflow
        const overflow = await evaluate(`
          document.documentElement.scrollWidth > document.documentElement.clientWidth
        `);
        if (overflow) {
          console.warn(`    ⚠️ Overflow detected in ${vp.name}-${theme}-${ws.id}`);
        }

        const outPath = path.join(targetDir, `${ws.id}.png`);
        await takeScreenshot(outPath);
      }
    }
  }

  // Interactive States
  console.log('\n--- Capturing Interactive States ---');
  const interactiveDir = path.join(rootDir, 'artifacts', 'ui-audit', 'Interactive');
  if (!fs.existsSync(interactiveDir)) fs.mkdirSync(interactiveDir, { recursive: true });

  // 1. Studio with TikTok safe zone
  await evaluate(`
    const buttons = Array.from(document.querySelectorAll('button'));
    const studioBtn = buttons.find(b => b.textContent && b.textContent.includes('Studio'));
    if (studioBtn) studioBtn.click();
  `);
  await wait(400);
  await takeScreenshot(path.join(interactiveDir, 'studio-tiktok-safe-zone.png'));

  // 2. Studio with Reels safe zone
  await evaluate(`
    const buttons = Array.from(document.querySelectorAll('button'));
    const reelsBtn = buttons.find(b => b.textContent && b.textContent.includes('REELS'));
    if (reelsBtn) reelsBtn.click();
  `);
  await wait(300);
  await takeScreenshot(path.join(interactiveDir, 'studio-reels-safe-zone.png'));

  // 3. Studio with Shorts safe zone
  await evaluate(`
    const buttons = Array.from(document.querySelectorAll('button'));
    const shortsBtn = buttons.find(b => b.textContent && b.textContent.includes('SHORTS'));
    if (shortsBtn) shortsBtn.click();
  `);
  await wait(300);
  await takeScreenshot(path.join(interactiveDir, 'studio-shorts-safe-zone.png'));

  // 4. Trending modal open
  await evaluate(`
    const buttons = Array.from(document.querySelectorAll('button'));
    const discBtn = buttons.find(b => b.textContent && b.textContent.includes('Discovery'));
    if (discBtn) discBtn.click();
  `);
  await wait(300);
  await evaluate(`
    const buttons = Array.from(document.querySelectorAll('button'));
    const trendBtn = buttons.find(b => b.textContent && b.textContent.includes('Top 10M Viral'));
    if (trendBtn) trendBtn.click();
  `);
  await wait(400);
  await takeScreenshot(path.join(interactiveDir, 'trending-modal-open.png'));

  console.log('\n[Capture] All screenshots captured successfully!');
  pageWs.close();
  ws.close();
  chromeProc.kill();
  process.exit(0);
}

run().catch((err) => {
  console.error('[Capture Error]', err);
  process.exit(1);
});
