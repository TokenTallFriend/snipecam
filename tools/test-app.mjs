// Drives the real app (index.html) with a fake camera and checks behavior end to end.
// Usage: node tools/test-app.mjs [chromium|firefox]   (default: chromium)
// Screenshots go to $SHOT_DIR if set.

import { startServer, launch } from './testlib.mjs';

const engine = process.argv[2] ?? 'chromium';
const shotDir = process.env.SHOT_DIR;
const server = await startServer();
const browser = await launch(engine);
const results = [];

async function check(id, name, fn) {
  try {
    await fn();
    results.push({ id, name, pass: true });
  } catch (err) {
    results.push({ id, name, pass: false, error: err.message.split('\n')[0] });
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

const iphone = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: engine === 'chromium', hasTouch: true };

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ ...iphone, ...(engine === 'chromium' ? { permissions: ['camera'] } : {}), ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}

const state = (page) => page.textContent('#status-state');
const shot = (page, name) => shotDir && page.screenshot({ path: `${shotDir}/${engine}-${name}.png` });

// --- Main flow ---
const page = await newPage();
await page.goto(`${server.base}/`);

await check('T-APP-1', 'boots to Ready with no errors', async () => {
  await page.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready', null, { timeout: 10000 });
  expect(page.errors.length === 0, `page errors: ${page.errors.join('; ')}`);
  expect(!(await page.isDisabled('#btn-start')), 'Start disabled');
  await shot(page, '1-ready');
});

await check('T-APP-2', 'Start → Watching with live video and resolution shown', async () => {
  await page.tap('#btn-start');
  await page.waitForFunction(() => document.getElementById('status-state').textContent === 'Watching', null, { timeout: 10000 });
  const w = await page.evaluate(() => document.getElementById('video').videoWidth);
  expect(w > 0, 'videoWidth is 0');
  const detail = await page.textContent('#status-detail');
  expect(/\d+×\d+/.test(detail), `status detail "${detail}" lacks resolution`);
  expect((await page.textContent('#btn-start')) === 'Stop', 'button not "Stop"');
  await page.waitForTimeout(500);
  await shot(page, '2-watching');
});

await check('T-APP-3', 'Dim covers screen while video keeps playing; tap wakes', async () => {
  await page.tap('#btn-dim');
  expect(await page.isVisible('#dim'), 'dim overlay not visible');
  const t0 = await page.evaluate(() => document.getElementById('video').currentTime);
  await page.waitForTimeout(800);
  const t1 = await page.evaluate(() => document.getElementById('video').currentTime);
  expect(t1 > t0, `video paused under dim (${t0} → ${t1})`);
  await shot(page, '3-dim');
  await page.tap('#dim');
  expect(!(await page.isVisible('#dim')), 'dim did not close');
});

await check('T-APP-4', 'Settings form renders all groups; edits are validated and persist', async () => {
  await page.tap('[data-go="settings"]');
  await page.waitForSelector('#settings-form fieldset');
  const groups = await page.$$eval('#settings-form legend', (els) => els.map((e) => e.textContent));
  expect(groups.join() === 'Camera,Performance,Recognition,Catching,Alerts,Advanced', `groups: ${groups}`);
  await shot(page, '4-settings');
  await page.fill('input[name="threshold"]', '5');
  await page.dispatchEvent('input[name="threshold"]', 'change');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('snipecam.settings')).threshold);
  expect(stored === 1, `stored threshold ${stored}, expected clamped 1`);
  expect((await state(page)) === 'Watching', 'non-camera setting interrupted watching');
});

await check('T-APP-5', 'Camera setting change restarts camera and keeps watching', async () => {
  await page.selectOption('select[name="facingMode"]', 'user');
  await page.waitForTimeout(1500);
  expect((await state(page)) === 'Watching', `state ${await state(page)}`);
  expect(await page.evaluate(() => document.getElementById('video').videoWidth > 0), 'no video after restart');
});

await check('T-APP-6', 'Log panel opens from Settings and shows camera line', async () => {
  await page.tap('#btn-log');
  expect(await page.isVisible('#log'), 'log not visible');
  expect((await page.textContent('#log .log-body')).includes('Camera '), 'camera line missing from log');
  await shot(page, '5-log');
  await page.tap('#btn-log-close');
  await page.tap('.panel:not([hidden]) [data-go="watch"]');
});

await check('T-APP-7', 'Stop → Ready, camera released', async () => {
  await page.tap('#btn-start');
  await page.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
  expect(await page.evaluate(() => document.getElementById('video').srcObject === null), 'srcObject not cleared');
});

await check('T-APP-8', 'Settings persist across reload; Reset restores defaults', async () => {
  await page.reload();
  await page.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('snipecam.settings')));
  expect(s.threshold === 1 && s.facingMode === 'user', `after reload: ${JSON.stringify(s)}`);
  await page.tap('[data-go="settings"]');
  await page.tap('#btn-reset');
  const r = await page.evaluate(() => JSON.parse(localStorage.getItem('snipecam.settings')));
  expect(r.threshold === 0.55 && r.facingMode === 'environment', `after reset: ${JSON.stringify(r)}`);
});

await check('T-APP-9', 'No horizontal scroll in any view at phone width', async () => {
  for (const view of ['watch', 'settings', 'inbox', 'roster']) {
    await page.evaluate((v) => {
      for (const el of document.querySelectorAll('[data-view]')) if (el.dataset.view !== 'watch') el.hidden = el.dataset.view !== v;
    }, view);
    const over = await page.evaluate(() => {
      const panel = document.querySelector('.panel:not([hidden])') ?? document.documentElement;
      return panel.scrollWidth > panel.clientWidth;
    });
    expect(!over, `${view} overflows horizontally`);
  }
});

await check('T-APP-10', 'All buttons are at least 44px tall', async () => {
  await page.evaluate(() => { for (const el of document.querySelectorAll('[data-view="settings"]')) el.hidden = false; });
  const small = await page.$$eval('button', (bs) => bs.filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.id || b.textContent));
  expect(small.length === 0, `small buttons: ${small}`);
});

// --- Permission denied ---
const denied = await newPage();
await denied.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
});
await denied.goto(`${server.base}/`);
await check('T-CAM-4', 'Permission denied → readable toast, back to Ready, no crash', async () => {
  await denied.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
  await denied.tap('#btn-start');
  await denied.waitForSelector('#toast:not([hidden])');
  expect(/permission denied/i.test(await denied.textContent('#toast')), 'toast text wrong');
  expect((await state(denied)) === 'Ready', `state ${await state(denied)}`);
  expect(denied.errors.length === 0, `page errors: ${denied.errors.join('; ')}`);
  await shot(denied, '6-denied');
});

await browser.close();
server.stop();

const pass = results.filter((r) => r.pass).length;
console.log(`\n[app/${engine}] ${pass}/${results.length} passed`);
for (const r of results) console.log(`  ${r.pass ? '✔' : '✖'} ${r.id} ${r.name}${r.pass ? '' : `\n      ${r.error}`}`);
process.exit(pass === results.length ? 0 : 1);
