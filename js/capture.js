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
