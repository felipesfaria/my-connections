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

  /*
   * The colour the board painted a solved row. The element that holds the words
   * is often a bare wrapper around the coloured one, so try each of them on its
   * own box before looking outwards from the closest.
   */
  function rowColor(candidates) {
    for (const el of candidates) {
      const own = NS.tint.near(el, 1);
      if (own) return own;
    }
    return NS.tint.near(candidates[0]);
  }

  /** Pulls the name and colour out of the solved-group banner, if it is readable. */
  function findSolvedGroup(words) {
    const candidates = [...document.body.querySelectorAll('div, section, li')].filter((el) => {
      // Our own panel lists the same words; it must not be mistaken for the board.
      if (el.closest('#mc-panel')) return false;
      const text = el.textContent;
      return text.length < 240 && words.every((w) => text.toUpperCase().includes(w));
    });
    if (!candidates.length) return null;

    candidates.sort((a, b) => a.textContent.length - b.textContent.length);
    const banner = candidates[0];
    let text = banner.textContent.trim();
    for (const word of words) text = text.replace(new RegExp(escapeRe(word), 'i'), ' ');
    const name = text
      .replace(/[,·|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { category: name ? name.slice(0, 60) : null, color: rowColor(candidates) };
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

    const group = solved ? findSolvedGroup(words) : null;

    store.addGuess({
      words,
      result,
      category: group?.category ?? null,
      color: group?.color ?? null,
      at: Date.now(),
    });
    panel.refreshGuesses();
    panel.setWords(board.words());
  }

  /*
   * Puts the history right against the board. A miss whose four words have all
   * left the board together, into a solved row of their own, was never a miss:
   * the outcome was read while the page was still catching up, or the record is
   * simply older than what the page now shows. Only a solved row is drawn in a
   * colour and it holds nothing but its own group, so a colour here is the
   * proof — four words that merely drifted off the board across two different
   * groups are never found inside one.
   */
  function reconcile() {
    const onBoard = new Set(board.words());
    let corrected = false;
    for (const guess of store.guesses) {
      if (guess.result === 'correct') continue;
      if (guess.words.some((word) => onBoard.has(word))) continue;
      const group = findSolvedGroup(guess.words);
      if (!group?.color) continue;
      store.amend(guess, { result: 'correct', category: group.category, color: group.color });
      corrected = true;
    }
    return corrected;
  }

  function onBoardChange(words) {
    // A finished puzzle has no words left, so the history is what there is to show.
    if (!mounted && (words.length >= 4 || store.guesses.length)) {
      panel.mount();
      mounted = true;
    }
    if (!mounted) return;
    if (reconcile()) panel.refreshGuesses();
    panel.setWords(words);
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
