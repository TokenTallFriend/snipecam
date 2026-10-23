import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupOf, groupKey, parseGroupKey, groupName, isLockedId } from '../../js/lookalikes.js';
import { bestMatch, matchFaces } from '../../js/matcher.js';
import { mergeRosters } from '../../js/rostersync.js';

const D = 8;
const v = (...pairs) => { const x = new Array(D).fill(0); for (const [i, k] of pairs) x[i] = k; return x; };
// Twins: nearly identical faces. Bob: different.
const twin1 = { id: 't1', name: 'Ann', embeddings: [v([0, 1], [1, 0.10])], lookalikes: ['t2'] };
const twin2 = { id: 't2', name: 'Amy', embeddings: [v([0, 1], [1, 0.12])], lookalikes: ['t1'] };
const bob = { id: 'b', name: 'Bob', embeddings: [v([4, 1])] };
const members = [twin1, twin2, bob];
const opts = { threshold: 0.9, margin: 0.05 };
const face = (embedding) => ({ box: [0, 0, 100, 100], score: 0.9, embedding });

test('T-LOOK-1: groups follow links (incl. triplets); keys round-trip; names; locked only when all are', () => {
  const byId = new Map(members.map((m) => [m.id, m]));
  assert.deepEqual(groupOf('t1', byId), ['t1', 't2']);
  assert.deepEqual(groupOf('b', byId), ['b']);
  const trip = new Map([['x', { id: 'x', lookalikes: ['y'] }], ['y', { id: 'y', lookalikes: ['z'] }], ['z', { id: 'z' }]]);
  assert.deepEqual(groupOf('x', trip), ['x', 'y', 'z']);
  assert.deepEqual(parseGroupKey(groupKey(['t2', 't1'])), ['t1', 't2']);
  assert.equal(parseGroupKey('t1'), null);
  assert.equal(groupName(['t1', 't2'], byId), 'Ann or Amy?');
  assert.equal(isLockedId(groupKey(['t1', 't2']), new Set(['t1'])), false);
  assert.equal(isLockedId(groupKey(['t1', 't2']), new Set(['t1', 't2'])), true);
  assert.equal(isLockedId('b', new Set(['b'])), true);
});

test('T-LOOK-2: without a link, twins fail the margin (unrecognized); linked, the margin ignores the twin', () => {
  const unlinked = [{ ...twin1, lookalikes: [] }, { ...twin2, lookalikes: [] }, bob];
  assert.equal(bestMatch(v([0, 1], [1, 0.11]), unlinked, opts), null);
  assert.ok(bestMatch(v([0, 1], [1, 0.11]), members, opts));
});

test('T-LOOK-3: the margin still applies against non-lookalikes', () => {
  const lookalikeOfBob = { id: 'c', name: 'Cal', embeddings: [v([0, 1], [1, 0.11])] }; // looks like the twins, not linked
  assert.equal(bestMatch(v([0, 1], [1, 0.11]), [...members, lookalikeOfBob], opts), null);
});

test('T-LOOK-4: one twin in frame → "Ann or Amy?" stand-in; both in frame → each face a different twin', () => {
  const one = matchFaces([face(v([0, 1], [1, 0.11])), face(v([4, 1]))], members, opts);
  assert.equal(one[0].match.member.id, groupKey(['t1', 't2']));
  assert.equal(one[0].match.member.name, 'Ann or Amy?');
  assert.equal(one[1].match.member.id, 'b');
  const both = matchFaces([face(v([0, 1], [1, 0.115])), face(v([0, 1], [1, 0.105]))], members, opts);
  assert.deepEqual(both.map((r) => r.match.member.id).sort(), ['t1', 't2']);
});

test('T-LOOK-5: roster merge carries lookalike links over, translated to local ids', () => {
  const local = [{ id: 'p-ann', name: 'Ann', slack: '', embeddings: [v([0, 1])], thumbs: [''] }, { id: 'p-amy', name: 'Amy', slack: '', embeddings: [v([0, 1], [2, 0.1])], thumbs: [''] }];
  const incoming = [
    { id: 'l-ann', name: 'Ann', slack: '', embeddings: [v([0, 1])], thumbs: [''], lookalikes: ['l-amy'] },
    { id: 'l-amy', name: 'Amy', slack: '', embeddings: [v([0, 1], [2, 0.1])], thumbs: [''], lookalikes: ['l-ann'] },
  ];
  const { changed, report } = mergeRosters(local, incoming, { newId: () => 'x' });
  const by = Object.fromEntries(changed.map((m) => [m.id, m.lookalikes]));
  assert.deepEqual(by, { 'p-ann': ['p-amy'], 'p-amy': ['p-ann'] });
  assert.equal(report.merged, 2);
  assert.equal(report.unchanged, 0);
});
