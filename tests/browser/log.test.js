import { test, assert } from '../harness.js';
import { initLog, log, getLines, MAX_LINES } from '../../js/log.js';

const panel = document.createElement('div');
panel.hidden = true;
panel.innerHTML = '<div class="log-body"></div>';
document.body.append(panel);
const errors = [];
initLog(panel, { onError: (line) => errors.push(line) });

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const hasLine = (text) => getLines().some((l) => l.msg.includes(text));

test('T-LOG-1', 'error thrown in setTimeout appears in panel', async () => {
  setTimeout(() => { throw new Error('log-test-thrown'); });
  await tick();
  assert.ok(hasLine('log-test-thrown'), 'thrown error not logged');
  assert.ok(panel.textContent.includes('log-test-thrown'), 'not rendered in panel');
  assert.ok(errors.some((l) => l.msg.includes('log-test-thrown')), 'onError not called');
});

test('T-LOG-2', 'unhandled promise rejection appears in panel', async () => {
  Promise.reject(new Error('log-test-rejected'));
  await tick(200);
  assert.ok(hasLine('log-test-rejected'), 'rejection not logged');
});

test('T-LOG-3', 'more than MAX_LINES lines drops the oldest', () => {
  log('log-test-first');
  for (let i = 0; i < MAX_LINES + 5; i++) log(`filler ${i}`);
  assert.equal(getLines().length, MAX_LINES);
  assert.equal(panel.querySelector('.log-body').childElementCount, MAX_LINES);
  assert.ok(!hasLine('log-test-first'), 'oldest line not dropped');
});

test('T-LOG-5', 'console.warn is captured with warn level', () => {
  console.warn('log-test-warn');
  assert.ok(getLines().some((l) => l.level === 'warn' && l.msg.includes('log-test-warn')));
});
