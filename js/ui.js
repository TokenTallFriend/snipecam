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
// Locked members (already sniped today) are drawn gray with 🔒 so it's clear why they aren't being caught.
// The preview is scaled by the digital zoom, so the processed crop fills the view: map boxes from crop space.
export function renderFaces(canvas, results, { videoW, videoH, crop, debug = false, showLabels = true, locked = new Set() }) {
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
  canvas.dataset.locked = results.filter((r) => r.match && locked.has(r.match.member.id)).map((r) => r.match.member.name).join(',');
  if (!videoW) return;
  ctx.lineWidth = 2;
  ctx.font = '600 14px system-ui, sans-serif';
  for (const { face, top, match } of results) {
    const isMember = !!match && showLabels;
    if (!isMember && !debug) continue;
    const [x, y, bw, bh] = mapBox(face.box, crop.w, crop.h, w, h);
    const isLocked = isMember && locked.has(match.member.id);
    const isUnsure = isMember && !!match.member.lookalikeGroup; // "Ann or Amy?" 
    let label;
    if (isMember) {
      const name = isLocked ? `🔒 ${match.member.name} · sniped today` : match.member.name;
      label = debug ? `${name} ${match.similarity.toFixed(2)}` : name;
    } else {
      label = `${top ? `${top.member.name}? ${top.similarity.toFixed(2)}` : 'face'} · ${face.box[2]}px`;
    }
    const color = isUnsure ? '#f59e0b' : isMember && !isLocked ? '#22c55e' : 'rgba(200,200,200,0.9)';
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, bw, bh);
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = isMember && !isLocked ? color : 'rgba(0,0,0,0.65)';
    ctx.fillRect(x, y - 22, tw, 22);
    ctx.fillStyle = isMember && !isLocked ? '#000' : '#fff';
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

// Persistent message at the top; tap to dismiss.
export function banner(msg) {
  const el = $('banner');
  el.textContent = msg;
  el.hidden = false;
  el.onclick = () => { el.hidden = true; };
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

const ROW_STATUS = { caught: '📷 caught today', shared: '🔒 sniped today', saved: '🔒 sniped today', manual: '🔒 sniped today', 'sniped-me': '🔒 sniped you today' };

export function renderRoster(members, { onEdit, status = new Map() }) {
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
        status.has(m.id) ? el('small', { textContent: ROW_STATUS[status.get(m.id)] }) : null,
        m.lookalikes?.length ? el('small', { textContent: `👯 looks like ${m.lookalikes.map((id) => members.find((x) => x.id === id)?.name).filter(Boolean).join(', ')}` }) : null,
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
    const img = p.thumb ? el('img', { src: p.thumb, alt: '' }) : el('div', { className: 'no-thumb', textContent: 'face data' });
    grid.append(el('div', { className: `photo${p.outlier ? ' outlier' : ''}` }, img, remove,
      note ? el('small', { textContent: note }) : null));
  });
  const skipped = $('member-skipped');
  skipped.replaceChildren(...editing.skipped.map((r) => el('div', {}, el('b', { textContent: '✗ Skipped ' }), `${r.name}: ${r.note}`)));
}

// ---------- Inbox ----------

const time = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function deadlineText(ms) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `Post by midnight · ${h ? `${h}h ` : ''}${m}m left`;
}

// cards: [{ c, url, title, others, flags }]; selected: Set of candidate ids
export function renderInbox(cards, { selected, deadline }, { onToggle, onOpen }) {
  $('inbox-deadline').textContent = cards.length ? deadline : '';
  const grid = $('inbox-grid');
  grid.replaceChildren();
  if (!cards.length) grid.append(el('p', { className: 'empty', textContent: 'No catches yet today.' }));
  for (const card of cards) {
    const on = selected.has(card.c.id);
    // Grid shows the face close-up (the full photo's center can cut the face off); detail shows the full photo.
    const open = el('button', { className: 'open', ariaLabel: `Open ${card.title}` }, el('img', { src: card.c.thumb || card.url, alt: '' }));
    open.addEventListener('click', () => onOpen(card.c));
    const pick = el('button', { className: 'pick', textContent: on ? '☑' : '☐', ariaLabel: on ? 'Deselect' : 'Select' });
    pick.addEventListener('click', () => onToggle(card.c));
    grid.append(el('div', { className: `cand${on ? ' selected' : ''}` }, open, pick,
      el('div', { className: 'meta' }, el('b', { textContent: card.title }),
        card.others ? el('small', { textContent: `with ${card.others}` }) : null,
        el('small', { textContent: ` ${time(card.c.seenAt)}` }),
        card.flags ? el('small', { className: 'warn', textContent: ` ⚠ ${card.flags}` }) : null)));
  }
  const n = cards.filter((x) => selected.has(x.c.id)).length;
  $('btn-share-selected').textContent = n ? `Share ${n}` : 'Share';
  for (const id of ['btn-share-selected', 'btn-save-selected', 'btn-dismiss-selected']) $(id).disabled = !n;
}

