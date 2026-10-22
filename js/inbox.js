// Inbox: review today's catches in bulk, fix names, and share one photo per Slack post.

import * as db from './db.js';
import { dayKey, tags, msUntilDeadline, inRehearsalWindow } from './rules.js';
import { now } from './clock.js';
import { tagText, snipeFilename, toFile, copyText, shareFile, saveFiles } from './share.js';
import { log } from './log.js';
import * as ui from './ui.js';

const $ = (id) => document.getElementById(id);

let deps = null; // { getMembers, getSettings, onChanged }
const state = {
  day: null,
  cands: [],
  locked: new Set(),
  selected: new Set(),
  urls: new Map(), // photoKey(c) → object URL of its photo
  current: null, // candidate open in the detail view
  queue: [], // share flow
  qi: 0,
  shared: 0,
};

export function initInbox(d) {
  deps = d;
  $('btn-share-selected').addEventListener('click', () => startShare(selectedCands()));
  $('btn-save-selected').addEventListener('click', saveSelected);
  $('btn-dismiss-selected').addEventListener('click', () => dismiss([...state.selected]));
  $('btn-cand-back').addEventListener('click', showInbox);
  $('btn-cand-share').addEventListener('click', () => startShare([state.current]));
  $('btn-cand-dismiss').addEventListener('click', () => dismiss([state.current.id]));
  $('cand-reassign').addEventListener('change', (e) => e.target.value && reassign(e.target.value));
  $('btn-share-go').addEventListener('click', shareCurrent);
  $('btn-share-skip').addEventListener('click', () => { state.qi++; showStep(); });
  $('btn-share-done').addEventListener('click', finishShare);
}

// Called when a new photo is caught: redraws the Inbox if it's on screen (not mid-share, to avoid surprises).
export async function refreshInbox() {
  if (document.querySelector('[data-view="inbox"]').hidden) return;
  await load();
  render();
}

export async function showInbox() {
  await load();
  render();
  ui.showView('inbox');
}

async function load() {
  state.day = dayKey(now());
  const previous = new Set(state.cands.map((c) => c.id));
  state.cands = await db.listCandidates(state.day);
  state.locked = new Set((await db.listLocks(state.day)).map((l) => l.memberId));
  const ids = new Set(state.cands.map((c) => c.id));
  for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);
  for (const c of state.cands) if (!previous.has(c.id)) state.selected.add(c.id); // new catches start selected
  const keys = new Set(state.cands.map(photoKey));
  for (const [key, url] of state.urls) {
    if (!keys.has(key)) {
      URL.revokeObjectURL(url);
      state.urls.delete(key);
    }
  }
}

// A better photo replaces a catch under the same id, so the photo cache is keyed by id + time seen.
const photoKey = (c) => `${c.id}:${c.seenAt}`;

const memberById = (id) => deps.getMembers().find((m) => m.id === id) ?? { id, name: 'Unknown', slack: '' };

// Display info for a candidate: title, others in the photo, warnings.
function card(c) {
  const key = photoKey(c);
  if (!state.urls.has(key)) state.urls.set(key, URL.createObjectURL(db.candidateBlob(c)));
  const others = (c.inFrame ?? []).filter((id) => id !== c.memberId);
  const flags = [];
  const lockedOthers = others.filter((id) => state.locked.has(id)).map((id) => memberById(id).name);
  if (lockedOthers.length) flags.push(`already sniped today: ${lockedOthers.join(', ')}`);
  if (inRehearsalWindow(c.seenAt, deps.getSettings().rehearsals)) flags.push('near rehearsal time (rule 1c)');
  return {
    c,
    url: state.urls.get(key),
    title: memberById(c.memberId).name,
    others: others.map((id) => memberById(id).name).join(', '),
    flags: flags.join('; '),
  };
}

function render() {
  ui.renderInbox(state.cands.map(card), { selected: state.selected, deadline: ui.deadlineText(msUntilDeadline(now())) }, {
    onToggle: (c) => {
      if (state.selected.has(c.id)) state.selected.delete(c.id);
      else state.selected.add(c.id);
      render();
    },
    onOpen: openCandidate,
  });
}

