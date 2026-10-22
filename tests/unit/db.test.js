import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMember, normalizeSlack, EMBEDDING_SIZE } from '../../js/db.js';
import { evaluateFaces, selfConsistency } from '../../js/enroll.js';

const emb = (v = 0.1) => new Array(EMBEDDING_SIZE).fill(v);
const good = { id: 'x', name: 'Alice', slack: '@alice', embeddings: [emb()], thumbs: ['data:'] };

test('T-DB-4: validateMember accepts good records and rejects bad ones', () => {
  assert.deepEqual(validateMember(good), []);
  assert.deepEqual(validateMember({ ...good, embeddings: [new Float32Array(EMBEDDING_SIZE)] }), []);
  assert.ok(validateMember(null).length);
  assert.ok(validateMember({ ...good, name: '  ' }).some((e) => /name/.test(e)));
  assert.ok(validateMember({ ...good, id: '' }).some((e) => /id/.test(e)));
  assert.ok(validateMember({ ...good, embeddings: [] }).some((e) => /embedding/.test(e)));
  assert.ok(validateMember({ ...good, embeddings: [[1, 2, 3]] }).some((e) => /1024/.test(e)));
  assert.ok(validateMember({ ...good, embeddings: [emb(NaN)] }).some((e) => /1024/.test(e)));
  assert.ok(validateMember({ ...good, embeddings: 'x' }).length);
  assert.ok(validateMember({ ...good, thumbs: [1] }).some((e) => /thumbs/.test(e)));
});

test('T-DB-10: normalizeSlack strips spaces and extra @, adds one @', () => {
  assert.equal(normalizeSlack('  @@Alice Smith '), '@AliceSmith');
  assert.equal(normalizeSlack('bob'), '@bob');
  assert.equal(normalizeSlack(''), '');
  assert.equal(normalizeSlack(undefined), '');
});

const face = (w, embedding = [1]) => ({ box: [0, 0, w, w], score: 0.9, embedding });

test('T-ENR-6: evaluateFaces skips no-face, too-small, unclear; picks largest of several', () => {
  assert.equal(evaluateFaces([]).note, 'No face found');
  assert.match(evaluateFaces([face(50)]).note, /too small/);
  assert.equal(evaluateFaces([face(120, null)]).note, 'Face unclear');
  const one = evaluateFaces([face(120)]);
  assert.equal(one.status, 'used');
  assert.equal(one.note, '');
  const many = evaluateFaces([face(90), face(200), face(100)]);
  assert.equal(many.face.box[2], 200);
  assert.match(many.note, /Several faces/);
});

test('T-ENR-4: selfConsistency flags the photo of a different person', () => {
  const a = [1, 0, 0], a2 = [0.95, 0.1, 0], a3 = [0.9, 0.05, 0.1], other = [0, 0, 1];
  assert.equal(selfConsistency([a, a2, other, a3]).outlierIndex, 2);
  assert.equal(selfConsistency([a, a2, a3]).outlierIndex, null);
  assert.equal(selfConsistency([a, other]).outlierIndex, null); // too few to judge
});
