import { abstractHoldem, DEFAULT_HOLDEM, type HoldemOptions } from '../src/gto/holdem/abstract-holdem'
import { trainMccfr } from '../src/gto/mccfr'
import { bucketCacheSize, clearBucketCache } from '../src/gto/holdem/buckets'
import { createRng } from '../src/utils/random'

/**
 * Phase 1 pilot, take two: today's board-blind bucket abstraction versus
 * 'texture' (src/gto/holdem/texture.ts) — a fixed 27-category board
 * classification instead of a percentile bucket alone.
 *
 * The first attempt at board-aware postflop keying (full canonical board,
 * then one street of it, then a canonical board paired with a finer bucket
 * — see docs/cfr-distillation-plan.md's phase 1 log) put the board's own
 * identity in the key at every resolution tried, and all three grew the
 * information-set space without bound: there are too many distinct
 * canonical boards for an affordable run to revisit any of them enough
 * times for coarser-within-a-board resolution to pay off. 'texture' never
 * keys on board identity at all — only on a fixed, small classification
 * (flushiness x pairedness x straightness) that many different boards
 * share — so it should be bounded the way plain 'bucket' mode already is.
 * This script exists to check that with real numbers rather than assume it.
 *
 *   npm run pilot:texture -- [iterations] [stack]
 *
 * Not meant to produce a usable blueprint; MIN_WEIGHT pruning and file
 * writing are deliberately left out, same as the first pilot script.
 */
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
  const textureResult = run('texture (27-category board classification)', {
    ...DEFAULT_HOLDEM,
    stack,
    cardAbstraction: 'texture',
  })

  console.log('\n=== comparison, relative to bucket mode ===')
  console.log(
    `  texture: ${(textureResult.nodeCount / bucketResult.nodeCount).toFixed(1)}x info sets, ` +
      `${(textureResult.elapsed / bucketResult.elapsed).toFixed(2)}x wall-clock`,
  )
}
