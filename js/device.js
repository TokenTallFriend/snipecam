// Keep the screen awake, play alert sounds, and dim the screen.

import { log } from './log.js';

let wakeLock = null;
let wantAwake = false;
let fallbackVideo = null;
let audioCtx = null;

// Returns how the screen is being kept awake: 'wakelock', 'fallback', or 'off'.
export async function keepAwake(on) {
  wantAwake = on;
  if (!on) {
    await wakeLock?.release().catch(() => {});
    wakeLock = null;
    fallbackVideo?.pause();
    return 'off';
  }
  return acquire();
}

async function acquire() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      return 'wakelock';
    } catch (err) {
      log(`Wake lock unavailable (${err.message}); using video fallback`, 'warn');
    }
  }
  startFallback();
  return 'fallback';
}

// NoSleep technique: a tiny muted looping video keeps iOS from auto-locking.
function startFallback() {
  if (!fallbackVideo) {
    fallbackVideo = document.createElement('video');
    Object.assign(fallbackVideo, { src: 'assets/nosleep.mp4', loop: true, muted: true, playsInline: true });
    fallbackVideo.setAttribute('playsinline', '');
    fallbackVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none;';
    document.body.append(fallbackVideo);
  }
  fallbackVideo.play().catch((err) => log(`Wake fallback failed: ${err.message}`, 'warn'));
}

// The OS drops the wake lock when the page is hidden; take it back when visible again.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wantAwake && document.visibilityState === 'visible' && !wakeLock) acquire();
  });
}

// Must be called inside a tap handler, or iOS keeps audio muted.
export function unlockAudio() {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

export function beep(freq = 880, ms = 150) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + ms / 1000);
}

export function isDim() {
  return !document.getElementById('dim').hidden;
}

// Black overlay on top of the video. The video keeps playing underneath, so detection continues.
export function setDim(on, statusText = '') {
  const el = document.getElementById('dim');
  el.hidden = !on;
  if (statusText) document.getElementById('dim-text').textContent = statusText;
}
