// [pure] Face matching: compares a face embedding against enrolled members.

import { groupOf, groupKey, groupMember } from './lookalikes.js';

export function cosine(a, b) {
  if (a.length !== b.length) throw new Error(`embedding length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Best similarity between an embedding and any of a member's enrolled embeddings (−1 if none).
export function memberScore(embedding, member) {
  let best = -1;
  for (const e of member.embeddings ?? []) best = Math.max(best, cosine(embedding, e));
  return best;
}

// Ranks all members for one embedding. Returns { top, runnerUp } (either may be null).
// runnerUp is the best member outside top's lookalike group: lookalikes are expected to score alike.
export function rank(embedding, members) {
  const scored = members
    .filter((m) => m.embeddings?.length)
    .map((member) => ({ member, similarity: memberScore(embedding, member) }))
    .sort((a, b) => b.similarity - a.similarity);
  const top = scored[0] ?? null;
  if (!top) return { top: null, runnerUp: null };
  const group = new Set(groupOf(top.member.id, new Map(members.map((m) => [m.id, m]))));
  return { top, runnerUp: scored.find((s) => !group.has(s.member.id)) ?? null };
}

// The matching member, or null if below threshold or too close to the runner-up to be sure.
export function bestMatch(embedding, members, { threshold, margin }) {
  const { top, runnerUp } = rank(embedding, members);
  if (!top || top.similarity < threshold) return null;
  if (runnerUp && top.similarity - runnerUp.similarity < margin) return null;
  return { member: top.member, similarity: top.similarity };
}

// For each face: { face, top (best candidate regardless of threshold, for debug), match (or null) }.
// Lookalike matches are then resolved per frame (resolveLookalikes).
export function matchFaces(faces, members, opts) {
  const results = faces.map((face) => {
    if (!face.embedding) return { face, top: null, match: null };
    const { top } = rank(face.embedding, members);
    return { face, top, match: bestMatch(face.embedding, members, opts) };
  });
  return resolveLookalikes(results, members);
}

// Within each lookalike group: if the frame has a face for every member, give each face a different member
// (best-scoring pairs first); otherwise those faces become "A or B?" (a stand-in member with a group key).
export function resolveLookalikes(results, members) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const groups = new Map(); // group key → indexes of results matched into that group
  results.forEach((r, i) => {
    if (!r.match) return;
    const ids = groupOf(r.match.member.id, byId);
    if (ids.length < 2) return;
    const key = groupKey(ids);
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const out = [...results];
  for (const idxs of groups.values()) {
    const ids = groupOf(results[idxs[0]].match.member.id, byId);
    if (idxs.length >= ids.length) {
      const pairs = idxs.flatMap((i) => ids.map((id) => ({ i, id, s: memberScore(results[i].face.embedding, byId.get(id)) })))
        .sort((a, b) => b.s - a.s);
      const usedFaces = new Set();
      const usedIds = new Set();
      for (const p of pairs) {
        if (usedFaces.has(p.i) || usedIds.has(p.id)) continue;
        usedFaces.add(p.i);
        usedIds.add(p.id);
        out[p.i] = { ...results[p.i], match: { member: byId.get(p.id), similarity: p.s } };
      }
      continue; // extra faces beyond the group size keep their own match
    }
    for (const i of idxs) out[i] = { ...results[i], match: { ...results[i].match, member: groupMember(ids, byId) } };
  }
  return out;
}
