// App bootstrap, state machine, watch loop, and wiring between modules.

import { loadSettings, saveSettings, validate, DEFAULTS } from './settings.js';
import { initLog, log, toggleLog } from './log.js';
import { startCamera, stopCamera, listCameras, cameraErrorMessage } from './camera.js';
import { keepAwake, unlockAudio, setDim } from './device.js';
import { initDetector, detect } from './detector.js';
import { grabFrame } from './capture.js';
import { nextDelay, createStats } from './loop.js';
import { matchFaces } from './matcher.js';
import { openDb, listMembers } from './db.js';
import { initRoster, showRoster } from './roster.js';
import * as ui from './ui.js';

export const VERSION = 'P3';

const CAMERA_KEYS = ['deviceId', 'width', 'height'];
const DETECTOR_KEYS = ['backend', 'maxDetected', 'minFacePx'];

const app = {
  state: 'LOADING', // LOADING | READY | WATCHING | PAUSED | ERROR
  settings: null,
  cam: null, // { width, height }
  awake: 'off',
  backend: null,
  timer: null,
  busy: false,
  idle: false,
  lastFaceAt: 0,
  faceCount: 0,
  knownCount: 0,
  members: [],
  stats: createStats(),
};

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const btnStart = document.getElementById('btn-start');
const btnDim = document.getElementById('btn-dim');

function setState(state) {
  app.state = state;
  const labels = { LOADING: 'Loading…', READY: 'Ready', WATCHING: 'Watching', PAUSED: 'Paused', ERROR: 'Error' };
  ui.setStatus({ state: labels[state], detail: statusDetail() });
  btnStart.disabled = state === 'LOADING' || state === 'ERROR';
  btnStart.textContent = state === 'WATCHING' ? 'Stop' : state === 'PAUSED' ? 'Resume' : 'Start';
  btnStart.classList.toggle('stop', state === 'WATCHING');
  btnDim.disabled = state !== 'WATCHING';
  document.getElementById('watch-hint').hidden = state === 'WATCHING';
}

function statusDetail() {
  if (app.state !== 'WATCHING' || !app.cam) return app.backend ? `detector: ${app.backend}` : '';
  const fps = app.stats.fps ? `${app.stats.fps.toFixed(1)} fps${app.idle ? ' (idle)' : ''}` : 'starting';
  const ms = app.stats.detectMs ? ` · ${Math.round(app.stats.detectMs)} ms` : '';
  return `${fps}${ms} · faces ${app.faceCount} · known ${app.knownCount}`;
}

async function boot() {
  initLog(document.getElementById('log'), { onError: () => toggleLog(true) });
  document.getElementById('version').textContent = VERSION;
  app.settings = loadSettings();
  log(`SnipeCam ${VERSION} · ${navigator.userAgent}`);
  await openDb();
  await reloadMembers();
  wireUi();
  setState('LOADING');
  await loadDetector();
  // Test hook: ?autostart starts the camera without a tap (used by automated browser tests).
  if (new URLSearchParams(location.search).has('autostart')) startWatch();
}

async function reloadMembers() {
  app.members = await listMembers();
  log(`Roster: ${app.members.length} member${app.members.length === 1 ? '' : 's'}`);
}

