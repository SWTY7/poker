# Solve exact, distill small — plan and progress

*Living document. Read this first before touching anything in `src/gto/` for this initiative — it's the
record of what's been decided, what's been measured, and what's still open, across sessions.*

## Context

After PR #14 (every bot kind mixed at the table) and PR #15 (four trained CFR depths instead of one), the
user asked whether the solved bot (`BlueprintSetBot` / `BlueprintBot`) does blocker/card-removal reasoning
— "I have a king, the flop makes suited hands unlikely, so his big raise is probably not a real king, I
should re-raise." It doesn't, and the reason is architectural, not an oversight:

`src/gto/holdem/buckets.ts` collapses every postflop hand into 1 of 8 buckets by percentile strength before
solving anything. Two completely different holdings that land in the same bucket on a board — one that
blocks two of an opponent's flush combos, one that doesn't — get treated as identical and play the exact
same strategy. Blocker reasoning depends on exactly the information the abstraction discards.

The user's proposal: solve one accurate ("teacher") model at much higher resolution, then train a small,
fast ("student") approximator to imitate it — **policy distillation**, the same shape of solution real
poker AI (DeepStack and successors) uses for this exact tension. Full write-up of why this is the right
shape of fix, and why distillation doesn't let the student learn anything the teacher didn't already know,
is in the session transcript around 2026-09-24; this doc carries forward only the plan and the numbers.

## The three phases

### Phase 1 — the teacher (a much higher-resolution CFR solve)

**Key design point, found while scoping, not obvious going in:** `abstractHoldem()`'s information-set key
today is `${street}|${bucket}|${history}` — the board itself is never part of the key, only which bucket
number the current hand falls into *on* it. That's fine for percentile buckets (a "top 12.5%" is
comparable across boards by construction). It is **not** fine for a canonical combo id — the same combo id
means a completely different hand on a different board, so an exact-resolution key has to include the
canonical board too: `${street}|${canonicalBoardKey(board)}|${comboId}|${history}`.

This is why the teacher can't just be "more buckets" — it has to key on **board × combo**, using the
isomorphism reduction already built in `isomorphism.ts` (lossless suit-symmetry reduction: 22,100 flops →
1,755 canonical ones) instead of the lossy percentile step in `buckets.ts`.

**Status: first approach (board identity in the key) tried three ways, all failed — see "Attempt 1" below.
Second approach (board texture instead of board identity) converges, unlike attempt 1, but a real trained
blueprint from it shows no measurable win-rate edge over the existing bucket blueprint at 2,000 duplicate
pairs — see "Attempt 2." Phase 1 is not producing a clearly-worth-shipping teacher yet.**

### Phase 2 — the student (not started)

A small, hand-rolled feedforward net (matches this codebase's from-scratch ethos — no ML dependency; this
project has literally `react`/`react-dom` as its only deps today) trained by supervised cross-entropy
against the teacher's solved distribution per key, weighted down for keys CFR barely visited (softened
version of `train-blueprint.ts`'s existing `MIN_WEIGHT` pruning).

- **Features**: hero's hand via continuous quantities already computed in `buckets.ts` (`strengthOf`'s
  E[HS]/E[HS²] — not a discrete bucket id, or the same information bottleneck comes right back), board
  texture indicators, the existing abstracted betting-history encoding, stack depth.
- **Output**: action-probability distribution over the same discrete action set already used.
- Blocked on Phase 1 producing a teacher worth distilling.

### Phase 3 — integration and evaluation (not started)

- A forward-pass-only module for the browser (no backprop at runtime — plain matrix-vector multiply).
- Evaluation reuses `blueprint-bot.test.ts`'s existing duplicate-scoring win-rate harness unchanged:
  student vs. teacher (should be close to break-even) and student vs. the existing bots.
- Ships as a new agent kind alongside `BlueprintSetBot`, benchmarked before anything gets replaced.

## Attempt 1 — board identity in the key (abandoned 2026-09-24)

Three variants were built and measured, in order: full canonical-board-plus-combo keying on every postflop
street (`'exact'`), the same restricted to the river only (`[3]`), and a canonical board paired with a
finer-but-still-fixed bucket count instead of the raw combo (`{ tiers, streets? }`). All three put the
board's own canonical identity in the information-set key — the thing plain `'bucket'` mode deliberately
leaves out — on the theory that a bounded per-board resolution (a fixed tier count, or eventually pruning)
would keep the total key space bounded the same way `'bucket'` mode already is.

