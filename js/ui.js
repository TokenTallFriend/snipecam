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

// Draws the overlay. `results` come from matchFaces: [{ face, top, match }].
// Members get a green box + name (if showLabels). Strangers are drawn only in debug mode, with their closest member.
// `crop` is where the processed frame sits within the video.
export function renderFaces(canvas, results, { videoW, videoH, crop, debug = false, showLabels = true }) {
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
  canvas.dataset.labels = results.filter((r) => r.match).map((r) => r.match.member.name).join(',');
  if (!videoW) return;
  ctx.lineWidth = 2;
  ctx.font = '600 14px system-ui, sans-serif';
  for (const { face, top, match } of results) {
    const isMember = !!match && showLabels;
    if (!isMember && !debug) continue;
    const [x, y, bw, bh] = mapBox([face.box[0] + crop.x, face.box[1] + crop.y, face.box[2], face.box[3]], videoW, videoH, w, h);
    const label = isMember
      ? match.member.name
      : debug ? `${top ? `${top.member.name}? ${top.similarity.toFixed(2)}` : 'face'} · ${face.box[2]}px` : '';
    const color = isMember ? '#22c55e' : 'rgba(200,200,200,0.9)';
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, bw, bh);
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = isMember ? color : 'rgba(0,0,0,0.65)';
    ctx.fillRect(x, y - 22, tw, 22);
    ctx.fillStyle = isMember ? '#000' : '#fff';
    ctx.fillText(label, x + 5, y - 6);
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

// ---------- Roster ----------

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children.filter((c) => c !== null && c !== undefined));
  return e;
}

export function renderRoster(members, { onEdit }) {
  const list = $('roster-list');
  list.replaceChildren();
  if (!members.length) {
    list.append(el('p', { className: 'empty', textContent: 'No members yet. Add the people you want SnipeCam to recognize.' }));
    return;
  }
  for (const m of members) {
    const avatar = m.thumbs?.[0] ? el('img', { src: m.thumbs[0], alt: '' }) : el('span', { className: 'avatar' });
    const n = m.embeddings.length;
    const detail = `${m.slack || 'no Slack handle'} · ${n} photo${n === 1 ? '' : 's'}`;
    const row = el('button', { className: 'member-row' }, avatar,
      el('span', { className: 'info' }, el('b', { textContent: m.name }),
        el('small', { textContent: detail }),
        n < 3 ? el('small', { className: 'warn', textContent: 'Add more photos for better recognition' }) : null));
    row.addEventListener('click', () => onEdit(m));
    list.append(row);
  }
}

// editing = { id, name, slack, photos: [{ thumb, note, outlier }], skipped: [{ name, note }] }
export function renderMemberEditor(editing, { onRemove }) {
  $('member-title').textContent = editing.id ? 'Edit member' : 'Add member';
  $('btn-member-delete').hidden = !editing.id;
  const grid = $('member-photo-grid');
  grid.replaceChildren();
  editing.photos.forEach((p, i) => {
    const remove = el('button', { className: 'remove', textContent: '✕', ariaLabel: 'Remove photo' });
    remove.addEventListener('click', () => onRemove(i));
    const note = p.outlier ? "Doesn't match their other photos. Wrong person?" : p.note;
    grid.append(el('div', { className: `photo${p.outlier ? ' outlier' : ''}` }, el('img', { src: p.thumb, alt: '' }), remove,
      note ? el('small', { textContent: note }) : null));
  });
  const skipped = $('member-skipped');
  skipped.replaceChildren(...editing.skipped.map((r) => el('div', {}, el('b', { textContent: '✗ Skipped ' }), `${r.name}: ${r.note}`)));
}
