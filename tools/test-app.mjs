// Drives the real app (index.html) with a fake camera and checks behavior end to end.
// Usage: node tools/test-app.mjs [chromium|firefox]   (default: chromium)
// Screenshots go to $SHOT_DIR if set.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer, launch } from './testlib.mjs';

const engine = process.argv[2] ?? 'chromium';
const shotDir = process.env.SHOT_DIR;
const server = await startServer();
const browser = await launch(engine);
const results = [];

// page (optional): on failure, saves a screenshot and appends the end of the app's log to the error.
async function check(id, name, fn, page = null) {
  try {
    await fn();
    results.push({ id, name, pass: true });
  } catch (err) {
    let extra = '';
    if (page) {
      if (shotDir) await page.screenshot({ path: `${shotDir}/${engine}-FAIL-${id}.png` }).catch(() => {});
      extra = ` | app log: ${(await page.textContent('#log .log-body').catch(() => '')).slice(-400)}`;
    }
    results.push({ id, name, pass: false, error: err.message.split('\n')[0] + extra });
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

const faceCam = fileURLToPath(new URL('../tests/fixtures/face-cam.y4m', import.meta.url));

const iphone = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: engine === 'chromium', hasTouch: true };

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ ...iphone, ...(engine === 'chromium' ? { permissions: ['camera'] } : {}), ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000); // first load downloads the face models
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}


const FIX = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));

// Adds a member through the Roster UI. Returns the toast text.
async function addMember(p, name, slack, photos) {
  if (!(await p.isVisible('[data-view="roster"]'))) await p.tap('[data-go="roster"]');
  await p.waitForSelector('[data-view="roster"]:not([hidden])');
  await p.tap('#btn-add-member');
  await p.fill('#member-name', name);
  await p.fill('#member-slack', slack);
  await p.setInputFiles('#member-photos', photos.map((f) => FIX + f));
  await p.waitForFunction(() => /photos? added/.test(document.getElementById('toast').textContent), null, { timeout: 120000 });
  const toast = await p.textContent('#toast');
  await p.tap('#btn-member-save');
  await p.waitForSelector('[data-view="roster"]:not([hidden])');
  return toast;
}

const state = (page) => page.textContent('#status-state');
const shot = (page, name) => shotDir && page.screenshot({ path: `${shotDir}/${engine}-${name}.png` });

// --- Main flow ---
const page = await newPage();
await page.goto(`${server.base}/`);

await check('T-APP-1', 'boots to Ready with no errors', async () => {
  await page.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
  expect(page.errors.length === 0, `page errors: ${page.errors.join('; ')}`);
  expect(!(await page.isDisabled('#btn-start')), 'Start disabled');
  await shot(page, '1-ready');
});

