import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairSimilarities, ratesAt, suggestThreshold, histogram } from '../tunelib.js';

const s = (person, embedding) => ({ person, embedding });

test('T-TUNE-2: pairSimilarities splits same/different pairs; strangers never paired with each other', () => {
  const samples = [s('a', [1, 0]), s('a', [1, 0.1]), s('b', [0, 1]), s(null, [1, 1]), s(null, [-1, 1])];
  const { same, diff } = pairSimilarities(samples);
  assert.equal(same.length, 1);          // a-a
  assert.equal(diff.length, 2 + 3 * 2);  // a-b ×2, plus each of 3 named vs 2 strangers
});

test('T-TUNE-3: ratesAt counts misses and false matches', () => {
  const pairs = { same: [0.9, 0.7, 0.5], diff: [0.2, 0.4, 0.6, 0.65] };
  assert.deepEqual(ratesAt(0.6, pairs), { missRate: 1 / 3, falseMatchRate: 2 / 4 });
});

test('T-TUNE-4: suggestThreshold picks the lowest threshold under the false-match cap', () => {
  const pairs = { same: [0.8, 0.75, 0.7], diff: [0.1, 0.3, 0.52] };
  assert.equal(suggestThreshold(pairs, 0).threshold, 0.53);
});

test('T-TUNE-5: histogram buckets and clamps', () => {
  const h = histogram([-1, 0, 0.99, 2], 0, 1, 4);
  assert.deepEqual(h.counts, [2, 0, 0, 2]);
});

import { memberLevel } from '../tunelib.js';

test('T-TUNE-6: memberLevel enrolls first N photos per person and scores the rest by best match', () => {
  const samples = [
    s('a', [1, 0]), s('a', [0.9, 0.1]), s('a', [1, 0.05]),   // a: enroll 2, probe 1
    s('b', [0, 1]), s('b', [0.1, 1]),                         // b: only 2 photos → enrolled-only member needs > 2
    s(null, [0.7, 0.7]),
  ];
  const r = memberLevel(samples, 2);
  assert.equal(r.members, 1);           // only 'a' has a held-out photo
  assert.equal(r.same.length, 1);       // a's third photo vs member a
  assert.equal(r.diff.length, 3);       // b's two photos + the stranger vs member a
  assert.ok(r.same[0] > Math.max(...r.diff));
});