**All three failed the same way, confirmed by real measurement, not just extrapolation:** at 20bb, 20,000
iterations, bucket mode stayed essentially flat (27,706 → 28,924 by 200k) while every board-keyed variant
kept growing near-linearly with no sign of flattening — river-only exact reached 5,729,925 info sets by
200k iterations (still accelerating, not converging), full exact crashed with a genuine
`FATAL ERROR: JavaScript heap out of memory` before reaching 200k, and the 24-tier "coarser middle ground"
came out *larger* than full river-exact at 200k (5,840,533 vs 5,729,925) — proving the "bounded by
construction" reasoning behind it wrong. The root cause, confirmed rather than assumed: there are so many
distinct canonical boards that at any affordable iteration budget, almost every visit to a board-keyed info
set is the *first* visit to that specific board — so no amount of coarsening the hand resolution *within* a
board helps, because boards themselves essentially never get revisited enough times for that coarsening to
pay off. It is keying on canonical board identity at all, not the resolution used within it, that drives
the explosion.

The code for all three variants was removed (see git history around 2026-09-24 — commits on
`claude/poker-bot-psychology-3tfo01` from the `pilot-exact-abstraction.ts` era — if the specifics are needed
again) rather than kept as unused, permanently-off options. This section is the record of what was tried and
why it doesn't work, so nobody re-discovers the same ceiling from a different angle.

## Attempt 2 — board texture instead of board identity (in progress, 2026-09-24)

The corrected idea, surfaced directly by attempt 1's failure: never put the board's own identity in the key
at all. `src/gto/holdem/texture.ts`'s `textureOf()` classifies a board into 1 of 27 fixed categories
(flushiness × pairedness × straightness — 3 values each) instead of identifying which specific board it is.
Many different boards share a category, the same way many different hands already share a strength bucket
today, so this should be bounded the way `'bucket'` mode is bounded, not the way board-identity keying
wasn't — that's the thing to confirm with `scripts/pilot-texture-abstraction.ts`
(`npm run pilot:texture -- [iterations] [stack]`) before trusting it.

**Measured, at 20bb, same seed both modes:**

| iterations | bucket: info sets | texture: info sets | texture vs. bucket growth (10x iterations) |
|---|---|---|---|
| 2,000 | 19,791 | 58,083 | — |
| 20,000 | 27,706 | 164,848 | 2.8x |
| 200,000 | 28,924 | 300,504 | 1.8x |

**Reading it — this is the first attempt that actually looks like the "bounded by construction" reasoning
was supposed to produce**, and the contrast with attempt 1 is the whole point:

- Texture mode's growth *decelerates* as iterations increase (2.8x per 10x iterations, then 1.8x) — the
  same direction bucket mode's flattening goes, just not as far along yet. Every board-identity variant in
  attempt 1 did the opposite: flat or *accelerating* growth (river-exact went from 9.4x to 15x per 10x
  iterations as it ran longer), which is the signature of a space with no real ceiling at any affordable
  budget. Texture mode's ceiling is close enough to be visible from here.
