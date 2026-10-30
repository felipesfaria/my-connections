/*
 * Today's answers, straight from the endpoint the game itself loads its puzzle
 * from. Nothing here runs until the "Revelar respostas" toggle is switched on:
 * the extension does not touch the answer data otherwise.
 *
 * The response looks like:
 *   { print_date: '2026-10-30',
 *     categories: [{ title: 'PARTS OF A CAMERA', cards: [{ content: 'FLASH', position: 9 }, …] }, …] }
 * and the titles change every day with the puzzle.
 */
(() => {
  const NS = (window.__myConnections ||= {});

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const cache = new Map(); // date -> { date, groups }

  /** Pulls { title, words } out of the response, and fails loudly if the shape changed. */
  function parse(data) {
    const categories = data && Array.isArray(data.categories) ? data.categories : null;
    if (!categories || !categories.length) throw new Error('unexpected format (no "categories")');
    return categories.map((category, i) => {
      const cards = Array.isArray(category.cards) ? category.cards : [];
      return {
        title: String(category.title ?? `Group ${i + 1}`).trim(),
        words: cards.map((card) => String(card.content ?? card.text ?? '').trim()).filter(Boolean),
      };
    });
  }

  /** The date in the URL on an archive page, otherwise today, then yesterday. */
  function candidateDates() {
    const fromUrl = location.pathname.match(/(\d{4}-\d{2}-\d{2})/);
    if (fromUrl) return [fromUrl[1]];
    return [ymd(new Date()), ymd(new Date(Date.now() - 864e5))];
  }

  async function get() {
    let lastError = new Error('no date to try');
    for (const date of candidateDates()) {
      if (cache.has(date)) return cache.get(date);
      try {
        const res = await fetch(`/svc/connections/v2/${date}.json`, {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${date}`);
        const data = await res.json();
        const puzzle = { date: data.print_date || date, groups: parse(data) };
        cache.set(date, puzzle);
        return puzzle;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  NS.answers = { get, parse };
})();