await check('T-APP-2', 'Start → Watching with live video; resolution logged', async () => {
  await page.tap('#btn-start');
  await page.waitForFunction(() => document.getElementById('status-state').textContent === 'Watching', null, { timeout: 10000 });
  const w = await page.evaluate(() => document.getElementById('video').videoWidth);
  expect(w > 0, 'videoWidth is 0');
  const logText = await page.textContent('#log .log-body');
  expect(/Camera \d+×\d+/.test(logText), 'resolution missing from log');
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
  const devId = await page.$eval('select[name="deviceId"]', (sel) => sel.options[1]?.value);
  expect(devId, 'no camera devices listed in picker');
  await page.selectOption('select[name="deviceId"]', devId);
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

await check('T-APP-11', 'Watch loop runs: status shows fps, detect time, faces; backend logged', async () => {
  await page.waitForFunction(() => /fps.*ms.*faces \d+/.test(document.getElementById('status-detail').textContent), null, { timeout: 30000 });
  expect(/Detector ready: (webgl|webgpu)/.test(await page.textContent('#log .log-body')), 'backend missing from log');
});

await check('T-MAIN-2', 'Loop never exceeds processFps (no overlapping ticks)', async () => {
  await page.waitForTimeout(3000);
  const fps = parseFloat((await page.textContent('#status-detail')).match(/([\d.]+) fps/)[1]);
  expect(fps <= 2.2, `achieved ${fps} fps > processFps 2`);
});

await check('T-APP-29', 'Zooming in restarts the camera asking for 4K; Settings shows what the camera delivered', async () => {
  const before = await page.evaluate(() => document.getElementById('video').videoWidth);
  await page.tap('[data-go="settings"]');
  await page.selectOption('select[name="zoom"]', '2');
  await page.waitForFunction((b) => document.getElementById('video').videoWidth > b, before, { timeout: 15000 });
  const w = await page.evaluate(() => document.getElementById('video').videoWidth);
  expect(w >= 3840, `zoomed capture is ${w} px wide, expected 4K`);
  await page.tap('[data-view="settings"] [data-go="watch"]');
  await page.tap('[data-go="settings"]');
  // Settings lists cameras before drawing, so wait for the refreshed text.
  await page.waitForFunction(() => /^In use: .*: 3840×2160/.test(document.getElementById('camera-info').textContent), null, { timeout: 10000 })
    .catch(() => {});
  const info = await page.textContent('#camera-info');
  expect(/^In use: .*: 3840×2160/.test(info), info);
  await page.selectOption('select[name="zoom"]', '1'); // back to 1× → back to normal resolution
  await page.waitForFunction(() => document.getElementById('video').videoWidth < 3840, null, { timeout: 15000 });
  await page.tap('[data-view="settings"] [data-go="watch"]');
}, page);

await check('T-APP-7', 'Stop → Ready, camera released', async () => {
  await page.tap('#btn-start');
  await page.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
  expect(await page.evaluate(() => document.getElementById('video').srcObject === null), 'srcObject not cleared');
});

await check('T-APP-8', 'Settings persist across reload; Reset restores defaults', async () => {
  await page.reload();
  await page.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('snipecam.settings')));
  expect(s.threshold === 1 && typeof s.deviceId === 'string', `after reload: ${JSON.stringify(s)}`);
  await page.tap('[data-go="settings"]');
  await page.tap('#btn-reset');
  const r = await page.evaluate(() => JSON.parse(localStorage.getItem('snipecam.settings')));
  expect(r.threshold === 0.64 && r.deviceId === null, `after reset: ${JSON.stringify(r)}`);
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


// --- Roster (any engine) ---
const rp = await newPage();
await rp.goto(`${server.base}/`);
await rp.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
await check('T-APP-14', 'Add member from photos: faces used, bad photo skipped with reason, saved to list', async () => {
  const toast = await addMember(rp, 'Person B', ' @person b', ['people/emotions-b/1.jpg', 'people/emotions-b/2.jpg', 'blank.png', 'people/emotions-b/3.jpg']);
  expect(/3 of 4 photos added/.test(toast), `toast "${toast}"`);
  const row = await rp.textContent('#roster-list');
  expect(row.includes('Person B') && row.includes('@personb · 3 photos'), `roster row "${row}"`);
  await shot(rp, '8-roster');
});
await check('T-APP-15', 'Editor shows skipped photo reason and thumbnails', async () => {
  await rp.tap('.member-row');
  await rp.waitForSelector('[data-view="member"]:not([hidden])');
  expect((await rp.$$('#member-photo-grid .photo')).length === 3, 'expected 3 thumbnails');
  await rp.setInputFiles('#member-photos', [FIX + 'blank.png']);
  await rp.waitForFunction(() => document.getElementById('member-skipped').textContent.includes('No face found'));
  await shot(rp, '9-editor');
  await rp.tap('#btn-member-back');
});
await check('T-APP-16', 'Export downloads roster; another device that enrolled the same person separately merges it (1 member, photos combined)', async () => {
  const [download] = await Promise.all([rp.waitForEvent('download'), rp.tap('#btn-export')]);
  expect(/^snipecam-roster-\d{4}-\d{2}-\d{2}\.snipedb\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
  const file = await download.path();
  const other = await newPage(); // a separate device
  await other.goto(`${server.base}/`);
  await other.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
  await addMember(other, 'person b', '', ['people/emotions-b/5.jpg']);
  await other.setInputFiles('#import-file', file);
  await other.waitForFunction(() => /Imported: 0 added, 1 updated \(\+3 photos\)/.test(document.getElementById('toast').textContent));
  // The toast appears before the list redraws; wait for the list itself.
  await other.waitForFunction(() => document.getElementById('roster-list').textContent.includes('4 photos'), null, { timeout: 10000 })
    .catch(() => {});
  const rows = await other.$$eval('.member-row', (els) => els.map((e) => e.textContent));
  expect(rows.length === 1 && rows[0].includes('@personb · 4 photos'), JSON.stringify(rows));
  await other.setInputFiles('#import-file', file); // importing again changes nothing
  await other.waitForFunction(() => /Imported: 0 added, 0 updated \(\+0 photos\), 3 already had/.test(document.getElementById('toast').textContent));
  await shot(other, '19-merged-roster');
  await other.context().close();
});
await check('T-APP-17', 'Delete member (after confirm) removes them', async () => {
  rp.once('dialog', (d) => d.accept());
  await rp.tap('.member-row');
  await rp.tap('#btn-member-delete');
  await rp.waitForFunction(() => document.getElementById('roster-list').textContent.includes('No members yet'));
});
await rp.context().close();


// --- Clock: midnight purge (rule 9) and reminder, using the ?clockOffset test hook ---
function offsetTo(h, m, sec) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, sec).getTime() - Date.now();
}
async function addPendingCandidate(p) {
  await p.evaluate(async () => {
    const db = await import('/js/db.js');
    const { dayKey } = await import('/js/rules.js');
    await db.putCandidate({ id: crypto.randomUUID(), memberId: 'zz', day: dayKey(window.snipecam.now()), jpeg: new ArrayBuffer(4),
      thumb: '', quality: 1, similarity: 0.8, box: [0, 0, 1, 1], inFrame: ['zz'], seenAt: window.snipecam.now(), status: 'pending' });
  });
}
const mid = await newPage();
await mid.goto(`${server.base}/?clockOffset=${offsetTo(23, 59, 48)}`);
await check('T-MAIN-5', 'At midnight, unposted photos are deleted and the badge clears', async () => {
  await mid.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
  await addPendingCandidate(mid);
  await mid.reload();
  await mid.waitForFunction(() => document.getElementById('badge').textContent === '1' && !document.getElementById('badge').hidden);
  await mid.waitForFunction(() => document.getElementById('badge').hidden, null, { timeout: 40000 });
  const left = await mid.evaluate(async () => (await (await import('/js/db.js')).listCandidates()).length);
  expect(left === 0, `${left} candidates left after midnight`);
  expect(/New day .*deleted 1/.test(await mid.textContent('#log .log-body')), 'rollover not logged');
});
await mid.context().close();

const rem = await newPage();
await rem.goto(`${server.base}/?clockOffset=${offsetTo(23, 0, 5)}`);
await check('T-MAIN-6', 'At reminderAt with photos waiting → banner', async () => {
  await rem.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
  await addPendingCandidate(rem);
  await rem.reload();
  await rem.waitForSelector('#banner:not([hidden])', { timeout: 30000 });
  expect(/1 snipe waiting/.test(await rem.textContent('#banner')), await rem.textContent('#banner'));
  await shot(rem, '11-reminder');
  await rem.tap('#banner');
  expect(!(await rem.isVisible('#banner')), 'banner did not dismiss');
});
await rem.context().close();


// --- Inbox & sharing (any engine). A fake iPhone share sheet records each share. ---
async function seedInbox(p) {
  await p.evaluate(async () => {
    const db = await import('/js/db.js');
    const { dayKey } = await import('/js/rules.js');
    await db.clearAll();
    const mk = (id, name, slack) => db.saveMember({ id, name, slack, embeddings: [new Array(db.EMBEDDING_SIZE).fill(0.1)], thumbs: [] });
    await mk('a', 'Alice', 'alice');
    await mk('b', 'Bob', 'bob');
    await mk('c', 'Cara', '');
    const day = dayKey(window.snipecam.now());
    const photo = async (color) => {
      const c = new OffscreenCanvas(320, 240);
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.fillRect(0, 0, 320, 240);
      return (await c.convertToBlob({ type: 'image/jpeg' })).arrayBuffer();
    };
    const put = async (memberId, inFrame, ago, color) => db.putCandidate({ id: crypto.randomUUID(), memberId, day, jpeg: await photo(color),
      thumb: '', quality: 0.5, similarity: 0.72, box: [0, 0, 50, 50], inFrame, seenAt: window.snipecam.now() - ago, status: 'pending' });
    await put('a', ['a', 'b'], 3000, '#a33'); // Alice's photo also shows Bob
    await put('b', ['b'], 2000, '#3a3');
    await put('c', ['c'], 1000, '#33a');
  });
  await p.reload();
  await p.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
}
const fakeIphoneShare = () => {
  window.__shares = [];
  window.__shareMode = 'ok';
  navigator.canShare = () => true;
  navigator.share = async (data) => {
    window.__shares.push({ n: data.files?.length ?? 0, names: (data.files ?? []).map((f) => f.name), text: data.text ?? '' });
    if (window.__shareMode === 'cancel') throw new DOMException('cancelled', 'AbortError');
  };
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__clip = t; } } });
};
const dbState = (p) => p.evaluate(async () => {
  const db = await import('/js/db.js');
  const { dayKey } = await import('/js/rules.js');
  const day = dayKey(window.snipecam.now());
  return {
    cands: (await db.listCandidates(day)).map((c) => c.memberId).sort(),
    locks: Object.fromEntries((await db.listLocks(day)).map((l) => [l.memberId, l.via])),
    shares: window.__shares ?? [],
    clip: window.__clip ?? '',
  };
});

