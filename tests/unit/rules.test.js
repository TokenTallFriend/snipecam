import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, decide, tags, isExpired, msUntilDeadline, reminderDue, inRehearsalWindow, SIMILARITY_GUARD } from '../../js/rules.js';

const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s);

test('T-RUL-1: dayKey rolls over at local midnight', () => {
  assert.equal(dayKey(at(2026, 10, 21, 23, 59)), '2026-10-21');
  assert.equal(dayKey(at(2026, 10, 22, 0, 1)), '2026-10-22');
  assert.equal(dayKey(at(2026, 1, 5).getTime()), '2026-01-05');
});

test('T-RUL-2: decide — locked member is always discarded', () => {
  assert.equal(decide({ existing: null, locked: true, incoming: { quality: 9, similarity: 1 } }), 'discard');
});

test('T-RUL-3: decide — keep when nothing pending (or only a dismissed one)', () => {
  assert.equal(decide({ existing: null, locked: false, incoming: { quality: 0.1, similarity: 0.7 } }), 'keep');
  assert.equal(decide({ existing: { status: 'dismissed', quality: 5, similarity: 0.9 }, locked: false, incoming: { quality: 0.1, similarity: 0.7 } }), 'keep');
});

test('T-RUL-4: decide — replace only with better quality and comparable similarity', () => {
  const existing = { status: 'pending', quality: 0.5, similarity: 0.75 };
  assert.equal(decide({ existing, locked: false, incoming: { quality: 0.6, similarity: 0.74 } }), 'replace');
  assert.equal(decide({ existing, locked: false, incoming: { quality: 0.5, similarity: 0.9 } }), 'discard'); // equal quality
  assert.equal(decide({ existing, locked: false, incoming: { quality: 0.4, similarity: 0.9 } }), 'discard'); // worse
  // Sharper photo but clearly less similar (a lookalike) must not push out the real catch
  assert.equal(decide({ existing, locked: false, incoming: { quality: 0.9, similarity: 0.75 - SIMILARITY_GUARD - 0.01 } }), 'discard');
});

test('T-RUL-5: tags — everyone in the photo; members locked today flagged', () => {
  assert.deepEqual(tags({ memberId: 'a', inFrame: ['a', 'b', 'c'] }, ['c']), { tag: ['a', 'b'], flagged: ['c'], unsure: [] });
  assert.deepEqual(tags({ memberId: 'a' }, []), { tag: ['a'], flagged: [], unsure: [] });
  // An unresolved twin ("A or B?") in someone else's photo can't be tagged automatically
  assert.deepEqual(tags({ memberId: 'a', inFrame: ['a', 'lookalike:t1+t2'] }, []), { tag: ['a'], flagged: [], unsure: ['lookalike:t1+t2'] });
});

test('T-RUL-6: isExpired false same day, true after midnight', () => {
  const c = { day: '2026-10-21' };
  assert.equal(isExpired(c, at(2026, 10, 21, 23, 59, 59)), false);
  assert.equal(isExpired(c, at(2026, 10, 22, 0, 0, 1)), true);
});

test('T-RUL-7: msUntilDeadline at 23:00 = 1 hour', () => {
  assert.equal(msUntilDeadline(at(2026, 10, 21, 23, 0)), 3_600_000);
});

test('T-RUL-8: inRehearsalWindow covers start−30 … end+30 on the right weekday only', () => {
  const r = [{ weekday: 3, start: '19:00', end: '21:00' }]; // Wednesday
  const wed = (h, m) => at(2026, 10, 21, h, m); // 2026-10-21 is a Wednesday
  assert.equal(wed(18, 30).getDay(), 3);
  assert.equal(inRehearsalWindow(wed(18, 30), r), true);
  assert.equal(inRehearsalWindow(wed(21, 30), r), true);
  assert.equal(inRehearsalWindow(wed(18, 29), r), false);
  assert.equal(inRehearsalWindow(wed(21, 31), r), false);
  assert.equal(inRehearsalWindow(at(2026, 10, 22, 19, 0), r), false); // Thursday
});

test('T-RUL-9: reminderDue once per day after reminderAt', () => {
  assert.equal(reminderDue(at(2026, 10, 21, 22, 59), '23:00', null), false);
  assert.equal(reminderDue(at(2026, 10, 21, 23, 0), '23:00', null), true);
  assert.equal(reminderDue(at(2026, 10, 21, 23, 30), '23:00', '2026-10-21'), false);
  assert.equal(reminderDue(at(2026, 10, 22, 23, 1), '23:00', '2026-10-21'), true);
});
