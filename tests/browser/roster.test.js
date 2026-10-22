import { test, assert, skip } from '../harness.js';
import * as db from '../../js/db.js';
import { enrollFromFiles } from '../../js/enroll.js';
import { bestMatch } from '../../js/matcher.js';
import { DEFAULTS } from '../../js/settings.js';
import { EMBEDDING_SIZE } from '../../js/db.js';

// Detector is initialized by detector.test.js, which runs first.

const vec = (v) => new Array(EMBEDDING_SIZE).fill(v);
const member = (id, name) => ({ id, name, slack: name.toLowerCase(), embeddings: [vec(0.1)], thumbs: ['data:image/jpeg;base64,'] });

async function fixtureFile(path) {
  const res = await fetch(path);
  if (!res.ok) skip(`fixture ${path} missing (run tools/fetch-fixtures.sh)`);
  return new File([await res.blob()], path.split('/').pop(), { type: 'image/jpeg' });
}

test('T-DB-1', 'member save → list → delete (delete cascades)', async () => {
  await db.openDb('snipecam-test');
  await db.clearAll();
  await db.saveMember(member('a', 'Alice'));
  await db.saveMember(member('b', 'Bob'));
  let list = await db.listMembers();
  assert.deepEqual(list.map((m) => m.name), ['Alice', 'Bob']);
  assert.equal(list[0].slack, '@alice');
  assert.ok(list[0].embeddings[0] instanceof Float32Array, 'embeddings stored as Float32Array');
  await db.deleteMember('a');
  list = await db.listMembers();
  assert.deepEqual(list.map((m) => m.id), ['b']);
});

test('T-DB-2', 'export → clear → import restores the roster', async () => {
  const before = await db.listMembers();
  const json = await db.exportJson();
  await db.clearAll();
  assert.equal((await db.listMembers()).length, 0);
  const r = await db.importJson(json);
  assert.deepEqual(r, { added: 1, updated: 0 });
  const after = await db.listMembers();
  assert.equal(after.length, before.length);
  assert.equal(after[0].name, before[0].name);
  assert.ok(Math.abs(after[0].embeddings[0][5] - before[0].embeddings[0][5]) < 1e-4);
});

test('T-DB-3', 'merge-importing the same file twice adds no duplicates', async () => {
  const json = await db.exportJson();
  const r = await db.importJson(json, { mode: 'merge' });
  assert.deepEqual(r, { added: 0, updated: 1 });
  assert.equal((await db.listMembers()).length, 1);
});

test('T-DB-5', 'malformed import → error, database unchanged', async () => {
  const before = await db.exportJson();
  await assert.throws(() => db.importJson('{nope'));
  await assert.throws(() => db.importJson(JSON.stringify({ app: 'other', version: 1, members: [] })));
  const bad = JSON.parse(before);
  bad.members.push({ id: 'z', name: 'Zed', embeddings: [[1, 2]] });
  await assert.throws(() => db.importJson(JSON.stringify(bad)));
  assert.equal((await db.listMembers()).length, 1);
});

test('T-ENR-1', 'single clear face → used, with thumbnail', async () => {
  const [r] = await enrollFromFiles([await fixtureFile('fixtures/single.jpg')]);
  assert.equal(r.status, 'used', r.note);
  assert.equal(r.embedding.length, EMBEDDING_SIZE);
  assert.ok(r.thumb.startsWith('data:image/jpeg'));
});

test('T-ENR-2', 'blank image → skipped "No face found"', async () => {
  const [r] = await enrollFromFiles([new File([await (await fetch('fixtures/blank.png')).blob()], 'blank.png', { type: 'image/png' })]);
  assert.equal(r.status, 'skipped');
  assert.equal(r.note, 'No face found');
});

test('T-ENR-3', 'group photo → largest face used with "Several faces" note', async () => {
  const [r] = await enrollFromFiles([await fixtureFile('fixtures/group.jpg')]);
  assert.equal(r.status, 'used', r.note);
  assert.ok(/Several faces/.test(r.note), r.note);
});

test('T-MAT-7', 'real faces: enrolled people recognized, stranger not matched (default threshold)', async () => {
  const enroll = async (name, paths) => {
    const results = await enrollFromFiles(await Promise.all(paths.map(fixtureFile)));
    return { id: name, name, embeddings: results.filter((r) => r.status === 'used').map((r) => r.embedding) };
  };
  const members = [
    await enroll('A', ['fixtures/people/emotions-a/1.jpg', 'fixtures/people/emotions-a/2.jpg', 'fixtures/people/emotions-a/3.jpg']),
    await enroll('B', ['fixtures/people/emotions-b/1.jpg', 'fixtures/people/emotions-b/2.jpg', 'fixtures/people/emotions-b/3.jpg']),
  ];
  const probe = async (path) => (await enrollFromFiles([await fixtureFile(path)]))[0].embedding;
  const opts = { threshold: DEFAULTS.threshold, margin: DEFAULTS.margin };
  const a = bestMatch(await probe('fixtures/people/emotions-a/5.jpg'), members, opts);
  const b = bestMatch(await probe('fixtures/people/emotions-b/5.jpg'), members, opts);
  const stranger = bestMatch(await probe('fixtures/people/vlado/1.jpg'), members, opts);
  assert.equal(a?.member.id, 'A', 'A not recognized');
  assert.equal(b?.member.id, 'B', 'B not recognized');
  assert.equal(stranger, null, `stranger matched ${stranger?.member.id}`);
  return `A ${a.similarity.toFixed(2)}, B ${b.similarity.toFixed(2)}`;
});