const ip = await newPage();
await ip.addInitScript(fakeIphoneShare);
await ip.goto(`${server.base}/`);
await ip.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
await seedInbox(ip);

await check('T-APP-19', 'Inbox lists today\'s catches, all preselected, with post-by-midnight countdown', async () => {
  expect((await ip.textContent('#badge')) === '3', 'badge not 3');
  await ip.tap('[data-go="inbox"]');
  await ip.waitForSelector('#inbox-grid .cand');
  expect((await ip.$$('#inbox-grid .cand.selected')).length === 3, 'not all selected');
  expect((await ip.textContent('#btn-share-selected')) === 'Share 3', 'share button label');
  expect(/Post by midnight · .*m left/.test(await ip.textContent('#inbox-deadline')), 'deadline text');
  expect((await ip.textContent('#inbox-grid')).includes('with Bob'), 'Alice card should mention Bob');
  await shot(ip, '13-inbox');
});

await check('T-APP-21', 'Inbox updates live when a photo is caught (and when a better one replaces it)', async () => {
  const add = (memberId, color) => ip.evaluate(async ([memberId, color]) => {
    const db = await import('/js/db.js');
    const { dayKey } = await import('/js/rules.js');
    const c = new OffscreenCanvas(320, 240);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 320, 240);
    const jpeg = await (await c.convertToBlob({ type: 'image/jpeg' })).arrayBuffer();
    const cand = await db.putCandidate({ id: crypto.randomUUID(), memberId, day: dayKey(window.snipecam.now()), jpeg, thumb: '',
      quality: 0.9, similarity: 0.8, box: [0, 0, 50, 50], inFrame: [memberId], seenAt: window.snipecam.now(), status: 'pending' });
    window.snipecam.ctx.onCandidate(cand, 'keep'); // what tripod mode calls after saving a catch
  }, [memberId, color]);
  await add('c', '#fff'); // replaces Cara's photo (same id)
  const src = () => ip.$eval('#inbox-grid .cand:has-text("Cara") img', (i) => i.src);
  const before = await src();
  await add('c', '#000');
  await ip.waitForFunction((b) => [...document.querySelectorAll('#inbox-grid .cand')]
    .find((c) => c.textContent.includes('Cara'))?.querySelector('img').src !== b, before);
  expect((await ip.$$('#inbox-grid .cand')).length === 3, 'replacement should not add a card');
});
await check('T-SHR-3', 'Share selected: one photo per post, everyone in it tagged; tagged members skipped later; all locked', async () => {
  await ip.tap('#btn-share-selected');
  await ip.waitForSelector('[data-view="share"]:not([hidden])');
  expect((await ip.textContent('#share-tags')) === '🎯 Sniped @alice @bob', `tags ${await ip.textContent('#share-tags')}`);
  await shot(ip, '14-share-step');
  await ip.tap('#btn-share-go');
  await ip.waitForFunction(() => document.getElementById('share-tags').textContent === '🎯 Sniped Cara');
  await ip.tap('#btn-share-go');
  await ip.waitForSelector('[data-view="inbox"]:not([hidden])');
  const st = await dbState(ip);
  expect(st.shares.length === 2, `expected 2 posts (Bob was tagged in Alice's), got ${st.shares.length}`);
  expect(st.shares.every((x) => x.n === 1), 'each post must have exactly one photo');
  expect(st.shares.every((x) => x.text === ''), 'share must send only the photo (text makes Slack take a link)');
  expect(/^snipe-\d{4}-\d{2}-\d{2}-\d{6}-alice-bob\.jpg$/.test(st.shares[0].names[0]), st.shares[0].names[0]);
  expect(st.clip === '🎯 Sniped Cara', `clipboard "${st.clip}"`);
  expect(st.cands.length === 0, `candidates left: ${st.cands}`);
  expect(JSON.stringify(st.locks) === JSON.stringify({ a: 'shared', b: 'shared', c: 'shared' }), JSON.stringify(st.locks));
  expect(await ip.isHidden('#badge'), 'badge should clear');
});