- It ran to completion at 200k iterations in 296.0s — barely slower than bucket mode's own 254.8s for the
  same budget, and with no memory pressure worth mentioning (RSS nowhere near the ~7.5GB that preceded
  attempt 1's OOM crash). Nothing here is fighting the trainer the way board-identity keying did.
- At 300,504 info sets, it's an order of magnitude short of what attempt 1's variants reached at the same
  iteration count (river-exact: 5.7M; the failed tiers variant: 5.8M) — consistent with the fixed 27-category
  ceiling actually doing its job, unlike the canonical-board keying it replaced.
- Not fully converged yet — 1.8x growth per 10x iterations is real growth, not flat the way bucket mode's
  1.04x is — but decelerating growth toward a visible ceiling is a completely different situation from the
  accelerating growth attempt 1 measured. This looks affordable to push further and actually reach
  convergence, which none of attempt 1's variants ever did.

**This directly answers the question that motivated trying it**: yes, texture buckets show real converging
behavior, unlike any board-identity variant.

## Attempt 2, continued: a real trained blueprint, and an inconclusive head-to-head (2026-09-24, same day)

Pushed further and built the real artifact: `BlueprintBot` was made cardAbstraction-aware (it previously
hardcoded bucket-mode key lookup, which would have silently mis-keyed a texture blueprint — see
`src/gto/holdem/blueprint-bot.ts`'s `lookUp()`), `train-blueprint.ts` got a `cardAbstraction` CLI arg, and a
texture blueprint was trained at 20bb, 1,000,000 iterations (5x past the last pilot point):

- **368,671 information sets reached, 335,238 kept** (91% survive `MIN_WEIGHT` pruning — most nodes have
  real repeat visits, not one-off noise). Growth from the 200k pilot point: 300,504 → 368,671, **1.23x over
  a 5x increase in iterations** — continuing to decelerate (was 1.8x over the *previous* 10x), confirming
  this is genuinely converging, not just slower to explode than attempt 1's variants.
- 949s to train, no memory pressure. 12.1MB on disk — a real jump from the shipped bucket blueprints
  (`blueprint-20.json` is 900KB, 28,594 kept keys), proportional to the larger information-set space.

**Compared against the shipped bucket blueprint and the two baseline bots**
(`scripts/compare-blueprints.ts`, same duplicate-scoring harness as `tests/gto/blueprint-bot.test.ts`,
2,000 pairs, 20bb):

| matchup | result |
|---|---|
| texture vs. bucket blueprint (head to head) | +1.7 +/- 11.0 bb/100 — **no clear edge** |
| texture vs. heuristic bot | +36.3 +/- 11.2 bb/100 — ahead |
| texture vs. psych bot (average human) | +33.4 +/- 12.2 bb/100 — ahead |
| key lookups answered | 5,209/5,209 (100%) |

**Reading it, plainly**: texture mode is a real infrastructure win — it converges, unlike every attempt-1
variant, and it plays the baseline bots about as well as the existing bucket blueprint does (+36.3/+33.4
here versus the bucket blueprint's own documented +39.2/+31.4 in `blueprint-bot.test.ts` — statistically
indistinguishable given the error bars on both). What it does **not** show is a measurable edge over the
bucket blueprint it was meant to improve on: +1.7 +/- 11.0 bb/100 head-to-head is nowhere near two standard
errors from zero. Three honest readings, not resolved by this measurement: the extra board-texture
resolution genuinely isn't worth much at this stack depth against these opponents; it is worth something but
too small to see through an 11 bb/100 error bar at 2,000 pairs (closing that gap to resolve a modest true
edge would need on the order of 10-20x more pairs, real additional compute); or 1M iterations, while clearly
still converging, isn't quite there yet and the comparison is measuring a not-fully-settled strategy.

**Recommendation, acted on**: don't ship this specific trained artifact. The 12.1MB file was not committed
— it's reproducible with the exact commands below, and committing an unproven 12MB blueprint that's 13x the
size of the one it was meant to replace isn't justified by an inconclusive head-to-head. The code that makes
it reproducible *is* kept (`texture.ts`, `cardAbstraction: 'texture'` support in `abstract-holdem.ts` and
`BlueprintBot`, the `train-blueprint.ts` CLI arg, `compare-blueprints.ts`), since all of it is correct,
tested infrastructure independent of whether this particular result justifies shipping.

**To reproduce:**
```sh
npm run train:blueprint -- 1000000 20 8 src/gto/holdem/blueprint-texture-20.json texture
npm run compare:blueprints -- src/gto/holdem/blueprint-20.json src/gto/holdem/blueprint-texture-20.json 2000
```

## Progress log

- **2026-09-24**: Phase 1 infrastructure built and pilot run — `'bucket'` vs `'exact'` at 2k/20k iterations.
  PR: https://github.com/SWTY7/poker/pull/17. No decision yet on how to proceed past the pilot.
- **2026-09-24** (same day, round 2): Added per-street `cardAbstraction`, measured river-only exact at
  2k/20k/200k iterations. Found it explosive (not converging) and found full-exact crashes with an OOM at
  200k iterations, well short of convergence.
- **2026-09-24** (same day, round 3): Built and measured the coarser middle ground — board key plus a
  24-tier bucket instead of full combo. Ruled it out on real evidence: it buys no memory savings at any
  budget tested, for the same root cause as rounds 1-2 (board identity itself, not per-board resolution, is
  what explodes).
- **2026-09-24** (same day, attempt 2 starts): Removed all three board-identity-keyed variants from the
  code (kept as the "Attempt 1" summary above, not as dead code) and built `texture.ts` — a 27-category
  board classification that never keys on board identity at all. Not yet measured.
- **2026-09-24** (same day, attempt 2 measured): Piloted texture mode at 2k/20k/200k iterations. Unlike
  every attempt-1 variant, its growth decelerates (2.8x then 1.8x per 10x iterations, versus bucket mode's
  flat ~1.04x and attempt 1's accelerating growth) and it ran to completion with no memory pressure. First
  real positive signal in this initiative — worth pushing further (more iterations, or a real pruned
  blueprint + evaluation) rather than a fourth resolution-scheme pivot.
- **2026-09-24** (same day, attempt 2 continued): Made `BlueprintBot` cardAbstraction-aware, trained a real
  texture blueprint at 1,000,000 iterations (368,671 info sets, 335,238 kept, still decelerating), and
  compared it against the shipped bucket blueprint and the two baseline bots via `compare-blueprints.ts`.
  It plays the baselines about as well as the bucket blueprint already does, but shows no statistically
  significant head-to-head edge over the bucket blueprint itself (+1.7 +/- 11.0 bb/100). Recommended not
  shipping this artifact; kept the code that reproduces it, did not commit the 12.1MB trained file. Phase 1
  is stalled at "converges but unproven benefit," not at a clean success or a clean stop.
