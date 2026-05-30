# Klondike Solitaire — Development Workflow

_Last updated: 2026-05-30_

Companion to [`SCOPE.md`](./SCOPE.md). `SCOPE.md` says **what** we build; this
document says **how** — the exact phases, the files and code created at each
step, what (if anything) is installed, and how each step is verified before
moving on.

---

## 0. Ground rules & environment

### 0.1 What gets installed to **play** the game

**Nothing.** The game is plain HTML/CSS/JS and runs by double-clicking
`index.html` in any modern desktop browser. No server, no package install, no
internet.

> **Key constraint that drives the architecture:** because we must support
> opening via the `file://` protocol, we will **not** use ES modules
> (`import`/`export`) or `fetch()` for game data — browsers block those over
> `file://`. Instead:
> - Scripts are loaded with plain `<script src="...">` tags in dependency order.
> - Each file attaches its public API to a single global namespace object
>   (`window.Solitaire`) to avoid polluting globals.
> - The deal pool is shipped as a **`.js` file that assigns a global**
>   (`window.Solitaire.DEALS = {...}`), not as a `.json` loaded via fetch.

### 0.2 What gets installed for **development only**

| Tool | Version present | Used for | Required to play? |
|------|-----------------|----------|-------------------|
| Node.js | v24.13.0 | Running the offline deal generator + unit tests | No |
| npm | 11.6.2 | (Optional) running test/generate scripts via `npm run` | No |
| Python | 3.13.5 | (Optional) `python -m http.server` for a clean local preview | No |
| git | 2.51.0 | Version control | No |

We will **not** add any runtime npm dependencies. Dev-only dependencies are kept
to zero if possible; tests use Node's built-in `node:test` + `node:assert`, so
**no `npm install` of third-party packages is planned**. A `package.json` is
added only to hold convenience scripts (`npm run gen`, `npm test`).

### 0.3 Final file tree (target)

```
cc_test_solitaire/
├─ SCOPE.md                 # what we build (done)
├─ WORKFLOW.md              # this file
├─ README.md               # how to play / how to regenerate deals (Phase 8)
├─ index.html               # page shell, loads scripts in order
├─ styles.css               # dark theme + card visuals + layout
├─ src/
│  ├─ namespace.js          # defines window.Solitaire = {}
│  ├─ engine.js             # pure rules engine (no DOM)
│  ├─ heuristic.js          # deal difficulty scoring (shared by game + generator)
│  ├─ deals.js              # GENERATED: window.Solitaire.DEALS pool
│  ├─ render.js             # state -> DOM
│  ├─ interactions.js       # click / drag / double-click handlers
│  └─ app.js               # bootstraps everything, top-bar wiring, timer
├─ tools/
│  └─ generate-deals.mjs    # offline Node script -> writes src/deals.js
├─ test/
│  ├─ engine.test.mjs       # unit tests for the rules engine
│  └─ heuristic.test.mjs    # sanity tests for the heuristic
└─ package.json             # dev scripts only (gen, test, serve)
```

> Note: `engine.js` and `heuristic.js` must be usable **both** in the browser
> (via `window.Solitaire`) **and** in Node (for tests/generator). We handle this
> with a tiny dual-export footer in each file (see §1.2).

---

## 1. Phase 1 — Rules engine (pure logic, no UI)

**Goal:** a fully correct, headless Klondike engine we can unit-test before any
pixel is drawn.

### 1.1 Files created
- `src/namespace.js`
- `src/engine.js`
- `test/engine.test.mjs`
- `package.json` (with `"test": "node --test"`)

### 1.2 `engine.js` — contents

Card representation (compact, JSON-friendly):
- A card is an object `{ s, r, up }` where `s` = suit `0..3`
  (`0♣ 1♦ 2♥ 3♠`), `r` = rank `1..13` (1=A, 11=J, 12=Q, 13=K), `up` = boolean
  face-up. Color is derived: `♦♥` (s=1,2) red, `♣♠` (s=0,3) black.

Game state object:
```
{
  stock:      [card, ...],      // face-down draw pile (top = end of array)
  waste:      [card, ...],      // face-up; top = end
  foundations:[[],[],[],[]],    // index = suit, built A..K
  tableau:    [[],[],[],[],[],[],[]], // 7 columns; top = end
  moves:      0,                // player-initiated move count
  recycles:   0                 // count of stock recycles (stats only; unlimited)
}
```

