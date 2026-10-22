// Minimal browser test harness. Test files call test(id, name, fn); browser.html calls run().

const tests = [];

export function test(id, name, fn) {
  tests.push({ id, name, fn });
}

function fail(msg) {
  throw new Error(msg);
}

export const assert = {
  ok(value, msg = 'expected truthy') {
    if (!value) fail(msg);
  },
  equal(actual, expected, msg) {
    if (actual !== expected) fail(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
  deepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) fail(msg ?? `expected ${e}, got ${a}`);
  },
  async throws(fn, msg = 'expected an error') {
    try {
      await fn();
    } catch {
      return;
    }
    fail(msg);
  },
};

// Runs all registered tests, renders results into `el`, and returns them.
// Results are also exposed on window.__testResults for automated runners.
export async function run(el) {
  const results = [];
  for (const t of tests) {
    const start = performance.now();
    try {
      await t.fn();
      results.push({ id: t.id, name: t.name, pass: true, ms: performance.now() - start });
    } catch (err) {
      results.push({ id: t.id, name: t.name, pass: false, error: String(err?.message ?? err) });
    }
  }
  const passed = results.filter((r) => r.pass).length;
  el.innerHTML =
    `<h2>${passed}/${results.length} passed</h2>` +
    results
      .map((r) => `<div class="${r.pass ? 'pass' : 'fail'}">${r.pass ? '✓' : '✗'} <b>${r.id}</b> ${r.name}` +
        (r.pass ? '' : `<pre>${r.error}</pre>`) + '</div>')
      .join('');
  window.__testResults = results;
  return results;
}
