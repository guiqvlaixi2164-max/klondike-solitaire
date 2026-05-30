# Plan — Phase 10: Dynamic card effects

_Short plan for review before coding. Companion to `SCOPE.md` §11 / `WORKFLOW.md`._

## Goal
Animate the three card actions — **flip**, **move/drag**, **collect** — so cards
slide, flip, and settle smoothly instead of snapping. Keep it tasteful and fast;
never block play or correctness.

## Approach (key decision)
Use the **FLIP technique** (First-Last-Invert-Play) on top of the current
full re-render — *not* a rewrite to persistent nodes.

- Each card already has a stable identity (suit+rank). Before re-rendering, record
  each card node's screen rect keyed by identity. After re-render, for any card
  whose position changed, set a `transform` equal to (old − new) then transition
  it to zero → it visually glides from where it was to where it is.
- This keeps the engine and render logic untouched; animation is a thin layer in
  `render.js` (or a small `anim.js`).

Why not persistent nodes: a bigger refactor for no extra benefit here; FLIP gives
smooth movement with the existing immutable-state + full-render model.

## What gets animated
1. **Flip** — face-down → face-up: a short 3D `rotateY` flip (CSS). Triggered when
   a card's `up` state changes (stock draw, tableau auto-reveal). Synced with the
   existing flip sound.
2. **Move** — click-to-move and auto-collect: the card glides from origin to
   destination (FLIP slide, ~160–200ms ease-out).
3. **Drag** — the browser already moves the card under the cursor. On drop we
   **suppress** the slide for the dragged card (it's already there) but still
   animate any revealed/auto-flipped card. (Distinguish drag-commit from
   click/auto-commit so drags don't "jump back and slide".)
4. **Collect** — to a foundation: the move slide plus a subtle settle (small
   scale/!glow) on arrival, timed with the collect chime.
5. **Auto-collect** — already stepped (~200ms/card); the per-card slide makes the
   cascade read naturally. May tighten the interval to match animation length.

## Constraints / non-goals
- Honor `prefers-reduced-motion: reduce` → disable transitions (accessibility).
- Durations short (~150–220ms); animations must not delay when the next input is
  accepted (state updates immediately; only the visuals tween).
- No win-screen cascade fireworks in this phase (can be a later nicety).
- No new dependencies; CSS transitions/keyframes only.

## Risks & mitigations
- **Re-render mid-animation** (rapid moves): key by identity and always animate
  from the latest recorded rect; interrupt cleanly by reading current transform.
- **Drag double-motion**: gate the slide with a `lastCommitWasDrag` flag set by
  `interactions.js`.
- **Fanned tableau offsets**: FLIP uses real measured rects, so fan offsets are
  handled automatically.

## Build steps
1. Add FLIP position-capture + replay in the render path (movement slide).
2. Add the 3D flip animation on `up`-state change; sync to flip sound.
3. Suppress slide on drag-commit; keep reveal animation.
4. Collect settle effect + auto-collect timing pass.
5. `prefers-reduced-motion` guard.
6. Verify (CDP): cards reach correct final positions after animations, no stuck
   transforms, reduced-motion disables them, no exceptions; unit tests stay green.
7. Update `SCOPE.md` §11 / `WORKFLOW.md`; refresh preview.

## Verification note
Animations are visual, so CDP checks final **post-animation** state/positions and
absence of leftover inline transforms, plus a reduced-motion run. A short
screen-capture/GIF isn't automated; I'll rely on a screenshot + your eyes for feel.
