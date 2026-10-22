// App bootstrap, state machine, and wiring between modules.

import { loadSettings, saveSettings, validate, DEFAULTS } from './settings.js';
import { initLog, log, toggleLog } from './log.js';
import { startCamera, stopCamera, listCameras, cameraErrorMessage } from './camera.js';
import { keepAwake, unlockAudio, setDim } from './device.js';
import * as ui from './ui.js';

export const VERSION = 'P1';

const CAMERA_KEYS = ['facingMode', 'deviceId', 'width', 'height'];

const app = {
  state: 'LOADING', // LOADING | READY | WATCHING | PAUSED
  settings: null,
  cam: null, // { width, height }
  awake: 'off',
};

const video = document.getElementById('video');
const btnStart = document.getElementById('btn-start');
const btnDim = document.getElementById('btn-dim');

function setState(state) {
  app.state = state;
  const labels = { LOADING: 'Loading…', READY: 'Ready', WATCHING: 'Watching', PAUSED: 'Paused' };
  ui.setStatus({ state: labels[state], detail: statusDetail() });
  btnStart.disabled = state === 'LOADING';
  btnStart.textContent = state === 'WATCHING' ? 'Stop' : state === 'PAUSED' ? 'Resume' : 'Start';
  btnStart.classList.toggle('stop', state === 'WATCHING');
  btnDim.disabled = state !== 'WATCHING';
  document.getElementById('watch-hint').hidden = state === 'WATCHING';
}

function statusDetail() {
  if (app.state !== 'WATCHING' || !app.cam) return '';
  return `${app.cam.width}×${app.cam.height} · awake: ${app.awake}`;
}

async function boot() {
  initLog(document.getElementById('log'), { onError: () => toggleLog(true) });
  document.getElementById('version').textContent = VERSION;
  app.settings = loadSettings();
  log(`SnipeCam ${VERSION} · ${navigator.userAgent}`);
  wireUi();
  setState('READY');
  // Test hook: ?autostart starts the camera without a tap (used by automated browser tests).
  if (new URLSearchParams(location.search).has('autostart')) startWatch();
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
}

async function stopWatch(nextState = 'READY') {
  stopCamera(video);
  app.awake = await keepAwake(false);
  setDim(false);
  setState(nextState);
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
  if (app.state === 'WATCHING' && CAMERA_KEYS.includes(key) && prev[key] !== app.settings[key]) {
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
  btnDim.addEventListener('click', () => setDim(true, `Watching · ${app.cam?.width}×${app.cam?.height}`));
  document.getElementById('dim').addEventListener('click', () => setDim(false));

  for (const btn of document.querySelectorAll('[data-go]')) {
    btn.addEventListener('click', () => (btn.dataset.go === 'settings' ? openSettings() : ui.showView(btn.dataset.go)));
  }

  document.getElementById('btn-log').addEventListener('click', () => toggleLog());
  document.getElementById('btn-log-close').addEventListener('click', () => toggleLog(false));
  document.getElementById('btn-reset').addEventListener('click', () => {
    app.settings = validate(DEFAULTS);
    saveSettings(app.settings);
    openSettings();
    ui.toast('Settings reset');
  });

  document.addEventListener('visibilitychange', onVisibility);
}

boot().catch((err) => {
  log(err, 'error');
  ui.setStatus({ state: 'Error', detail: String(err.message ?? err) });
});
