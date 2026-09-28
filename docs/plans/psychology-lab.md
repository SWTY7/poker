# Plan: reading the human, then a personality lab

*Written 2026-09-28 from the user's brief ("Poker opponent that models you → Personality lab") and this
repo's current state. Ultimate goal: **Phase 3, recovering personality from play, validated on bots and then
on real players.** Branch: the psychology branch. Read `docs/plans/README.md` for how this track shares the
codebase with the game-modes track.*

## Where things stand (end of PR #19)

- Bots: `PsychBot` (prospect theory, mental accounting, tilt, level-k) blended with solved strategies by
  `discipline` (piKL). It prices later streets (implied odds) and five bet sizes, and reads opponents by
  range, size and showdowns. See `docs/combined-bot.md`.
- `OpponentModel` already learns, from public actions, every player's aggression, fold-to-bet, postflop
  bet/fold/call/raise rates, big-bet share, and river bluffs seen at showdown. That includes the human.
- Solves: heads-up blueprints (10/20/40/75bb) and a multiway preflop book (3–6 players, 8/20/40/100bb).
  Both expose `strategyFor(obs)`, the whole mixed strategy for a spot, which is what a leak finder compares
  against.
- The `AIObservation` boundary: bots never see hidden cards. Everything below that looks at the human's own
  cards lives **outside** it, in `src/review/`, and nothing in `src/ai/` may import from there.

## Step 0: seams the game-modes track needs (do first, small, merge early)

1. `OpponentModel.toJSON()` / `OpponentModel.fromJSON(data, decay)`: serialize tallies per player. Restoring
   multiplies every count by `decay` (e.g. 0.7), so old evidence fades and a read never freezes.
2. `PsychBot` option to start tilted (`startTilted(level)`), clamped to the profile's own tilt range.
3. A decision's **closeness**: the value gap between the chosen and the next-best action, in pots, exposed
   next to the action (e.g. `lastDecision: { closeness }` on the bot). This is for timing tells. It must not
   change any decision.

Tests for each, then a PR. The game track builds rivals, pre-tilt and timing on these.

## Phase 1: "What the table thinks of you"

1. **Hand-history logging** of the human seat (`src/review/log.ts`, storage `poker.review`, versioned, JSON
   export). Every decision with its state: street, position, pot, stacks/depth, facing bet, hole cards, board,
   the action and its size. Logging uses the engine state at the table, never an `AIObservation` built for a
   bot.
2. **Read panel** (end of session or results screen): the table's `OpponentModel` read on the human, e.g. "the
   bots think you bluff X% and bet big Y% of the time", in plain words.
3. **Style profile** from the log: VPIP, PFR, 3-bet %, aggression factor, c-bet %, fold-to-c-bet, WTSD,
   W$SD, and a **tilt signature** (does play change after losing a big pot?). Show a sample size with every
   stat; VPIP/PFR settle within ~100 hands, river stats don't.
4. **Leak finder:** wherever a solve applies (heads-up at a trained depth, or multiway preflop), compare the
   human's action with the solve's mixed strategy. Report the most frequent and most costly deviations.

## Phase 2: teaching mode (hand review)

- **Hand review**, a toggle in Quick Play (see README for the order with the game track). After each hand,
  show at each of the human's decisions the solve's mix ("book: raise 85%, you called"), the equity at the
  time, and what a `PRO` character would have done in the same spot.
- Optional hint mode during play, off by default.
- Reuses Phase 1's engine. The review UI component lives in `src/ui/`; the logic lives in `src/review/`.

## Phase 3: personality lab (the goal)

### 3a. Validate on bots first

The `CAST` characters have **known parameters**: loss aversion (lambda), probability weighting (gamma),
accounting style, tilt sensitivity, level-k depth, confidence, discipline. So:

1. **Generate ground truth.** Run many bot-vs-bot sessions (scripts, like `scripts/calibrate-reads.ts`) with
   parameters drawn at random from wide ranges, not just the eight archetypes. Log every seat as Phase 1 logs
   the human.
2. **Summary statistics.** Compute each seat's style profile (Phase 1's stats plus the tilt signature,
   showdown bluff share, sizing tendencies) per N hands.
3. **Recover parameters from behaviour alone.** Start with simulation-based inference: learn the map from
   stats to parameters on training seats (nearest-neighbour or a small regression), then test on held-out
   seats. Report, per parameter, how well it's recovered (correlation, error) **as a function of hands
   played**, e.g. 50/100/200/500. That curve is the answer to "which stats are stable enough in ~100 hands".
4. **Identifiability check.** Some parameters may be indistinguishable in behaviour (e.g. lambda vs
   accounting style). Say so rather than report a number for them.

If bot personalities can't be recovered from their play, there's no claim to make about humans. This step
decides whether 3b is worth doing.

### 3b. Real players

- **Backend:** Supabase (auth + Postgres) with the site still on GitHub Pages. The anon key may ship
  client-side **only with Row-Level Security on**. Never put the service key in the repo. GitHub Pages from
  a private repo needs a paid plan, so check before making the repo private.
- **Protocol:** ~15-minute sessions on a **fixed deal set** (the same cards for everyone, duplicate-style,
  so styles are comparable). Add a short Big-Five questionnaire (BFI-10) and a question on poker experience,
  which must be controlled for.
- **Consent and anonymity from day one:** an explicit consent screen, no names stored, the ability to delete
  your data.
- **Expectations:** first pool is the AI coding club. Expect n ≈ 10–20 case studies, not statistics, and
  write it up that way.

### Open questions

- Which stats are stable in ~100 hands? (3a's curve answers this.)
- Does poker style map onto personality at all, or only onto poker experience?

## Done means

Each step: tests, `npx tsc -b`, `npx oxlint`, `npx vitest run`, a browser check where there's UI, and a line
in `docs/PROGRESS.md`. Any bot behaviour change is A/B-measured the way `docs/combined-bot.md` does it (a
temporary baseline copy plus duplicate scoring, never committed).
