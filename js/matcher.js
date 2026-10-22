// [pure] Face matching: compares a face embedding against enrolled members.

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
export function rank(embedding, members) {
  let top = null;
  let runnerUp = null;
  for (const member of members) {
    if (!member.embeddings?.length) continue;
    const similarity = memberScore(embedding, member);
    if (!top || similarity > top.similarity) {
      runnerUp = top;
      top = { member, similarity };
    } else if (!runnerUp || similarity > runnerUp.similarity) {
      runnerUp = { member, similarity };
    }
  }
  return { top, runnerUp };
}

// The matching member, or null if below threshold or too close to the runner-up to be sure.
export function bestMatch(embedding, members, { threshold, margin }) {
  const { top, runnerUp } = rank(embedding, members);
  if (!top || top.similarity < threshold) return null;
  if (runnerUp && top.similarity - runnerUp.similarity < margin) return null;
  return { member: top.member, similarity: top.similarity };
}

// For each face: { face, top (best candidate regardless of threshold, for debug), match (or null) }.
export function matchFaces(faces, members, opts) {
  return faces.map((face) => {
    if (!face.embedding) return { face, top: null, match: null };
    const { top } = rank(face.embedding, members);
    return { face, top, match: bestMatch(face.embedding, members, opts) };
  });
}