await check('T-SHR-6', 'Cancelled share → photo stays in Inbox, nobody locked', async () => {
  await seedInbox(ip);
  await ip.evaluate(() => { window.__shares = []; window.__shareMode = 'cancel'; });
  await ip.tap('[data-go="inbox"]');
  await ip.waitForSelector('#inbox-grid .cand');
  await ip.tap('#inbox-grid .cand:last-child .open'); // Alice (oldest last)
  await ip.tap('#btn-cand-share');
  await ip.tap('#btn-share-go');
  await ip.waitForFunction(() => /Not shared/.test(document.getElementById('toast').textContent));
  await ip.tap('#btn-share-done');
  const st = await dbState(ip);
  expect(st.cands.length === 3 && Object.keys(st.locks).length === 0, JSON.stringify(st));
});

await check('T-UI-5', 'Wrong person → change name moves the catch (replacing that member\'s pending one)', async () => {
  await ip.evaluate(() => { window.__shareMode = 'ok'; });
  await ip.waitForSelector('[data-view="inbox"]:not([hidden])');
  const bobCard = await ip.$('#inbox-grid .cand:has-text("Bob"):not(:has-text("with Bob")) .open');
  await bobCard.tap();
  await ip.selectOption('#cand-reassign', 'c');
  await ip.waitForFunction(() => document.getElementById('cand-title').textContent === 'Cara');
  const st = await dbState(ip);
  expect(JSON.stringify(st.cands) === JSON.stringify(['a', 'c']), JSON.stringify(st.cands));
  await ip.tap('#btn-cand-back');
});

await check('T-APP-20', 'Dismiss selected ("not them") removes catches without locking anyone', async () => {
  await ip.waitForSelector('#inbox-grid .cand');
  await ip.tap('#inbox-grid .cand:has-text("Alice") .pick'); // deselect Alice, leaving Cara selected
  await ip.tap('#btn-dismiss-selected');
  await ip.waitForFunction(() => document.querySelectorAll('#inbox-grid .cand').length === 1);
  const st = await dbState(ip);
  expect(JSON.stringify(st.cands) === '["a"]' && Object.keys(st.locks).length === 0, JSON.stringify(st));
});