export function renderCandidate(card, members) {
  $('cand-title').textContent = card.title;
  $('cand-photo').src = card.url;
  $('cand-info').replaceChildren(
    el('p', { textContent: `Seen at ${time(card.c.seenAt)} · match ${(card.c.similarity * 100).toFixed(0)}%` }),
    card.others ? el('p', { textContent: `Also in photo: ${card.others}` }) : null,
    card.flags ? el('p', { className: 'warn', textContent: `⚠ ${card.flags}` }) : null,
  );
  const sel = $('cand-reassign');
  sel.replaceChildren(new Option('—', ''), ...members.filter((m) => m.id !== card.c.memberId).map((m) => new Option(m.name, m.id)));
}

export function renderShareStep({ card, index, total, tagLine, flagged, unsure }) {
  $('share-title').textContent = `Photo ${index + 1} of ${total}`;
  $('share-photo').src = card.url;
  $('share-tags').textContent = tagLine;
  $('share-flags').textContent = [
    flagged && `⚠ Already sniped today, not tagged: ${flagged}`,
    unsure && `⚠ Also in photo, tag the right one yourself: ${unsure}`,
  ].filter(Boolean).join(' · ');
}

// Lookalike links in the member editor. linked: Member[]; others: Member[] that could be added.
export function renderMemberLookalikes(linked, others, { onAdd, onRemove }) {
  $('member-lookalikes').hidden = !linked.length && !others.length;
  const chips = $('lookalike-chips');
  chips.replaceChildren(...linked.map((m) => {
    const b = el('button', { className: 'chip', ariaLabel: `Unlink ${m.name}` }, `👯 ${m.name}`, el('span', { textContent: ' ✕' }));
    b.addEventListener('click', () => onRemove(m.id));
    return b;
  }));
  const sel = $('lookalike-add');
  sel.replaceChildren(new Option('—', ''), ...others.map((m) => new Option(m.name, m.id)));
  sel.onchange = () => sel.value && onAdd(sel.value);
}

// "Which one is it?" buttons for an unresolved lookalike catch.
export function renderWhich(people, onPick) {
  $('cand-which').hidden = !people.length;
  $('cand-which-buttons').replaceChildren(...people.map((m) => {
    const b = el('button', { className: 'primary', textContent: `It's ${m.name}` });
    b.addEventListener('click', () => onPick(m.id));
    return b;
  }));
}

export function renderMemberToday(statusText) {
  $('member-today-status').textContent = statusText;
}

// ---------- Rehearsal schedule (Settings) ----------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// list: [{ weekday, start, end }]; onChange(newList) on every edit.
export function renderRehearsals(list, onChange) {
  const box = $('rehearsal-list');
  box.replaceChildren();
  list.forEach((r, i) => {
    const update = (patch) => onChange(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const day = el('select', { ariaLabel: 'Day' }, ...WEEKDAYS.map((d, n) => new Option(d, n, false, n === r.weekday)));
    day.addEventListener('change', () => update({ weekday: Number(day.value) }));
    const start = el('input', { type: 'time', value: r.start, ariaLabel: 'Start' });
    start.addEventListener('change', () => update({ start: start.value }));
    const end = el('input', { type: 'time', value: r.end, ariaLabel: 'End' });
    end.addEventListener('change', () => update({ end: end.value }));
    const remove = el('button', { textContent: '✕', ariaLabel: 'Remove rehearsal' });
    remove.addEventListener('click', () => onChange(list.filter((_, j) => j !== i)));
    box.append(el('div', { className: 'rehearsal' }, day, start, end, remove));
  });
}
