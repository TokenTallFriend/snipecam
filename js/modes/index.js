// Mode registry. A mode receives every watch-loop tick and decides what to do with recognized members.
//
// Mode interface:
//   id, label
//   start(ctx)                  watching begins
//   tick(ctx, frame, results)   every tick; takes ownership of frame.bitmap (must close it or hand it on)
//   stop(ctx)                   watching ends; flush state
//   onLocksChanged(ctx)         a member was locked/unlocked
//   onDayChanged(ctx)           local midnight passed
//
// ctx: { db, settings, now(), onConfirmed(memberId), onCandidate(candidate), log }
// To add a mode: create js/modes/<name>.js, register it here, and add its id to MODES in settings.js.

import tripod from './tripod.js';

export const MODES = { tripod };

export function getMode(id) {
  return MODES[id] ?? MODES.tripod;
}
