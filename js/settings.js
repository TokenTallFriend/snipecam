// [pure] App settings: defaults, field definitions, validation, persistence.
// FIELDS drives both validate() and the Settings form, so ranges live in one place.

export const STORAGE_KEY = 'snipecam.settings';

export const MODES = ['tripod'];

export const FIELDS = [
  // Camera
  { key: 'facingMode', group: 'Camera', label: 'Camera', type: 'select', options: [['environment', 'Rear'], ['user', 'Front']], default: 'environment' },
  { key: 'deviceId', group: 'Camera', label: 'Device', type: 'camera', default: null },
  { key: 'width', group: 'Camera', label: 'Width (px)', type: 'number', min: 320, max: 3840, step: 1, int: true, default: 1920 },
  { key: 'height', group: 'Camera', label: 'Height (px)', type: 'number', min: 240, max: 2160, step: 1, int: true, default: 1080 },
  { key: 'zoom', group: 'Camera', label: 'Zoom', type: 'select', options: [[1, '1×'], [1.5, '1.5×'], [2, '2×']], default: 1 },
  // Performance
  { key: 'processFps', group: 'Performance', label: 'Checks per second', type: 'number', min: 0.2, max: 10, step: 0.1, default: 2 },
  { key: 'idleFps', group: 'Performance', label: 'Idle checks per second', type: 'number', min: 0.1, max: 5, step: 0.1, default: 0.5 },
  { key: 'idleAfterSec', group: 'Performance', label: 'Go idle after (s) with no faces', type: 'number', min: 5, max: 3600, step: 1, int: true, default: 60 },
  // Recognition
  { key: 'threshold', group: 'Recognition', label: 'Match threshold', type: 'number', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'margin', group: 'Recognition', label: 'Margin over runner-up', type: 'number', min: 0, max: 0.5, step: 0.01, default: 0.05 },
  { key: 'maxDetected', group: 'Recognition', label: 'Max faces per frame', type: 'number', min: 1, max: 20, step: 1, int: true, default: 10 },
  { key: 'minFacePx', group: 'Recognition', label: 'Min face size (px)', type: 'number', min: 10, max: 500, step: 1, int: true, default: 40 },
  { key: 'minCandidateFacePx', group: 'Recognition', label: 'Min face size to keep photo (px)', type: 'number', min: 10, max: 500, step: 1, int: true, default: 60 },
  // Catching
  { key: 'minHits', group: 'Catching', label: 'Matches needed per sighting', type: 'number', min: 1, max: 10, step: 1, int: true, default: 2 },
  { key: 'gapSec', group: 'Catching', label: 'Sighting ends after unseen (s)', type: 'number', min: 1, max: 60, step: 1, int: true, default: 5 },
  // Alerts
  { key: 'alert', group: 'Alerts', label: 'Alert on catch', type: 'select', options: [['off', 'Off'], ['sound', 'Sound']], default: 'off' },
  { key: 'reminderAt', group: 'Alerts', label: 'Post-by-midnight reminder', type: 'time', default: '23:00' },
  { key: 'showLabels', group: 'Alerts', label: 'Show name labels', type: 'checkbox', default: true },
  // Advanced
  { key: 'mode', group: 'Advanced', label: 'Mode', type: 'select', options: MODES.map((m) => [m, m[0].toUpperCase() + m.slice(1)]), default: 'tripod' },
  { key: 'backend', group: 'Advanced', label: 'Compute backend', type: 'select', options: [['webgpu', 'WebGPU'], ['webgl', 'WebGL']], default: 'webgpu' },
];

export const DEFAULTS = Object.freeze({
  ...Object.fromEntries(FIELDS.map((f) => [f.key, f.default])),
  rehearsals: [], // P6: [{ weekday: 0-6, start: 'HH:MM', end: 'HH:MM' }]
});

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validField(f, v) {
  switch (f.type) {
    case 'number': {
      let n = Number(v);
      if (v === null || v === '' || !Number.isFinite(n)) return f.default;
      n = Math.min(f.max, Math.max(f.min, n));
      return f.int ? Math.round(n) : n;
    }
    case 'select': {
      const match = f.options.find(([val]) => String(val) === String(v));
      return match ? match[0] : f.default;
    }
    case 'checkbox':
      return typeof v === 'boolean' ? v : f.default;
    case 'time':
      return typeof v === 'string' && TIME_RE.test(v) ? v : f.default;
    case 'camera':
      return typeof v === 'string' && v ? v : null;
    default:
      return f.default;
  }
}

function validRehearsals(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((r) => r && Number.isInteger(r.weekday) && r.weekday >= 0 && r.weekday <= 6 &&
    TIME_RE.test(r.start) && TIME_RE.test(r.end));
}

// Returns a complete, valid Settings object. Unknown keys are dropped.
export function validate(s) {
  const src = s && typeof s === 'object' ? s : {};
  const out = {};
  for (const f of FIELDS) out[f.key] = validField(f, src[f.key]);
  out.rehearsals = validRehearsals(src.rehearsals);
  return out;
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return validate(DEFAULTS);
    const parsed = JSON.parse(raw);
    return validate({ ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) });
  } catch {
    return validate(DEFAULTS);
  }
}

export function saveSettings(s, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(validate(s)));
    return true;
  } catch {
    return false;
  }
}
