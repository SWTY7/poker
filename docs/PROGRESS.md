# Current status

*Read this first. It's the accurate, current picture — the other docs are either historical
(`v1-architecture-plan.md`) or scoped to one initiative (`cfr-distillation-plan.md`). Update this file
whenever a meaningful piece lands; it's meant to stay current, not to be rewritten from scratch.*

## What this is

A client-side, No-Limit Texas Hold'em web app — React + TypeScript + Vite, deployed to GitHub Pages, no
backend, no LLM. What makes it more than a poker engine with a UI on top is the AI opponent layer: every
bot is a full psychological model, anchored (as far as its character has studied) to a CFR-solved "GTO"
strategy for heads-up spots, with a different character in each seat, drawn fresh every game.

## Doc map

- **This file** — current state, updated as things land.
- [`v1-architecture-plan.md`](./v1-architecture-plan.md) — the original design plan, written before any
  of it was built. Historical from here; its layering principles and the `AIObservation` information
  boundary are still followed, its milestone list and scope are long since exceeded (see its own header
  note and annotated milestones for what actually shipped against each one).
- [`cfr-distillation-plan.md`](./cfr-distillation-plan.md) — the one initiative currently in progress
  (solve a much higher-resolution CFR "teacher" once, distill it into a small fast "student"). Phase 1's
  pilot is measured; no decision yet on how far to take it. Read its own progress log before continuing it.
- [`combined-bot.md`](./combined-bot.md) — how the one bot kind blends its own instinct with the solved
  strategy, why reads don't loosen discipline, and the heads-up benchmark numbers behind both.
- [`human-strategy-gaps.md`](./human-strategy-gaps.md) — poker strategies real players use that no bot does
  yet, basics and advanced, each with a concrete implementation suggestion and a suggested order. Not a
  plan; nothing in it is scoped or committed to.

## Engine & rules — `src/poker/`

Deck, hand evaluator, game state, betting/pot logic (side pots, all-ins), dealer/blind rotation, table
position labels. `src/poker/fast/` is a separate, optimized hand-evaluation path used by the GTO solver's
equity sampling, where raw speed matters (millions of evaluations per training run). Complete and tested;
this layer hasn't needed rework since the milestones in the v1 plan.

## Bankroll, profile, tournaments — `src/game/`

- `profile.ts`: a versioned, `localStorage`-backed bankroll with lifetime stats and a daily stake (a
  small top-up once per calendar day if the bankroll runs low).
- `tournament.ts`: blind structures, geometric blind escalation, payout brackets, standings.

## The table UI — `src/ui/`

Lobby → cash-game/tournament setup → table → results, all built on a shared `menu-*` visual vocabulary. A
poker chip + spade favicon, chip-denomination-colored bankroll/buy-in displays, a positional seat legend, a
hand-strength study aid, a tournament HUD with a blind clock. The bet-sizing slider caps its own draggable
range at `max(5x pot, $2,000)` rather than the full stack, so it stays precise regardless of how deep a
session's bankroll has grown (a fixed-pixel-width linear slider spanning a huge stack otherwise turns a
small drag into a four-figure jump).

## AI opponents — `src/ai/`

Every bot seat is one model — `PsychBot` — and `useHoldemGame.ts`'s `buildTable()` gives each seat a
different character from `profile.ts`'s `CAST`, drawn fresh every game. No settings, no flags. What the
model does, and what the characters vary:

