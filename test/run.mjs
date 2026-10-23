/*
 * Drives test/mock-board.html in headless Chrome over the DevTools protocol and
 * checks the panel does what it promises. Run it with: node test/run.mjs
 *
 * Set CHROME=<path to chrome.exe> if Chrome lives somewhere unusual.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(resolve(here, 'mock-board.html')).href;
const PORT = 9333;

function chromePath() {
  const candidates = [
    process.env.CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found — set the CHROME environment variable.');
  return found;
}

const TEST = `(async () => {
  const log = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, fn) => {
    try { log.push([name, !!fn()]); } catch (e) { log.push([name, false, String(e)]); }
  };
  const waitFor = async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); }
    return null;
  };
  const chips = () => [...document.querySelectorAll('#mc-panel .mc-chip')];
  const rows = () => [...document.querySelectorAll('#mc-panel .mc-guess')];
  const notes = () =>
    [...document.querySelectorAll('#mc-panel .mc-note')].map((n) => n.textContent).join(' | ');
  const pick = (words) => { for (const w of words) chips().find((c) => c.textContent === w)?.click(); };

  const panel = await waitFor(() => document.getElementById('mc-panel'));
  check('panel mounts when the board appears', () => panel);
  await waitFor(() => chips().length === 16);
  check('mirrors all 16 words', () => chips().length === 16);
  check('reads each word once, not once per rendered copy', () => {
    const onBoard = [...document.querySelectorAll('.card')].map((c) => c.dataset.word).sort();
    return chips().map((c) => c.textContent).sort().join() === onBoard.join();
  });

  // Drag the first word onto the sixth: the two swap places.
  const before = chips().map((c) => c.textContent);
  const dt = new DataTransfer();
  const from = chips()[0], to = chips()[5];
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  await sleep(100);
  const after = chips().map((c) => c.textContent);
  check('drag swaps the two words', () => after[5] === before[0] && after[0] === before[5]);
  check('the other words stay put', () =>
    after.every((w, i) => i === 0 || i === 5 || w === before[i]));
  await sleep(400);
  check('layout is persisted', () => {
    const { order } = Object.values(chrome.storage.local._data)[0];
    return order[5] === before[0] && order[0] === before[5];
  });

  // Clicks must still work after a drag: the dropped chip is a new node.
  const chip = chips()[0];
  const card = [...document.querySelectorAll('.card')].find((c) => c.dataset.word === chip.textContent);
  chip.click();
  await sleep(150);
  check('clicking a chip selects the board tile', () => card.getAttribute('aria-pressed') === 'true');
  check('the chip shows the selection', () => chip.classList.contains('mc-sel'));
  chip.click();
  await sleep(150);
  check('clicking it again deselects', () =>
    card.getAttribute('aria-pressed') === 'false' && !chip.classList.contains('mc-sel'));

  pick(['NAVY', 'ROYAL', 'SKY', 'BRIDGE']);
  await sleep(200);
  check('four words selected on the board', () => __myConnections.board.selection().length === 4);
  document.getElementById('submit').click();
  await sleep(3400);
  check('a near miss is logged as one away', () =>
    rows().length === 1 && rows()[0].classList.contains('mc-one-away'));

  pick(['NAVY', 'ROYAL', 'SKY', 'TEAL']);
  await sleep(200);
  document.getElementById('submit').click();
  await sleep(3400);
  check('a solved group is logged as correct', () =>
    rows().length === 2 && rows()[1].classList.contains('mc-correct'));
  check('the category name is captured', () => /shades of blue/i.test(notes()));
  check('solved words leave the grid', () => chips().length === 12);

  pick(['HEARTS', 'SPIT', 'CROW', 'CHALK']);
  await sleep(200);
  document.getElementById('submit').click();
  await sleep(3400);
  check('a plain miss is logged as wrong', () =>
    rows().length === 3 && rows()[2].classList.contains('mc-wrong'));
  check('every guess lists its four words', () => rows()[2].querySelectorAll('.mc-word').length === 4);
  check('guesses reach storage', () =>
    Object.values(chrome.storage.local._data)[0].guesses.length === 3);

  // Fallback path: without test ids the board has to be found by its text.
  for (const card of document.querySelectorAll('.card')) delete card.dataset.testid;
  __myConnections.board.refresh();
  await sleep(200);
  check('finds the board without test ids', () => {
    const onBoard = [...document.querySelectorAll('.card')].map((c) => c.dataset.word).sort();
    return __myConnections.board.words().sort().join() === onBoard.join();
  });
  return log;
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'mc-chrome-'));
const browser = spawn(chromePath(), [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  PAGE,
]);

async function debuggerUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes('mock-board'));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome never exposed a debugging target');
}

function evaluate(ws, expression) {
  return new Promise((resolve, reject) => {
    ws.addEventListener('message', function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      ws.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else if (message.result?.exceptionDetails)
        reject(new Error(JSON.stringify(message.result.exceptionDetails)));
      else resolve(message.result.result.value);
    });
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      })
    );
  });
}

let failures = 0;
try {
  const ws = new WebSocket(await debuggerUrl());
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok);
    ws.addEventListener('error', fail);
  });
  for (const [name, passed, error] of await evaluate(ws, TEST)) {
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${error ? ` — ${error}` : ''}`);
    if (!passed) failures++;
  }
  ws.close();
  console.log(failures ? `\n${failures} failing` : '\nall checks passed');
} catch (err) {
  console.error('ERROR', err.message);
  failures = 1;
} finally {
  browser.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(failures ? 1 : 0);
}
