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

**Status: infrastructure built, two rounds of pilot measurement done, both exact variants (full and
river-only) found to have a real blocker — not just cost, an actual crash — before reaching anything close
to convergence. See Pilot Results below, especially the second round.** Neither is currently safe to run to
completion; the training script needs real engineering (bounded, incremental pruning) before either is.

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

## Pilot round 2: river-only exact, and a real ceiling (2026-09-24, same day)

Added `HoldemOptions.cardAbstraction: number[]` — an array of streets (1=flop, 2=turn, 3=river) to key
exact, leaving the rest bucketed. `[3]` (river only) was the obvious next thing to measure: bound the
exact-resolution cost to the one street the user's own motivating example is actually about, rather than
all four. `pilot-exact-abstraction.ts` now runs a three-way comparison (bucket / river-exact / full-exact).

**Measured, at 20bb, same seed all three modes:**

| iterations | bucket: info sets | river-exact: info sets | full-exact: info sets |
|---|---|---|---|
| 2,000 | 19,791 | 41,327 | 130,289 |
| 20,000 | 27,706 | 379,230 | 1,227,451 |
| 200,000 | 28,924 | **5,729,925** | **crashed — OOM** |

**Reading it — two findings, both against the earlier hope:**

1. **River-only isn't a qualitatively smaller problem, just a smaller constant.** At 20k iterations its
   info-set count was ~3.2x smaller than full-exact's (379,230 vs 1,227,451), which read as encouraging.
   At 200k iterations it grew **15x** (379,230 → 5,729,925) — *faster* than the 10x growth in iterations,
   i.e. accelerating, not converging. Whatever the total river-exact universe actually is, 200k iterations
   hasn't found the top of it. Bucket mode, over the same range, went 27,706 → 28,924 — a 4% move. It's
   fully converged; the other two give no sign of being anywhere close.
2. **Full-exact doesn't just get slow, it crashes.** The 200k-iteration full-exact run died with a genuine
   `FATAL ERROR: JavaScript heap out of memory` after ~950s of GC thrashing at a 7.5GB heap. This is a real
   ceiling in the current implementation, not a "let it run longer" problem: `trainMccfr` keeps every node
   it has ever visited in one in-memory `Map` for the whole run, with pruning (`MIN_WEIGHT` in
   `train-blueprint.ts`) applied only *after* training finishes. At full-exact's node-count growth rate,
   more compute time means more memory, not just more wall-clock — the crash would very plausibly recur
   even with a much larger heap allocation, just later.

**What this changes:** the earlier "decision point" listed four options assuming the only question was how
much *time* to spend. That was wrong — two of the three resolution levels above (full-exact, and very
plausibly river-exact once pushed further) have a *memory* ceiling that arrives before a *time* ceiling
would. Getting either to something usable isn't "run it longer," it's real engineering: `trainMccfr` or a
training-specific wrapper around it needs to prune low-weight nodes *during* the run, periodically, not
just once at the end — bounding memory regardless of how large the total reachable space turns out to be.
That's unbuilt and unscoped.

**Decision point, revised:**
1. ~~Just run it overnight~~ — ruled out as stated. It doesn't fail slow, it fails with an OOM crash, at a
   scale (200k iterations) far short of anything that would look converged.
2. **Build incremental pruning first**, then reattempt river-exact (not full-exact — river-exact's smaller
   constant factor still means less memory pressure at the same iteration count, even though its growth
   rate looks similar). Real engineering work with an uncertain payoff: pruning keeps memory bounded, but
   doesn't by itself tell you whether the *pruned* strategy is any good — that still needs measuring.
