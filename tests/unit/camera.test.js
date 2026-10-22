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
