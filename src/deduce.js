/*
 * What the guess history already proves about the current selection.
 *
 * A guess that came back wrong rather than "one away" has at most two words
 * from any single group — three would have been one away. So no three of its
 * words share a group, and neither can any selection built around three of
 * them: a correct group of four contains four correct triples.
 *
 * A guess that came back one away proves exactly three of its words share a
 * group, but not which three, so nothing follows from it beyond not submitting
 * the same four again.
 */
(() => {
  const NS = (window.__myConnections ||= {});

  /**
   * @returns {{kind: 'repeat'|'ruled-out', words: string[], result?: string}|null}
   */
  function check(selection, guesses) {
    const picked = new Set(selection);
    if (picked.size < 3) return null;

    if (picked.size === 4) {
      const repeat = guesses.find(
        (guess) => guess.words.length === 4 && guess.words.every((word) => picked.has(word))
      );
      if (repeat) return { kind: 'repeat', result: repeat.result, words: [...picked] };
    }

    for (const guess of guesses) {
      if (guess.result !== 'wrong') continue;
      const shared = guess.words.filter((word) => picked.has(word));
      if (shared.length >= 3) return { kind: 'ruled-out', words: shared };
    }
    return null;
  }

  NS.deduce = { check };
})();
