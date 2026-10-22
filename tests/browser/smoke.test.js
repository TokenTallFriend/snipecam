import { test, assert } from '../harness.js';

test('T-P0-B', 'harness runs in browser', () => {
  assert.equal(1 + 1, 2);
});
