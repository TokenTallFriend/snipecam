// IndexedDB storage: members (roster), candidates (caught photos, P4), locks (daily snipe locks, P4).
// Pure helpers (validateMember, normalizeSlack) touch no browser APIs, so Node can test them.

export const DB_NAME = 'snipecam';
export const EMBEDDING_SIZE = 1024;
const DB_VERSION = 1;

let dbName = DB_NAME;
let dbPromise = null;

// Opens (and on first run creates) the database. Tests pass a different name to stay isolated.
export function openDb(name = DB_NAME) {
  if (dbPromise && name === dbName) return dbPromise;
  dbName = name;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('members', { keyPath: 'id' });
      const candidates = db.createObjectStore('candidates', { keyPath: 'id' });
      candidates.createIndex('memberDay', ['memberId', 'day'], { unique: true });
      candidates.createIndex('day', 'day');
      const locks = db.createObjectStore('locks', { keyPath: ['memberId', 'day'] });
      locks.createIndex('day', 'day');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const request = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

const complete = (t) => new Promise((resolve, reject) => {
  t.oncomplete = () => resolve();
  t.onerror = t.onabort = () => reject(t.error);
});

async function transaction(stores, mode = 'readonly') {
  return (await openDb(dbName)).transaction(stores, mode);
}

// ---------- Members ----------

// [pure] "  @@Alice Smith " → "@AliceSmith"; empty stays empty.
export function normalizeSlack(handle) {
  const h = String(handle ?? '').replace(/\s+/g, '').replace(/^@+/, '');
  return h ? `@${h}` : '';
}

const isVector = (v) => Array.isArray(v) || ArrayBuffer.isView(v);

// [pure] Returns a list of problems with a member record (empty = valid).
export function validateMember(m) {
  if (!m || typeof m !== 'object') return ['not an object'];
  const errors = [];
  if (typeof m.id !== 'string' || !m.id) errors.push('missing id');
  if (typeof m.name !== 'string' || !m.name.trim()) errors.push('missing name');
  if (m.slack !== undefined && typeof m.slack !== 'string') errors.push('slack must be text');
  if (!Array.isArray(m.embeddings) || !m.embeddings.length) {
    errors.push('needs at least one face embedding');
  } else if (!m.embeddings.every((e) => isVector(e) && e.length === EMBEDDING_SIZE && Array.prototype.every.call(e, Number.isFinite))) {
    errors.push(`embeddings must be ${EMBEDDING_SIZE} numbers each`);
  }
  if (m.thumbs !== undefined && (!Array.isArray(m.thumbs) || !m.thumbs.every((t) => typeof t === 'string'))) errors.push('thumbs must be text');
  return errors;
}

function normalizeMember(m) {
  return {
    id: m.id,
    name: m.name.trim(),
    slack: normalizeSlack(m.slack),
    embeddings: m.embeddings.map((e) => Float32Array.from(e)),
    thumbs: m.thumbs ?? [],
    createdAt: m.createdAt ?? Date.now(),
    updatedAt: m.updatedAt ?? Date.now(),
  };
}

export async function listMembers() {
  const t = await transaction('members');
  const members = await request(t.objectStore('members').getAll());
  return members.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveMember(m) {
  const errors = validateMember(m);
  if (errors.length) throw new Error(`Invalid member: ${errors.join(', ')}`);
  const member = normalizeMember(m);
  const t = await transaction('members', 'readwrite');
  t.objectStore('members').put(member);
  await complete(t);
  return member;
}

// Deletes a member and everything stored about them (candidates, locks).
export async function deleteMember(id) {
  const t = await transaction(['members', 'candidates', 'locks'], 'readwrite');
  const range = IDBKeyRange.bound([id, ''], [id, '￿']);
  t.objectStore('members').delete(id);
  t.objectStore('locks').delete(range);
  const cursorReq = t.objectStore('candidates').index('memberDay').openCursor(range);
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  await complete(t);
}

export async function clearAll() {
  const t = await transaction(['members', 'candidates', 'locks'], 'readwrite');
  for (const s of ['members', 'candidates', 'locks']) t.objectStore(s).clear();
  await complete(t);
}

// ---------- Candidates (caught photos) ----------
// { id, memberId, day, jpeg: ArrayBuffer, thumb, quality, similarity, box, inFrame, seenAt, status: 'pending'|'dismissed' }
// The photo is stored as an ArrayBuffer (more portable across browsers' IndexedDB than a Blob).

export const candidateBlob = (c) => new Blob([c.jpeg], { type: 'image/jpeg' });

export async function getCandidate(memberId, day) {
  const t = await transaction('candidates');
  return (await request(t.objectStore('candidates').index('memberDay').get([memberId, day]))) ?? null;
}

// Saves a candidate. At most one per member per day: an existing one for that member/day is overwritten.
export async function putCandidate(c) {
  const t = await transaction('candidates', 'readwrite');
  const store = t.objectStore('candidates');
  const existing = await request(store.index('memberDay').get([c.memberId, c.day]));
  const record = { ...c, id: existing?.id ?? c.id };
  store.put(record);
  await complete(t);
  return record;
}

// Pending candidates (optionally for one day), newest first.
export async function listCandidates(day = null) {
  const t = await transaction('candidates');
  const all = day ? await request(t.objectStore('candidates').index('day').getAll(day)) : await request(t.objectStore('candidates').getAll());
  return all.filter((c) => c.status === 'pending').sort((a, b) => b.seenAt - a.seenAt);
}

export async function deleteCandidates(ids) {
  const t = await transaction('candidates', 'readwrite');
  for (const id of ids) t.objectStore('candidates').delete(id);
  await complete(t);
}

// "Wrong person": moves a candidate to another member (overwriting that member's pending one for the day).
export async function reassignCandidate(id, newMemberId) {
  const t = await transaction('candidates', 'readwrite');
  const store = t.objectStore('candidates');
  const c = await request(store.get(id));
  if (!c) throw new Error('candidate not found');
  const clash = await request(store.index('memberDay').get([newMemberId, c.day]));
  if (clash && clash.id !== id) store.delete(clash.id);
  const inFrame = [...new Set([newMemberId, ...(c.inFrame ?? []).filter((m) => m !== c.memberId)])];
  const moved = { ...c, memberId: newMemberId, inFrame, status: 'pending' };
  store.put(moved);
  await complete(t);
  return moved;
}

// Deletes today's candidates for these members (after they're tagged in a posted photo).
export async function deleteCandidatesFor(memberIds, day) {
  const t = await transaction('candidates', 'readwrite');
  const index = t.objectStore('candidates').index('memberDay');
  for (const memberId of memberIds) {
    const c = await request(index.get([memberId, day]));
    if (c) t.objectStore('candidates').delete(c.id);
  }
  await complete(t);
}

// "Not them": keeps the record (so the slot stays known) but marks it dismissed; a new sighting may replace it.
export async function dismissCandidates(ids) {
  const t = await transaction('candidates', 'readwrite');
  const store = t.objectStore('candidates');
  for (const id of ids) {
    const c = await request(store.get(id));
    if (c) store.put({ ...c, status: 'dismissed', jpeg: new ArrayBuffer(0), thumb: '' });
  }
  await complete(t);
}

// Rule 9: candidates from earlier days can't be posted; delete them. Returns how many were removed.
export async function purgeExpired(today) {
  const t = await transaction('candidates', 'readwrite');
  const range = IDBKeyRange.upperBound(today, true);
  const n = await request(t.objectStore('candidates').index('day').count(range));
  const cursorReq = t.objectStore('candidates').index('day').openCursor(range);
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  await complete(t);
  return n;
}

// ---------- Locks (member already sniped / not snipeable today) ----------
// { memberId, day, at, via: 'shared'|'saved'|'manual'|'sniped-me' }

export async function lock(memberIds, day, via, at = Date.now()) {
  const t = await transaction('locks', 'readwrite');
  for (const memberId of memberIds) t.objectStore('locks').put({ memberId, day, at, via });
  await complete(t);
}

export async function unlock(memberId, day) {
  const t = await transaction('locks', 'readwrite');
  t.objectStore('locks').delete([memberId, day]);
  await complete(t);
}

export async function listLocks(day) {
  const t = await transaction('locks');
  return request(t.objectStore('locks').index('day').getAll(day));
}

// ---------- Export / import (roster only) ----------

export async function exportJson() {
  const members = await listMembers();
  return JSON.stringify({
    app: 'snipecam',
    version: 1,
    exportedAt: new Date().toISOString(),
    members: members.map((m) => ({ ...m, embeddings: m.embeddings.map((e) => Array.from(e, (v) => Math.round(v * 1e5) / 1e5)) })),
  });
}

// Validates everything first; on any problem throws and leaves the database unchanged.
export async function importJson(text, { mode = 'merge' } = {}) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a SnipeCam roster file (invalid JSON)');
  }
  if (data?.app !== 'snipecam' || data.version !== 1 || !Array.isArray(data.members)) {
    throw new Error('Not a SnipeCam roster file');
  }
  data.members.forEach((m, i) => {
    const errors = validateMember(m);
    if (errors.length) throw new Error(`Member ${i + 1} (${m?.name ?? '?'}): ${errors.join(', ')}`);
  });
  const existing = new Set((await listMembers()).map((m) => m.id));
  const t = await transaction('members', 'readwrite');
  const store = t.objectStore('members');
  if (mode === 'replace') store.clear();
  let added = 0;
  let updated = 0;
  for (const m of data.members) {
    store.put(normalizeMember(m));
    if (existing.has(m.id) && mode !== 'replace') updated++;
    else added++;
  }
  await complete(t);
  return { added, updated };
}
