import { test, assert } from '../harness.js';
import * as db from '../../js/db.js';
import tripod from '../../js/modes/tripod.js';
import { dayKey } from '../../js/rules.js';
import { DEFAULTS } from '../../js/settings.js';
import { toJpegBlob } from '../../js/capture.js';

// Uses the isolated test database opened by roster.test.js ('snipecam-test').

const TODAY = '2026-10-21';
const NOON = new Date(2026, 9, 21, 12, 0, 0).getTime();
const cand = (memberId, day, extra = {}) => ({
  id: crypto.randomUUID(), memberId, day, jpeg: new Uint8Array([1, 2, 3]).buffer, thumb: '', quality: 0.5,
  similarity: 0.7, box: [0, 0, 100, 100], inFrame: [memberId], seenAt: NOON, status: 'pending', ...extra,
});

async function frame() {
  const c = new OffscreenCanvas(640, 480);
  const g = c.getContext('2d');
  g.fillStyle = '#888';
  g.fillRect(0, 0, 640, 480);
  return { bitmap: await createImageBitmap(c), crop: { x: 0, y: 0, w: 640, h: 480 } };
}

// A matchFaces-style result for a recognized member.
const seen = (id, similarity = 0.75, w = 120) => ({ face: { box: [100, 100, w, w], score: 0.9 }, top: null, match: { member: { id, name: id.toUpperCase() }, similarity } });

function fakeCtx(t0 = NOON) {
  let t = t0;
  const ctx = {
    db, settings: { ...DEFAULTS, minHits: 2, gapSec: 5 }, log: () => {},
    now: () => t, advance: (ms) => { t += ms; },
    confirmed: [], candidates: [],
    onConfirmed: (id) => ctx.confirmed.push(id),
    onCandidate: (c, verdict) => ctx.candidates.push({ c, verdict }),
  };
  return ctx;
}

// Runs a scripted sequence: each step is a list of results for one tick, 500 ms apart.
async function play(ctx, steps) {
  for (const results of steps) {
    await tripod.tick(ctx, await frame(), results);
    ctx.advance(500);
  }
}

test('T-DB-6', 'putCandidate for the same member+day overwrites (one per member per day)', async () => {
  await db.clearAll();
  await db.putCandidate(cand('a', TODAY, { quality: 0.3 }));
  await db.putCandidate(cand('a', TODAY, { quality: 0.8 }));
  await db.putCandidate(cand('a', '2026-10-22'));
  const all = await db.listCandidates();
  assert.equal(all.length, 2);
  assert.equal((await db.getCandidate('a', TODAY)).quality, 0.8);
});

test('T-DB-7', 'lock → listed that day only; unlock removes', async () => {
  await db.lock(['a', 'b'], TODAY, 'manual');
  assert.deepEqual((await db.listLocks(TODAY)).map((l) => l.memberId).sort(), ['a', 'b']);
  assert.equal((await db.listLocks('2026-10-22')).length, 0);
  await db.unlock('a', TODAY);
  assert.deepEqual((await db.listLocks(TODAY)).map((l) => l.memberId), ['b']);
});

test('T-DB-8', 'purgeExpired removes earlier days, keeps today', async () => {
  await db.clearAll();
  await db.putCandidate(cand('a', '2026-10-20'));
  await db.putCandidate(cand('b', TODAY));
  assert.equal(await db.purgeExpired(TODAY), 1);
  assert.deepEqual((await db.listCandidates()).map((c) => c.memberId), ['b']);
});

test('T-DB-9', 'candidate photo round-trips through IndexedDB as a real JPEG', async () => {
  const f = await frame();
  const blob = await toJpegBlob(f.bitmap);
  await db.putCandidate(cand('c', TODAY, { jpeg: await blob.arrayBuffer() }));
  const back = db.candidateBlob(await db.getCandidate('c', TODAY));
  const bmp = await createImageBitmap(back);
  assert.equal(back.type, 'image/jpeg');
  assert.equal(bmp.width, 640);
});

test('T-DB-11', 'dismissCandidates marks dismissed and drops the photo; dismissed are not listed', async () => {
  const c = await db.getCandidate('c', TODAY);
  await db.dismissCandidates([c.id]);
  const after = await db.getCandidate('c', TODAY);
  assert.equal(after.status, 'dismissed');
  assert.equal(after.jpeg.byteLength, 0);
  assert.ok(!(await db.listCandidates(TODAY)).some((x) => x.memberId === 'c'));
});

test('T-MOD-2', 'one pass (3 sightings, then gone) → exactly one candidate, confirmed once', async () => {
  await db.clearAll();
  const ctx = fakeCtx();
  await tripod.start(ctx);
  await play(ctx, [[seen('a')], [seen('a')], [seen('a')], ...Array(12).fill([])]);
  assert.deepEqual(ctx.confirmed, ['a']);
  assert.equal(ctx.candidates.length, 1);
  const c = await db.getCandidate('a', dayKey(NOON));
  assert.ok(c.jpeg.byteLength > 100, 'photo saved');
  assert.ok(c.thumb.startsWith('data:image/jpeg'));
});

