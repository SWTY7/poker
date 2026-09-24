import { abstractHoldem, DEFAULT_HOLDEM, type HoldemOptions } from '../src/gto/holdem/abstract-holdem'
import { trainMccfr } from '../src/gto/mccfr'
import { bucketCacheSize, clearBucketCache } from '../src/gto/holdem/buckets'
import { createRng } from '../src/utils/random'

/**
 * Phase 1 pilot for the "solve exact, distill small" idea: measures what
 * dropping percentile bucketing for canonical-combo-keyed information sets
 * actually costs, at a small, controlled, apples-to-apples iteration count
 * — same depth, same iteration budget, several abstractions — rather than
 * gambling a background run of unknown length on the full thing.
 *
 *   npm run pilot:exact -- [iterations] [stack]
 *
 * Five runs: today's bucket abstraction; river-only exact and full exact
 * (both already measured to grow without bound and, for full exact, crash
 * with an out-of-memory error well short of 200,000 iterations — see
 * docs/cfr-distillation-plan.md's round 2); and two board-tiers runs (river
 * only, then every postflop street) — a coarser alternative that folds the
 * board into a percentile bucket like today's mode does, but keeps the
 * canonical board in the key so two different boards no longer share a
 * strategy just because a hand lands in the same tier on both. Bounded by
 * construction (fixed board count x fixed tier count), so it should not be
 * able to hit the growth or memory problems the two exact variants did —
 * that is the thing this run exists to confirm with real numbers.
 *
 * Not meant to produce a usable blueprint; MIN_WEIGHT pruning and file
 * writing are deliberately left out of this script. It exists to answer one
 * question with real numbers: how much bigger and slower does the tree get,
 * and does a run at this resolution even look affordable from here.
 */
const TIERS = 24

export default function main(args: string[]): void {
  const iterations = Number(args[0] ?? 20_000)
  const stack = Number(args[1] ?? DEFAULT_HOLDEM.stack)

  const run = (label: string, options: HoldemOptions) => {
    clearBucketCache()
    console.log(`\n=== ${label}: ${iterations} iterations at ${stack}bb ===`)
    const game = abstractHoldem(options)
    const started = Date.now()
    const result = trainMccfr(game, iterations, { rng: createRng(20260919), plus: true })
    const elapsed = (Date.now() - started) / 1000
    console.log(`  ${result.nodeCount} information sets reached`)
    console.log(`  ${bucketCacheSize()} boards bucketed and cached`)
    console.log(`  ${elapsed.toFixed(1)}s (${(result.nodeCount / elapsed).toFixed(0)} info sets/s)`)
    return { nodeCount: result.nodeCount, elapsed }
  }

  const bucketResult = run('bucket (today\'s abstraction)', { ...DEFAULT_HOLDEM, stack })
  const riverExactResult = run('river-exact (flop/turn bucketed, river exact)', {
    ...DEFAULT_HOLDEM,
    stack,
    cardAbstraction: [3],
  })
  const exactResult = run('exact (canonical board + combo, every street)', {
    ...DEFAULT_HOLDEM,
    stack,
    cardAbstraction: 'exact',
  })
  const riverTiersResult = run(`river-tiers (flop/turn bucketed, river board+${TIERS}-tier)`, {
    ...DEFAULT_HOLDEM,
    stack,
    cardAbstraction: { tiers: TIERS, streets: [3] },
  })
  const allTiersResult = run(`all-tiers (every postflop street board+${TIERS}-tier)`, {
    ...DEFAULT_HOLDEM,
    stack,
    cardAbstraction: { tiers: TIERS },
  })

  console.log('\n=== comparison, relative to bucket mode ===')
  for (const [label, result] of [
    ['river-exact', riverExactResult],
    ['exact', exactResult],
    ['river-tiers', riverTiersResult],
    ['all-tiers', allTiersResult],
  ] as const) {
    console.log(`  ${label}: ${(result.nodeCount / bucketResult.nodeCount).toFixed(1)}x info sets, ` +
      `${(result.elapsed / bucketResult.elapsed).toFixed(2)}x wall-clock`)
  }
}
