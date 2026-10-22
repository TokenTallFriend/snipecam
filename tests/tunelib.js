// [pure] Threshold tuning math for tests/tune.html.

import { cosine } from '../js/matcher.js';

// samples: [{ person, embedding }]. person = null marks a stranger (only compared against named people).
// Returns similarity lists for same-person pairs and different-person pairs.
export function pairSimilarities(samples) {
  const same = [];
  const diff = [];
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const a = samples[i];
      const b = samples[j];
      if (a.person === null && b.person === null) continue;
      const s = cosine(a.embedding, b.embedding);
      if (a.person !== null && a.person === b.person) same.push(s);
      else diff.push(s);
    }
  }
  return { same, diff };
}

// Rates at a threshold: missRate = same-person pairs below it; falseMatchRate = different-person pairs at/above it.
export function ratesAt(threshold, { same, diff }) {
  const missRate = same.length ? same.filter((s) => s < threshold).length / same.length : 0;
  const falseMatchRate = diff.length ? diff.filter((s) => s >= threshold).length / diff.length : 0;
  return { missRate, falseMatchRate };
}

// Suggests the lowest threshold whose false-match rate is at most maxFalseMatch (default 0.1%).
// Strangers outnumber members on campus, so false matches cost more than misses (a miss just waits for the next frame).
export function suggestThreshold(pairs, maxFalseMatch = 0.001) {
  for (let t = 0.3; t <= 0.951; t += 0.01) {
    const threshold = Math.round(t * 100) / 100;
    const r = ratesAt(threshold, pairs);
    if (r.falseMatchRate <= maxFalseMatch) return { threshold, ...r };
  }
  return { threshold: 0.95, ...ratesAt(0.95, pairs) };
}

export function summary(values) {
  if (!values.length) return { n: 0, mean: 0, min: 0, max: 0 };
  return {
    n: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

// Histogram counts over [lo, hi) in `bins` buckets.
export function histogram(values, lo = -0.2, hi = 1, bins = 24) {
  const counts = new Array(bins).fill(0);
  const w = (hi - lo) / bins;
  for (const v of values) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)))]++;
  return { counts, lo, hi, w };
}

// Member-level scores, the way the app matches: each known person is enrolled from their first `enrollCount`
// photos; every other photo is a probe scored by its best similarity to each member's enrolled photos.
// same = a person's held-out photos vs their own member; diff = everyone else (incl. strangers) vs that member.
export function memberLevel(samples, enrollCount = 3) {
  const byPerson = new Map();
  for (const s of samples) if (s.person !== null) byPerson.set(s.person, [...(byPerson.get(s.person) ?? []), s]);
  const members = [...byPerson].filter(([, list]) => list.length > enrollCount)
    .map(([person, list]) => ({ person, enrolled: list.slice(0, enrollCount), probes: new Set(list.slice(enrollCount)) }));
  const enrolledSet = new Set(members.flatMap((m) => m.enrolled));
  const same = [];
  const diff = [];
  for (const m of members) {
    for (const s of samples) {
      if (enrolledSet.has(s)) continue;
      const score = Math.max(...m.enrolled.map((e) => cosine(s.embedding, e.embedding)));
      if (s.person === m.person) same.push(score);
      else diff.push(score);
    }
  }
  return { same, diff, members: members.length };
}
