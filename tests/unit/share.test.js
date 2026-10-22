import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagText, snipeFilename } from '../../js/share.js';

test('T-SHR-1: tagText uses Slack handles, falls back to names, empty for nobody', () => {
  assert.equal(tagText([{ name: 'Alice', slack: '@alice' }, { name: 'Bob', slack: '' }]), '🎯 Sniped @alice Bob');
  assert.equal(tagText([]), '');
});

test('T-SHR-2: snipeFilename is dated, zero-padded, and slugs names', () => {
  const d = new Date(2026, 0, 5, 9, 3, 7);
  assert.equal(snipeFilename(d, ['Alice Smith', 'Zoë']), 'snipe-2026-01-05-090307-alice-smith-zoe.jpg');
  assert.equal(snipeFilename(d), 'snipe-2026-01-05-090307.jpg');
});