await check('T-SHR-7', 'Save selected → one share sheet with all photos ("Save N Images"); members locked as saved', async () => {
  await seedInbox(ip);
  await ip.evaluate(() => { window.__shares = []; });
  await ip.tap('[data-go="inbox"]');
  await ip.waitForSelector('#inbox-grid .cand');
  await ip.tap('#btn-save-selected');
  await ip.waitForFunction(() => /Saved 3 photos/.test(document.getElementById('toast').textContent));
  const st = await dbState(ip);
  expect(st.shares.length === 1 && st.shares[0].n === 3, JSON.stringify(st.shares));
  expect(Object.values(st.locks).every((v) => v === 'saved') && Object.keys(st.locks).length === 3, JSON.stringify(st.locks));
});

await check('T-UI-6', 'Roster today actions: status shown; Sniped today / Sniped me / Reset today work and reach the mode', async () => {
  await seedInbox(ip);
  await ip.tap('[data-go="roster"]');
  await ip.waitForSelector('.member-row');
  expect((await ip.textContent('#roster-list')).includes('📷 caught today'), 'row status missing');
  await ip.tap('.member-row:has-text("Bob")');
  await ip.waitForFunction(() => /caught, waiting in Inbox/.test(document.getElementById('member-today-status').textContent));
  await ip.tap('#btn-sniped-today');
  await ip.waitForFunction(() => /sniped \(marked by you\)/.test(document.getElementById('member-today-status').textContent));
  let st = await dbState(ip);
  expect(st.locks.b === 'manual' && !st.cands.includes('b'), JSON.stringify(st));
  expect(await ip.evaluate(() => window.snipecam.app.mode.lockedIds.includes('b')), 'tripod mode not told about the lock (T-E2E-4)');
  await ip.tap('#btn-sniped-me');
  await ip.waitForFunction(() => /no countersnipe/.test(document.getElementById('member-today-status').textContent));
  await ip.tap('#btn-reset-today');
  await ip.waitForFunction(() => /not caught yet/.test(document.getElementById('member-today-status').textContent));
  st = await dbState(ip);
  expect(!('b' in st.locks), JSON.stringify(st.locks));
  expect(!(await ip.evaluate(() => window.snipecam.app.mode.lockedIds.includes('b'))), 'mode still thinks b is locked');
  await shot(ip, '15-member-today');
});
await ip.context().close();

