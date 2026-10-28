/*
 * Per-puzzle persistence: my word layout, my guess history and where I left
 * the panel. One record per day in chrome.storage.local.
 */
(() => {
  const NS = (window.__myConnections ||= {});

  const PREFIX = 'mc:';
  const KEEP_DAYS = 14;

  const today = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const blank = () => ({
    order: [],
    guesses: [],
    panel: { left: null, top: null, collapsed: false },
  });

  let key = PREFIX + today();
  let data = blank();
  let writeTimer = null;

  function flush() {
    writeTimer = null;
    chrome.storage.local.set({ [key]: data });
  }

  function save() {
    if (writeTimer) return;
    writeTimer = setTimeout(flush, 250);
  }

  /** Drops records older than KEEP_DAYS so storage does not grow forever. */
  async function prune() {
    const all = await chrome.storage.local.get(null);
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    const stale = Object.keys(all).filter((k) => {
      if (!k.startsWith(PREFIX)) return false;
      const stamp = Date.parse(k.slice(PREFIX.length));
      return Number.isFinite(stamp) && stamp < cutoff;
    });
    if (stale.length) await chrome.storage.local.remove(stale);
  }

  NS.store = {
    async load() {
      key = PREFIX + today();
      const stored = await chrome.storage.local.get(key);
      data = { ...blank(), ...(stored[key] ?? {}) };
      data.panel = { ...blank().panel, ...(data.panel ?? {}) };
      prune().catch(() => {});
      return data;
    },

    get order() {
      return data.order;
    },
    setOrder(order) {
      data.order = order;
      save();
    },

    get guesses() {
      return data.guesses;
    },
    addGuess(guess) {
      const same = data.guesses.find(
        (g) => g.words.length === guess.words.length && g.words.every((w) => guess.words.includes(w))
      );
      if (same) {
        same.result = guess.result;
        same.category = guess.category ?? same.category;
        same.color = guess.color ?? same.color;
        same.repeats = (same.repeats ?? 0) + 1;
      } else {
        data.guesses.push(guess);
      }
      save();
      return !same;
    },

    /** Puts a guess already recorded right, once the board shows what it really was. */
    amend(guess, patch) {
      Object.assign(guess, patch);
      save();
    },

    get panel() {
      return data.panel;
    },
    setPanel(patch) {
      data.panel = { ...data.panel, ...patch };
      save();
    },

    async clear() {
      data = blank();
      await chrome.storage.local.remove(key);
    },
  };
})();
