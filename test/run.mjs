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

  // "Revelar respostas": off until asked, nothing fetched until then.
  const toggle = document.querySelector('#mc-panel .mc-toggle-input');
  const ansList = document.querySelector('#mc-panel .mc-ans-list');
  const ansItems = () => [...document.querySelectorAll('#mc-panel .mc-ans-item')];
  const ansButtons = () => [...document.querySelectorAll('#mc-panel .mc-ans')];
  check('the answers toggle is there and starts off', () => toggle && !toggle.checked);
  check('no answer buttons are showing by default', () => ansList.hidden && ansButtons().every((b) => b.offsetParent === null));
  check('nothing is fetched while the toggle is off', () => window.__answerFetches === 0);
  toggle.click();
  await waitFor(() => ansButtons().length === 4);
  check('turning it on shows four buttons', () => !ansList.hidden && ansButtons().length === 4);
  check('each button carries that day\u2019s title', () =>
    ansButtons().map((b) => b.textContent).join('|') === 'Shades of blue|Card games|Kinds of bar|___ board');
  check('the answers are fetched once, on demand', () => window.__answerFetches === 1);
  check('the words stay hidden until a button is clicked', () =>
    ansItems().every((i) => i.querySelector('.mc-ans-words').hidden));
  ansButtons()[0].click();
  await sleep(100);
  check('clicking a title reveals that group\u2019s words', () => {
    const words = ansItems()[0].querySelector('.mc-ans-words');
    return !words.hidden && words.textContent.split(', ').sort().join() === 'NAVY,ROYAL,SKY,TEAL';
  });
  check('the other groups stay hidden', () =>
    ansItems().slice(1).every((i) => i.querySelector('.mc-ans-words').hidden));
  check('an opened group takes its row colour', () =>
    getComputedStyle(ansItems()[0]).backgroundColor === 'rgb(249, 223, 109)');
  ansButtons()[0].click();
  await sleep(100);
  check('clicking it again hides the words', () => ansItems()[0].querySelector('.mc-ans-words').hidden);
  toggle.click();
  await sleep(100);
  check('turning the toggle off hides the buttons', () => ansList.hidden);
  toggle.click();
  await sleep(100);
  check('turning it back on does not fetch again', () => window.__answerFetches === 1 && !ansList.hidden);
  toggle.click();
  await sleep(100);

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

  check('a partly solved board still fills whole rows', () =>
    gridRows().every((r) => r.querySelectorAll('.mc-chip').length === 4));
  return log;
})()`;

/* Shared by the passes that play the mock board rather than poke at it. */
const PRELUDE = `
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
  const gridRows = () => [...document.querySelectorAll('#mc-panel .mc-row')];
  const solvedRows = () => [...document.querySelectorAll('#mc-panel .mc-done')];
  const misses = () => [...document.querySelectorAll('#mc-panel .mc-guess')];
  const solve = async (words) => {
    document.getElementById('deselect').click();
    await sleep(150);
    for (const w of words) chips().find((c) => c.textContent === w)?.click();
    await sleep(200);
    document.getElementById('submit').click();
    await sleep(3400);
  };
  await waitFor(() => document.getElementById('mc-panel'));
  await waitFor(() => chips().length === 16);
