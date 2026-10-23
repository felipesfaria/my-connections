/*
 * Reads the Connections board out of the page and tracks which tiles are selected.
 *
 * The board is rendered by NYT's own React app, so nothing here ever moves or
 * rewrites its nodes: we only read text, listen to clicks and forward clicks
 * back to the real tiles. Everything is found by feature sniffing (test ids
 * first, then a text heuristic) so a class name change on their side does not
 * break the extension.
 */
(() => {
  const NS = (window.__myConnections ||= {});

  // A tile label: one short, all-caps token or phrase.
  const WORD_RE = /^[\p{L}\p{N}][\p{L}\p{N}'’\-.&!? ]{0,23}$/u;
  const BOARD_SIZES = [16, 12, 8, 4];

  const listeners = { board: [], selection: [], submit: [] };
  let tiles = []; // [{ el, word }]
  let selected = new Set();
  let domSchemeSeen = false; // true once the page exposes its own selected-state
  let lastSubmit = 0;

  const emit = (name, ...args) => {
    for (const fn of listeners[name]) {
      try {
        fn(...args);
      } catch (err) {
        console.error('[my-connections]', err);
      }
    }
  };

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  };

  /*
   * A card holds its word more than once — the page keeps a second copy for
   * its flip animation — so reading textContent off the card gives "SKYSKY".
   * Read the innermost text nodes instead and collapse the copies.
   */
  function labelOf(el) {
    const leaves = [...el.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && node.textContent.trim()
    );
    const visible = leaves.filter(isVisible);
    const pool = visible.length ? visible : leaves;
    const texts = [...new Set(pool.map((node) => node.textContent.trim()))];
    const text =
      texts.length === 1 ? texts[0] : (pool[0]?.textContent.trim() ?? el.textContent.trim());
    return text.trim().toUpperCase();
  }

  const depthOf = (el) => {
    let d = 0;
    for (let p = el.parentElement; p; p = p.parentElement) d++;
    return d;
  };

  // The element that actually handles the click for a tile label.
  const hitboxOf = (el) =>
    el.closest('button, [role="button"], [data-testid^="card"]') || el;

  function innermost(els) {
    return els.filter((el) => !els.some((other) => other !== el && el.contains(other)));
  }

  function labelsFromTestIds() {
    const els = [...document.querySelectorAll('[data-testid^="card"]')].filter(isVisible);
    return innermost(els).filter((el) => WORD_RE.test(labelOf(el)));
  }

  /** One element per distinct label, since a card renders its word twice. */
  function firstPerLabel(els) {
    const seen = new Set();
    const out = [];
    for (const el of els) {
      const label = labelOf(el);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push(el);
    }
    return out;
  }

  // Fallback: find the deepest container holding exactly 16 (or 12/8/4, once
  // groups have been solved) short all-caps leaf elements.
  function labelsByHeuristic() {
    const leaves = [...document.body.querySelectorAll('div, span, button, li, p')].filter(
      (el) => {
        if (el.children.length !== 0 || !isVisible(el)) return false;
        const text = el.textContent.trim();
        if (!WORD_RE.test(text)) return false;
        // Tiles read as caps; the page may do that in CSS rather than in the text.
        return (
          text === text.toUpperCase() || getComputedStyle(el).textTransform === 'uppercase'
        );
      }
    );
    if (leaves.length < 4) return [];

    const groups = new Map();
    for (const leaf of leaves) {
      let p = leaf.parentElement;
      for (let up = 0; p && up < 6; up++, p = p.parentElement) {
        if (!groups.has(p)) groups.set(p, []);
        groups.get(p).push(leaf);
      }
    }

    for (const size of BOARD_SIZES) {
      const hits = [...groups]
        .map(([el, found]) => [el, firstPerLabel(found)])
        .filter(([, found]) => found.length === size);
      if (!hits.length) continue;
      hits.sort((a, b) => depthOf(b[0]) - depthOf(a[0]));
      return hits[0][1];
    }
    return [];
  }

  /** Re-reads the board. Emits "board" when the set of words changed. */
  function refresh() {
    let labels = labelsFromTestIds();
    if (labels.length < 4) labels = labelsByHeuristic();

    const seen = new Set();
    const next = [];
    for (const el of labels) {
      const word = labelOf(el);
      if (!word || seen.has(word)) continue;
      seen.add(word);
      next.push({ el, word });
    }

    const changed =
      next.length !== tiles.length || next.some((t, i) => t.word !== tiles[i].word);
    tiles = next;

    if (changed) {
      for (const word of [...selected]) if (!seen.has(word)) selected.delete(word);
      emit('board', words());
      emit('selection', selection());
    }
    return tiles;
  }

  /** Reads selection straight from the page, or null if it exposes no such state. */
  function selectionFromDom() {
    const found = new Set();
    let scheme = false;
    for (const { el, word } of tiles) {
      const box = hitboxOf(el);
      const pressedEl = box.closest('[aria-pressed]');
      if (pressedEl) {
        scheme = true;
        if (pressedEl.getAttribute('aria-pressed') === 'true') found.add(word);
        continue;
      }
      const classes = `${String(box.className)} ${String(box.parentElement?.className ?? '')}`;
      if (/selected/i.test(classes)) {
        scheme = true;
        found.add(word);
      }
    }
    if (scheme) domSchemeSeen = true;
    return domSchemeSeen && (scheme || found.size === 0) ? found : null;
  }

  function syncSelection() {
    const fromDom = selectionFromDom();
    if (fromDom) selected = fromDom;
    emit('selection', selection());
  }

  function submit() {
    const words = [...selected];
    const now = Date.now();
    if (words.length !== 4 || now - lastSubmit < 800) return;
    lastSubmit = now;
    selected = new Set();
    emit('submit', words);
    emit('selection', selection());
  }

  function onClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const tile = tiles.find(({ el }) => hitboxOf(el).contains(target));
    if (tile) {
      if (selected.has(tile.word)) selected.delete(tile.word);
      else if (selected.size < 4) selected.add(tile.word);
      requestAnimationFrame(syncSelection);
      return;
    }

    const button = target.closest('button, [role="button"]');
    const label = button ? button.textContent.trim().toLowerCase() : '';
    if (/^submit/.test(label)) requestAnimationFrame(submit);
    else if (/deselect/.test(label)) {
      selected = new Set();
      emit('selection', selection());
    } else if (/shuffle/.test(label)) requestAnimationFrame(refresh);
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && selected.size === 4) requestAnimationFrame(submit);
  }

  const words = () => tiles.map((t) => t.word);
  const selection = () => [...selected];

  const sameSet = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));

  /** Replays a pointer press for tiles that do not listen for plain clicks. */
  function pointerPoke(el) {
    const rect = el.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', init));
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
  }

  NS.board = {
    start() {
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeyDown, true);
      refresh();
    },
    refresh,
    words,
    selection,
    isSelected: (word) => selected.has(word),
    /** Forwards a click to the real tile so the game registers the selection. */
    clickWord(word) {
      const tile = tiles.find((t) => t.word === word);
      if (!tile) return false;
      const box = hitboxOf(tile.el);
      const before = selectionFromDom();
      box.click();
      requestAnimationFrame(() => {
        // If the page tracks selection itself and ignored the click, it is
        // listening for pointer events instead — replay those too.
        const after = selectionFromDom();
        if (before && after && sameSet(before, after)) pointerPoke(box);
        requestAnimationFrame(syncSelection);
      });
      return true;
    },
    on(name, fn) {
      listeners[name].push(fn);
    },
  };
})();
