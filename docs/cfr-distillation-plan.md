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
Now trying a second approach (board texture instead of board identity) — see "Attempt 2."**

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

Status: built, not yet measured. Next step is the same pilot pattern used for attempt 1 — 2k/20k/200k
iterations, bucket vs. texture, same seed — before deciding whether this is a viable teacher resolution or
needs its own follow-up.

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
