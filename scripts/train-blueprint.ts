import { writeFileSync } from 'node:fs'
import { abstractHoldem, DEFAULT_HOLDEM, type HoldemOptions } from '../src/gto/holdem/abstract-holdem'
import { encodeBlueprint } from '../src/gto/holdem/blueprint'
import { trainMccfr } from '../src/gto/mccfr'
import { bucketCacheSize } from '../src/gto/holdem/buckets'
import { createRng } from '../src/utils/random'

/**
 * Trains the blueprint and writes it out.
 *
 *   npm run train:blueprint -- [iterations] [stack] [buckets]
 *
 * Minutes, not seconds, and deliberately offline: the browser gets the answer
 * as data. Sampled rather than a full tree walk, because the tree here is the
 * thing that cannot be walked — which is the whole reason MCCFR exists and
 * the reason it looked like a waste of time on Leduc.
 */

/**
 * Information sets reached less than this often are dropped.
 *
 * A strategy averaged over a handful of visits is noise, it is no better than
 * playing uniformly, and there are tens of thousands of them — they would be
 * most of the file. Dropping them makes the blueprint smaller and no worse,
 * and the bot falls back to a shorter key when it meets one.
 */
const MIN_WEIGHT = 1

export default function main(args: string[]): void {
  const iterations = Number(args[0] ?? 200_000)
  const options: HoldemOptions = {
    ...DEFAULT_HOLDEM,
    stack: Number(args[1] ?? DEFAULT_HOLDEM.stack),
    buckets: Number(args[2] ?? DEFAULT_HOLDEM.buckets),
  }

  console.log(`training ${iterations} iterations at ${options.stack}bb, ${options.buckets} buckets`)
  const started = Date.now()
  const game = abstractHoldem(options)
  const result = trainMccfr(game, iterations, { rng: createRng(20260919), plus: true })
  const trained = (Date.now() - started) / 1000

  const kept = new Map(
    [...result.strategy].filter(([key]) => (result.weight.get(key) ?? 0) >= MIN_WEIGHT),
  )
  const file = encodeBlueprint(kept, options, iterations)
  const json = JSON.stringify(file)
  writeFileSync('src/gto/holdem/blueprint.json', json)

  console.log(`  ${result.nodeCount} information sets reached, ${kept.size} kept`)
  console.log(`  ${bucketCacheSize()} boards bucketed and cached`)
  console.log(`  ${(json.length / 1024).toFixed(0)} KB written in ${trained.toFixed(0)}s`)
}
