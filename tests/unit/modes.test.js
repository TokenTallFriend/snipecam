import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, getMode } from '../../js/modes/index.js';
import { MODES as SETTING_MODES } from '../../js/settings.js';

test('T-MOD-1: registry — unknown id falls back to tripod; every mode implements the interface', () => {
  assert.equal(getMode('nope').id, 'tripod');
  for (const [id, m] of Object.entries(MODES)) {
    assert.equal(m.id, id);
    for (const fn of ['start', 'tick', 'stop', 'onLocksChanged', 'onDayChanged']) assert.equal(typeof m[fn], 'function', `${id}.${fn}`);
  }
  assert.deepEqual(Object.keys(MODES).sort(), [...SETTING_MODES].sort(), 'settings MODES and registry agree');
});