Functions (all **pure** where possible — they take/return state, no DOM):
- `makeDeck()` → ordered 52-card array.
- `dealFromOrder(order)` → builds a fresh state from a 52-length array of card
  codes (deterministic; this is how bundled deals are reconstructed).
- `cardCode(card)` / `parseCode(str)` → compact serialize (e.g. `"♠K"` → `{s:3,r:13}`)
  used by the deal pool format.
- `canMoveToTableau(card, destColTop)` → bool (opposite color, one rank lower;
  empty column requires King).
- `canMoveToFoundation(card, foundationPile)` → bool (same suit, next rank).
- `legalRun(column, index)` → bool: are cards from `index` to top a valid
  descending alternating-color run (so they can move together).
- `applyMove(state, move)` → **new** state (immutable update) for each move type:
  `DRAW`, `RECYCLE`, `WASTE_TO_TABLEAU`, `WASTE_TO_FOUNDATION`,
  `TABLEAU_TO_TABLEAU`, `TABLEAU_TO_FOUNDATION`, `FOUNDATION_TO_TABLEAU`.
  Auto-flips a newly exposed tableau card as part of the same move.
- `isWin(state)` → all four foundations length 13.
- `availableAutoFoundation(state, source)` → returns the target foundation for a
  double-click auto-move, or null.

> Undo is **not** in the engine — it's a UI-layer history stack of past states
> (see Phase 3). The engine staying immutable/pure is what makes undo trivial.

### 1.3 Dual-export footer (in `engine.js` and `heuristic.js`)
```js
// Browser: attach to namespace. Node: module.exports.
(function (root) { /* assign API to root */ })(
  typeof window !== 'undefined'
    ? (window.Solitaire = window.Solitaire || {})
    : exports
);
```
This lets the **same file** load via `<script>` in the browser and `require()`
in Node tests without a build step. (`engine.js` is a classic script, not a
`.mjs`; tests `require()` it.)

### 1.4 Verification
- Run `npm test` (alias for `node --test`).
- Tests assert: deck has 52 unique cards; deal lays out 1..7 columns with correct
  face-up counts and 24 in stock; each move type accepts legal / rejects illegal
  moves; auto-flip works; `isWin` true only on a full solved state; draw/recycle
  cycle the stock correctly.
- **Exit criteria:** all engine tests green. No DOM yet.

---

## 2. Phase 2 — Static UI & rendering (state → screen)

**Goal:** see a real, dark-themed board rendered from a hard-coded deal. No
interaction yet.

### 2.1 Files created
- `index.html`
- `styles.css`
- `src/render.js`
- `src/app.js` (minimal bootstrap for now)

### 2.2 `index.html`
- Dark page shell with a top bar (New Game / difficulty `<select>` / Undo /
  "Moves: 0" / "Time: 0:00") and a board container with named regions: stock,
  waste, 4 foundation slots, 7 tableau columns.
- Loads scripts in dependency order at end of `<body>`:
  `namespace.js → engine.js → heuristic.js → deals.js → render.js →
  interactions.js → app.js`.

### 2.3 `styles.css` (dark theme)
- Dark felt/background palette (e.g. deep slate/green), high-contrast cards.
- Card component: rounded rectangle, large rank + suit glyph, red/black text on
  light card face; CSS-pattern card back for face-down. No image files.
- Layout via CSS grid/fl: top bar row, foundations + stock/waste row, tableau row
  with overlapping (fanned) cards per column.
- Visual states: `.selected` (highlight ring), `.drop-target` (hover hint),
  `.face-down`.

### 2.4 `render.js`
- `render(state)` — rebuilds the board DOM from state (or a targeted diff;
  start with full re-render for simplicity). Each card DOM node carries
  `data-*` attributes (suit, rank, pile, index) so interaction code can identify
  it. Fanning offset computed per column.

