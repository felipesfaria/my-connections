/*
 * Reading colour off the page.
 *
 * Connections draws a solved group in that group's colour and draws everything
 * else — the tiles, a selected tile, the page behind them — in something close
 * to a grey. So the distance between a background's strongest and weakest
 * channel is what tells a solved row from a tile, in either theme: the four
 * group colours clear 60, while the warmest thing the board puts behind a word
 * is the selected tile, which is a brown-grey at 12.
 */
(() => {
  const NS = (window.__myConnections ||= {});

  const MIN = 40;

  /** An element's own background, or null if it is see-through. */
  function background(el) {
    const parts = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
    if (!parts) return null;
    const [r, g, b, a = 1] = parts.map(Number);
    if (a < 0.9 || Math.max(r, g, b) - Math.min(r, g, b) < MIN) return null;
    return `rgb(${r}, ${g}, ${b})`;
  }

  NS.tint = {
    /**
     * The first group colour at or above an element, or null if it sits on the
     * board's own neutral furniture. The box that carries the colour is often a
     * few levels above the word itself, hence the walk.
     */
    near(el, levels = 6) {
      for (let node = el, up = 0; node && node !== document.body && up < levels; up++) {
        const colour = background(node);
        if (colour) return colour;
        node = node.parentElement;
      }
      return null;
    },
  };
})();
