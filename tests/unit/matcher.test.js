import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosine, memberScore, bestMatch, matchFaces } from '../../js/matcher.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const m = (id, ...embeddings) => ({ id, name: id, embeddings });
const opts = { threshold: 0.6, margin: 0.05 };

test('T-MAT-1: cosine identical = 1, orthogonal = 0, opposite = −1, scale-invariant', () => {
  near(cosine([1, 2, 3], [1, 2, 3]), 1);
  near(cosine([1, 0], [0, 1]), 0);
  near(cosine([1, 2], [-1, -2]), -1);
  near(cosine([1, 2], [10, 20]), 1);
  near(cosine(new Float32Array([1, 0]), [1, 0]), 1);
});

test('T-MAT-2: cosine length mismatch throws', () => {
  assert.throws(() => cosine([1, 2], [1, 2, 3]), /mismatch/);
});

test('T-MAT-3: empty roster → null', () => {
  assert.equal(bestMatch([1, 0], [], opts), null);
});

test('T-MAT-4: best below threshold → null', () => {
  assert.equal(bestMatch([1, 0], [m('a', [0.5, 1])], opts), null); // cos ≈ 0.447
});

test('T-MAT-5: two members within margin → null (ambiguous)', () => {
  const r = bestMatch([1, 0], [m('a', [1, 0.1]), m('b', [1, 0.12])], opts);
  assert.equal(r, null);
});

test('T-MAT-6: picks highest; uses best of a member\'s photos; ignores members without embeddings', () => {
  const members = [m('a', [0, 1], [1, 0.05]), m('b', [1, 0.6]), m('empty')];
  near(memberScore([1, 0], members[0]), cosine([1, 0], [1, 0.05]));
  assert.equal(memberScore([1, 0], members[2]), -1);
  const r = bestMatch([1, 0], members, opts);
  assert.equal(r.member.id, 'a');
});

test('T-MAT-8: matchFaces returns top candidate even when unmatched; skips faces without embeddings', () => {
  const members = [m('a', [1, 0])];
  const out = matchFaces([{ embedding: [1, 0.01] }, { embedding: [0, 1] }, { embedding: null }], members, opts);
  assert.equal(out[0].match.member.id, 'a');
  assert.equal(out[1].match, null);
  assert.equal(out[1].top.member.id, 'a');
  assert.equal(out[2].top, null);
});
