// Camera access via getUserMedia.

let stream = null;

export async function startCamera(videoEl, { facingMode = 'environment', width = 1920, height = 1080, deviceId = null } = {}) {
  stopCamera(videoEl);
  const size = { width: { ideal: width }, height: { ideal: height } };
  const video = deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: facingMode }, ...size };
  stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });

  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.srcObject = stream;
  if (!videoEl.videoWidth) {
    await new Promise((resolve) => videoEl.addEventListener('loadedmetadata', resolve, { once: true }));
  }
  await videoEl.play();
  return { stream, width: videoEl.videoWidth, height: videoEl.videoHeight };
}

export function stopCamera(videoEl) {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (videoEl) videoEl.srcObject = null;
}

// [pure] How to reach a zoom level: the camera's own zoom when it supports it (real detail from the full sensor
// or a telephoto lens), topped up with a digital crop if the camera can't go far enough.
// caps = MediaTrackCapabilities. Returns { hardware: number|null, digital: number }.
export function zoomPlan(level, caps) {
  const hw = caps?.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null;
  if (!hw) return { hardware: null, digital: level };
  const hardware = Math.min(Math.max(level, hw.min), hw.max);
  return { hardware, digital: Math.max(1, level / hardware) };
}

// Applies a zoom level to the running camera. Falls back to digital-only if the camera refuses.
export async function applyZoom(level) {
  const track = stream?.getVideoTracks()[0];
  const plan = zoomPlan(level, track?.getCapabilities?.());
  if (plan.hardware === null) return plan;
  try {
    await track.applyConstraints({ advanced: [{ zoom: plan.hardware }] });
    return plan;
  } catch {
    return { hardware: null, digital: level };
  }
}

export function isCameraLive() {
  return !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
}

export async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}

// [pure] Human-readable message for a getUserMedia failure.
export function cameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission denied. Allow camera access for this site (iPhone: Settings → Apps → Safari → Camera) and try again.';
    case 'NotFoundError':
      return 'No camera found.';
    case 'NotReadableError':
      return 'Camera is busy. Close other apps using it and try again.';
    case 'OverconstrainedError':
      return 'Selected camera is unavailable. Pick another in Settings.';
    default:
      return `Camera failed: ${err?.message ?? err}`;
  }
}
