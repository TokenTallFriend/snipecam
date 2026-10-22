// [pure] Game rules (Sniping Rules, Spring 2026) as app behavior. All game logic lives here.

const pad = (n) => String(n).padStart(2, '0');

// Rule 9: a game day is the local calendar date; snipes must be posted before midnight.
export function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function msUntilDeadline(now) {
  const d = new Date(now);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return midnight - d;
}

export function isExpired(candidate, now) {
  return candidate.day !== dayKey(now);
}

// A better-quality photo may replace a pending one only if it's at least about as surely the same person,
// so a sharp photo of a lookalike can't push out a real catch.
export const SIMILARITY_GUARD = 0.03;

// Rule 8 (once per day) + keep the best photo: what to do with a finished sighting.
export function decide({ existing, locked, incoming }) {
  if (locked) return 'discard';
  if (!existing || existing.status === 'dismissed') return 'keep';
  if (incoming.quality > existing.quality && incoming.similarity >= existing.similarity - SIMILARITY_GUARD) return 'replace';
  return 'discard';
}

// Rule 4: tag everyone recognized in the photo. Members already sniped today are flagged for the user to decide.
export function tags(candidate, lockedIds) {
  const locked = new Set(lockedIds);
  const everyone = [...new Set([candidate.memberId, ...(candidate.inFrame ?? [])])];
  return { tag: everyone.filter((id) => !locked.has(id)), flagged: everyone.filter((id) => locked.has(id)) };
}

// Daily post-by-midnight reminder: due once per day after reminderAt ("HH:MM").
export function reminderDue(now, reminderAt, lastReminderDay) {
  const d = new Date(now);
  const [h, m] = reminderAt.split(':').map(Number);
  return lastReminderDay !== dayKey(d) && d.getHours() * 60 + d.getMinutes() >= h * 60 + m;
}

// Rule 1c: within padMin minutes of a rehearsal's start or end (flag only; the rule is location-based).
// rehearsals: [{ weekday: 0-6 (Sun-Sat), start: 'HH:MM', end: 'HH:MM' }]
export function inRehearsalWindow(date, rehearsals, padMin = 30) {
  const d = new Date(date);
  const minutes = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return rehearsals.some((r) => r.weekday === d.getDay() &&
    minutes >= toMin(r.start) - padMin && minutes <= toMin(r.end) + padMin);
}
