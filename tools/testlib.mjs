// Shared helpers for automated browser runs: a throwaway static server and browser launchers.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export async function startServer(port = 8000 + Math.floor(Math.random() * 1000)) {
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(base);
      return { base, stop: () => proc.kill() };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  proc.kill();
  throw new Error('static server did not start');
}

// Launch options that give each engine a fake camera where supported.
export const ENGINES = {
  chromium: { type: chromium, launch: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }, fakeCamera: true },
  firefox: { type: firefox, launch: { firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } }, fakeCamera: true },
  webkit: { type: webkit, launch: {}, fakeCamera: false },
};

export async function launch(name) {
  const e = ENGINES[name];
  return e.type.launch({ headless: true, ...e.launch });
}
