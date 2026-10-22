// Frame capture from the camera video.

// [pure] Center-crop rectangle for a digital zoom factor.
export function cropRect(srcW, srcH, zoom = 1) {
  const w = Math.round(srcW / zoom);
  const h = Math.round(srcH / zoom);
  return { x: Math.round((srcW - w) / 2), y: Math.round((srcH - h) / 2), w, h };
}

// Grabs the current video frame (center-cropped by zoom). Caller must close() the bitmap.
export async function grabFrame(videoEl, zoom = 1) {
  const crop = cropRect(videoEl.videoWidth, videoEl.videoHeight, zoom);
  const bitmap = await createImageBitmap(videoEl, crop.x, crop.y, crop.w, crop.h);
  return { bitmap, crop };
}

// Square thumbnail around a face (with padding), as a small JPEG data URL.
export function cropFace(bitmap, [x, y, w, h], pad = 0.3, size = 96) {
  const side = Math.min(Math.round(Math.max(w, h) * (1 + 2 * pad)), bitmap.width, bitmap.height);
  const sx = Math.round(Math.min(Math.max(0, x + w / 2 - side / 2), bitmap.width - side));
  const sy = Math.round(Math.min(Math.max(0, y + h / 2 - side / 2), bitmap.height - side));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.8);
}

// Encodes a frame as JPEG.
export async function toJpegBlob(bitmap, quality = 0.9) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    c.getContext('2d').drawImage(bitmap, 0, 0);
    return c.convertToBlob({ type: 'image/jpeg', quality });
  }
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  c.getContext('2d').drawImage(bitmap, 0, 0);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', quality));
}
