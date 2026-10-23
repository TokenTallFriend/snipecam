// [pure] Lookalikes (e.g. identical twins): members the face model can't tell apart.
// Members list each other in `lookalikes`. A face matching one of them may be any of them, so:
// - if a photo shows as many of them as there are, each face is one of them (who is who doesn't matter,
//   everyone in the photo gets tagged);
// - otherwise the face is "A or B?" and the user picks in the Inbox. Such catches are stored under a group key.

export const GROUP_PREFIX = 'lookalike:';

// All members linked to memberId, directly or through others (triplets), including itself. Sorted ids.
export function groupOf(memberId, byId) {
  const seen = new Set([memberId]);
  const queue = [memberId];
  while (queue.length) {
    for (const id of byId.get(queue.shift())?.lookalikes ?? []) {
      if (!seen.has(id) && byId.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
  }
  return [...seen].sort();
}

export const groupKey = (ids) => GROUP_PREFIX + [...ids].sort().join('+');

// Member ids in a group key, or null if `id` is an ordinary member id.
export function parseGroupKey(id) {
  return typeof id === 'string' && id.startsWith(GROUP_PREFIX) ? id.slice(GROUP_PREFIX.length).split('+') : null;
}

// "Ann or Amy?"
export function groupName(ids, byId) {
  return `${ids.map((id) => byId.get(id)?.name ?? 'Unknown').join(' or ')}?`;
}

// Stand-in member for an unresolved lookalike face.
export function groupMember(ids, byId) {
  return { id: groupKey(ids), name: groupName(ids, byId), lookalikeGroup: ids };
}

// A member id or group key is locked only when every person it could be is locked.
export function isLockedId(id, locked) {
  const ids = parseGroupKey(id);
  return ids ? ids.every((m) => locked.has(m)) : locked.has(id);
}
