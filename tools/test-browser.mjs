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
  await page.goto(`${server.base}/tests/browser.html`);
  const results = await page.waitForFunction(() => window.__testResults, null, { timeout: 60000 }).then((h) => h.jsonValue());
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n[${name}] ${pass}/${results.length} passed`);
  for (const r of results) {
    console.log(`  ${r.pass ? '✔' : '✖'} ${r.id} ${r.name}${r.pass ? '' : `\n      ${r.error}`}`);
    if (!r.pass) failed++;
  }
  await browser.close();
}

server.stop();
process.exit(failed ? 1 : 0);
