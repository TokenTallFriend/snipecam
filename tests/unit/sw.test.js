import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');
const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));

test('T-SW-1: offline file list covers every app module and the files index.html links', () => {
  const js = readdirSync(new URL('js/', root), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`);
  for (const f of js) assert.ok(shell.includes(f), `${f} missing from sw.js SHELL`);
  const html = readFileSync(new URL('index.html', root), 'utf8');
  for (const [, href] of html.matchAll(/(?:href|src)="([^"#:]+)"/g)) assert.ok(shell.includes(href), `${href} (linked from index.html) missing from SHELL`);
  for (const f of shell.filter((x) => x !== './')) readFileSync(new URL(f, root)); // every listed file exists
});
