// Face detection + embeddings via the Human library (pinned version, loaded from jsDelivr).

import { log } from './log.js';

export const HUMAN_VERSION = '3.3.6';
const CDN = `https://cdn.jsdelivr.net/npm/@vladmandic/human@${HUMAN_VERSION}`;

let human = null;
let minFace = 0;

// [pure] Human config: face detector + mesh (for alignment) + description (embedding). Everything else off.
// The default detector (blazeface.json) is already MediaPipe's long-range "back camera" model.
export function humanConfig({ backend, maxDetected, minFacePx }) {
  const off = { enabled: false };
  return {
    backend,
    modelBasePath: `${CDN}/models/`,
    debug: false,
    warmup: 'face',
    cacheModels: true, // models stored in IndexedDB after first download
    cacheSensitivity: 0, // frames are ~0.5 s apart; always run full detection
    filter: off,
    gesture: off,
    face: {
      enabled: true,
      detector: { enabled: true, rotation: false, maxDetected, minConfidence: 0.5, minSize: minFacePx, skipFrames: 0, skipTime: 0, return: false },
      mesh: { enabled: true },
      description: { enabled: true, skipFrames: 0, skipTime: 0 },
      attention: off, iris: off, emotion: off, antispoof: off, liveness: off, gear: off,
    },
    body: off, hand: off, object: off, segmentation: off,
  };
}

// Loads the library and models. Tries WebGPU first (if requested), then WebGL. Returns the backend used.
export async function initDetector({ backend = 'webgpu', maxDetected = 10, minFacePx = 40, onProgress } = {}) {
  minFace = minFacePx;
  onProgress?.(5, 'Loading face library…');
  const { default: Human } = await import(`${CDN}/dist/human.esm.js`);
  const candidates = backend === 'webgpu' ? ['webgpu', 'webgl'] : ['webgl'];
  for (const b of candidates) {
    try {
      const h = new Human(humanConfig({ backend: b, maxDetected, minFacePx }));
      onProgress?.(15, `Loading models (${b})…`);
      await h.load();
      onProgress?.(70, 'Warming up…');
      await h.warmup();
      const actual = h.tf.getBackend();
      if (actual !== b) throw new Error(`requested ${b}, got ${actual}`);
      human = h;
      onProgress?.(100, 'Ready');
      return b;
    } catch (err) {
      log(`Backend ${b} failed: ${err.message}`, 'warn');
    }
  }
  throw new Error('No compute backend available (WebGPU and WebGL both failed)');
}

// Per-call stage toggles. Human merges per-call config into its own, so both stages set every flag explicitly.
const FIND = { face: { mesh: { enabled: false }, description: { enabled: false } } };
const DESCRIBE = { face: { mesh: { enabled: true }, description: { enabled: true } } };

// Detects faces in an ImageBitmap and computes an embedding for each. Boxes are in input pixels.
// Stage 1 (cheap): find face boxes on the full frame, plus an n×n grid of zoomed tiles when tiles > 1,
//   because the detector shrinks its input to 256 px and misses distant faces in a full 1080p frame.
// Stage 2: for each unique face, run mesh + embedding once on an enlarged crop around it.
export async function detect(input, { tiles = 1 } = {}) {
  if (!human) throw new Error('detector not initialized');
  const found = await findFaces(input, tiles);
  const faces = [];
  for (const f of found) faces.push(await describe(input, f));
  return faces;
}

async function findFaces(input, tiles) {
  const found = toFaces((await human.detect(input, FIND)).face, minFace);
  for (const r of tiles > 1 ? tileRects(input.width, input.height, tiles) : []) {
    const tile = await createImageBitmap(input, r.x, r.y, r.w, r.h);
    try {
      for (const f of toFaces((await human.detect(tile, FIND)).face, minFace)) {
        found.push({ ...f, box: [f.box[0] + r.x, f.box[1] + r.y, f.box[2], f.box[3]] });
      }
    } finally {
      tile.close();
    }
  }
  return dedupe(found);
}

async function describe(input, face) {
  const r = expandRect(face.box, 2, input.width, input.height);
  const crop = await createImageBitmap(input, r.x, r.y, r.w, r.h);
  try {
    const inCrop = toFaces((await human.detect(crop, DESCRIBE)).face);
    const best = inCrop.sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[0];
    if (!best?.embedding) return face; // found but not describable (e.g. heavy blur); embedding stays null
    return { box: [best.box[0] + r.x, best.box[1] + r.y, best.box[2], best.box[3]], score: face.score, embedding: best.embedding };
  } finally {
    crop.close();
  }
}

// [pure] Square region `factor`× the face's larger side, centered on it, clamped to the image.
export function expandRect([x, y, w, h], factor, W, H) {
  const size = Math.min(Math.round(Math.max(w, h) * factor), W, H);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.round(Math.min(Math.max(0, cx - size / 2), W - size));
  const ry = Math.round(Math.min(Math.max(0, cy - size / 2), H - size));
  return { x: rx, y: ry, w: size, h: size };
}

// [pure] n×n grid of tiles covering W×H, each 25% larger than an exact split so faces on seams appear whole in one tile.
export function tileRects(W, H, n, grow = 1.25) {
  const tw = Math.min(W, Math.round((W / n) * grow));
  const th = Math.min(H, Math.round((H / n) * grow));
  const rects = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      rects.push({ x: Math.round((i * (W - tw)) / (n - 1)), y: Math.round((j * (H - th)) / (n - 1)), w: tw, h: th });
    }
  }
  return rects;
}

// [pure] Merges duplicate detections: boxes overlapping by more than half of the smaller one are the same face.
// Keeps the larger box (a face cut by a tile edge yields a smaller, partial box).
export function dedupe(faces, minOverlap = 0.5) {
  const sorted = [...faces].sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]);
  const kept = [];
  for (const f of sorted) {
    if (!kept.some((k) => overlap(k.box, f.box) > minOverlap)) kept.push(f);
  }
  return kept;
}

function overlap([ax, ay, aw, ah], [bx, by, bw, bh]) {
  const iw = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const ih = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  return (iw * ih) / Math.min(aw * ah, bw * bh);
}

// [pure] Human FaceResult[] → Face[] ({ box, score, embedding }), dropping faces below minFacePx.
export function toFaces(results, minFacePx = 0) {
  return (results ?? [])
    .filter((f) => f.box[2] >= minFacePx && f.box[3] >= minFacePx)
    .map((f) => ({
      box: f.box.map(Math.round),
      score: f.score,
      embedding: f.embedding?.length ? Float32Array.from(f.embedding) : null,
    }));
}

// [pure] Photo quality for choosing the best frame: confident, certain, and large faces win.
export function quality(face, similarity, frameW, frameH) {
  const area = (face.box[2] * face.box[3]) / (frameW * frameH);
  return face.score * similarity * Math.sqrt(Math.max(0, area));
}
