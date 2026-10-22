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
      ? [['', 'Default'], ...cameras.map((c, i) => [c.deviceId, c.label || `Camera ${i + 1}`])]
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
