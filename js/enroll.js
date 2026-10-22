// Enrollment: turns photos of a member into checked face embeddings + thumbnails.

import { detect } from './detector.js';
import { cropFace } from './capture.js';
import { cosine } from './matcher.js';

export const MIN_ENROLL_FACE_PX = 80;

// Decodes an image file (EXIF orientation applied) and shrinks it so the long side ≤ maxSide.
export async function loadImageFile(file, maxSide = 1600) {
  const bmp = await createImageBitmap(file);
  const scale = maxSide / Math.max(bmp.width, bmp.height);
  if (scale >= 1) return bmp;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return createImageBitmap(canvas);
}

// [pure] Decides whether a photo's detected faces are usable for enrollment.
export function evaluateFaces(faces, minPx = MIN_ENROLL_FACE_PX) {
  if (!faces.length) return { status: 'skipped', note: 'No face found' };
  const face = [...faces].sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[0];
  if (face.box[2] < minPx) return { status: 'skipped', note: `Face too small (${face.box[2]} px, need ${minPx}+)` };
  if (!face.embedding) return { status: 'skipped', note: 'Face unclear' };
  return { status: 'used', face, note: faces.length > 1 ? 'Several faces: used the largest. Check the thumbnail.' : '' };
}

// Checks each file. Returns [{ name, status: 'used'|'skipped', note, embedding?, thumb? }].
export async function enrollFromFiles(files, { onProgress } = {}) {
  const results = [];
  for (const [i, file] of [...files].entries()) {
    onProgress?.(i, files.length);
    let bmp;
    try {
      bmp = await loadImageFile(file);
    } catch {
      results.push({ name: file.name, status: 'skipped', note: 'Could not read image' });
      continue;
    }
    try {
      const verdict = evaluateFaces(await detect(bmp, { tiles: 1 }));
      if (verdict.status === 'used') {
        results.push({ name: file.name, status: 'used', note: verdict.note, embedding: verdict.face.embedding, thumb: cropFace(bmp, verdict.face.box) });
      } else {
        results.push({ name: file.name, status: 'skipped', note: verdict.note });
      }
    } finally {
      bmp.close();
    }
  }
  onProgress?.(files.length, files.length);
  return results;
}

// [pure] Flags the one photo least like the others (likely the wrong person). Needs ≥ 3 photos.
// A photo is an outlier if its mean similarity to the rest is `gap` below the median photo's.
export function selfConsistency(embeddings, gap = 0.15) {
  if (embeddings.length < 3) return { outlierIndex: null, scores: [] };
  const scores = embeddings.map((e, i) => {
    let sum = 0;
    embeddings.forEach((o, j) => { if (j !== i) sum += cosine(e, o); });
    return sum / (embeddings.length - 1);
  });
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const lowest = scores.indexOf(sorted[0]);
  return { outlierIndex: sorted[0] < median - gap ? lowest : null, scores };
}
