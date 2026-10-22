// Minimal browser test harness. Test files call test(id, name, fn); browser.html calls run().
// A test passes by returning (optionally a note string), fails by throwing, or skips via skip(reason).

const tests = [];

export function test(id, name, fn) {
  tests.push({ id, name, fn });
}

// Throw skip('reason') inside a test to mark it skipped (e.g. fixtures missing on the deployed site).
export class Skip extends Error {}
export const skip = (reason) => { throw new Skip(reason); };

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
      const note = await t.fn(); // a test may return a short note (e.g. a measured value)
      results.push({ id: t.id, name: t.name, pass: true, ms: performance.now() - start, note: note ?? '' });
      console.log(`[harness] ${t.id} done in ${(performance.now() - start).toFixed(0)} ms`);
    } catch (err) {
      if (err instanceof Skip) results.push({ id: t.id, name: t.name, pass: true, skipped: err.message });
      else results.push({ id: t.id, name: t.name, pass: false, error: String(err?.message ?? err) });
    }
  }
  const passed = results.filter((r) => r.pass && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  el.innerHTML =
    `<h2>${passed}/${results.length - skipped} passed${skipped ? `, ${skipped} skipped` : ''}</h2>` +
    results
      .map((r) => `<div class="${r.skipped ? 'skip' : r.pass ? 'pass' : 'fail'}">${r.skipped ? '○' : r.pass ? '✓' : '✗'} <b>${r.id}</b> ${r.name}` +
        (r.skipped ? ` <i>(skipped: ${r.skipped})</i>` : r.pass ? (r.note ? ` — ${r.note}` : '') : `<pre>${r.error}</pre>`) + '</div>')
      .join('');
  window.__testResults = results;
  return results;
}
