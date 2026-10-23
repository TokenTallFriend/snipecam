// Roster screens: member list, add/edit member, export/import.

import * as db from './db.js';
import { describeMerge } from './rostersync.js';
import { enrollFromFiles, selfConsistency } from './enroll.js';
import { log } from './log.js';
import { dayKey } from './rules.js';
import { now } from './clock.js';
import * as ui from './ui.js';

const $ = (id) => document.getElementById(id);

let editing = null; // { id, name, slack, createdAt, photos: [{ embedding, thumb, note, outlier }], skipped: [] }
let onMembersChanged = async () => {};
let onLocksChanged = async () => {};

export function initRoster({ onChanged, onLocks }) {
  onMembersChanged = onChanged;
  onLocksChanged = onLocks;
  $('btn-sniped-today').addEventListener('click', () => setToday('manual'));
  $('btn-sniped-me').addEventListener('click', () => setToday('sniped-me'));
  $('btn-reset-today').addEventListener('click', () => setToday(null));
  $('btn-add-member').addEventListener('click', () => openEditor(null));
  $('btn-member-back').addEventListener('click', showRoster);
  $('btn-member-save').addEventListener('click', save);
  $('btn-member-delete').addEventListener('click', remove);
  $('member-photos').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = ''; // allow picking the same files again
    if (files.length) await addPhotos(files);
  });
  $('btn-export').addEventListener('click', exportRoster);
  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importRoster(file);
  });
}

export async function showRoster() {
  const day = dayKey(now());
  const [members, locks, cands] = await Promise.all([db.listMembers(), db.listLocks(day), db.listCandidates(day)]);
  const status = new Map(cands.map((c) => [c.memberId, 'caught']));
  for (const l of locks) status.set(l.memberId, l.via);
  ui.renderRoster(members, { onEdit: openEditor, status });
  ui.showView('roster');
}

const TODAY_TEXT = {
  open: 'Today: not caught yet',
  caught: '📷 Today: caught, waiting in Inbox',
  shared: '🔒 Today: sniped (shared)',
  saved: '🔒 Today: sniped (saved)',
  manual: '🔒 Today: sniped (marked by you)',
  'sniped-me': '🔒 Today: they sniped you, no countersnipe (rule 6)',
};

async function todayStatus(memberId) {
  const day = dayKey(now());
  const lock = (await db.listLocks(day)).find((l) => l.memberId === memberId);
  if (lock) return lock.via;
  return (await db.getCandidate(memberId, day))?.status === 'pending' ? 'caught' : 'open';
}

async function renderToday() {
  $('member-today').hidden = !editing.id;
  if (editing.id) ui.renderMemberToday(TODAY_TEXT[await todayStatus(editing.id)]);
}

// via = 'manual' | 'sniped-me' locks the member for today; null resets them (unlock + drop today's photo).
async function setToday(via) {
  const day = dayKey(now());
  await db.deleteCandidatesFor([editing.id], day);
  if (via) await db.lock([editing.id], day, via, now());
  else await db.unlock(editing.id, day);
  log(`${editing.name}: ${via ? `locked today (${via})` : 'reset for today'}`);
  await onLocksChanged();
  await renderToday();
  ui.toast(via ? `${editing.name} won't be caught again today` : `${editing.name} reset for today`);
}

function openEditor(member) {
  editing = member
    ? {
      id: member.id, name: member.name, slack: member.slack, createdAt: member.createdAt, skipped: [],
      photos: member.embeddings.map((embedding, i) => ({ embedding, thumb: member.thumbs[i], note: '' })),
    }
    : { id: null, name: '', slack: '', createdAt: null, photos: [], skipped: [] };
  $('member-name').value = editing.name;
  $('member-slack').value = editing.slack;
  flagOutliers();
  render();
  renderToday();
  ui.showView('member');
}

function render() {
  ui.renderMemberEditor(editing, {
    onRemove: (i) => {
      editing.photos.splice(i, 1);
      flagOutliers();
      render();
    },
  });
}

function flagOutliers() {
  const { outlierIndex } = selfConsistency(editing.photos.map((p) => p.embedding));
  editing.photos.forEach((p, i) => { p.outlier = i === outlierIndex; });
}

async function addPhotos(files) {
  try {
    const results = await enrollFromFiles(files, {
      onProgress: (i, n) => ui.progress(i >= n ? 100 : (i / n) * 100, `Checking photo ${Math.min(i + 1, n)} of ${n}…`),
    });
    for (const r of results) (r.status === 'used' ? editing.photos : editing.skipped).push(r);
    const used = results.filter((r) => r.status === 'used').length;
    ui.toast(`${used} of ${results.length} photo${results.length === 1 ? '' : 's'} added`);
  } catch (err) {
    log(err, 'warn');
    ui.toast(err.message);
  } finally {
    ui.progress(null);
  }
  flagOutliers();
  render();
}

async function save() {
  const name = $('member-name').value.trim();
  if (!name) return ui.toast('Enter a name');
  if (!editing.photos.length) return ui.toast('Add at least one photo with a clear face');
  const member = await db.saveMember({
    id: editing.id ?? crypto.randomUUID(),
    name,
    slack: $('member-slack').value,
    embeddings: editing.photos.map((p) => p.embedding),
    thumbs: editing.photos.map((p) => p.thumb),
    createdAt: editing.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
  log(`Saved member ${member.name} (${member.embeddings.length} photos)`);
  await onMembersChanged();
  await showRoster();
  ui.toast(editing.photos.length < 3 ? `Saved ${name}. Tip: 3+ photos recognize better.` : `Saved ${name}`);
}

async function remove() {
  if (!confirm(`Delete ${editing.name}? This removes all of their face data from this device.`)) return;
  await db.deleteMember(editing.id);
  log(`Deleted member ${editing.name}`);
  await onMembersChanged();
  await showRoster();
}

async function exportRoster() {
  const json = await db.exportJson();
  const blob = new Blob([json], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `snipecam-roster-${new Date().toISOString().slice(0, 10)}.snipedb.json`,
  });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function importRoster(file) {
  try {
    const report = await db.importJson(await file.text(), { mode: 'merge' });
    const summary = describeMerge(report);
    ui.toast(summary, report.conflicts.length ? 10000 : 5000);
    log(summary);
    for (const c of report.conflicts) log(c, 'warn');
    await onMembersChanged();
    await showRoster();
  } catch (err) {
    log(err, 'warn');
    ui.toast(err.message, 6000);
  }
}
