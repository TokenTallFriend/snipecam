import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDelay, createStats } from '../../js/loop.js';

const base = { processFps: 2, idleFps: 0.5, idleAfterSec: 60 };

test('T-LOOP-1: full rate while faces were seen recently; work time is subtracted', () => {
  const r = nextDelay({ ...base, now: 10_000, lastFaceAt: 9_000, elapsedMs: 120 });
  assert.equal(r.idle, false);
  assert.equal(r.delay, 500 - 120);
});

test('T-LOOP-2: idle rate after idleAfterSec without faces', () => {
  const r = nextDelay({ ...base, now: 100_000, lastFaceAt: 39_000, elapsedMs: 100 });
  assert.equal(r.idle, true);
  assert.equal(r.delay, 2000 - 100);
});

test('T-LOOP-3: delay never negative when work exceeds interval', () => {
  assert.equal(nextDelay({ ...base, now: 0, lastFaceAt: 0, elapsedMs: 900 }).delay, 0);
});

test('T-LOOP-4: stats report mean detect time and achieved fps over a rolling window', () => {
  const s = createStats(5);
  assert.equal(s.fps, 0);
  for (let i = 0; i < 10; i++) s.record(i * 500, 100 + i);
  assert.equal(s.fps, 2); // ticks 500 ms apart
  assert.equal(s.detectMs, (105 + 106 + 107 + 108 + 109) / 5); // only last 5 kept
  s.reset();
  assert.equal(s.detectMs, 0);
});
