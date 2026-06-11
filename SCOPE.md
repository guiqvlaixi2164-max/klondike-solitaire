# Klondike Solitaire — Project Scope

_Last updated: 2026-05-30_

This document defines exactly what we are building before any game code is
written. It reflects the decisions made during the clarification round. Anything
marked **OPEN** still needs a decision; everything else is considered locked.

---

## 1. One-line summary

A locally playable, browser-based Klondike Solitaire game with a simple,
clickable UI, four difficulty levels (easy / hard / expert / master), one-card
draw, and unlimited undo per match.

---

## 2. Confirmed decisions (locked)

| Topic | Decision |
|-------|----------|
| Platform | **Browser** — plain HTML + CSS + JavaScript (no framework, no build step). Open a single file to play. |
| Draw mode | **Draw one card** at a time from the stock. (Fixed; not configurable.) |
| Undo | **Unlimited undo** within a match. Each click reverts exactly one prior move. |
| Restart | **Restart the same deal** (issue #4) — a Restart button re-deals the current hand from its opening layout, so a stuck player can retry the identical game. (Added post-v1, see §11.8.) |
| Difficulty | **Four levels** — easy, hard, expert, master. Every bundled deal is **offline-solver-verified winnable**; the levels grade deals by **casual-player win rate** (how often an imperfect auto-player wins). See §4. |
| Deal source | **Pre-generated, pre-classified deal pool** bundled as a data file. New Game picks a random deal from the selected difficulty bucket. Instant, fully offline. |
| Hints | **Limited solver hints** (issue #2) — a Hint button suggests the best next move, capped per game. (Originally none; added post-v1, see §11.7.) |
| Stats | **Move counter + elapsed timer** shown per match. |
| Win handling | **Win detection** + a visible celebration + a **New Game** button. |
| Auto-move | **Double-click a card** to auto-send it to a legal foundation. |
| Interaction | **Both** drag-and-drop **and** click-to-select-then-click-destination. |
| Scoring | **No point scoring** (explicitly out of scope). |

---

## 3. Game rules (standard Klondike, as implemented here)

### 3.1 Board layout

- **1 Stock** (face-down draw pile), top-left.
- **1 Waste** (face-up discard pile), next to the stock.
- **4 Foundations** (one per suit, built up A→K), top-right.
- **7 Tableau columns**, the main play area below.

### 3.2 Initial deal

- Standard 52-card deck, no jokers.
- Tableau columns get 1, 2, 3, 4, 5, 6, 7 cards left-to-right.
- In each column only the **top (last) card is face-up**; the rest are face-down.
- Remaining 24 cards form the face-down **stock**.

### 3.3 Legal moves

- **Stock → Waste:** click the stock to flip **one** card to the waste.
- **Stock recycle:** when the stock is empty, clicking it recycles the entire
  waste back into the stock (face-down, order preserved/reversed per standard
  Klondike). **Recycles are unlimited** (see note in §5).
- **Waste → Tableau / Foundation:** the top waste card may move onto a legal
  tableau column or foundation.
- **Tableau → Tableau:** a face-up card (and the ordered run of cards on top of
  it) may move onto another column if the destination's top card is **one rank
  higher and the opposite color**. Empty columns accept **only a King** (or a
  King-led run).
- **Tableau → Foundation:** a single top card may move to its foundation if it
  is the next rank up in the same suit (A first, then 2…K).
- **Foundation → Tableau:** allowed (a card may be pulled back down), counts as
  a normal move and is undoable.
- **Auto-flip:** when a tableau move exposes a face-down card, that newly
  exposed card is automatically flipped face-up. (This automatic flip is bundled
  into the same undo step as the move that caused it.)

### 3.4 Win condition

- The game is won when **all 52 cards are on the foundations** (each foundation
  A→K). Triggers the win celebration and offers New Game.

### 3.5 Loss / dead-end

- No automatic loss detection. The player decides when to give up (New Game).
  (No solver runs during play, so the game does not announce "no moves left.")

---

## 4. Difficulty model (solver-verified winnability + casual-player difficulty)

Difficulty does **not** change the rules — every level plays identical Klondike
with one-card draw. Difficulty only selects **which deals you are given**.

> **History.** v1 estimated difficulty with a heuristic only (no winnability
> guarantee). **Issue #1** added the offline solver so every deal is *proven
> winnable*, and graded difficulty by the solver's **search effort** (node
> count). **Issue #3** replaced that grading: search effort turned out to be
> near-constant for the ~75% of deals that are trivially forgiving, so easy /
> hard / expert were indistinguishable in play. Difficulty is now the
> **casual-player win rate** (below). `src/heuristic.js` is retained for its
> tests but no longer used.
>
> **Issue #3 (follow-up).** The first win-rate build split a small pool into four
> equal quartiles and stopped at the first 400 winnable deals — so "master" was
> only the unluckiest 25% of a mostly-easy sample, and the casual player
> *saturated* (it loses ~100% of hard deals, so they all collapsed to a 0% win
> rate and became indistinguishable). Expert/master felt too soft. Grading is now
> **two-tier against absolute thresholds**, with rejection sampling (below).

### 4.1 How deals are classified

`tools/generate-deals.mjs` scans deterministic seeded shuffles. For each:

1. **Winnability gate (issue #1).** The offline solver (`src/solver.js`, DFS with
   a transposition set + safe-foundation autoplay, node-budgeted) must actually
   win it; deals it can't crack are discarded. A kept deal comes with a real,
   verified win.
2. **Difficulty grade (issue #3).** An imperfect auto-player
   (`tools/casual-player.mjs`) plays the deal many times with a fixed `MISTAKE`
   rate; the fraction it wins (0..1) is the difficulty signal. It prefers good
   moves (reveal face-down cards, build sequences, collect to foundations) but
   sometimes plays a random/greedy-wrong move — so a *forgiving* deal (many
   winning lines) wins most trials, while a *fragile* deal (one narrow line)
   loses most of them. Two player profiles are used:
   - a **casual** player (high `MISTAKE`) — felt difficulty for a typical player;
   - a **skilled** player (low `MISTAKE`) — only struggles on genuinely fragile
     deals, giving the hard tail the dynamic range the casual player lacks.

Deals are assigned to buckets by **absolute win-rate thresholds**, not quartiles:
the casual win rate splits **easy vs hard**, and (for deals the casual player
finds hard) the skilled win rate splits **expert vs master**. The generator
**rejection-samples** — it keeps scanning seeds until every bucket is full,
oversampling the rare hard tail rather than stopping at the first N winnable
deals. A deal the casual player loses but a skilled player still clears reliably
punishes mistakes yet has a clear line, so it stays **hard**, not expert/master.

> NOTE: The solver omits "pull a card back off a foundation" moves and bounds its
> search by a node budget, so it may *fail to win* some deals that are in fact
> winnable — that only ever **discards** a deal, never accepts an unwinnable one.
> The casual player is stochastic but **seeded**, so the whole generation is
> reproducible. (No solver/player runs during normal play; difficulty grading is
> generation-time only. The live Hint button is the one play-time solver use —
> §11.7.)

### 4.2 Buckets

Difficulty = how often an imperfect player wins the deal (graded player in
parentheses):

| Level | Meaning |
|-------|---------|
| Easy | **Casual** wins ≥ 80% — forgiving; you can play loosely and still win. |
| Hard | **Casual** wins 40–80% (or loses more but a skilled player clears it reliably) — needs care. |
| Expert | **Skilled** wins 5–30% — usually lost without precise play. |
| Master | **Skilled** wins < 5% — even a near-optimal player almost always loses, yet it **is** winnable. |

~100 deals per bucket are bundled (`PER_BUCKET` in the generator). The exact
thresholds (`EASY_MIN_CASUAL`, `HARD_MIN_CASUAL`, `EXPERT_MAX_SKILLED`,
`MASTER_MAX_SKILLED`) and the measured per-bucket win-rate ranges are written
into the header of the generated `src/deals.js`.

### 4.3 Deal data format

Deals are stored in a bundled JS/JSON data file as compact ordered card lists
(e.g. one array of 52 card codes per deal, plus its bucket label). The game
reconstructs the board deterministically from this list. No randomness at play
time except which deal index is picked.

---

## 5. Stock recycle — point to confirm

You chose **draw-one** and did **not** select "stock redeals" as a difficulty
lever, so the current plan is **unlimited recycles** of the waste pile at every
difficulty. This matches casual draw-one Klondike.

> **OPEN-A:** ✅ Confirmed — **unlimited recycles for all levels.**

---

## 6. UI / UX

### 6.1 Layout

- Top bar: **New Game** button, **difficulty selector** (easy/hard/expert/master),
  **Undo** button, **move counter**, **timer**.
- Below: stock, waste, four foundations (top row); seven tableau columns (main area).
- Plain, clean styling. Cards rendered with CSS (suit + rank), red/black colors,
  clear face-up vs face-down states. No external image assets required (suit
  glyphs via Unicode); a card-back pattern via CSS.

### 6.2 Interactions

- **Click-to-move:** click a card/run to select (highlight); click a legal
  destination to move. Click elsewhere / the same card to deselect.
- **Drag-and-drop:** press and drag a card/run onto a destination; drop on a
  legal target completes the move, illegal drop snaps back.
- **Double-click:** auto-send a card to a legal foundation if one exists.
- **Click stock:** draw one / recycle when empty.
- **Undo button:** revert the last move (unlimited).
- Illegal moves are rejected with a subtle visual cue (snap-back / shake); no
  penalty.

### 6.3 Stats

- **Move counter:** increments once per player-initiated move (a stock draw
  counts as a move; an undo decrements it). Final count shown on win.
- **Timer:** starts on the first move of a match, stops on win. Reset by New Game.

### 6.4 Win celebration

- A clear "You won!" overlay/message with final time and move count, plus a
  New Game button. (Animation style kept simple — exact effect TBD in build.)

---

## 7. Technical design (high level)

- **Files (planned):**
  - `index.html` — page structure / mount point.
  - `styles.css` — all styling and card visuals.
  - `game.js` — game state, rules engine, move validation, undo stack.
  - `ui.js` — rendering, click/drag handling, wiring to game state.
  - `deals.js` (or `.json`) — bundled pre-classified deal pool.
  - `generate-deals.*` — offline script that builds the deal pool (not loaded by
    the game at runtime).
  - (File split may be consolidated during implementation; the game must run by
    just opening `index.html` with no server.)
- **State model:** a single game-state object (stock, waste, foundations[4],
  tableau[7], each card with suit/rank/faceUp). Moves are pure transitions.
- **Undo:** stack of prior states (or reversible move records) — pushed on every
  move, popped on undo. Unlimited within a match.
- **No network, no backend, no build tooling** required to play.

---

## 8. Explicitly out of scope

- Point scoring / leaderboards / high-score persistence.
- Auto-solve, or "no moves left" detection. (Limited solver *hints* were
  originally out of scope but have since been added on request — see §11.7.)
- Draw-three mode or any other draw count.
- Multiplayer, accounts. (Sound was originally optional/TBD — it has since been
  implemented; see §11.)
- Mobile-specific/touch optimization (desktop browser is the target; touch may
  work incidentally but isn't a guarantee).

---

## 9. Open questions — RESOLVED

- **OPEN-A (recycles):** ✅ Confirmed — **unlimited** stock recycles at all difficulties.
- **OPEN-B (pool size):** ✅ Confirmed — proposed ~100–250 deals per bucket.
- **OPEN-C (heuristic tuning):** ✅ Confirmed approach — final weights/percentile
  cut points tuned and reviewed once the generator exists.
- **OPEN-D (theme):** ✅ Confirmed — **dark theme**. Win animation kept simple,
  finalized during implementation.

---

## 10. Proposed build order (step by step)

1. **Rules engine** (`game.js`) — deck, deal, move validation, win check, undo —
   testable without UI.
2. **Static UI + rendering** — draw the board from a state object.
3. **Interactions** — click-to-move, then drag-and-drop, then double-click auto.
4. **Stock/waste + recycle**, move counter, timer.
5. **Deal generator + heuristic** (`generate-deals.*`) → produce `deals.js`.
6. **Difficulty selector** wired to the deal pool.
7. **Win celebration + New Game**.
8. **Polish pass** (styling, illegal-move feedback, edge cases).

---

_All §9 items resolved (2026-05-30). Theme: dark. See `WORKFLOW.md` for the
detailed build plan._

---

## 11. Post-v1 enhancements (implemented)

Added after the initial build, on request. All verified in headless Chrome (CDP)
and committed.

### 11.1 Sound effects (synthesized)
- `src/sound.js` generates all audio via the Web Audio API — no asset files, so
  it stays offline/reproducible. Effects: **flip** (card flick on draw and
  auto-reveal), **pick** (lift on drag-start / select), **move** (place on
  tableau), **collect** (chime to a foundation; double-chime on win).
- A **🔊 / 🔇 mute toggle** lives in the top bar.

### 11.2 Realistic card faces
- **Pip layouts** for A–10 using the standard playing-card arrangement (e.g. 3 =
  three centered pips; 7/8/10 use the classic offset rows), with bottom-half
  pips rotated 180°. Ace = one large central pip.
- **Court cards** use suit-colored Unicode chess glyphs: **J = ♞, Q = ♛, K = ♚**.
- Card size is 100×140; corner indices are sized for readability and the pip
  field is inset so pips never overlap the numbers (verified pixel-level).

### 11.3 Auto-Collect
- A top-bar **Auto-Collect** button appears only when every card is known: the
  stock is empty and no tableau cards are face-down.
- It sends the remaining cards to the foundations **one at a time, in rank
  order**, each with the collect sound — it animates rather than jumping to the
  win screen, and stops exactly on win. Input is locked while it runs.
- Greedy foundation collection; always completes when the stock is empty and all
  tableau cards are face-up. (Edge case: cards stranded in the waste in an
  un-collectible order would stop the run early — not reachable in normal play.)

### 11.4 Foundation → tableau
- A collected card can be moved back down from a foundation onto the tableau
  (drag or click-to-move), per the rules, enabling more advanced play. (Engine
  support existed from v1; a `pointer-events: none` fix on the foundation "ghost"
  overlay was needed so real drags/clicks reach the card.)

### 11.5 Dynamic card effects (implemented)
- Cards animate using the **FLIP technique** layered over the existing
  re-render: a card glides (~160ms, snappy) from its previous screen position to
  the new one, flips (3D `rotateY`) when revealed or drawn, and glows briefly
  when collected to a foundation.
- Drag-commits **suppress the slide** for the dragged card (it's already at the
  cursor); reveals still animate.
- Honors `prefers-reduced-motion: reduce` (animations off). No new dependencies.
- See `ANIMATION_PLAN.md` for the design.

### 11.6 Win celebration — bouncing-card cascade (implemented)
- On win, the classic Windows-Solitaire cascade plays on a full-screen `<canvas>`
  (`src/win-anim.js`): foundation cards launch one by one, fall under gravity,
  bounce off the bottom in arcs, and leave trails that paint the screen.
- The stats overlay is **held back** and fades in after the cascade finishes (or
  immediately when the player **clicks to skip**).
- Canvas-drawn simplified card faces (rounded rect + rank/suit, suit-colored) from
  the cards' suit/rank — no images. Honors `prefers-reduced-motion` (skips to the
  overlay). New Game tears the canvas down.

### 11.7 Hint button (implemented — issue #2)
- A top-bar **Hint** button, **limited to 3 per game** (resets on New Game,
  disabled when used up / during Auto-Collect / after a win).
- Uses the same solver that guarantees winnable deals (`src/solver.js`, now
  shared by Node and the browser). It runs from the **current** position and
  highlights the **first move of an actual winning line** — the best move
  regardless of the moves the player already made. The solver knows the full
  deal, so the hint can reason about face-down cards.
- The suggested move's source card(s) pulse and the destination pile is outlined
  (distinct purple, separate from the yellow click-selection). Honors
  `prefers-reduced-motion`.
- **Fallback (per the issue):** if the position can't be won within the solver's
  live node budget (e.g. the player has played into a dead end), the hint falls
  back to "flip the next card from the stock" (draw, or recycle when empty).
- This is the one place a solver runs **at play time**; deal generation/
  verification remain offline (§4).

### 11.8 Restart the same deal (implemented — issue #4)
- A top-bar **Restart** button that re-deals the **current hand** from its
  opening layout, for when a player dead-ends and wants to retry the *same*
  game rather than draw a fresh one.
- The deal is identified by its 52-card **order array**, which `newGame` now
  remembers on `app.currentOrder`. Restart simply re-deals that stored order;
  New Game picks a new one. `engine.dealFromOrder` builds fresh card objects and
  never mutates the order, so the same array re-deals to a byte-identical
  opening every time.
- Restart resets exactly what a new match resets — undo history, the 3-hint
  budget, the move counter and timer, and any in-progress win/auto animation —
  but keeps the difficulty and the deal. It is disabled until the first deal is
  on the board and while Auto-Collect is animating (same lock as New Game).
- No new engine state or persistence: a refresh still starts a new deal. Restart
  only reaches back to the deal currently in memory.