### 2.5 Verification
- Open `index.html` directly (file://). A complete board appears from a sample
  deal, dark-themed, cards legible, columns correctly fanned.
- **Exit criteria:** board renders correctly from a state object; resizing looks
  reasonable; no console errors.

---

## 3. Phase 3 — Interactions + undo (the playable core)

**Goal:** the game becomes actually playable with mouse, with unlimited undo.

### 3.1 Files created/edited
- `src/interactions.js` (new)
- `src/app.js` (extended: owns the live state + history stack)

### 3.2 State ownership & undo
- `app.js` holds `currentState` and `history = []`.
- `commit(move)`: `history.push(currentState)`; `currentState =
  engine.applyMove(currentState, move)`; `render(currentState)`; update stats.
- `undo()`: if `history.length`, `currentState = history.pop()`; re-render;
  decrement move count. **Unlimited** — bounded only by match length.

### 3.3 `interactions.js` — built in this sub-order
1. **Click-to-move:** click selects a card/run (validates `legalRun`), highlights
   it; click a destination pile → if `applyMove` legal, commit; else snap/clear.
   Click stock → DRAW (or RECYCLE when empty).
2. **Drag-and-drop:** HTML5 drag events on face-up cards/runs; compute drop
   target from `data-*`; legal drop commits, illegal snaps back. Click-to-move
   and drag share the same validation path.
3. **Double-click:** `availableAutoFoundation` → commit if a legal foundation
   exists.

### 3.4 Verification
- Manually play several moves of every type; undo repeatedly back to the initial
  deal; confirm move counter increments on moves and decrements on undo.
- **Exit criteria:** all seven move types work via both click and drag;
  double-click auto-foundation works; undo unwinds to the very first state.

---

## 4. Phase 4 — Stock/waste polish, recycle, stats

**Goal:** finish the stock mechanics and the on-screen stats.

### 4.1 Files edited
- `engine.js` (confirm RECYCLE), `interactions.js`, `app.js`, `styles.css`.

### 4.2 Work
- **Recycle:** clicking empty stock recycles the waste (unlimited; bump
  `recycles`). A visible "↻" / empty-stock affordance.
- **Move counter:** one move per committed action (draw counts; undo decrements).
- **Timer:** starts on first committed move of a match; `setInterval` updates the
  `M:SS` display; stops on win; reset by New Game. Lives in `app.js`.

### 4.3 Verification
- Draw through the whole stock, recycle, repeat; timer starts on first move and
  formats correctly; counters accurate across undo.
- **Exit criteria:** stock/waste/recycle and both stats behave correctly.

---

## 5. Phase 5 — Deal generator + heuristic (offline)

**Goal:** produce the bundled, pre-classified deal pool. Runs in **Node**, not in
the browser.

### 5.1 Files created
- `src/heuristic.js` (shared dual-export; also used live if ever needed)
- `tools/generate-deals.mjs`
- `test/heuristic.test.mjs`
- **Generated output:** `src/deals.js`

### 5.2 `heuristic.js`
- `scoreDeal(order)` → number. Inputs per `SCOPE.md` §4.1: buried-low-card depth,
  per-suit buried progression, tableau color clustering, count of immediate legal
  moves, stock dependence. Returns a single weighted difficulty score (higher =
  harder). Weights are constants at the top of the file for easy tuning.

### 5.3 `tools/generate-deals.mjs`
- `require`/import the engine + heuristic.
- Generate **N** shuffled deals (seeded RNG for reproducibility; e.g. N≈20,000).
- Score each; sort; split into the four percentile bands (cut points are the
  tunable part of **OPEN-C**); sample ~100–250 per bucket (**OPEN-B**).
- Serialize each chosen deal to the compact code-array format.
- Write `src/deals.js` as:
  `window.Solitaire = window.Solitaire || {}; window.Solitaire.DEALS = { easy:[...], hard:[...], expert:[...], master:[...] };`
- Run via `npm run gen` (script: `node tools/generate-deals.mjs`).

### 5.4 Verification
- `npm run gen` produces `src/deals.js` with four non-empty buckets of the
  expected sizes.
- `node --test test/heuristic.test.mjs`: heuristic is deterministic, ordered
  (a deliberately buried-aces layout scores higher than an open one), and
  bucket boundaries are monotonic.
- Spot-check: load a few easy vs master deals in the game and confirm easy feels
  more open (manual, informal — heuristic is an estimate by design).
- **Exit criteria:** `src/deals.js` exists, is loadable in the browser, four
  buckets populated.

---

## 6. Phase 6 — Difficulty selector wired to the pool

**Goal:** New Game respects the chosen difficulty.

### 6.1 Files edited
- `index.html` (the `<select>` already present), `app.js`.

### 6.2 Work
- `newGame(difficulty)`: pick a random deal from
  `Solitaire.DEALS[difficulty]`, `engine.dealFromOrder(...)`, reset history,
  reset stats/timer, render.
- Difficulty `<select>` defaults to **easy**; changing it does **not** disturb a
  game in progress until the next New Game (documented in UI tooltip/README).

### 6.3 Verification
- Each of the four levels deals a board from its bucket; New Game reshuffles the
  pick; selection persists across games in the same session.
- **Exit criteria:** all four difficulties deal correctly from the bundled pool.

---

## 7. Phase 7 — Win celebration + New Game flow

**Goal:** close the loop on a finished match.

### 7.1 Files edited
- `app.js`, `render.js`, `styles.css`.

### 7.2 Work
- After each commit, `engine.isWin(currentState)` → stop timer, show a simple
  dark-themed "You won!" overlay with final time + move count and a New Game
  button. Keep the animation simple (e.g. a brief card/confetti CSS effect).
- New Game (top bar **and** overlay) starts a fresh deal at the current
  difficulty.

### 7.3 Verification
- Force a near-win (or solve an easy deal) to trigger the overlay; confirm timer
  stops, stats are correct, New Game restarts cleanly.
- **Exit criteria:** win is detected exactly once, overlay shows correct stats,
  New Game works from both entry points.

---

## 8. Phase 8 — Polish, docs, final pass

**Goal:** ship-quality feel and documentation.

### 8.1 Files created/edited
- `README.md` (new), all CSS/JS as needed.

### 8.2 Work
- Illegal-move feedback (snap-back / subtle shake), selection clarity, hover drop
  hints, empty-pile placeholders.
- Edge cases: dragging multi-card runs, rapid clicks, undo at boundaries, recycle
  on empty waste (no-op), double-click when no foundation available (no-op).
- Responsive sizing for typical desktop window sizes; verify no `file://` console
  errors.
- `README.md`: how to play (just open `index.html`), controls, difficulty
  explanation, and how to regenerate deals (`npm run gen`).
- Final cross-check against every line of `SCOPE.md` §2 (decision table).

### 8.3 Verification
- Full manual playthrough of a complete game per difficulty.
- **Exit criteria:** every locked decision in `SCOPE.md` is satisfied; no console
  errors; README accurate.

---

## Post-v1 enhancements (Phase 9 — added after the initial build)

Requested after v1 shipped. Each was implemented and verified in headless Chrome
via the DevTools Protocol (rect-intersection, hit-testing with
`document.elementFromPoint`, and dispatched event sequences), in addition to the
Node unit tests staying green.

### 9.1 Synthesized sound (`src/sound.js`, new)
- Web Audio only (no asset files): `flip`, `pick`, `move`, `collect`. Loaded
  before `interactions.js`/`app.js`; hooked in `app.commit` (per move type, plus
  the secondary flip when a tableau move reveals a card) and in `interactions.js`
  (pick on drag-start / select). Mute toggle wired in `app.js`.

### 9.2 Realistic card faces (`render.js`, `styles.css`)
- Per-rank pip position map (A–10) with lower-half pips rotated 180°; suit-colored
  chess glyphs for J/Q/K. Card enlarged to 100×140; corner indices enlarged and
  the pip field inset so pips never overlap the numbers.
- **Verification:** measured every `.pip` rect against the `.corner` rects for all
  ranks A–10 → zero intersections.

### 9.3 Auto-Collect (`app.js`, `index.html`, `styles.css`)
- `canAutoCollect` (stock empty + no face-down tableau cards) toggles a top-bar
  button; `startAutoCollect` runs a `setInterval` that commits the lowest-rank
  foundation move each tick (sound + render via `commit`), stopping on win. Input
  is locked via an `autoRunning` flag honored by `interactions.js`.
- **Verification:** built an all-known endgame, confirmed gradual progress
  (44→…→52, not instant), win overlay, and `autoRunning` cleared.

### 9.4 Foundation → tableau, and a hit-testing bug
- The move was already supported by the engine + interaction layer. Real drags
  failed because the `.foundation::after` ghost overlay intercepted pointer
  events; fixed with `pointer-events: none`. A direct `.click()` test had masked
  this — now verified with `elementFromPoint` and a hit-tested drag sequence.

## Phase 10 — Dynamic card effects (implemented)

Plan in `ANIMATION_PLAN.md`. Implemented entirely in `src/render.js` (+ CSS),
with a one-line hook in `interactions.js`.

- **FLIP slide:** `render()` snapshots every card's screen rect (keyed by
  suit+rank) before the rebuild, then after rebuild inverts the delta as a
  `transform` and transitions it to zero (~160ms ease-out) — cards glide to their
  new spots with no engine/state changes.
