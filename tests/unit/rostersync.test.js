import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRosters, describeMerge, nameKey, MAX_PHOTOS } from '../../js/rostersync.js';

// Distinct "photos": unit vectors pointing different ways. Person A's photos are near each other; B's are elsewhere.
const D = 16;
const vec = (...pairs) => { const v = new Array(D).fill(0); for (const [i, x] of pairs) v[i] = x; return v; };
const A = [vec([0, 1], [1, 0.3]), vec([0, 1], [2, 0.3]), vec([0, 1], [3, 0.3]), vec([0, 1], [4, 0.3]), vec([0, 1], [5, 0.3])];
const B = [vec([8, 1], [9, 0.3]), vec([8, 1], [10, 0.3])];
const member = (id, name, embeddings, extra = {}) => ({ id, name, slack: '', embeddings, thumbs: embeddings.map((_, i) => `t-${id}-${i}`), ...extra });
let n = 0;
const opts = { newId: () => `new-${++n}` };

test('T-SYNC-1: same id → photos combined, local id and name kept', () => {
  const local = [member('a', 'Alice', A.slice(0, 2))];
  const { changed, report } = mergeRosters(local, [member('a', 'alice ', A.slice(1, 4))], opts);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].id, 'a');
  assert.equal(changed[0].name, 'Alice');
  assert.equal(changed[0].embeddings.length, 4); // 2 local + 2 new (1 duplicate skipped)
  assert.equal(changed[0].thumbs.length, 4);
  assert.deepEqual([report.merged, report.photosAdded, report.duplicatesSkipped], [1, 2, 1]);
});

test('T-SYNC-2: enrolled separately on two devices (different ids) → matched by name, merged into the local member', () => {
  const local = [member('phone-a', 'Alice Smith', A.slice(0, 2))];
  const { changed, report } = mergeRosters(local, [member('laptop-a', '  alice   SMITH', A.slice(2, 5))], opts);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].id, 'phone-a');
  assert.equal(changed[0].embeddings.length, 5);
  assert.equal(report.added, 0);
});

test('T-SYNC-3: importing the same file twice changes nothing the second time', () => {
  const local = [member('a', 'Alice', A.slice(0, 2))];
  const incoming = [member('a', 'Alice', A.slice(0, 4))];
  const first = mergeRosters(local, incoming, opts);
  const second = mergeRosters(first.changed, incoming, opts);
  assert.equal(second.changed.length, 0);
  assert.deepEqual([second.report.unchanged, second.report.photosAdded, second.report.duplicatesSkipped], [1, 0, 4]);
});

test('T-SYNC-4: rosters grow together in both directions', () => {
  const laptop = [member('a', 'Alice', A.slice(0, 3)), member('b', 'Bob', B.slice(0, 1))];
  const phone = [member('a', 'Alice', A.slice(2, 5)), member('c', 'Cara', [vec([12, 1])])];
  const toPhone = mergeRosters(phone, laptop, opts).changed;
  const phoneAfter = [...phone.filter((m) => !toPhone.some((c) => c.id === m.id)), ...toPhone];
  const toLaptop = mergeRosters(laptop, phone, opts).changed;
  const laptopAfter = [...laptop.filter((m) => !toLaptop.some((c) => c.id === m.id)), ...toLaptop];
  const summary = (r) => r.map((m) => `${m.name}:${m.embeddings.length}`).sort();
  assert.deepEqual(summary(phoneAfter), ['Alice:5', 'Bob:1', 'Cara:1']);
  assert.deepEqual(summary(laptopAfter), summary(phoneAfter));
});

test('T-SYNC-5: new member added; empty Slack handle filled from import; existing handle kept', () => {
  const local = [member('a', 'Alice', A.slice(0, 1)), member('b', 'Bob', B.slice(0, 1), { slack: '@bob' })];
  const { changed, report } = mergeRosters(local, [
    member('a', 'Alice', A.slice(0, 1), { slack: '@alice' }),
    member('b', 'Bob', B.slice(0, 1), { slack: '@robert' }),
    member('c', 'Cara', [vec([12, 1])]),
  ], opts);
  const by = Object.fromEntries(changed.map((m) => [m.name, m]));
  assert.equal(by.Alice.slack, '@alice');
  assert.equal(by.Bob, undefined, 'Bob unchanged (handle kept, no new photos)');
  assert.equal(by.Cara.id, 'c');
  assert.deepEqual([report.added, report.merged, report.unchanged], [1, 1, 1]);
});

test('T-SYNC-6: same name but a clearly different face → kept separate as "Name (2)" and reported', () => {
  const local = [member('a1', 'Alex', A.slice(0, 2))];
  const { changed, report } = mergeRosters(local, [member('a2', 'Alex', B)], opts);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].name, 'Alex (2)');
  assert.equal(changed[0].embeddings.length, 2);
  assert.equal(report.conflicts.length, 1);
  assert.match(describeMerge(report), /1 name conflict/);
});

test('T-SYNC-7: same id but different face is still merged (ids are authoritative)', () => {
  const { changed } = mergeRosters([member('a', 'Alice', A.slice(0, 1))], [member('a', 'Alice', B.slice(0, 1))], opts);
  assert.equal(changed[0].embeddings.length, 2);
});

test('T-SYNC-8: photo limit — never more than MAX_PHOTOS; overflow counted', () => {
  const many = Array.from({ length: MAX_PHOTOS + 5 }, (_, i) => vec([0, 1], [1 + (i % 14), 0.2 + i * 0.01]));
  const { changed, report } = mergeRosters([member('a', 'Alice', many.slice(0, 20))], [member('a', 'Alice', many.slice(20))], opts);
  assert.equal(changed[0].embeddings.length, MAX_PHOTOS);
  assert.equal(report.overCap, 5);
  const fresh = mergeRosters([], [member('z', 'Zed', many)], opts);
  assert.equal(fresh.changed[0].embeddings.length, MAX_PHOTOS);
});

test('T-SYNC-9: distinct ids stay distinct; a shared id means the same member, even if renamed on the other device', () => {
  const { changed } = mergeRosters([member('x', 'Alice', A.slice(0, 1))], [member('y', 'Bob', B.slice(0, 1))], opts);
  assert.equal(changed[0].id, 'y');
  const clash = mergeRosters([member('x', 'Alice', A.slice(0, 1))], [member('x', 'Bob', B.slice(0, 1))], opts);
  // Same id is treated as the same member (ids are authoritative), even if renamed on the other device
  assert.equal(clash.changed[0].id, 'x');
  assert.equal(clash.changed[0].name, 'Alice');
});

test('T-SYNC-10: nameKey ignores case, extra spaces, and Unicode form', () => {
  assert.equal(nameKey('  Zoë   Smith '), nameKey('ZOË smith'));
  assert.equal(nameKey('Zoë'), nameKey('Zoë'));
});