- **`psychology/psych-bot.ts`**, the largest and most-iterated piece:
  - Prospect theory (loss aversion, diminishing sensitivity, probability weighting — `prospect.ts`) and
    mental accounting (where the reference point sits, session vs. hand-to-hand — `accounting.ts`).
  - Tilt as a state variable that decays between hands and spikes on a violated expectation, not just a
    lost pot (`tilt.ts`).
  - Level-k opponent reasoning for how much a bet is believed to be a bluff (`level-k.ts`), floored so no
    profile ever reads a raise as literally unbluffable (`MIN_BLUFF_BELIEF` in `psych-bot.ts`).
  - Loss aversion that scales down as a facing bet becomes a smaller fraction of the stack, so a
    deep-stacked bot doesn't fold a trivial-relative-size raise as readily as a short-stacked one would
    (`STAKE_REFERENCE_FRACTION`).
  - A shared, per-table `OpponentModel` (`opponent-model.ts`): every bot learns each opponent's aggression
    and fold-to-a-bet rates from their public actions this session (never their cards). Each read is
    against what's *normal in that setting*, heads-up or multiway: baselines measured by
    `npm run calibrate:reads`, since one fixed number once read a whole full table as passive. Confidence
    grows with the number of actions seen.
  - Range reading across the whole hand (`range-reading.ts`): every opponent who has acted is read street
    by street by Bayes' rule over all 1,326 combos. Each postflop action is cut relative to what they can
    still hold, at the rate that player is seen taking it; the engine stamps each recorded action with its
    street for this. One measured exception: a bettor's range isn't used for deciding whether to call
    them, because without showdown information their bluff share can't be read.
  - Blocker-aware fold equity (`range-reading.ts`'s `splitAgainstBet`): an opponent continues with strong
    hands plus the top share of their *own* range, decided without seeing the hero's cards. The hero's
    cards are then removed from what's possible, so holding a card their calling hands need makes a bluff
    work more often.
  - Position-aware ranges for an opponent who hasn't voluntarily acted yet, preflop, via
    `math/realization.ts`'s real per-position opening widths (`OPEN_PERCENT`) — a still-to-act UTG seat
    reads tighter than a still-to-act button.
  - Board-texture-aware ranges postflop, reusing the GTO solver's own hand-bucketing machinery
    (`gto/holdem/buckets.ts`'s `bucketOf`) instead of a flat, board-blind percentile cutoff.
  - Randomized per table: which archetype (`profile.ts`'s `CAST`) sits where, and each instance's own
    level-k depth, confidence and discipline (`randomizeProfile`).
- **Combined with the solved strategy** (`docs/combined-bot.md`): once the trained CFR strategies download,
  every bot gets them (`useFundamentals`). Wherever a hand is heads-up at a trained depth, the bot
  blends the solve's mixed strategy with its own valuation, KL-regularized ("piKL"). How much it
  trusts the solve is the character's `discipline`, which tilt wears down. `PRO` (discipline 0.85) plays
  near the solve; the recreational characters (0.1–0.15) mostly play instinct. Multiway, or at an
  untrained depth, it's pure instinct. Measured heads-up with `npm run benchmark:pro`. A calibrated read on
  the heads-up opponent adjusts the solve's mix directly first (`exploits.ts`): call a bluffer down
  lighter, bluff an over-folder more, stop bluffing a calling station.
- **Not seated any more:** `heuristic-bot.ts` (pot odds and three thresholds) stays as the cheap engine
  test driver and the benchmark floor. The old personality-dial bot was deleted, since a `PsychBot` with
  the right profile covers everything it did.

## The GTO solver — `src/gto/`

From-scratch CFR and Monte Carlo CFR (`cfr.ts`, `mccfr.ts`), verified against solved-game oracles at small
scale (Kuhn, Leduc, heads-up push/fold — each checked against an independently-written second solver
and/or published values) before being pointed at abstracted heads-up hold'em, which has no published
oracle to check against.

- `holdem/abstract-holdem.ts`: the abstracted game CFR actually solves — bucketed hand strength, three bet
  sizes (half-pot/pot/all-in), capped raises. Heads-up only, deliberately: CFR's convergence guarantee is
  a two-player zero-sum theorem, and there's no equilibrium a multiway solve would even be converging
  toward.
- `holdem/buckets.ts`: real, card-removal-correct, run-out-sampled percentile hand strength per board,
  cached per canonical board.
- `holdem/isomorphism.ts`: lossless suit-symmetry board reduction (22,100 flops → 1,755 canonical ones).
- Four trained stack depths shipped as static JSON (`blueprint-{10,20,40,75}.json`, `scripts/train-blueprint.ts`
  generates them, ~400k iterations each). `blueprint-set.ts`'s `BlueprintSetBot` picks whichever trained
  depth is closest to a table's actual effective stack at decision time.
- `holdem/pushfold.ts` / `pushfold-solver.ts`: heads-up push/fold solved exactly (338 information sets,
  real cards, checked against published charts) — the one corner of hold'em small enough to solve without
  any abstraction at all.

## Verification, as of this writing

440 tests as of the last full run; `npx vitest run`, `npx tsc -b` and `npx oxlint` are all clean. Re-run
them rather than trust this number — it moves.

**Use `npx tsc -b`, not `npx tsc --noEmit -p .`**: `tsconfig.json` only lists project references, so
`-p .` typechecks nothing and passes even on a deliberate type error (found 2026-09-25; earlier "tsc clean"
claims made with it were hollow, though the code passed `tsc -b` once checked). `npm run build` runs
`tsc -b` too. Nothing typechecks `tests/` or `scripts/` (`tsconfig.app.json` includes only `src`).

## Deliberately not built

- Omaha or other variants.
- A multiway (3+ player) CFR solve — see the note in `abstract-holdem.ts`'s own top comment for why this
  isn't just unimplemented, it's out of scope on purpose.
- A UI toggle or settings screen for anything AI-related — there isn't one, by design; the bot mix is
  always on, always randomized, nothing to configure.
