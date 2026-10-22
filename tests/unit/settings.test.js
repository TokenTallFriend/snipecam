import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, STORAGE_KEY, validate, loadSettings, saveSettings } from '../../js/settings.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

const throwingStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
};

test('T-SET-1: empty storage returns defaults', () => {
  assert.deepEqual(loadSettings(memoryStorage()), { ...DEFAULTS });
});

test('T-SET-2: corrupt JSON returns defaults without throwing', () => {
  assert.deepEqual(loadSettings(memoryStorage({ [STORAGE_KEY]: '{not json' })), { ...DEFAULTS });
  assert.deepEqual(loadSettings(memoryStorage({ [STORAGE_KEY]: '42' })), { ...DEFAULTS });
});

test('T-SET-3: out-of-range values are clamped', () => {
  const s = validate({ threshold: 5, processFps: 0, minHits: 2.6, width: 99999 });
  assert.equal(s.threshold, 1);
  assert.equal(s.processFps, 0.2);
  assert.equal(s.minHits, 3);
  assert.equal(s.width, 3840);
});

test('T-SET-3b: wrong types fall back to defaults', () => {
  const s = validate({ threshold: 'abc', showLabels: 'yes', reminderAt: '25:00', alert: 'loud', zoom: '2', rehearsals: 'x' });
  assert.equal(s.threshold, DEFAULTS.threshold);
  assert.equal(s.showLabels, DEFAULTS.showLabels);
  assert.equal(s.reminderAt, DEFAULTS.reminderAt);
  assert.equal(s.alert, DEFAULTS.alert);
  assert.equal(s.zoom, 2);
  assert.deepEqual(s.rehearsals, []);
});

test('T-SET-4: stored object missing keys gets defaults; unknown mode becomes tripod', () => {
  const s = loadSettings(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ threshold: 0.7, mode: 'nope', junk: 1 }) }));
  assert.equal(s.threshold, 0.7);
  assert.equal(s.mode, 'tripod');
  assert.equal(s.processFps, DEFAULTS.processFps);
  assert.equal('junk' in s, false);
});

test('T-SET-5: throwing storage gives defaults and save does not throw', () => {
  assert.deepEqual(loadSettings(throwingStorage), { ...DEFAULTS });
  assert.equal(saveSettings(DEFAULTS, throwingStorage), false);
  assert.deepEqual(loadSettings(undefined), { ...DEFAULTS });
});

test('T-SET-6: save then load round-trips', () => {
  const st = memoryStorage();
  saveSettings({ ...DEFAULTS, threshold: 0.62, alert: 'sound' }, st);
  const s = loadSettings(st);
  assert.equal(s.threshold, 0.62);
  assert.equal(s.alert, 'sound');
});
