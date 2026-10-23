/*
 * The floating helper panel: a drag-and-drop copy of the board plus the list
 * of guesses already made.
 */
(() => {
  const NS = (window.__myConnections ||= {});

  let root, gridEl, guessesEl, countEl, collapseBtn;
  let order = []; // my own arrangement of the words still on the board
  let dragFrom = null;
  let dragged = false;

  const store = () => NS.store;

  function build() {
    root = document.createElement('div');
    root.id = 'mc-panel';
    root.innerHTML = `
      <div class="mc-head">
        <span class="mc-grip">&#10287;</span>
        <span class="mc-title">My Connections</span>
        <button class="mc-btn" data-act="shuffle" title="Shuffle my layout">&#8646;</button>
        <button class="mc-btn" data-act="reset" title="Match the board order">&#8635;</button>
        <button class="mc-btn" data-act="collapse" title="Collapse">&#8722;</button>
      </div>
      <div class="mc-body">
        <div class="mc-grid"></div>
        <div class="mc-hint">Drag a word onto another to swap them. Click it to select it on the board.</div>
        <div class="mc-sub">Previous guesses <span class="mc-count"></span></div>
        <div class="mc-guesses"></div>
      </div>`;
    document.body.appendChild(root);

    gridEl = root.querySelector('.mc-grid');
    guessesEl = root.querySelector('.mc-guesses');
    countEl = root.querySelector('.mc-count');
    collapseBtn = root.querySelector('[data-act="collapse"]');

    root.querySelector('.mc-head').addEventListener('pointerdown', onHeadPointerDown);
    root.addEventListener('click', onPanelClick);
    gridEl.addEventListener('dragstart', onDragStart);
    gridEl.addEventListener('dragover', onDragOver);
    gridEl.addEventListener('dragleave', onDragLeave);
    gridEl.addEventListener('drop', onDrop);
    gridEl.addEventListener('dragend', onDragEnd);

    restorePlacement();
    matchPageTheme();
  }

  /* ---------- theme ---------- */

  /** Picks light or dark from the page's own background, not the OS setting. */
  function matchPageTheme() {
    const dark = isDark(document.body) ?? isDark(document.documentElement);
    root.classList.toggle('mc-dark', dark === true);
    root.classList.toggle('mc-light', dark === false);
  }

  function isDark(el) {
    const match = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const [r, g, b, alpha = 1] = match[1].split(',').map(Number);
    if (!alpha) return null; // transparent: nothing to go on
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
  }

  /* ---------- placement ---------- */

  function restorePlacement() {
    const { left, top, collapsed } = store().panel;
    if (left != null && top != null) {
      root.style.left = `${clamp(left, 0, window.innerWidth - 120)}px`;
      root.style.top = `${clamp(top, 0, window.innerHeight - 40)}px`;
      root.style.right = 'auto';
    }
    setCollapsed(!!collapsed, false);
  }

  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

  function onHeadPointerDown(event) {
    if (event.target.closest('.mc-btn') || event.button !== 0) return;
    const rect = root.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    root.classList.add('mc-dragging');

    const move = (e) => {
      const left = clamp(e.clientX - offsetX, 0, window.innerWidth - rect.width);
      const top = clamp(e.clientY - offsetY, 0, window.innerHeight - 40);
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.style.right = 'auto';
    };
    const up = () => {
      root.classList.remove('mc-dragging');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      const final = root.getBoundingClientRect();
      store().setPanel({ left: final.left, top: final.top });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    event.preventDefault();
  }

  function setCollapsed(collapsed, persist = true) {
    root.classList.toggle('mc-collapsed', collapsed);
    collapseBtn.innerHTML = collapsed ? '&#43;' : '&#8722;';
    collapseBtn.title = collapsed ? 'Expand' : 'Collapse';
    if (persist) store().setPanel({ collapsed });
  }

  /* ---------- word grid ---------- */

  /** Keeps my arrangement, drops solved words and appends ones I have not seen. */
  function syncOrder(boardWords) {
    const onBoard = new Set(boardWords);
    const kept = order.filter((w) => onBoard.has(w));
    const known = new Set(kept);
    order = [...kept, ...boardWords.filter((w) => !known.has(w))];
    store().setOrder(order);
  }

  function renderGrid() {
    gridEl.textContent = '';
    order.forEach((word, index) => {
      const chip = document.createElement('div');
      chip.className = 'mc-chip';
      chip.textContent = word;
      chip.draggable = true;
      chip.dataset.index = String(index);
      if (NS.board.isSelected(word)) chip.classList.add('mc-sel');
      gridEl.appendChild(chip);
    });
  }

  const indexOfChip = (el) => {
    const chip = el instanceof Element ? el.closest('.mc-chip') : null;
    return chip ? Number(chip.dataset.index) : null;
  };

  function onDragStart(event) {
    dragFrom = indexOfChip(event.target);
    if (dragFrom == null) return;
    dragged = true;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', order[dragFrom]);
    event.target.closest('.mc-chip').classList.add('mc-drag');
  }

  function onDragOver(event) {
    if (dragFrom == null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const chip = event.target instanceof Element ? event.target.closest('.mc-chip') : null;
    for (const el of gridEl.querySelectorAll('.mc-over')) el.classList.remove('mc-over');
    if (chip && Number(chip.dataset.index) !== dragFrom) chip.classList.add('mc-over');
  }

  function onDragLeave(event) {
    const chip = event.target instanceof Element ? event.target.closest('.mc-chip') : null;
    chip?.classList.remove('mc-over');
  }

  function onDrop(event) {
    const to = indexOfChip(event.target);
    if (dragFrom == null || to == null) return endDrag(event);
    event.preventDefault();
    [order[dragFrom], order[to]] = [order[to], order[dragFrom]];
    store().setOrder(order);
    renderGrid();
    // The drop re-rendered the grid, so the dragged chip is gone and its
    // dragend will never reach us: clear the drag state here instead.
    endDrag(event);
  }

  function onDragEnd(event) {
    endDrag(event);
  }

  function endDrag() {
    dragFrom = null;
    for (const el of gridEl.querySelectorAll('.mc-drag, .mc-over')) {
      el.classList.remove('mc-drag', 'mc-over');
    }
    // A click event can follow the drag; swallow just that one.
    setTimeout(() => {
      dragged = false;
    }, 0);
  }

  function onPanelClick(event) {
    const button = event.target.closest('.mc-btn');
    if (button) {
      const act = button.dataset.act;
      if (act === 'collapse') setCollapsed(!root.classList.contains('mc-collapsed'));
      else if (act === 'reset') {
        order = NS.board.words();
        store().setOrder(order);
        renderGrid();
      } else if (act === 'shuffle') {
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        store().setOrder(order);
        renderGrid();
      }
      return;
    }

    const index = indexOfChip(event.target);
    if (index != null && !dragged) NS.board.clickWord(order[index]);
  }

  /* ---------- guess history ---------- */

  function renderGuesses() {
    const guesses = store().guesses;
    guessesEl.textContent = '';
    countEl.textContent = guesses.length ? `(${guesses.length})` : '';

    if (!guesses.length) {
      const empty = document.createElement('div');
      empty.className = 'mc-empty';
      empty.textContent = 'Nothing yet. Every group you submit shows up here.';
      guessesEl.appendChild(empty);
      return;
    }

    guesses.forEach((guess, i) => {
      const row = document.createElement('div');
      row.className = `mc-guess mc-${guess.result}`;
      row.title = resultLabel(guess, i);

      const badge = document.createElement('div');
      badge.className = 'mc-badge';
      badge.textContent = '';
      row.appendChild(badge);

      const words = document.createElement('div');
      words.className = 'mc-words';
      for (const word of guess.words) {
        const chip = document.createElement('div');
        chip.className = 'mc-word';
        chip.textContent = word;
        chip.title = word;
        words.appendChild(chip);
      }
      row.appendChild(words);
      guessesEl.appendChild(row);

      const note = noteFor(guess);
      if (note) {
        const noteEl = document.createElement('div');
        noteEl.className = 'mc-note';
        noteEl.textContent = note;
        guessesEl.appendChild(noteEl);
      }
    });
  }

  function resultLabel(guess, i) {
    const result =
      guess.result === 'correct' ? 'correct' : guess.result === 'one-away' ? 'one away' : 'wrong';
    return `Guess ${i + 1}: ${result}`;
  }

  function noteFor(guess) {
    const parts = [];
    if (guess.result === 'one-away') parts.push('one away');
    if (guess.category) parts.push(guess.category);
    if (guess.repeats) parts.push(`submitted ${guess.repeats + 1}×`);
    return parts.join(' · ');
  }

  /* ---------- api ---------- */

  NS.panel = {
    mount() {
      if (!root) build();
      renderGuesses();
    },
    setWords(boardWords) {
      syncOrder(boardWords);
      renderGrid();
      matchPageTheme();
    },
    refreshSelection() {
      if (!gridEl) return;
      for (const chip of gridEl.querySelectorAll('.mc-chip')) {
        chip.classList.toggle('mc-sel', NS.board.isSelected(chip.textContent));
      }
    },
    refreshGuesses: renderGuesses,
    toggle() {
      if (!root) return;
      root.style.display = root.style.display === 'none' ? '' : 'none';
    },
  };
})();
