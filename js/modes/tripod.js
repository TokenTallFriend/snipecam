// Tripod (passive) mode: keeps the single best photo of each member per day, while you do something else.

import { createTracker } from '../tracker.js';
import { dayKey, decide } from '../rules.js';
import { quality } from '../detector.js';
import { toJpegBlob, cropFace } from '../capture.js';

let tracker = null;
let locked = new Set();
let day = null;

async function loadLocks(ctx) {
  day = dayKey(ctx.now());
  locked = new Set((await ctx.db.listLocks(day)).map((l) => l.memberId));
}

// Turns finished sightings into candidates (or discards them), per the game rules.
async function handleEnded(ctx, ended) {
  for (const e of ended) {
    try {
      const sightingDay = dayKey(e.end);
      const existing = await ctx.db.getCandidate(e.memberId, sightingDay);
      const verdict = decide({
        existing,
        locked: locked.has(e.memberId) || sightingDay !== day,
        incoming: { quality: e.quality, similarity: e.meta.similarity },
      });
      if (verdict === 'discard') continue;
      const blob = await toJpegBlob(e.frame);
      const candidate = await ctx.db.putCandidate({
        id: crypto.randomUUID(),
        memberId: e.memberId,
        day: sightingDay,
        jpeg: await blob.arrayBuffer(),
        thumb: cropFace(e.frame, e.meta.box, 0.6, 160),
        quality: e.quality,
        similarity: e.meta.similarity,
        box: e.meta.box,
        inFrame: e.meta.inFrame,
        seenAt: e.end,
        status: 'pending',
      });
      ctx.log(`Caught ${e.meta.name} (${verdict}, ${e.hits} hits, similarity ${e.meta.similarity.toFixed(2)})`);
      ctx.onCandidate(candidate, verdict);
    } catch (err) {
      ctx.log(`Saving catch failed: ${err.message}`, 'error');
    } finally {
      tracker.release(e.frame);
    }
  }
}

export default {
  id: 'tripod',
  label: 'Tripod',

  async start(ctx) {
    tracker?.reset();
    tracker = createTracker({ minHits: ctx.settings.minHits, gapSec: ctx.settings.gapSec, onDispose: (bmp) => bmp.close() });
    await loadLocks(ctx);
  },

  async tick(ctx, frame, results) {
    const { bitmap } = frame;
    const matched = results.filter((r) => r.match);
    const inFrame = matched.map((r) => r.match.member.id);
    const hits = matched
      .filter((r) => !locked.has(r.match.member.id) && r.face.box[2] >= ctx.settings.minCandidateFacePx)
      .map((r) => ({
        memberId: r.match.member.id,
        quality: quality(r.face, r.match.similarity, bitmap.width, bitmap.height),
        frame: bitmap,
        meta: { name: r.match.member.name, similarity: r.match.similarity, box: r.face.box, inFrame },
      }));
    const { confirmed, ended } = tracker.update(hits, ctx.now());
    if (!hits.length) bitmap.close(); // the tracker only owns frames it was given
    for (const id of confirmed) ctx.onConfirmed(id);
    await handleEnded(ctx, ended);
  },

  async stop(ctx) {
    if (!tracker) return;
    await handleEnded(ctx, tracker.flush());
    tracker.reset();
  },

  async onLocksChanged(ctx) {
    await loadLocks(ctx);
    for (const id of locked) tracker?.drop(id);
  },

  async onDayChanged(ctx) {
    tracker?.reset();
    await loadLocks(ctx);
  },

  // For status display and tests.
  get lockedIds() {
    return [...locked];
  },
};