test('T-MOD-6', 'second, worse pass the same day → still one candidate (best kept)', async () => {
  const ctx = fakeCtx(NOON + 60_000);
  await tripod.start(ctx);
  const before = await db.getCandidate('a', dayKey(NOON));
  await play(ctx, [[seen('a', 0.75, 70)], [seen('a', 0.75, 70)], ...Array(12).fill([])]);
  assert.equal(ctx.candidates.length, 0, 'smaller face should not replace');
  assert.equal((await db.listCandidates()).length, 1);
  assert.equal((await db.getCandidate('a', dayKey(NOON))).id, before.id);
});

test('T-MOD-3', 'locked member → no candidate, no confirmation', async () => {
  await db.clearAll();
  await db.lock(['a'], dayKey(NOON), 'shared');
  const ctx = fakeCtx();
  await tripod.start(ctx);
  await play(ctx, [[seen('a')], [seen('a')], [seen('a')], ...Array(12).fill([])]);
  assert.equal(ctx.confirmed.length, 0);
  assert.equal(ctx.candidates.length, 0);
});

test('T-MOD-4', 'two members in the same frame → a candidate each, both listing both people', async () => {
  await db.clearAll();
  const ctx = fakeCtx();
  await tripod.start(ctx);
  await play(ctx, [[seen('a'), seen('b')], [seen('a'), seen('b')], ...Array(12).fill([])]);
  assert.equal(ctx.candidates.length, 2);
  for (const id of ['a', 'b']) {
    assert.deepEqual([...(await db.getCandidate(id, dayKey(NOON))).inFrame].sort(), ['a', 'b']);
  }
});

test('T-MOD-5', 'locked mid-sighting → nothing more is saved for them (even a better photo)', async () => {
  await db.clearAll();
  const ctx = fakeCtx();
  await tripod.start(ctx);
  await play(ctx, [[seen('a')], [seen('a')]]);
  const before = ctx.candidates.length; // already saved at confirmation; Roster/Inbox delete it when they lock
  await db.lock(['a'], dayKey(NOON), 'manual');
  await tripod.onLocksChanged(ctx);
  await play(ctx, [[seen('a', 0.9, 200)], [seen('a', 0.9, 200)], ...Array(12).fill([])]);
  assert.equal(ctx.candidates.length, before);
});

test('T-MOD-9', 'photo is saved as soon as the sighting is confirmed (person still in view), then upgraded', async () => {
  await db.clearAll();
  const ctx = fakeCtx();
  await tripod.start(ctx);
  await play(ctx, [[seen('a', 0.75, 80)], [seen('a', 0.75, 80)]]);
  const first = await db.getCandidate('a', dayKey(NOON));
  assert.ok(first, 'not saved while still in view');
  await play(ctx, [[seen('a', 0.75, 200)]]); // closer → better photo
  const upgraded = await db.getCandidate('a', dayKey(NOON));
  assert.equal(upgraded.id, first.id);
  assert.ok(upgraded.quality > first.quality, 'not upgraded');
  assert.equal((await db.listCandidates()).length, 1);
});

test('T-MOD-7', 'faces smaller than minCandidateFacePx never become candidates (rule 3)', async () => {
  await db.clearAll();
  const ctx = fakeCtx();
  await tripod.start(ctx);
  await play(ctx, [[seen('a', 0.8, 50)], [seen('a', 0.8, 50)], [seen('a', 0.8, 50)], ...Array(12).fill([])]);
  assert.equal(ctx.candidates.length, 0);
});

test('T-MOD-8', 'stop mid-sighting flushes it into a candidate', async () => {
  await db.clearAll();
  const ctx = fakeCtx();
  await tripod.start(ctx);
  await play(ctx, [[seen('a')], [seen('a')]]);
  await tripod.stop(ctx);
  assert.equal(ctx.candidates.length, 1);
});

test('T-DB-12', 'reassignCandidate moves a catch to another member, replacing their pending one', async () => {
  await db.clearAll();
  const a = await db.putCandidate(cand('a', TODAY, { inFrame: ['a', 'x'] }));
  await db.putCandidate(cand('b', TODAY));
  const moved = await db.reassignCandidate(a.id, 'b');
  assert.equal(moved.memberId, 'b');
  assert.deepEqual([...moved.inFrame].sort(), ['b', 'x']);
  const list = await db.listCandidates(TODAY);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, a.id);
});

test('T-DB-13', 'deleteCandidatesFor removes only the named members\' catches for that day', async () => {
  await db.clearAll();
  await db.putCandidate(cand('a', TODAY));
  await db.putCandidate(cand('b', TODAY));
  await db.putCandidate(cand('a', '2026-10-22'));
  await db.deleteCandidatesFor(['a', 'zz'], TODAY);
  assert.deepEqual((await db.listCandidates()).map((c) => `${c.memberId}@${c.day}`).sort(), ['a@2026-10-22', 'b@2026-10-21']);
});
