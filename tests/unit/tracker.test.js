import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTracker } from '../../js/tracker.js';

// Fake frames record how often they're disposed.
function setup(opts = {}) {
  const disposed = new Map();
  const tracker = createTracker({ minHits: 2, gapSec: 5, onDispose: (f) => disposed.set(f, (disposed.get(f) ?? 0) + 1), ...opts });
  let n = 0;
  const frame = () => ({ id: n++ });
  const hit = (memberId, quality, f = frame()) => ({ memberId, quality, frame: f, meta: { q: quality } });
  // update() as a well-behaved caller uses it: improved frames are released after use.
  const step = (hits, t) => {
    const r = tracker.update(hits, t);
    for (const e of r.improved) tracker.release(e.frame);
    return r;
  };
  return { tracker, disposed, frame, hit, step };
}

test('T-TRK-1: a single hit then a gap → not reported; its frame disposed', () => {
  const { tracker, disposed, hit } = setup();
  const h = hit('a', 0.5);
  tracker.update([h], 0);
  const r = tracker.update([], 6000);
  assert.equal(r.ended.length, 0);
  assert.equal(disposed.get(h.frame), 1);
});

test('T-TRK-2: confirmed emitted once, at the minHits-th hit', () => {
  const { tracker, hit } = setup();
  assert.deepEqual(tracker.update([hit('a', 0.1)], 0).confirmed, []);
  assert.deepEqual(tracker.update([hit('a', 0.1)], 500).confirmed, ['a']);
  assert.deepEqual(tracker.update([hit('a', 0.1)], 1000).confirmed, []);
});

test('T-TRK-3: ended session returns the best frame; all other frames disposed', () => {
  const { tracker, disposed, hit, step } = setup();
  const hits = [hit('a', 0.2), hit('a', 0.9), hit('a', 0.4), hit('a', 0.95), hit('a', 0.1)];
  hits.forEach((h, i) => step([h], i * 500));
  const { ended } = tracker.update([], 2000 + 5001);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].frame, hits[3].frame);
  assert.equal(ended[0].quality, 0.95);
  assert.equal(ended[0].hits, 5);
  for (const [i, h] of hits.entries()) assert.equal(disposed.get(h.frame) ?? 0, i === 3 ? 0 : 1, `frame ${i}`);
  tracker.release(ended[0].frame);
  assert.equal(disposed.get(hits[3].frame), 1);
});

test('T-TRK-4: a gap longer than gapSec splits into two sessions', () => {
  const { tracker, hit } = setup();
  tracker.update([hit('a', 0.5)], 0);
  tracker.update([hit('a', 0.5)], 1000);
  const r = tracker.update([hit('a', 0.6)], 7000); // 6 s gap: first session ends, second starts
  assert.equal(r.ended.length, 1);
  assert.equal(r.ended[0].end, 1000);
  tracker.update([hit('a', 0.6)], 7500);
  assert.equal(tracker.flush().length, 1);
});

test('T-TRK-5: two members tracked independently; a shared frame is disposed only after both release it', () => {
  const { tracker, disposed, frame, hit, step } = setup();
  const f1 = frame();
  const f2 = frame();
  step([hit('a', 0.9, f1), hit('b', 0.8, f1)], 0);
  step([hit('a', 0.1, f2), hit('b', 0.1, f2)], 500);
  assert.equal(disposed.get(f2), 1, 'unused shared frame disposed once');
  const { ended } = tracker.update([], 6000);
  assert.deepEqual(ended.map((e) => e.memberId).sort(), ['a', 'b']);
  assert.ok(ended.every((e) => e.frame === f1));
  tracker.release(f1);
  assert.equal(disposed.get(f1) ?? 0, 0, 'still held by second session result');
  tracker.release(f1);
  assert.equal(disposed.get(f1), 1);
});

test('T-TRK-6: drop ends silently; flush reports; reset disposes everything', () => {
  const { tracker, disposed, hit } = setup();
  const a = hit('a', 0.5);
  tracker.update([a, hit('b', 0.5)], 0);
  tracker.update([hit('b', 0.6)], 100);
  tracker.drop('a');
  assert.equal(disposed.get(a.frame), 1);
  const flushed = tracker.flush();
  assert.deepEqual(flushed.map((e) => e.memberId), ['b']);
  tracker.release(flushed[0].frame);
  const c = hit('c', 0.5);
  tracker.update([c], 200);
  tracker.reset();
  assert.equal(disposed.get(c.frame), 1);
  assert.equal(tracker.activeCount, 0);
});

test('T-TRK-7: no leaks — every frame is disposed exactly once after results are released', () => {
  const { tracker, disposed, frame, hit } = setup({ minHits: 2, gapSec: 1 });
  const all = [];
  let t = 0;
  // Pseudo-random stream: members a/b/c appearing and disappearing, sometimes sharing frames.
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 400; i++) {
    t += 500;
    const f = frame();
    const hits = ['a', 'b', 'c'].filter(() => rnd() < 0.4).map((m) => hit(m, rnd(), f));
    if (hits.length) all.push(f);
    const r = tracker.update(hits, t);
    for (const e of [...r.ended, ...r.improved]) tracker.release(e.frame);
  }
  for (const e of tracker.flush()) tracker.release(e.frame);
  for (const f of all) assert.equal(disposed.get(f), 1, `frame ${f.id} disposed ${disposed.get(f) ?? 0}×`);
});

test('T-TRK-8: improved reports the best frame at confirmation and whenever it gets better, not otherwise', () => {
  const { tracker, disposed, hit } = setup();
  assert.deepEqual(tracker.update([hit('a', 0.5)], 0).improved, []); // not confirmed yet
  const h2 = hit('a', 0.4);
  let r = tracker.update([h2], 500); // confirmed: best is still the first hit
  assert.equal(r.improved.length, 1);
  assert.equal(r.improved[0].quality, 0.5);
  tracker.release(r.improved[0].frame);
  r = tracker.update([hit('a', 0.3)], 1000); // worse: nothing to report
  assert.equal(r.improved.length, 0);
  const better = hit('a', 0.9);
  r = tracker.update([better], 1500);
  assert.equal(r.improved[0].frame, better.frame);
  tracker.release(r.improved[0].frame);
  assert.equal(disposed.get(better.frame) ?? 0, 0, 'session still holds its best frame');
  const { ended } = tracker.update([], 7000);
  tracker.release(ended[0].frame);
  assert.equal(disposed.get(better.frame), 1);
});