async function loadDetector() {
  const wasWatching = app.state === 'WATCHING';
  if (wasWatching) stopLoop();
  setState('LOADING');
  const t0 = performance.now();
  try {
    app.backend = await initDetector({ ...app.settings, onProgress: ui.progress });
  } catch (err) {
    ui.progress(null);
    log(err, 'error');
    setState('ERROR');
    return;
  }
  log(`Detector ready: ${app.backend} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  setState(wasWatching ? 'WATCHING' : 'READY');
  if (wasWatching) startLoop();
}

async function startWatch() {
  unlockAudio();
  try {
    app.cam = await startCamera(video, app.settings);
  } catch (err) {
    ui.toast(cameraErrorMessage(err), 6000);
    log(err, 'warn');
    setState('READY');
    return;
  }
  app.awake = await keepAwake(true);
  log(`Camera ${app.cam.width}×${app.cam.height}; keep-awake: ${app.awake}`);
  setState('WATCHING');
  startLoop();
}

async function stopWatch(nextState = 'READY') {
  stopLoop();
  stopCamera(video);
  app.awake = await keepAwake(false);
  setDim(false);
  setState(nextState);
}

function startLoop() {
  stopLoop();
  app.stats.reset();
  app.lastFaceAt = performance.now(); // start at full rate
  tick();
}

function stopLoop() {
  clearTimeout(app.timer);
  app.timer = null;
  ui.clearOverlay(overlay);
}

async function tick() {
  if (app.state !== 'WATCHING') return;
  const started = performance.now();
  if (!app.busy && video.readyState >= 2) {
    app.busy = true;
    let frame = null;
    try {
      frame = await grabFrame(video, app.settings.zoom);
      const faces = await detect(frame.bitmap, { tiles: app.settings.tiles });
      app.stats.record(started, performance.now() - started);
      const results = matchFaces(faces, app.members, app.settings);
      app.faceCount = faces.length;
      app.knownCount = results.filter((r) => r.match).length;
      if (faces.length) app.lastFaceAt = performance.now();
      ui.renderFaces(overlay, results, {
        videoW: video.videoWidth, videoH: video.videoHeight, crop: frame.crop,
        debug: app.settings.debugFaces, showLabels: app.settings.showLabels,
      });
      ui.setStatus({ detail: statusDetail() });
    } catch (err) {
      log(err, 'error');
    } finally {
      frame?.bitmap.close();
      app.busy = false;
    }
  }
  if (app.state !== 'WATCHING') return;
  const { delay, idle } = nextDelay({ now: performance.now(), lastFaceAt: app.lastFaceAt, elapsedMs: performance.now() - started, ...app.settings });
  app.idle = idle;
  app.timer = setTimeout(tick, delay);
}

function onVisibility() {
  // iOS stops the camera when the app is hidden; pause cleanly and let the user resume.
  if (document.hidden && app.state === 'WATCHING') {
    stopWatch('PAUSED');
    log('Paused: app hidden');
  }
}

function onSettingChange(key, value) {
  const prev = app.settings;
  app.settings = validate({ ...prev, [key]: value });
  saveSettings(app.settings);
  if (prev[key] === app.settings[key]) return;
  if (DETECTOR_KEYS.includes(key)) {
    log(`Detector setting ${key} changed; reloading detector`);
    loadDetector();
  } else if (app.state === 'WATCHING' && CAMERA_KEYS.includes(key)) {
    log(`Camera setting ${key} changed; restarting camera`);
    startWatch();
  }
}

async function openSettings() {
  let cameras = [];
  try { cameras = await listCameras(); } catch (err) { log(err, 'warn'); }
  ui.renderSettings(app.settings, onSettingChange, { cameras });
  ui.showView('settings');
}

function wireUi() {
  btnStart.addEventListener('click', () => {
    if (app.state === 'WATCHING') stopWatch();
    else startWatch();
  });
  btnDim.addEventListener('click', () => setDim(true, `Watching · ${app.backend}`));
  document.getElementById('dim').addEventListener('click', () => setDim(false));

  for (const btn of document.querySelectorAll('[data-go]')) {
    const go = btn.dataset.go;
    btn.addEventListener('click', () => (go === 'settings' ? openSettings() : go === 'roster' ? showRoster() : ui.showView(go)));
  }
  initRoster({ onChanged: reloadMembers });

  document.getElementById('btn-log').addEventListener('click', () => toggleLog());
  document.getElementById('btn-log-close').addEventListener('click', () => toggleLog(false));
  document.getElementById('btn-reset').addEventListener('click', () => {
    const prev = app.settings;
    app.settings = validate(DEFAULTS);
    saveSettings(app.settings);
    openSettings();
    ui.toast('Settings reset');
    if (DETECTOR_KEYS.some((k) => prev[k] !== app.settings[k])) loadDetector();
  });

  document.addEventListener('visibilitychange', onVisibility);
}

boot().catch((err) => {
  log(err, 'error');
  ui.setStatus({ state: 'Error', detail: String(err.message ?? err) });
});