- **Reveal/draw flip:** a 3D `rotateY` (`.flip-in`) on a card whose `up` state
  changed (tableau auto-reveal) or that freshly appears in the waste (draw).
- **Collect glow:** a brief box-shadow pulse (`.landed`) when a card lands on a
  foundation.
- **Drag-commits skip the slide** via `render.skipSlideOnce()` set in the drop
  handler (so the dragged card doesn't snap-back-and-glide).
- **Reduced motion:** `animOn()` checks `prefers-reduced-motion` and a CSS
  `@media` guard disables the keyframes.
- **Verification (CDP):** moved cards settle at the exact destination with no
  leftover `transform` (dx=0); flip-in fires on draw and reveal; landed fires on
  collect; reduced-motion disables effects; zero exceptions. Unit tests green.

## Phase 11 — Win cascade (implemented)

`src/win-anim.js` (new), hooked from `app.onWin` and torn down in `newGame`.

- Full-screen `<canvas>` (z below the stats overlay). On win, a launch queue of
  all 52 cards (Kings first, cycling suits) is spawned from the foundation
  positions on a ~70ms cadence. Each card runs simple physics (gravity + floor
  bounce with restitution, constant horizontal velocity) and is drawn each frame
  **without clearing** the canvas → trails. Cards are removed when off-screen.
- The canvas is never cleared during play, so trails accumulate (the iconic look).
  Cards are drawn as simplified faces (rounded rect + rank/suit glyphs).
- The stats overlay is held back; `onWin` passes a `show` callback that
  `win-anim` invokes when the cascade ends (queue empty + no cards, or a 12s cap)
  or when the canvas is clicked (skip). `prefers-reduced-motion` → `show()`
  immediately, no canvas. `newGame` calls `stop()` (clears + hides).
- **Verification (CDP):** overlay held hidden during play; canvas shown and
  painting non-transparent pixels; click-to-skip reveals overlay; New Game hides
  canvas + overlay; reduced-motion goes straight to overlay with no canvas; zero
  exceptions.

---

## 9. Commands reference

```bash
# Play (no install): just open index.html in a browser.
# Optional clean preview over http:
python -m http.server 8000      # then visit http://localhost:8000

# Dev scripts (defined in package.json):
npm test          # node --test  -> runs engine + heuristic tests
npm run gen       # node tools/generate-deals.mjs -> writes src/deals.js
npm run serve     # python -m http.server 8000 (convenience)
```

---

## 10. Phase / deliverable checklist

| Phase | Deliverable | Verified by |
|-------|-------------|-------------|
| 1 | `engine.js` + tests | `npm test` green |
| 2 | `index.html`, `styles.css`, `render.js` | Board renders (dark) |
| 3 | `interactions.js` + undo | Playable; undo unwinds fully |
| 4 | Stock/recycle + stats | Counters/timer correct |
| 5 | `heuristic.js`, generator, `deals.js` | Pool generated + tests |
| 6 | Difficulty wiring | All 4 levels deal |
| 7 | Win overlay + New Game | Win detected, stats shown |
| 8 | README + polish | Full playthrough, no errors |

---

## 11. Risks & mitigations

- **`file://` restrictions** → no ES modules / no fetch; scripts + global
  namespace + `deals.js` as an assignment (already designed in §0.1).
- **Heuristic ≠ true solvability** (accepted in `SCOPE.md` §4.1) → label as an
  estimate; tune bands; allow easy regeneration via `npm run gen`.
- **Generator runtime** for large N → seeded RNG + reasonable N (~20k); it's
  offline, so a few seconds is fine.
- **Full re-render performance** → board is tiny (≤52 nodes); full re-render is
  acceptable. Optimize to diff only if needed.
- **Dual browser/Node code** → the small dual-export footer (§1.3) keeps one
  source of truth for engine + heuristic with no build step.

---

_Workflow approved? Say "start phase 1" and I'll build the rules engine + tests
first, verify them green, then proceed phase by phase._