const selectedCands = () => state.cands.filter((c) => state.selected.has(c.id)).sort((a, b) => a.seenAt - b.seenAt);

function openCandidate(c) {
  state.current = c;
  ui.renderCandidate(card(c), deps.getMembers());
  ui.showView('candidate');
}

async function reassign(newMemberId) {
  const moved = await db.reassignCandidate(state.current.id, newMemberId);
  const name = memberById(newMemberId).name;
  log(`Reassigned catch to ${name}`);
  ui.toast(state.locked.has(newMemberId) ? `${name} was already sniped today` : `Changed to ${name}`);
  await load();
  await deps.onChanged();
  openCandidate(state.cands.find((c) => c.id === moved.id) ?? moved);
}

async function dismiss(ids) {
  await db.dismissCandidates(ids);
  log(`Dismissed ${ids.length} catch(es)`);
  await deps.onChanged();
  await showInbox();
}

// Marks everyone tagged in a posted/saved photo as sniped today and clears their other photos (rules 4, 8).
async function accept(c, tagged, via) {
  await db.lock(tagged, state.day, via, now());
  await db.deleteCandidatesFor(tagged, state.day);
  for (const id of tagged) state.locked.add(id);
  state.cands = state.cands.filter((x) => !tagged.includes(x.memberId));
  log(`${via === 'shared' ? 'Shared' : 'Saved'} snipe: ${tagged.map((id) => memberById(id).name).join(', ')}`);
  await deps.onChanged();
}

// ---------- Share flow: one photo per post ----------

function startShare(list) {
  if (!list.length) return;
  state.queue = list;
  state.qi = 0;
  state.shared = 0;
  ui.showView('share');
  showStep();
}

// Current step's photo, tags, and file. Skips photos whose member was tagged in an earlier post.
function step() {
  while (state.qi < state.queue.length && state.locked.has(state.queue[state.qi].memberId)) state.qi++;
  const c = state.queue[state.qi];
  if (!c) return null;
  const { tag, flagged } = tags(c, [...state.locked]);
  const members = tag.map(memberById);
  return {
    c,
    tag,
    card: card(c),
    tagLine: tagText(members),
    flagged: flagged.map((id) => memberById(id).name).join(', '),
    file: toFile(db.candidateBlob(c), snipeFilename(c.seenAt, members.map((m) => m.name))),
  };
}

function showStep() {
  const s = step();
  if (!s) return finishShare();
  ui.renderShareStep({ ...s, index: state.qi, total: state.queue.length });
}

// Tap handler: copy tags and open the share sheet synchronously (iOS requires it within the tap).
function shareCurrent() {
  const s = step();
  if (!s) return finishShare();
  copyText(s.tagLine);
  shareFile(s.file)
    .then(async (result) => {
      if (result === 'cancelled') {
        ui.toast('Not shared: still in your Inbox');
        return;
      }
      await accept(s.c, s.tag, result === 'shared' ? 'shared' : 'saved');
      state.shared++;
      if (result === 'downloaded') ui.toast('Photo downloaded; tags copied');
      state.qi++;
      showStep();
    })
    .catch((err) => {
      log(err, 'warn');
      ui.toast(`Couldn't share: ${err.message}`);
    });
}

async function finishShare() {
  if (state.shared) ui.toast(`Posted ${state.shared} snipe${state.shared === 1 ? '' : 's'}`);
  state.queue = [];
  await showInbox();
}

// Save: hands all selected photos to the share sheet ("Save N Images") or downloads them.
function saveSelected() {
  const list = selectedCands();
  if (!list.length) return;
  const files = list.map((c) => toFile(db.candidateBlob(c), snipeFilename(c.seenAt, [memberById(c.memberId).name])));
  saveFiles(files)
    .then(async (result) => {
      if (result === 'cancelled') return;
      for (const c of list) if (!state.locked.has(c.memberId)) await accept(c, tags(c, [...state.locked]).tag, 'saved');
      ui.toast(`Saved ${list.length} photo${list.length === 1 ? '' : 's'}. Post them before midnight!`);
      await showInbox();
    })
    .catch((err) => {
      log(err, 'warn');
      ui.toast(`Couldn't save: ${err.message}`);
    });
}
