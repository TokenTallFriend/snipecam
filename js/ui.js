// DOM rendering. No DOM access at import time, so pure helpers (mapBox) can be unit-tested in Node.

import { FIELDS } from './settings.js';

const $ = (id) => document.getElementById(id);

// [pure] Map a box from source-video pixels to screen pixels for a video shown with `object-fit: cover`.
export function mapBox([x, y, w, h], srcW, srcH, viewW, viewH) {
  const scale = Math.max(viewW / srcW, viewH / srcH);
  const offX = (viewW - srcW * scale) / 2;
  const offY = (viewH - srcH * scale) / 2;
  return [x * scale + offX, y * scale + offY, w * scale, h * scale];
}

// Draws face boxes on the overlay canvas. `crop` is where the processed frame sits within the video.
// P2: only drawn in debug mode (strangers are never shown in normal use).
export function renderFaces(canvas, faces, { videoW, videoH, crop, debug = false }) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!debug || !videoW) return;
  ctx.lineWidth = 2;
  ctx.font = '13px system-ui, sans-serif';
  for (const f of faces) {
    const [x, y, bw, bh] = mapBox([f.box[0] + crop.x, f.box[1] + crop.y, f.box[2], f.box[3]], videoW, videoH, w, h);
    ctx.strokeStyle = 'rgba(200,200,200,0.9)';
    ctx.strokeRect(x, y, bw, bh);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y - 18, 64, 18);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${f.box[2]}px ${f.score.toFixed(2)}`, x + 3, y - 5);
  }
}

export function clearOverlay(canvas) {
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// Views other than 'watch' are full-screen panels drawn over it, so the video never stops rendering.
export function showView(name) {
  for (const el of document.querySelectorAll('[data-view]')) {
    if (el.dataset.view !== 'watch') el.hidden = el.dataset.view !== name;
  }
}

export function setStatus({ state, detail } = {}) {
  if (state !== undefined) $('status-state').textContent = state;
  if (detail !== undefined) $('status-detail').textContent = detail;
}

let toastTimer = null;
export function toast(msg, ms = 3000) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

export function progress(pct, label = '') {
  const el = $('progress');
  el.hidden = pct === null || pct >= 100;
  el.querySelector('.progress-bar').style.width = `${pct ?? 0}%`;
  el.querySelector('.progress-label').textContent = label;
}

// Builds the settings form from FIELDS. onChange(key, rawValue) is called on every edit.
export function renderSettings(settings, onChange, { cameras = [] } = {}) {
  const form = $('settings-form');
  form.replaceChildren();
  let fieldset = null;
  for (const f of FIELDS) {
    if (fieldset?.dataset.group !== f.group) {
      fieldset = document.createElement('fieldset');
      fieldset.dataset.group = f.group;
      fieldset.innerHTML = `<legend>${f.group}</legend>`;
      form.append(fieldset);
    }
    const row = document.createElement('label');
    row.className = 'field';
    row.append(Object.assign(document.createElement('span'), { textContent: f.label }));
    const input = makeInput(f, settings[f.key], cameras);
    input.name = f.key;
    input.addEventListener('change', () => {
      const v = f.type === 'checkbox' ? input.checked : input.value;
      onChange(f.key, f.type === 'camera' && v === '' ? null : v);
    });
    row.append(input);
    fieldset.append(row);
  }
}

function makeInput(f, value, cameras) {
  if (f.type === 'select' || f.type === 'camera') {
    const sel = document.createElement('select');
    const options = f.type === 'camera'
      ? [['', 'Default (rear)'], ...cameras.map((c, i) => [c.deviceId, c.label || `Camera ${i + 1}`])]
      : f.options;
    for (const [val, label] of options) sel.append(new Option(label, val, false, String(val) === String(value ?? '')));
    return sel;
  }
  const input = document.createElement('input');
  input.type = f.type;
  if (f.type === 'checkbox') {
    input.checked = !!value;
  } else {
    input.value = value;
    if (f.type === 'number') Object.assign(input, { min: f.min, max: f.max, step: f.step, inputMode: 'decimal' });
  }
  return input;
}
