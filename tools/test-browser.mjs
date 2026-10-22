// Runs tests/browser.html in each engine and prints results.
// Usage: node tools/test-browser.mjs [chromium] [firefox] [webkit]

import { startServer, launch, ENGINES } from './testlib.mjs';

const engines = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ENGINES);
const server = await startServer();
let failed = 0;

for (const name of engines) {
  let browser;
  try {
    browser = await launch(name);
  } catch (err) {
    console.log(`\n[${name}] SKIPPED: ${err.message.split('\n')[0]}`);
    continue;
  }
  const page = await browser.newPage();
  page.on('console', (m) => (process.env.VERBOSE || m.text().startsWith('[harness]')) && console.log(`    ${m.text()}`));
  await page.goto(`${server.base}/tests/browser.html`);
  const results = await page.waitForFunction(() => window.__testResults, null, { timeout: 900000 }).then((h) => h.jsonValue());
  const pass = results.filter((r) => r.pass && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\n[${name}] ${pass}/${results.length - skipped} passed${skipped ? `, ${skipped} skipped` : ''}`);
  for (const r of results) {
    const mark = r.skipped ? '○' : r.pass ? '✔' : '✖';
    const extra = r.skipped ? ` (skipped: ${r.skipped})` : r.pass ? (r.note ? ` — ${r.note}` : '') : `\n      ${r.error}`;
    console.log(`  ${mark} ${r.id} ${r.name}${extra}`);
    if (!r.pass) failed++;
  }
  await browser.close();
}

server.stop();
process.exit(failed ? 1 : 0);
