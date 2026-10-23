// [pure] Merging an imported roster into this device's roster, so rosters built on several devices grow together.
//
// - Match by id, then by name (case/space-insensitive).
// - Photos are combined: the same photo coming back (same embedding) is skipped, so re-importing is harmless.
// - The local member keeps its id (its catches and locks stay attached), name, and Slack handle; an empty
//   handle is filled from the import.
// - Same name but clearly a different face → kept as a separate member and reported as a conflict.
// - Additive only: deletions on one device don't propagate.

import { cosine } from './matcher.js';

export const MAX_PHOTOS = 30;
export const SAME_PHOTO = 0.995; // exported embeddings are rounded to 1e-5, so a round-tripped photo scores ~1.0
export const SAME_PERSON = 0.5; // a same-name match must look at least this alike somewhere, or it's a conflict

export const nameKey = (name) => String(name ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

const isDuplicate = (e, list) => list.some((x) => cosine(e, x) >= SAME_PHOTO);
const bestSimilarity = (a, b) => Math.max(-1, ...a.flatMap((x) => b.map((y) => cosine(x, y))));

// Adds incoming photos (embedding + thumb pairs) to a member, skipping duplicates, up to MAX_PHOTOS.
function combine(local, incoming) {
  const embeddings = [...local.embeddings];
  const thumbs = [...(local.thumbs ?? [])];
  let added = 0;
  let duplicates = 0;
  let overCap = 0;
  incoming.embeddings.forEach((e, i) => {
    if (isDuplicate(e, embeddings)) duplicates++;
    else if (embeddings.length >= MAX_PHOTOS) overCap++;
    else {
      embeddings.push(e);
      thumbs[embeddings.length - 1] = incoming.thumbs?.[i] ?? '';
      added++;
    }
  });
  return { member: { ...local, embeddings, thumbs: thumbs.slice(0, embeddings.length) }, added, duplicates, overCap };
}

function uniqueName(name, taken) {
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
}

// local, incoming: Member[]. newId(): id for members added from the import when their id is already used.
// Returns { changed: Member[] (to save), report }.
export function mergeRosters(local, incoming, { newId }) {
  const byId = new Map(local.map((m) => [m.id, m]));
  const byName = new Map();
  for (const m of local) byName.set(nameKey(m.name), [...(byName.get(nameKey(m.name)) ?? []), m]);
  const takenNames = new Set(local.map((m) => nameKey(m.name)));
  const current = new Map(local.map((m) => [m.id, m])); // latest version of each local member
  const changed = new Map();
  const report = { added: 0, merged: 0, unchanged: 0, photosAdded: 0, duplicatesSkipped: 0, overCap: 0, conflicts: [] };

  for (const inc of incoming) {
    const sameName = byName.get(nameKey(inc.name)) ?? [];
    let target = byId.get(inc.id) ?? (sameName.length === 1 ? sameName[0] : null);
    if (target && target.id !== inc.id && bestSimilarity(target.embeddings, inc.embeddings) < SAME_PERSON) {
      report.conflicts.push(`${inc.name}: imported photos don't match the existing ${target.name}, so added separately`);
      target = null;
    } else if (!target && sameName.length > 1) {
      report.conflicts.push(`${inc.name}: several members already have this name, so added separately`);
    }

    if (target) {
      const base = current.get(target.id);
      const r = combine(base, inc);
      const slack = base.slack || inc.slack || '';
      report.photosAdded += r.added;
      report.duplicatesSkipped += r.duplicates;
      report.overCap += r.overCap;
      if (r.added || slack !== base.slack) {
        const updated = { ...r.member, slack, updatedAt: Math.max(base.updatedAt ?? 0, inc.updatedAt ?? 0) };
        current.set(target.id, updated);
        if (!changed.has(target.id)) report.merged++;
        changed.set(target.id, updated);
      } else if (!changed.has(target.id)) {
        report.unchanged++;
      }
    } else {
      const name = takenNames.has(nameKey(inc.name)) ? uniqueName(inc.name, takenNames) : inc.name;
      const id = current.has(inc.id) ? newId() : inc.id;
      const added = { ...inc, id, name, embeddings: inc.embeddings.slice(0, MAX_PHOTOS), thumbs: (inc.thumbs ?? []).slice(0, MAX_PHOTOS) };
      report.overCap += Math.max(0, inc.embeddings.length - MAX_PHOTOS);
      report.added++;
      report.photosAdded += added.embeddings.length;
      takenNames.add(nameKey(name));
      current.set(id, added);
      changed.set(id, added);
      byId.set(id, added);
      if (!byName.has(nameKey(name))) byName.set(nameKey(name), [added]);
    }
  }
  return { changed: [...changed.values()], report };
}

// [pure] One-line summary for a toast.
export function describeMerge(r) {
  const parts = [`${r.added} added`, `${r.merged} updated (+${r.photosAdded} photo${r.photosAdded === 1 ? '' : 's'})`];
  if (r.duplicatesSkipped) parts.push(`${r.duplicatesSkipped} already had`);
  if (r.overCap) parts.push(`${r.overCap} over the ${MAX_PHOTOS}-photo limit`);
  if (r.conflicts.length) parts.push(`${r.conflicts.length} name conflict${r.conflicts.length === 1 ? '' : 's'}`);
  return `Imported: ${parts.join(', ')}`;
}
