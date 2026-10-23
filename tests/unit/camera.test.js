import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraErrorMessage } from '../../js/camera.js';

test('T-CAM-6: camera errors map to readable messages', () => {
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /permission denied/i);
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /no camera/i);
  assert.match(cameraErrorMessage({ name: 'NotReadableError' }), /busy/i);
  assert.match(cameraErrorMessage({ name: 'OverconstrainedError' }), /unavailable/i);
  assert.match(cameraErrorMessage(new Error('boom')), /boom/);
});

import { zoomPlan } from '../../js/camera.js';

test('T-CAM-7: zoomPlan prefers camera zoom, tops up digitally, and falls back to digital', () => {
  assert.deepEqual(zoomPlan(2, { zoom: { min: 1, max: 10 } }), { hardware: 2, digital: 1 });
  assert.deepEqual(zoomPlan(4, { zoom: { min: 1, max: 2 } }), { hardware: 2, digital: 2 });
  assert.deepEqual(zoomPlan(1, { zoom: { min: 1, max: 10 } }), { hardware: 1, digital: 1 });
  assert.deepEqual(zoomPlan(2, {}), { hardware: null, digital: 2 });
  assert.deepEqual(zoomPlan(2, undefined), { hardware: null, digital: 2 });
  assert.deepEqual(zoomPlan(2, { zoom: { min: 1, max: 1 } }), { hardware: null, digital: 2 }); // no real range
});

import { captureSize, describeCamera } from '../../js/camera.js';

test('T-CAM-9: captureSize asks for 4K only when zoomed in', () => {
  assert.deepEqual(captureSize({ width: 1920, height: 1080, zoom: 1 }), { width: 1920, height: 1080 });
  assert.deepEqual(captureSize({ width: 1920, height: 1080, zoom: 2 }), { width: 3840, height: 2160 });
  assert.deepEqual(captureSize({ width: 1280, height: 720, zoom: 1.5 }), { width: 3840, height: 2160 });
});

test('T-CAM-10: describeCamera reports resolution, max, and zoom support', () => {
  assert.equal(describeCamera({ label: 'Back Camera', width: 3840, height: 2160, maxWidth: 4032, maxHeight: 3024, zoom: { min: 1, max: 10 } }),
    'Back Camera: 3840×2160 (max 4032×3024); camera zoom 1–10×');
  assert.equal(describeCamera({ label: 'Back Camera', width: 1920, height: 1080, zoom: null }), 'Back Camera: 1920×1080; no camera zoom (digital crop only)');
  assert.equal(describeCamera(null), 'Camera not running');
});