`;

/*
 * Second pass, on a board with no test ids: the extension has to find it by its
 * text, and keep finding it once the page starts replacing tiles with solved
 * rows made of the very same words.
 */
const PLAIN = `(async () => {${PRELUDE}
  check('finds the board without test ids', () => {
    const onBoard = [...document.querySelectorAll('.card')].map((c) => c.dataset.word).sort();
    return __myConnections.board.words().sort().join() === onBoard.join();
  });

  check('the answers toggle starts off on a fresh load', () =>
    !document.querySelector('#mc-panel .mc-toggle-input').checked && window.__answerFetches === 0);

  await solve(['NAVY', 'ROYAL', 'SKY', 'TEAL']);
  check('the guess is read as solved, not as a miss', () => misses().length === 0);
  check('a solved row is not read back as part of the board', () => chips().length === 12);
  check('the solved group is still shown', () => solvedRows().length === 1);
  check('the words left in play still fill whole rows', () =>
    gridRows().every((r) => r.querySelectorAll('.mc-chip').length === 4));
  return log;
})()`;

/* Third pass: play the whole puzzle out, since the end of it has its own shape. */
const FINISH = `(async () => {${PRELUDE}
  // A near miss reaching across two groups: once both are solved every one of
  // its words is off the board, and it is still not a group.
  await solve(['NAVY', 'ROYAL', 'SKY', 'BRIDGE']);
  await solve(['NAVY', 'ROYAL', 'SKY', 'TEAL']);
  await solve(['BRIDGE', 'HEARTS', 'SPIT', 'WAR']);
  check('a near miss across two solved groups stays a miss', () =>
    misses().length === 1 && misses()[0].classList.contains('mc-one-away'));

  /*
   * A record can be wrong: read while the page was still catching up, or left
   * over from a session that could not tell. Force the first group back to a
   * miss and the next look at the board should put it right again.
   */
  const store = __myConnections.store;
  store.amend(store.guesses[1], { result: 'wrong', category: null, color: null });
  __myConnections.panel.refreshGuesses();
  __myConnections.panel.setWords(__myConnections.board.words());
  await sleep(100);
  check('a solved group forced back to a miss is shown as one', () =>
    misses().length === 2 && solvedRows().length === 1);

  await solve(['CROW', 'SALAD', 'SNACK', 'TOWEL']);
  check('the board puts a stale miss right', () => misses().length === 1);
  check('the group comes back in its own colour, with its name', () => {
    const row = solvedRows()[0];
    return (
      getComputedStyle(row).backgroundColor === 'rgb(249, 223, 109)' &&
      /shades of blue/i.test(row.querySelector('.mc-name').textContent)
    );
  });

  await solve(['CHALK', 'DART', 'KEY', 'SURF']);

  check('the last group is solved, not logged as a miss', () =>
    misses().length === 1 && misses()[0].classList.contains('mc-one-away'));
  check('a finished board leaves no words in play', () => chips().length === 0);
  check('all four groups are shown', () => solvedRows().length === 4);
  check('each keeps the colour of its row', () => {
    const want = ['rgb(249, 223, 109)', 'rgb(160, 195, 90)', 'rgb(176, 196, 239)', 'rgb(186, 129, 197)'];
    return solvedRows().map((r) => getComputedStyle(r).backgroundColor).join() === want.join();
  });
  check('the drag hint goes with the last word', () =>
    document.querySelector('#mc-panel .mc-hint').hidden);
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

let nextId = 0;

function call(ws, method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    ws.addEventListener('message', function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await call(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

/*
 * Each pass runs on its own load of the page: whether the board carries test
 * ids, and what the extension has already seen of it, are decided once, when
 * the content scripts start.
 */
async function load(ws, url) {
  const want = `complete|${new URL(url).search}|true`;
  await call(ws, 'Page.navigate', { url });
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    try {
      const state = await evaluate(
        ws,
        `document.readyState + '|' + location.search + '|' + !!window.__myConnections?.board`
      );
      if (state === want) return;
    } catch {} // the old document is on its way out
  }
  throw new Error(`the page never finished loading: ${url}`);
}

let failures = 0;
try {
  const ws = new WebSocket(await debuggerUrl());
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok);
    ws.addEventListener('error', fail);
  });
  for (const [url, script] of [
    [PAGE, TEST],
    [`${PAGE}?plain=1`, PLAIN],
    [PAGE, FINISH],
  ]) {
    await load(ws, url);
    for (const [name, passed, error] of await evaluate(ws, script)) {
      console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${error ? ` — ${error}` : ''}`);
      if (!passed) failures++;
    }
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
