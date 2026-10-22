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