// Laptop: no share sheet → photo downloads, tags copied, member locked as saved
const lp = await newPage();
await lp.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__clip = t; } } }));
await lp.goto(`${server.base}/`);
await lp.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
await seedInbox(lp);
await check('T-SHR-5', 'Laptop (no share sheet): Share downloads the photo and copies tags', async () => {
  await lp.tap('[data-go="inbox"]');
  await lp.waitForSelector('#inbox-grid .cand');
  await lp.tap('#inbox-grid .cand:has-text("Cara") .open');
  await lp.tap('#btn-cand-share');
  const [dl] = await Promise.all([lp.waitForEvent('download'), lp.tap('#btn-share-go')]);
  expect(/-cara\.jpg$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await lp.waitForSelector('[data-view="inbox"]:not([hidden])');
  const st = await dbState(lp);
  expect(st.locks.c === 'saved' && st.clip === '🎯 Sniped Cara', JSON.stringify(st));
});
await lp.context().close();



// --- Lookalikes (twins): roster link + "which one?" in the Inbox ---
const tw = await newPage();
await tw.addInitScript(fakeIphoneShare);
await tw.goto(`${server.base}/`);
await tw.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
await seedInbox(tw);
await check('T-APP-27', 'Roster: linking Alice ↔ Bob as lookalikes saves on both members', async () => {
  await tw.tap('[data-go="roster"]');
  await tw.tap('.member-row:has-text("Alice")');
  await tw.selectOption('#lookalike-add', 'b');
  await tw.waitForSelector('#lookalike-chips .chip');
  await tw.tap('#btn-member-save');
  await tw.waitForSelector('[data-view="roster"]:not([hidden])');
  const rows = await tw.$$eval('.member-row', (els) => els.map((e) => e.textContent));
  expect(rows.some((r) => r.includes('Alice') && r.includes('looks like Bob')), JSON.stringify(rows));
  expect(rows.some((r) => r.includes('Bob') && r.includes('looks like Alice')), JSON.stringify(rows));
  await shot(tw, '20-lookalikes');
}, tw);
await check('T-APP-28', '"Which one?" catch: not preselected, kept out of Share, resolved by "It\'s Bob"', async () => {
  await tw.evaluate(async () => {
    const db = await import('/js/db.js');
    const { dayKey } = await import('/js/rules.js');
    const c = new OffscreenCanvas(320, 240);
    c.getContext('2d').fillRect(0, 0, 320, 240);
    const jpeg = await (await c.convertToBlob({ type: 'image/jpeg' })).arrayBuffer();
    await db.deleteCandidatesFor(['b'], dayKey(window.snipecam.now()));
    await db.putCandidate({ id: 'twin-cand', memberId: 'lookalike:a+b', day: dayKey(window.snipecam.now()), jpeg, thumb: '',
      quality: 0.6, similarity: 0.8, box: [0, 0, 50, 50], inFrame: ['lookalike:a+b'], seenAt: window.snipecam.now(), status: 'pending' });
    window.__shares = [];
  });
  await tw.tap('[data-view="roster"] [data-go="watch"]');
  await tw.tap('[data-go="inbox"]');
  await tw.waitForSelector('#inbox-grid .cand:has-text("Alice or Bob?")');
  expect(!(await tw.$('#inbox-grid .cand.selected:has-text("Alice or Bob?")')), 'unresolved catch should not be preselected');
  await tw.tap('#inbox-grid .cand:has-text("Alice or Bob?") .pick'); // select it anyway
  await tw.tap('#btn-share-selected');
  await tw.waitForFunction(() => /Choose which one first: Alice or Bob\?/.test(document.getElementById('toast').textContent));
  await tw.tap('#btn-share-done');
  await tw.tap('#inbox-grid .cand:has-text("Alice or Bob?") .open');
  await tw.waitForSelector('#cand-which:not([hidden])');
  await shot(tw, '21-which-twin');
  await tw.tap('#cand-which-buttons button:has-text("It\'s Bob")');
  await tw.waitForFunction(() => document.getElementById('cand-title').textContent === 'Bob');
  const st = await dbState(tw);
  expect(st.cands.includes('b') && !st.cands.some((c) => c.startsWith('lookalike:')), JSON.stringify(st.cands));
}, tw);
await tw.context().close();

// --- P6: home-screen app, rehearsal warning, offline ---
const hp = await newPage();
await hp.addInitScript(fakeIphoneShare);
await hp.goto(`${server.base}/`);
await hp.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
await check('T-APP-23', 'Home-screen app: manifest (standalone, start URL, icons) and iOS icon are served', async () => {
  const r = await hp.evaluate(async () => {
    const m = await (await fetch(document.querySelector('link[rel=manifest]').href)).json();
    const ok = async (u) => (await fetch(u)).ok;
    return {
      m,
      icons: await Promise.all(m.icons.map((i) => ok(i.src))),
      apple: await ok(document.querySelector('link[rel=apple-touch-icon]').href),
    };
  });
  expect(r.m.display === 'standalone' && r.m.start_url === './' && r.m.icons.length === 2, JSON.stringify(r.m));
  expect(r.icons.every(Boolean) && r.apple, 'an icon is missing');
});
await check('T-RUL-10', 'Rehearsal schedule in Settings → catches during the window get a ⚠ in the Inbox', async () => {
  await seedInbox(hp);
  const d = new Date();
  const hm = (t) => `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  await hp.tap('[data-go="settings"]');
  await hp.tap('#btn-add-rehearsal');
  await hp.selectOption('#rehearsal-list .rehearsal select', String(d.getDay()));
  await hp.fill('#rehearsal-list input[aria-label="Start"]', hm(new Date(d.getTime() + 60 * 60000)));
  await hp.dispatchEvent('#rehearsal-list input[aria-label="Start"]', 'change');
  await hp.fill('#rehearsal-list input[aria-label="End"]', hm(new Date(d.getTime() + 90 * 60000)));
  await hp.dispatchEvent('#rehearsal-list input[aria-label="End"]', 'change');
  const saved = await hp.evaluate(() => JSON.parse(localStorage.getItem('snipecam.settings')).rehearsals);
  expect(saved.length === 1 && saved[0].weekday === d.getDay(), JSON.stringify(saved));
  await shot(hp, '16-rehearsals');
  await hp.tap('[data-view="settings"] [data-go="watch"]');
  await hp.tap('[data-go="inbox"]');
  await hp.waitForSelector('#inbox-grid .cand');
  // Rehearsal starts in 60 min: 30-min window begins in 30 min, so no warning yet
  expect(!(await hp.textContent('#inbox-grid')).includes('rehearsal'), 'warned outside the window');
  await hp.tap('[data-view="inbox"] [data-go="watch"]');
  await hp.tap('[data-go="settings"]');
  await hp.fill('#rehearsal-list input[aria-label="Start"]', hm(new Date(d.getTime() + 20 * 60000)));
  await hp.dispatchEvent('#rehearsal-list input[aria-label="Start"]', 'change');
  await hp.tap('[data-view="settings"] [data-go="watch"]');
  await hp.tap('[data-go="inbox"]');
  await hp.waitForFunction(() => document.getElementById('inbox-grid').textContent.includes('near rehearsal time'));
});
await hp.context().close();

if (engine === 'chromium') {
  const op = await newPage();
  await op.goto(`${server.base}/`);
  await check('T-APP-24', 'Works offline after the first load (service worker + cached models)', async () => {
    await op.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
    await op.evaluate(() => navigator.serviceWorker.ready);
    await op.reload(); // let the service worker take control and cache this load
    await op.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
    await op.context().setOffline(true);
    await op.reload();
    await op.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready', null, { timeout: 60000 });
    expect(/Detector ready/.test(await op.textContent('#log .log-body')), 'detector did not load offline');
    expect(op.errors.length === 0, op.errors.join('; '));
  });
  await op.context().close();
}

// --- Idle rate: no faces → drops to idleFps after idleAfterSec ---
const idlePage = await newPage();
await idlePage.addInitScript(() => localStorage.setItem('snipecam.settings', JSON.stringify({ idleAfterSec: 5, idleFps: 0.5 })));
await idlePage.goto(`${server.base}/?autostart`);
await check('T-APP-13', 'No faces → idle rate after idleAfterSec', async () => {
  await idlePage.waitForFunction(() => document.getElementById('status-state').textContent === 'Watching');
  await idlePage.waitForFunction(() => document.getElementById('status-detail').textContent.includes('(idle)'), null, { timeout: 20000 });
});
await idlePage.context().close();

await browser.close();

// --- Real face as the camera (Chromium only: plays a video file as the fake camera) ---
if (engine === 'chromium' && existsSync(faceCam)) {
  const faceBrowser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${faceCam}`] });
  const ctx = await faceBrowser.newContext({ ...iphone, permissions: ['camera'] });
  const fp = await ctx.newPage();
  fp.setDefaultTimeout(60000);
  await fp.addInitScript(() => localStorage.setItem('snipecam.settings', JSON.stringify({ debugFaces: true })));
  await fp.goto(`${server.base}/?autostart`);
  await fp.waitForFunction(() => document.getElementById('status-state').textContent === 'Watching');
  await check('T-APP-12', 'Face on camera → detected; debug overlay draws its box', async () => {
    await fp.waitForFunction(() => /faces [1-9]/.test(document.getElementById('status-detail').textContent), null, { timeout: 60000 });
    const drawn = await fp.evaluate(() => {
      const c = document.getElementById('overlay');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    });
    expect(drawn, 'overlay is empty');
    const logText = await fp.textContent('#log .log-body');
    expect(!/TypeError|ReferenceError/.test(logText), `errors in app log: ${logText.match(/.*(TypeError|ReferenceError).*/)?.[0]}`);
    await shot(fp, '7-face-debug');
  });
  await check('T-APP-18', 'Enrolled member on camera → green name label; stranger mode shows nothing', async () => {
    // Camera shows emotions-a/1.jpg; enroll the same person from different photos
    await addMember(fp, 'Person A', 'persona', ['people/emotions-a/2.jpg', 'people/emotions-a/3.jpg', 'people/emotions-a/4.jpg']);
    await fp.tap('.panel:not([hidden]) [data-go="watch"]');
    await fp.waitForFunction(() => document.getElementById('overlay').dataset.labels === 'Person A', null, { timeout: 60000 });
    expect(/known 1/.test(await fp.textContent('#status-detail')), 'status lacks "known 1"');
    await shot(fp, '10-member-label');
  });
  await check('T-APP-22', 'Member stays in view → caught photo appears (badge 1) without stopping the camera', async () => {
    await fp.waitForFunction(() => document.getElementById('badge').textContent === '1' && !document.getElementById('badge').hidden, null, { timeout: 60000 });
    expect((await state(fp)) === 'Watching', 'camera should still be running');
  });
  await check('T-APP-25', 'Locked member (sniped today) → gray 🔒 label and no new photo; Reset today restores catching', async () => {
    await fp.tap('[data-go="roster"]');
    await fp.tap('.member-row:has-text("Person A")');
    await fp.tap('#btn-sniped-today');
    await fp.waitForFunction(() => /marked by you/.test(document.getElementById('member-today-status').textContent));
    await fp.tap('#btn-member-back');
    await fp.tap('.panel:not([hidden]) [data-go="watch"]');
    await fp.waitForFunction(() => document.getElementById('overlay').dataset.locked === 'Person A', null, { timeout: 30000 });
    await shot(fp, '17-locked-label');
    await fp.waitForTimeout(8000);
    expect(await fp.isHidden('#badge'), 'locked member was caught');
    await fp.tap('[data-go="roster"]');
    await fp.tap('.member-row:has-text("Person A")');
    await fp.tap('#btn-reset-today');
    await fp.waitForFunction(() => /not caught yet/.test(document.getElementById('member-today-status').textContent));
    await fp.tap('#btn-member-back');
    await fp.tap('.panel:not([hidden]) [data-go="watch"]');
    await fp.waitForFunction(() => document.getElementById('badge').textContent === '1' && !document.getElementById('badge').hidden, null, { timeout: 60000 });
  });
  await check('T-APP-26', 'Zoom (no camera zoom available → digital): preview scales, face still recognized and boxed', async () => {
    await fp.tap('[data-go="settings"]');
    await fp.selectOption('select[name="zoom"]', '1.5');
    await fp.tap('[data-view="settings"] [data-go="watch"]');
    await fp.waitForFunction(() => document.getElementById('video').style.transform === 'scale(1.5)');
    expect(/Zoom 1\.5×: digital 1\.50×/.test(await fp.textContent('#log .log-body')), 'zoom not logged');
    await fp.waitForTimeout(4000);
    await fp.waitForFunction(() => document.getElementById('overlay').dataset.labels === 'Person A', null, { timeout: 30000 });
    await shot(fp, '18-zoom');
  });
  await faceBrowser.close();
} else if (engine === 'chromium') {
  results.push({ id: 'T-APP-12', name: 'Face on camera (skipped: run tools/fetch-fixtures.sh)', pass: true });
}

