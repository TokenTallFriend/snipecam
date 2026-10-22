import { test, assert, skip } from '../harness.js';
import { initDetector, detect } from '../../js/detector.js';

let backend = null;

async function loadImage(path) {
  const res = await fetch(path, { method: 'HEAD' });
  if (!res.ok) skip(`fixture ${path} missing (run tools/fetch-fixtures.sh)`);
  const img = new Image();
  img.src = path;
  await img.decode();
  return createImageBitmap(img);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / Math.sqrt(na * nb);
}

async function embeddingOf(path) {
  const faces = await detect(await loadImage(path));
  assert.ok(faces.length >= 1, `no face in ${path}`);
  faces.sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]);
  return faces[0].embedding;
}

test('T-DET-1', 'initDetector resolves with webgpu or webgl', async () => {
  const t0 = performance.now();
  backend = await initDetector({ backend: 'webgpu', maxDetected: 20, minFacePx: 20 });
  assert.ok(['webgpu', 'webgl'].includes(backend), `backend ${backend}`);
  return `${backend}, loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
});

test('T-DET-7', 'without WebGPU, falls back to WebGL', async () => {
  if ('gpu' in navigator && backend === 'webgpu') skip('this browser has WebGPU; fallback exercised in browsers without it');
  assert.equal(backend, 'webgl');
});

test('T-DET-2', 'blank image → no faces', async () => {
  const faces = await detect(await loadImage('fixtures/blank.png'));
  assert.equal(faces.length, 0);
});

test('T-DET-3', 'group photo (2×2 tiles) → many faces, each with a 1024-d embedding', async () => {
  const faces = await detect(await loadImage('fixtures/group.jpg'), { tiles: 2 });
  assert.ok(faces.length >= 13, `only ${faces.length} faces`); // baseline: 13 of ~16 (a few are occluded)
  for (const f of faces) {
    assert.ok(f.embedding, 'face missing embedding');
    assert.equal(f.embedding.length, 1024);
  }
  return `${faces.length} faces`;
});

test('T-DET-4', 'same-person similarity > different-person similarity', async () => {
  const a1 = await embeddingOf('fixtures/people/emotions-a/1.jpg');
  const a2 = await embeddingOf('fixtures/people/emotions-a/2.jpg');
  const b1 = await embeddingOf('fixtures/people/emotions-b/1.jpg');
  const same = cosine(a1, a2);
  const diff = cosine(a1, b1);
  assert.ok(same > diff, `same ${same.toFixed(3)} <= diff ${diff.toFixed(3)}`);
  return `same ${same.toFixed(3)}, different ${diff.toFixed(3)}`;
});

test('T-DET-6', 'detect time on single-face photo (benchmark, 10 runs)', async () => {
  const bmp = await loadImage('fixtures/single.jpg');
  await detect(bmp);
  const times = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    await detect(bmp);
    times.push(performance.now() - t0);
  }
  const mean = times.reduce((a, b) => a + b) / times.length;
  return `mean ${mean.toFixed(0)} ms (${backend})`;
});

// Simulates distance: the group photo shrunk into a 1080p frame (faces ~55–100 px).
async function distantFrame(scale) {
  const img = await loadImage('fixtures/group.jpg');
  const c = new OffscreenCanvas(1920, 1080);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#777';
  ctx.fillRect(0, 0, 1920, 1080);
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, (1920 - w) / 2, (1080 - h) / 2, w, h);
  return createImageBitmap(c);
}

test('T-DET-12', 'distant faces (group at 50% in 1080p): tiles find more than full frame', async () => {
  const bmp = await distantFrame(0.5);
  const full = (await detect(bmp, { tiles: 1 })).length;
  const t2 = (await detect(bmp, { tiles: 2 })).length;
  const t3 = (await detect(bmp, { tiles: 3 })).length;
  assert.ok(t2 > full, `2×2 (${t2}) not better than full (${full})`);
  assert.ok(t2 >= 8, `2×2 found only ${t2}`);
  return `full ${full}, 2×2 ${t2}, 3×3 ${t3} (of ~16)`;
});

test('T-DET-13', 'tiled detect time on a 1080p frame (benchmark, 5 runs)', async () => {
  const bmp = await distantFrame(0.5);
  const out = [];
  for (const tiles of [1, 2]) {
    await detect(bmp, { tiles });
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) await detect(bmp, { tiles });
    out.push(`${tiles === 1 ? 'full' : '2×2'} ${((performance.now() - t0) / 5).toFixed(0)} ms`);
  }
  return out.join(', ');
});
