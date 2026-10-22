// Roster screens: member list, add/edit member, export/import.

import * as db from './db.js';
import { enrollFromFiles, selfConsistency } from './enroll.js';
import { log } from './log.js';
import * as ui from './ui.js';

const $ = (id) => document.getElementById(id);

let editing = null; // { id, name, slack, createdAt, photos: [{ embedding, thumb, note, outlier }], skipped: [] }
let onMembersChanged = async () => {};

export function initRoster({ onChanged }) {
  onMembersChanged = onChanged;
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
  ui.renderRoster(await db.listMembers(), { onEdit: openEditor });
  ui.showView('roster');
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
    const { added, updated } = await db.importJson(await file.text(), { mode: 'merge' });
    ui.toast(`Imported: ${added} added, ${updated} updated`);
    log(`Imported roster: ${added} added, ${updated} updated`);
    await onMembersChanged();
    await showRoster();
  } catch (err) {
    log(err, 'warn');
    ui.toast(err.message, 6000);
  }
}
