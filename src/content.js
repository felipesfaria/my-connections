/*
 * Boots the helper: waits for the board to appear, keeps the panel in sync and
 * works out the outcome of every guess that gets submitted.
 */
(() => {
  const NS = window.__myConnections;
  const { board, store, panel } = NS;

  let mounted = false;
  let refreshQueued = false;

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function queueRefresh() {
    if (refreshQueued || document.hidden) return;
    refreshQueued = true;
    setTimeout(() => {
      refreshQueued = false;
      board.refresh();
    }, 600);
  }

  /*
   * A rolling log of text added to the page — that is where toasts such as
   * "One away..." show up. It has to run continuously: the toast is inserted
   * synchronously while the submit click is still being dispatched, so an
   * observer started after the fact would always miss it.
   */
  const recentText = [];

  function collectText(mutations) {
    const now = Date.now();
    for (const mutation of mutations) {
      const nodes =
        mutation.type === 'characterData' ? [mutation.target] : [...mutation.addedNodes];
      for (const node of nodes) {
        const text = (node.textContent ?? '').trim();
        if (text && text.length < 200) recentText.push({ at: now, text });
      }
    }
    if (recentText.length > 200) recentText.splice(0, recentText.length - 200);
  }

  const textSince = (since) =>
    recentText
      .filter((entry) => entry.at >= since)
      .map((entry) => entry.text)
      .join(' | ');

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Pulls the category name out of the solved-group banner, if it is readable. */
  function findCategory(words) {
    const candidates = [...document.body.querySelectorAll('div, section, li')].filter((el) => {
      const text = el.textContent;
      return text.length < 240 && words.every((w) => text.toUpperCase().includes(w));
    });
    if (!candidates.length) return null;

    candidates.sort((a, b) => a.textContent.length - b.textContent.length);
    let text = candidates[0].textContent.trim();
    for (const word of words) text = text.replace(new RegExp(escapeRe(word), 'i'), ' ');
    const name = text
      .replace(/[,·|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return name ? name.slice(0, 60) : null;
  }

  async function onSubmit(words) {
    // The click that triggered this already ran, so look a little into the past.
    const since = Date.now() - 500;
    await sleep(2600);
    const noise = textSince(since);
    board.refresh();

    const stillOnBoard = new Set(board.words());
    const solved = words.every((w) => !stillOnBoard.has(w));
    const result = solved ? 'correct' : /one\s*away/i.test(noise) ? 'one-away' : 'wrong';

    store.addGuess({
      words,
      result,
      category: solved ? findCategory(words) : null,
      at: Date.now(),
    });
    panel.refreshGuesses();
    panel.setWords(board.words());
  }

  function onBoardChange(words) {
    if (!mounted && words.length >= 4) {
      panel.mount();
      mounted = true;
    }
    if (mounted) panel.setWords(words);
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'toggle-panel') {
      panel.toggle();
      respond({ ok: mounted });
    } else if (message?.type === 'clear-today') {
      store.clear().then(() => {
        panel.refreshGuesses();
        panel.setWords(board.words());
        respond({ ok: true });
      });
      return true; // async response
    } else if (message?.type === 'status') {
      respond({ ok: true, mounted, words: board.words().length, guesses: store.guesses.length });
    }
    return undefined;
  });

  (async function start() {
    await store.load();

    board.on('board', onBoardChange);
    board.on('selection', () => panel.refreshSelection());
    board.on('submit', (words) => {
      onSubmit(words).catch((err) => console.error('[my-connections]', err));
    });

    board.start();
    onBoardChange(board.words());

    // The board only renders once the splash screen is dismissed, and it is
    // rebuilt as groups are solved, so keep watching the page.
    new MutationObserver((mutations) => {
      collectText(mutations);
      queueRefresh();
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
    document.addEventListener('visibilitychange', queueRefresh);
  })();
})();
