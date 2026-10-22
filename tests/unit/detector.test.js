import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanConfig, toFaces, quality, HUMAN_VERSION } from '../../js/detector.js';
import { cropRect } from '../../js/capture.js';

test('T-DET-5: quality increases with face size, detector score, and similarity', () => {
  const f = (w, score) => ({ box: [0, 0, w, w], score });
  const q = (face, sim) => quality(face, sim, 1920, 1080);
  assert.ok(q(f(200, 0.9), 0.7) > q(f(100, 0.9), 0.7), 'size');
  assert.ok(q(f(100, 0.95), 0.7) > q(f(100, 0.6), 0.7), 'score');
  assert.ok(q(f(100, 0.9), 0.8) > q(f(100, 0.9), 0.6), 'similarity');
});

test('T-DET-8: Human config enables only face detector, mesh, description; pins version', () => {
  const c = humanConfig({ backend: 'webgl', maxDetected: 7, minFacePx: 40 });
  assert.equal(c.backend, 'webgl');
  assert.ok(c.modelBasePath.includes(`@${HUMAN_VERSION}/`));
  assert.equal(c.face.detector.maxDetected, 7);
  assert.equal(c.face.detector.minSize, 40);
  for (const k of ['detector', 'mesh', 'description']) assert.equal(c.face[k].enabled, true, k);
  for (const k of ['iris', 'emotion', 'antispoof', 'liveness', 'gear', 'attention']) assert.equal(c.face[k].enabled, false, k);
  for (const k of ['body', 'hand', 'object', 'segmentation', 'gesture', 'filter']) assert.equal(c[k].enabled, false, k);
});

test('T-DET-9: toFaces maps results, rounds boxes, drops small faces, converts embeddings', () => {
  const faces = toFaces([
    { box: [10.4, 20.6, 50.2, 60.1], score: 0.9, embedding: [0.1, 0.2] },
    { box: [0, 0, 30, 30], score: 0.8, embedding: [0.3] },
    { box: [5, 5, 80, 80], score: 0.7 },
  ], 40);
  assert.equal(faces.length, 2);
  assert.deepEqual(faces[0].box, [10, 21, 50, 60]);
  assert.ok(faces[0].embedding instanceof Float32Array);
  assert.equal(faces[1].embedding, null);
  assert.deepEqual(toFaces(undefined), []);
});

test('T-CAP-3: cropRect zoom 2 → centered half-size crop; zoom 1 → full frame', () => {
  assert.deepEqual(cropRect(1920, 1080, 2), { x: 480, y: 270, w: 960, h: 540 });
  assert.deepEqual(cropRect(1920, 1080, 1), { x: 0, y: 0, w: 1920, h: 1080 });
  assert.deepEqual(cropRect(1080, 1920, 1.5), { x: 180, y: 320, w: 720, h: 1280 });
});

import { tileRects, dedupe } from '../../js/detector.js';

test('T-DET-10: tileRects covers the whole frame with overlapping tiles', () => {
  const rects = tileRects(1920, 1080, 2);
  assert.equal(rects.length, 4);
  assert.deepEqual(rects[0], { x: 0, y: 0, w: 1200, h: 675 });
  assert.deepEqual(rects[3], { x: 720, y: 405, w: 1200, h: 675 });
  for (const r of rects) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1920 && r.y + r.h <= 1080);
  assert.equal(tileRects(1920, 1080, 3).length, 9);
  // Adjacent tiles overlap, so a face on the seam is whole in at least one tile
  assert.ok(rects[0].x + rects[0].w > rects[1].x);
});

test('T-DET-11: dedupe merges overlapping boxes and keeps the larger one', () => {
  const f = (box, score = 0.9) => ({ box, score, embedding: null });
  const out = dedupe([
    f([100, 100, 50, 50]),          // partial copy of the next face
    f([95, 95, 70, 70]),            // whole face
    f([400, 400, 60, 60]),          // separate face
    f([455, 400, 60, 60]),          // neighbor: overlaps only 5/60 → kept
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((x) => x.box[0]).sort((a, b) => a - b), [95, 400, 455]);
  assert.deepEqual(dedupe([]), []);
});

import { expandRect } from '../../js/detector.js';

test('T-DET-14: expandRect makes a centered square crop, clamped inside the image', () => {
  assert.deepEqual(expandRect([100, 100, 50, 60], 2, 1920, 1080), { x: 65, y: 70, w: 120, h: 120 });
  assert.deepEqual(expandRect([0, 0, 50, 50], 2, 1920, 1080), { x: 0, y: 0, w: 100, h: 100 });       // top-left edge
  assert.deepEqual(expandRect([1900, 1060, 20, 20], 2, 1920, 1080), { x: 1880, y: 1040, w: 40, h: 40 }); // bottom-right edge
  assert.deepEqual(expandRect([0, 0, 800, 800], 2, 1920, 1080), { x: 0, y: 0, w: 1080, h: 1080 });   // capped at image size
});