3. **A coarser middle ground that was on the table before either exact variant looked broken**: key on
   canonical board but keep a *few* fine-grained buckets within it (not 8, more like 20-30) instead of full
   per-combo resolution. This bounds memory by construction the same way today's bucket mode does — a fixed
   number of tiers, not an open-ended combo count — so it doesn't have the same crash risk, at the cost of
   being back to *some* lossy collapsing (less than 8 buckets' worth, but not zero).
4. **Stop here.** The two pilot rounds are real, informative, negative results: this specific approach
   (canonical-combo-exact CFR keying, in-memory, no incremental pruning) doesn't work at a useful scale with
   the current implementation. That's worth knowing and worth stopping on rather than continuing to spend
   compute discovering the same ceiling from a different angle.

Nothing above has been chosen. Option 3 is the one that doesn't require new engineering before it can even
be tried — whoever picks this up next should probably measure that one before deciding whether option 2's
engineering investment is worth making.

## Pilot round 3: option 3 measured, and the "bounded by construction" reasoning was wrong (2026-09-24, same day)

Built `{ tiers, streets? }` on `cardAbstraction`: like `'bucket'`, hands are folded into a percentile bucket
rather than a raw combo id, but the canonical board is kept in the key alongside the bucket — so, unlike
`'bucket'`, two different boards no longer automatically share a strategy. `pilot-exact-abstraction.ts` now
runs a five-way comparison; `river-tiers` (24 tiers, river only) and `all-tiers` (24 tiers, every postflop
street) were added as the direct comparison points against `river-exact` and `exact`.

**Measured, at 20bb, same seed all five modes:**

| iterations | bucket | river-exact | exact | river-tiers (24) | all-tiers (24) |
|---|---|---|---|---|---|
| 2,000 | 19,791 | 41,327 | 130,289 | 41,327 | 135,437 |
| 20,000 | 27,706 | 379,230 | 1,227,451 | 382,264 | 1,222,668 |
| 200,000 | 28,924 | 5,729,925 | crashed — OOM | **5,840,533** | not run (see below) |

**Reading it — the "bounded by construction" framing in the decision point above was wrong, and it's worth
saying plainly why**, since it was my own reasoning and it didn't survive contact with a real measurement:

The theory was that keeping the tier count fixed (24, instead of ~500-1,000 live combos) bounds the
per-board contribution to the node count, the same way `'bucket'` mode's fixed 8 buckets keep it flat
overall. That's true in principle — for a board sampled enough times to see collisions between different
combos landing in the same tier. It assumed collisions would start happening at a reachable iteration count.
They don't, and the reason is the same shape of problem as before: the *number of distinct canonical river
boards* is itself enormous (comparable to or larger than the number of live combos per board), so at any
affordable iteration budget almost every visited river info set is the *first* visit to that specific board,
whether keyed by full combo or by a 24-way tier. Coarsening the resolution *within* a board does nothing
when the run essentially never revisits the same board more than a handful of times. The node-count numbers
say this directly: river-tiers tracked river-exact within 1% at 20k iterations and came out **larger** than
it at 200k (5,840,533 vs 5,729,925) — not smaller, which is the opposite of what "bounded by construction"
predicted. It ran to completion without crashing (355.9s, no OOM), but that's the only thing it bought —
memory-wise it is indistinguishable from full combo resolution at this scale, so it isn't actually a cheaper
alternative, just a coincidentally-safer one this one time.

`all-tiers` at 200,000 iterations was not run: with river-tiers alone shown to give zero savings over
river-exact, and full-`exact` already known to OOM at 200k, running all-tiers (which tracked full-exact
almost exactly at both smaller sizes) would very likely just reproduce the same crash for the same reason,
at real compute cost, with the outcome already predictable from the pattern above.

**The corrected lesson**: it is *keying on the canonical board at all* — regardless of what resolution is
used to describe the hand on it — that reproduces almost the entire information-set explosion. The combo-vs-
tier resolution question, which both this round and round 2 spent real measurement on, turns out to be
close to irrelevant next to that. Any future attempt at this has to either (a) not put the full canonical
board in the key at all — e.g. a genuinely coarse *board-texture* classification (a few dozen categories:
monotone, two-tone, paired, connected, and so on) instead of full board identity, cutting the board
dimension itself by orders of magnitude rather than the per-board hand dimension — or (b) accept the
explosion and solve the memory problem structurally, with incremental pruning during training. Both are real,
unscoped engineering, neither of which this pilot built.

**Revised decision point**, superseding the one above:
1. ~~Just run it overnight~~ — still ruled out, for the reasons already given.
2. ~~Coarser bucket-on-canonical-board middle ground~~ — **ruled out by this round's measurement**, not
   just deprioritized. It does not bound memory at any iteration budget tested, and there's a clear
   structural reason to expect that to keep holding at any budget this project could afford to run.
3. **Build incremental pruning into the trainer.** Still the only path that keeps full board+combo
   resolution (what the original blocker-reasoning motivation actually wanted) while bounding memory. Real
   engineering, uncertain payoff on strategy quality even once built.
4. **A genuinely coarser board classification** (board texture buckets, not canonical board identity) —
   newly surfaced by this round's finding, not previously scoped. Would need real design work (what counts
   as a texture category, how many, how it's computed) before it could even be piloted the way the last
   three rounds piloted combo/tier resolution.
5. **Stop here.** Three rounds of real measurement across three resolution choices (full exact, river-only
   exact, and now board+tier) have not found a version of "solve exact" that both fits in memory and shows
   any sign of being affordable to run to something resembling convergence. That is a complete, honest
   answer to the phase 1 question as originally scoped, even though it isn't the answer anyone was hoping
   for going in.

## Progress log

- **2026-09-24**: Phase 1 infrastructure built and pilot run (see Pilot Results above). PR:
  https://github.com/SWTY7/poker/pull/17. No decision yet on how to proceed past the pilot.
- **2026-09-24** (same day, round 2): Added per-street `cardAbstraction`, measured river-only exact at
  2k/20k/200k iterations. Found it explosive (not converging) and found full-exact crashes with an OOM at
  200k iterations, well short of convergence. Revised the decision point — this isn't a "how long to run
  it" question anymore, it's "does this need incremental pruning built first, or is a coarser bucketed
  middle ground (option 3) worth trying before investing in that." Still no decision made; still open.
- **2026-09-24** (same day, round 3): Built and measured the coarser middle ground (option 3 above) — board
  key plus a 24-tier bucket instead of full combo. It does not work: node counts tracked river-exact within
  1% at 20k iterations and came out slightly *larger* at 200k (5,840,533 vs 5,729,925), so it buys no memory
  savings at any budget tested despite the "bounded by construction" reasoning that motivated trying it.
  Root cause, confirmed: the explosion comes from the sheer number of distinct canonical boards a run
  encounters, not from the resolution used to describe a hand within a board — coarsening that resolution
  doesn't help when almost no board gets revisited enough times to see the coarsening's benefit. Ruled option
  3 out on real evidence and surfaced a new, previously-unscoped option 4 (board-texture buckets instead of
  full canonical board identity) as the only untried way to shrink the space instead of accepting it and
  pruning. Still no decision made on how to proceed; reported back to the user with the corrected picture
  rather than picking a direction unilaterally.
