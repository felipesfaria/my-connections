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
  const words = () => chips().map((c) => c.textContent);
  const gridRows = () => [...document.querySelectorAll('#mc-panel .mc-row')];
  const grips = () => [...document.querySelectorAll('#mc-panel .mc-rowgrip')];
  const dragTo = (from, to) => {
    const dt = new DataTransfer();
    const fire = (el, type, cancelable = false) =>
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable, dataTransfer: dt }));
    fire(from, 'dragstart');
    fire(to, 'dragover', true);
    fire(to, 'drop', true);
    fire(from, 'dragend');
  };
  const stored = () => Object.values(chrome.storage.local._data)[0];
  const rows = () => [...document.querySelectorAll('#mc-panel .mc-guess')];
  const pick = (words) => { for (const w of words) chips().find((c) => c.textContent === w)?.click(); };
  const guessColor = (i) =>
    getComputedStyle(rows()[i].querySelector('.mc-word')).backgroundColor;
  const solvedRows = () => [...document.querySelectorAll('#mc-panel .mc-done')];
  const solvedList = (i) => solvedRows()[i].querySelector('.mc-list').textContent;

  const panel = await waitFor(() => document.getElementById('mc-panel'));
  check('panel mounts when the board appears', () => panel);
  await waitFor(() => chips().length === 16);
  check('mirrors all 16 words', () => chips().length === 16);
  check('reads each word once, not once per rendered copy', () => {
    const onBoard = [...document.querySelectorAll('.card')].map((c) => c.dataset.word).sort();
    return chips().map((c) => c.textContent).sort().join() === onBoard.join();
  });

  // Drag the first word onto the sixth: the two swap places.
  const before = words();
  dragTo(chips()[0], chips()[5]);
  await sleep(100);
  const after = words();
  check('drag swaps the two words', () => after[5] === before[0] && after[0] === before[5]);
  check('the other words stay put', () =>
    after.every((w, i) => i === 0 || i === 5 || w === before[i]));
  await sleep(400);
  check('layout is persisted', () => {
    const { order } = stored();
    return order[5] === before[0] && order[0] === before[5];
  });

  // Drag the second row's handle onto the fourth row: the two rows swap whole.
  check('the grid is laid out as four rows with a handle each', () =>
    gridRows().length === 4 && grips().length === 4);
  const beforeRows = words();
  dragTo(grips()[1], gridRows()[3]);
  await sleep(100);
  const afterRows = words();
  const row = (list, i) => list.slice(i * 4, i * 4 + 4).join();
  check('dragging a row handle swaps the two rows', () =>
    row(afterRows, 1) === row(beforeRows, 3) && row(afterRows, 3) === row(beforeRows, 1));
  check('the rows in between stay put', () =>
    row(afterRows, 0) === row(beforeRows, 0) && row(afterRows, 2) === row(beforeRows, 2));
  await sleep(400);
  check('the row order is persisted', () => stored().order.join() === afterRows.join());

  // A word dragged onto a row, or a row onto a word, must not cross the wires.
  dragTo(chips()[0], grips()[2]);
  await sleep(100);
  check('dropping a word on a row handle changes nothing', () =>
    words().join() === afterRows.join());

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
  check('a near miss reads orange', () => guessColor(0) === 'rgb(232, 144, 60)');

  pick(['NAVY', 'ROYAL', 'SKY', 'TEAL']);
  await sleep(200);
  document.getElementById('submit').click();
  await sleep(3400);
  // A solved group stays in the grid, as the board keeps it — not in the miss list.
  check('a solved group stays in the grid', () =>
    solvedRows().length === 1 && solvedList(0).split(', ').sort().join() === 'NAVY,ROYAL,SKY,TEAL');
  check('its words are written out with commas, as the board writes them', () =>
    /^[A-Z]+(, [A-Z]+){3}$/.test(solvedList(0)));
  check('a solved group is not listed as a miss', () =>
    rows().length === 1 && rows()[0].classList.contains('mc-one-away'));
  check('the solved group sits above the words still in play', () =>
    document.querySelector('#mc-panel .mc-grid').firstElementChild === solvedRows()[0]);
  check('the category name is on the solved group', () =>
    /shades of blue/i.test(solvedRows()[0].querySelector('.mc-name').textContent));
  // Shades of blue is the yellow row on the mock board.
  check('a solved group takes the colour of its row', () =>
    getComputedStyle(solvedRows()[0]).backgroundColor === 'rgb(249, 223, 109)');
  check('the row colour is persisted', () => stored().guesses[1].color === 'rgb(249, 223, 109)');
  check('solved words are no longer draggable chips', () => chips().length === 12);
  check('a solved group cannot be dragged', () => grips().length === 3);

  pick(['HEARTS', 'SPIT', 'CROW', 'CHALK']);
  await sleep(200);
  document.getElementById('submit').click();
  await sleep(3400);
  check('a plain miss is logged as wrong', () =>
    rows().length === 2 && rows()[1].classList.contains('mc-wrong'));
  check('a plain miss reads red', () => guessColor(1) === 'rgb(192, 57, 43)');
  check('every miss lists its four words', () => rows()[1].querySelectorAll('.mc-word').length === 4);
  check('the misses are counted, the solved group is not', () =>
    document.querySelector('#mc-panel .mc-count').textContent === '(2)');
  check('every guess reaches storage', () => stored().guesses.length === 3);

  // HEARTS, SPIT, CROW, CHALK came back wrong rather than one away, so no
  // three of them share a group and any selection around three is a dead end.
  const warning = () => document.querySelector('#mc-panel .mc-warn');
  const flagged = () =>
    [...document.querySelectorAll('#mc-panel .mc-chip.mc-flag')].map((c) => c.textContent).sort();
  const clear = async () => { document.getElementById('deselect').click(); await sleep(150); };

  await clear();
  pick(['HEARTS', 'SPIT', 'CROW', 'TOWEL']);
  await sleep(200);
  check('warns about a selection the history rules out', () => !warning().hidden);
  check('names the three ruled-out words', () => {
    const text = warning().textContent;
    return ['HEARTS', 'SPIT', 'CROW'].every((w) => text.includes(w)) && !text.includes('TOWEL');
  });
  check('flags only those three chips', () => flagged().join() === 'CROW,HEARTS,SPIT');

  await clear();
  pick(['HEARTS', 'SPIT', 'TOWEL', 'SURF']);
  await sleep(200);
  check('stays quiet when only two words were ruled out together', () => warning().hidden);
  check('flags nothing then', () => flagged().length === 0);

  await clear();
  pick(['HEARTS', 'SPIT', 'CROW', 'CHALK']);
  await sleep(200);
  check('warns when the exact four were already submitted', () =>
    !warning().hidden && /already guessed/i.test(warning().textContent));

  await clear();

  // The deduction itself, away from the board.
  const deduce = (selection, guesses) => __myConnections.deduce.check(selection, guesses);
  const wrong = [{ words: ['A', 'B', 'C', 'D'], result: 'wrong' }];
  const nearMiss = [{ words: ['A', 'B', 'C', 'D'], result: 'one-away' }];
  check('a one-away guess rules nothing out', () => deduce(['A', 'B', 'C', 'E'], nearMiss) === null);
  check('three words from a wrong guess are ruled out', () => {
    const found = deduce(['A', 'B', 'C', 'E'], wrong);
    return found?.kind === 'ruled-out' && found.words.sort().join() === 'A,B,C';
  });
  check('two shared words are not enough', () => deduce(['A', 'B', 'X', 'Y'], wrong) === null);
  check('it fires as soon as the third word is picked', () =>
    deduce(['A', 'B', 'C'], wrong)?.kind === 'ruled-out');

  // Long words have to shrink to fit: a chip reading INTERSTITIA / L is worse
  // than a smaller font. Several words still wrap at their spaces.
  const LONG = ['INTERSTITIAL', 'CONSTELLATION', 'ROCK AND ROLL', 'SKYSCRAPER'];
  [...document.querySelectorAll('.card')].slice(0, 4).forEach((card, i) => {
    card.dataset.word = LONG[i];
    const label = LONG[i][0] + LONG[i].slice(1).toLowerCase();
    for (const span of card.querySelectorAll('span')) span.textContent = label;
  });
  __myConnections.board.refresh();
  await sleep(300);

  const widest = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return Math.max(0, ...[...range.getClientRects()].map((r) => r.width));
  };
  const room = (el) => {
    const s = getComputedStyle(el);
    return el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
  };
  const lineCount = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getClientRects().length;
  };
  const chipFor = (word) => chips().find((c) => c.textContent === word);

  check('a long word is shrunk to fit its chip', () => {
    const chip = chipFor('INTERSTITIAL');
    return chip && widest(chip) <= room(chip);
  });
  check('it is not split across lines', () => lineCount(chipFor('INTERSTITIAL')) === 1);
  check('a longer word shrinks further', () => {
    const chip = chipFor('CONSTELLATION');
    return widest(chip) <= room(chip) && lineCount(chip) === 1;
  });
  check('the grid still fits inside the panel', () => {
    // The grid grows its own box, so it never overflows itself: a column wide
    // enough to hold a long word pushes the panel instead.
    const grid = document.querySelector('#mc-panel .mc-grid');
    return grid.getBoundingClientRect().width <= panel.getBoundingClientRect().width;
  });
  check('several words still wrap at the space, at full size', () => {
    const chip = chipFor('ROCK AND ROLL');
    return lineCount(chip) === 2 && getComputedStyle(chip).fontSize === '12px';
  });
  check('short words keep the base size', () => {
    const short = chips().find((c) => c.textContent.length <= 4);
    return getComputedStyle(short).fontSize === '12px';
  });

  // Fallback path: without test ids the board has to be found by its text.
  for (const card of document.querySelectorAll('.card')) delete card.dataset.testid;
  __myConnections.board.refresh();
  await sleep(200);
  check('finds the board without test ids', () => {
    const onBoard = [...document.querySelectorAll('.card')].map((c) => c.dataset.word).sort();
    return __myConnections.board.words().sort().join() === onBoard.join();
  });
  check('a partly solved board still fills whole rows', () =>
    gridRows().every((r) => r.querySelectorAll('.mc-chip').length === 4));
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
