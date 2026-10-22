// [pure] Sighting sessions: turns a stream of per-frame member matches into one best frame per pass.
//
// A session starts at a member's first match and continues while matches arrive at most gapSec apart.
// It counts only if it reaches minHits matches (filters one-frame false matches). Only the best-quality
// frame is held. Frames are opaque objects shared between members in the same tick, so the tracker
// reference-counts them and calls onDispose(frame) once nothing holds a frame any more.
//
// Once a session is confirmed, `improved` reports its best frame whenever it gets better (including at
// confirmation), so a photo can be saved while the person is still in view.
//
// Ownership: every frame passed to update() belongs to the tracker. Each `ended` and `improved` entry hands
// one reference to the caller, who must call release(frame) when done with it.

export function createTracker({ minHits, gapSec, onDispose }) {
  const gapMs = gapSec * 1000;
  const sessions = new Map(); // memberId → { start, last, hits, best: { frame, quality, meta }, confirmed }
  const refs = new Map(); // frame → count

  const retain = (frame) => refs.set(frame, (refs.get(frame) ?? 0) + 1);
  function release(frame) {
    const n = (refs.get(frame) ?? 0) - 1;
    if (n > 0) {
      refs.set(frame, n);
    } else {
      refs.delete(frame);
      onDispose(frame);
    }
  }

  function end(memberId, s, ended) {
    sessions.delete(memberId);
    if (s.hits >= minHits) {
      ended.push({ memberId, frame: s.best.frame, quality: s.best.quality, meta: s.best.meta, hits: s.hits, start: s.start, end: s.last });
    } else {
      release(s.best.frame);
    }
  }

  return {
    // hits: [{ memberId, quality, frame, meta }]. Call every tick, even with [], so stale sessions end.
    update(hits, now) {
      const confirmed = [];
      const ended = [];
      const changed = new Set(); // confirmed sessions whose best frame changed this tick
      for (const hit of hits) {
        let s = sessions.get(hit.memberId);
        if (s && now - s.last > gapMs) {
          end(hit.memberId, s, ended);
          s = null;
        }
        if (!s) {
          s = { start: now, last: now, hits: 0, best: null, confirmed: false };
          sessions.set(hit.memberId, s);
        }
        s.hits++;
        s.last = now;
        if (!s.best || hit.quality > s.best.quality) {
          retain(hit.frame);
          if (s.best) release(s.best.frame);
          s.best = { frame: hit.frame, quality: hit.quality, meta: hit.meta };
          if (s.confirmed) changed.add(hit.memberId);
        }
        if (!s.confirmed && s.hits >= minHits) {
          s.confirmed = true;
          confirmed.push(hit.memberId);
          changed.add(hit.memberId);
        }
      }
      const improved = [];
      for (const memberId of changed) {
        const s = sessions.get(memberId);
        retain(s.best.frame);
        improved.push({ memberId, frame: s.best.frame, quality: s.best.quality, meta: s.best.meta, hits: s.hits, start: s.start, end: s.last });
      }
      for (const [memberId, s] of sessions) {
        if (now - s.last > gapMs) end(memberId, s, ended);
      }
      // Frames nobody kept are disposed now.
      for (const frame of new Set(hits.map((h) => h.frame))) {
        if (!refs.has(frame)) onDispose(frame);
      }
      return { confirmed, improved, ended };
    },

    release,

    // Ends one member's session without reporting it (e.g. they were just locked for the day).
    drop(memberId) {
      const s = sessions.get(memberId);
      if (!s) return;
      sessions.delete(memberId);
      release(s.best.frame);
    },

    // Ends all sessions now (on Stop), reporting those with enough hits.
    flush() {
      const ended = [];
      for (const [memberId, s] of [...sessions]) end(memberId, s, ended);
      return ended;
    },

    reset() {
      for (const s of sessions.values()) release(s.best.frame);
      sessions.clear();
    },

    get activeCount() {
      return sessions.size;
    },
  };
}