// --- Catching end to end (Chromium): camera loops [A and B for 6 s] [empty for 8 s] ---
const pairCam = fileURLToPath(new URL('../tests/fixtures/pair-cam.y4m', import.meta.url));
if (engine === 'chromium' && existsSync(pairCam)) {
  const pb = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${pairCam}`] });
  const pctx = await pb.newContext({ ...iphone, permissions: ['camera'] });
  const pp = await pctx.newPage();
  pp.setDefaultTimeout(60000);
  pp.on('pageerror', (e) => console.log('pageerror', e.message));
  // Default gapSec (5 s) < the 8 s empty stretch, so each pass ends; generous waits tolerate slow software rendering.
  await pp.addInitScript(() => localStorage.setItem('snipecam.settings', JSON.stringify({ gapSec: 5, minHits: 2 })));
  await pp.goto(`${server.base}/`);
  await pp.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
  await addMember(pp, 'Person A', 'persona', ['people/emotions-a/2.jpg', 'people/emotions-a/3.jpg', 'people/emotions-a/4.jpg']);
  await addMember(pp, 'Person B', 'personb', ['people/emotions-b/1.jpg', 'people/emotions-b/2.jpg', 'people/emotions-b/3.jpg']);
  await pp.tap('.panel:not([hidden]) [data-go="watch"]');
  const candidates = () => pp.evaluate(async () => (await (await import('/js/db.js')).listCandidates()).map((c) => ({ name: c.memberId, inFrame: c.inFrame.length, kb: Math.round(c.jpeg.byteLength / 1024) })));
  const loopMs = 14000;

  await check('T-E2E-1', 'Two members pass once → one candidate each, both photos list both people; badge 2', async () => {
    await pp.tap('#btn-start');
    await pp.waitForFunction(() => document.getElementById('status-state').textContent === 'Watching');
    await pp.tap('#btn-dim'); // T-DEV-4: everything below runs under dim
    await pp.waitForFunction(() => document.getElementById('badge').textContent === '2', null, { timeout: 5 * loopMs })
      .catch(async (err) => { throw new Error(`${err.message}\n--- app log ---\n${(await pp.textContent('#log .log-body')).slice(-1500)}`); });
    const c = await candidates();
    expect(c.length === 2 && c.every((x) => x.inFrame === 2 && x.kb > 10), JSON.stringify(c));
    expect(/2 caught · post by 12 am/.test(await pp.textContent('#dim-text')), `dim text: ${await pp.textContent('#dim-text')}`);
    await shot(pp, '12-dim-caught');
  });

  await check('T-E2E-2', 'More passes the same day → still exactly one candidate per member', async () => {
    await pp.waitForTimeout(2 * loopMs);
    const c = await candidates();
    expect(c.length === 2, JSON.stringify(c));
  });

  await check('T-E2E-3', 'Member locked (e.g. shared) → no new candidate or alert for them that day', async () => {
    await pp.evaluate(async () => {
      const db = await import('/js/db.js');
      const { dayKey } = await import('/js/rules.js');
      const { app, ctx, now } = window.snipecam;
      const a = app.members.find((m) => m.name === 'Person A');
      const day = dayKey(now());
      await db.lock([a.id], day, 'shared');
      await db.deleteCandidates([(await db.getCandidate(a.id, day)).id]);
      await app.mode.onLocksChanged(ctx);
    });
    await pp.waitForTimeout(2 * loopMs);
    const c = await candidates();
    expect(c.length === 1, `expected only B's candidate, got ${JSON.stringify(c)}`);
  });

  await check('T-MAIN-4', 'Stop mid-sighting → that sighting still becomes a candidate', async () => {
    await pp.tap('#dim');
    await pp.evaluate(async () => {
      const db = await import('/js/db.js');
      await db.deleteCandidates((await db.listCandidates()).map((c) => c.id));
    });
    // Wait until B is being seen, then stop right away
    await pp.waitForFunction(() => /known [12]/.test(document.getElementById('status-detail').textContent), null, { timeout: 3 * loopMs });
    await pp.waitForFunction(() => /Sighting confirmed: Person B/.test(document.getElementById('log').textContent.split('Stop').pop()), null, { timeout: 2 * loopMs });
    await pp.tap('#btn-start'); // Stop
    await pp.waitForFunction(() => document.getElementById('status-state').textContent === 'Ready');
    const c = await candidates();
    expect(c.length === 1, JSON.stringify(c));
  });
  await pb.close();
} else if (engine === 'chromium') {
  results.push({ id: 'T-E2E-1..3', name: 'Catching end to end (skipped: run tools/fetch-fixtures.sh)', pass: true });
}

server.stop();

const pass = results.filter((r) => r.pass).length;
console.log(`\n[app/${engine}] ${pass}/${results.length} passed`);
for (const r of results) console.log(`  ${r.pass ? '✔' : '✖'} ${r.id} ${r.name}${r.pass ? '' : `\n      ${r.error}`}`);
process.exit(pass === results.length ? 0 : 1);
