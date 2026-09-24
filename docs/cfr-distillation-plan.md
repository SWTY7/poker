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

**Status: infrastructure built, pilot run, full solve not yet attempted.** See Pilot Results below.

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

## Pilot results (Phase 1, 2026-09-24)

**What was built** (merged, low-risk, doesn't change any existing behavior):
- `HoldemOptions.cardAbstraction?: 'bucket' | 'exact'` on `abstractHoldem()` (`src/gto/holdem/abstract-holdem.ts`).
  Default `'bucket'` reproduces today's behavior exactly (all existing tests pass unchanged). `'exact'` keys
  postflop info sets by canonical board + relabelled combo id instead of a percentile bucket.
- `scripts/pilot-exact-abstraction.ts` (`npm run pilot:exact -- [iterations] [stack]`) — runs the same
  iteration budget through both modes at the same depth and reports info sets reached and wall-clock time
  for each. Does not write a blueprint file; it exists only to measure, not to produce something usable.

**Measured, at 20bb, same seed both modes:**

| iterations | bucket: info sets | bucket: time | exact: info sets | exact: time |
|---|---|---|---|---|
| 2,000 | 19,791 | 31.7s | 130,289 | 1.8s |
| 20,000 | 27,706 | 102.9s | 1,227,451 | 25.2s |

**Reading it:**
- Exact mode's *per-iteration* cost is actually cheaper than bucket mode's — canonical relabelling is cheap
  pure computation, versus bucket mode's Monte Carlo run-out sampling per new board. The wall-clock numbers
  above are not a speed problem.
- The real finding is *scale*. Bucket mode's reached-info-set count grew only 1.4x from 2k→20k iterations
  (19,791 → 27,706) — it's already mostly revisiting a small, bounded space (~28k-69k total kept info sets
  at convergence, per the four depths trained in PR #15). Exact mode grew 9.4x over the same 10x increase
  in iterations (130,289 → 1,227,451) — **still almost linear, i.e. still overwhelmingly discovering new
  info sets, not revisiting known ones.** No sign yet of the flattening that would mean it's converging.
- The per-iteration rate was already dropping as the node table grew (1,111 iter/s → 794 iter/s, 2k→20k),
  before the space is anywhere near the millions-of-nodes scale where memory (a JS `Map<string, Node>` with
  tens of millions of entries) becomes a real concern on its own.
- **Honest extrapolation, not measured**: the four PR-#15 depths converged with roughly 14 visits per kept
  info set on average (400k iterations / ~28,594 kept info sets at 20bb). Getting even that same modest
  confidence level across what's very plausibly several million total info sets (the flop alone has ~1,755
  canonical boards × up to ~1,081 live combos ≈ 1.9M board×combo pairs, before turn, river, and betting
  history multiply it further) points to tens of millions of iterations — **plausibly many hours to the
  better part of a day for one depth**, not the ~5-9 minutes bucket mode took per depth in PR #15.

**Decision point, not yet made:** whether to commit to a real multi-hour-to-day-scale background solve at
this resolution. Options, not decided between:
1. Just run it — accept the cost, one depth (20bb, the most-played), as an overnight/background job with
   checkpointing so a partial result isn't wasted if it needs to stop early.
2. A coarser middle ground before going fully exact — e.g. key on canonical board but keep a *few* very
   fine-grained buckets within it (not 8, more like 20-30) rather than full per-combo resolution, to see if
   most of the blocker-relevant signal survives at a much smaller info-set count.
3. Restrict the exact solve to a single street first (river only — smallest remaining tree, and it's
   exactly the street in the user's own motivating example) rather than all four streets at once.
4. Stop here — the pilot data alone may be enough to judge this isn't worth the compute/engineering budget
   right now, and revisit later.

Nothing above has been chosen. Whoever picks this up next (me, in a future session, or the user) should
re-read this section, decide, and update the log below before proceeding.

## Progress log

- **2026-09-24**: Phase 1 infrastructure built and pilot run (see Pilot Results above). PR:
  https://github.com/SWTY7/poker/pull/17. No decision yet on how to proceed past the pilot.
