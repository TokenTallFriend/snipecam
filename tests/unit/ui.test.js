import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapBox } from '../../js/ui.js';

const close = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} vs ${b}`));

test('T-UI-1: mapBox is identity when sizes match, scales when aspect matches', () => {
  close(mapBox([10, 20, 30, 40], 1920, 1080, 1920, 1080), [10, 20, 30, 40]);
  close(mapBox([10, 20, 30, 40], 1920, 1080, 960, 540), [5, 10, 15, 20]);
});

test('T-UI-2: mapBox cover-crops a 16:9 source into a 9:16 view', () => {
  // View 1080x1920: scale = max(1080/1920, 1920/1080) = 1.777…; scaled source is 3413.3 wide, offset x = -1166.7
  const scale = 1920 / 1080;
  const offX = (1080 - 1920 * scale) / 2;
  close(mapBox([960, 540, 100, 100], 1920, 1080, 1080, 1920), [960 * scale + offX, 540 * scale, 100 * scale, 100 * scale]);
  // Source center maps to view center
  const [cx, cy] = mapBox([960, 540, 0, 0], 1920, 1080, 1080, 1920);
  close([cx, cy], [540, 960]);
});
