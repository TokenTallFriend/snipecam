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
