# My Connections

A Chrome extension for the [NYT Connections](https://www.nytimes.com/games/connections) puzzle.
It adds a small panel next to the board with the two things the game does not give you:

- **Rearrange the words freely.** The panel holds a copy of the 16 words that you can drag into
  any order, so you can park your four candidates on one row and keep them there — and drag a
  whole row by its handle once the group is together. The real board only offers a random shuffle,
  which throws your grouping away.
- **See your previous misses.** A group that does not match is listed under the grid, orange for
  one away and red for anything further off, so you never burn a life re-submitting something you
  already tried. A group that does match stays in the grid instead, as a block in the colour the
  board gave that row with its category name, pinned above the words still in play — the same as
  the board itself.

Clicking a word in the panel selects it on the real board, so you can play entirely from your own
layout. Your arrangement and history are saved per day and survive a page reload.

## Install

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder (`my-connections`).
3. Open the puzzle and press **Play**. The panel appears once the board is on screen.

## Using it

| Control | What it does |
| --- | --- |
| Drag a word onto another | Swaps the two; every other word stays where it is |
| Drag a row's ⠿ handle onto another row | Swaps the two rows, four words at a time |
| Click a word | Selects / deselects that tile on the real board |
| ⇆ | Shuffles your layout (the board is untouched) |
| ↻ | Resets your layout to the board's own order |
| − | Collapses the panel; drag the title bar to move it |

The toolbar popup can hide the panel entirely or clear today's layout and history.

## How it works

`src/board.js` finds the board and reads it; it never moves or rewrites NYT's own nodes, since the
page is a React app that would overwrite anything the extension changed. Tiles are located by
`data-testid` when available and otherwise by a text heuristic (the deepest container holding
exactly 16 / 12 / 8 / 4 distinct short all-caps labels), so a class name change on their side does
not break it. Each card renders its word more than once — there is a second copy for the flip
animation — so the word is read from the innermost text and the copies are collapsed, otherwise
every tile reads "SKYSKY". Selection is tracked from your clicks and reconciled with whatever
selected-state the page exposes (`aria-pressed`, a `selected` class).

A solved group does not leave the page — it moves into a solved row — so the text heuristic has to
know not to read those rows back as tiles, or a finished puzzle looks like a full board of answers.
Anything drawn in a group's colour is ruled out, as is the panel's own copy of the words, and a
word that has left the board is never read back onto it.

`src/content.js` watches what happens after a submit: if the four words leave the board the guess
was correct, and the category name and the row's colour are read off the solved banner, otherwise
a "one away" toast decides between orange and red.

That reading can be wrong — the page may not have caught up yet — so the history is checked against
the board whenever the board changes. A miss whose four words have all left the board together,
into a solved row of their own, is put right: only a solved row carries a colour, and it holds
nothing but its own group, so four words that merely drifted off across two groups are never
mistaken for one.

`src/store.js` keeps one record per day in `chrome.storage.local` and drops records older than two
weeks. Nothing leaves your browser, and the extension never reads the puzzle's answer data.

| File | Role |
| --- | --- |
| `src/tint.js` | Telling a group's colour from the board's own greys |
| `src/board.js` | Board detection, selection tracking, submit detection |
| `src/store.js` | Per-day persistence |
| `src/panel.js` | The panel UI and drag-and-drop |
| `src/content.js` | Boot, guess outcome resolution, popup messages |
| `src/popup.*` | Toolbar popup |
| `test/mock-board.html` | A stand-in board for working offline |
| `test/run.mjs` | Drives that board in headless Chrome and checks the panel |

## Checking it works

`test/mock-board.html` is a fake board — four groups, a submit button, a "One away..." toast — that
loads the content scripts directly, so you can open it in any browser and play with the panel
without touching the real puzzle.

```sh
node test/run.mjs     # headless Chrome, no dependencies to install
```

It checks that the panel mounts, that dragging swaps two words and sticks, that clicking a chip
selects the real tile (and still does so after a drag), that a solved group stays in the grid in
its own colour with its category name, and that one away / wrong guesses are listed below it. It
runs three times over: once on the board as NYT marks it, once on a board with no test ids so the
text heuristic has to find it, and once playing the puzzle out to the end. Set `CHROME=<path>` if
Chrome is not where it usually lives.

## If the panel does not show up

The board must be rendered first — dismiss the splash screen. If NYT reworks the board markup the
heuristic may miss it; open the console and run `__myConnections.board.refresh()` to see what it
finds, or file the selector that changed.
