import { writeFileSync } from 'node:fs'
import { MultiwayTrainer, bestResponseGain, exportStrategy } from '../src/gto/holdem/preflop-multiway'
import { createRng } from '../src/utils/random'

/**
 * Trains the multiway preflop solves (preflop-multiway.ts) and writes one
 * file per table size and depth.
 *
 *   npm run train:preflop -- [iterations] [players, comma-separated] [stacks, comma-separated] [checkSamples]
 *
 * Defaults: 10,000,000 iterations for each of 3-6 players at 8, 20, 40
 * and 100 big blinds — under two minutes each on one core. For tables of
 * three and four, it then estimates how far each seat is from equilibrium
 * (the best-response gain, see `bestResponseGain`): the number that says
 * whether the run was long enough. Five and six are too big to check that
 * way in reasonable time, so they get the same iteration count; at
 * four-handed 100bb, training four times longer didn't move the estimate
 * (docs/multiway-preflop.md).
 */
export default function main(args: string[]): void {
  const iterations = Number(args[0] ?? 10_000_000)
  const tableSizes = (args[1] ?? '3,4,5,6').split(',').map(Number)
  const stacks = (args[2] ?? '8,20,40,100').split(',').map(Number)
  const checkSamples = Number(args[3] ?? 200_000)

  for (const players of tableSizes) {
    for (const stack of stacks) {
      const started = Date.now()
      const trainer = new MultiwayTrainer({ players, stack }, createRng(players * 1000 + stack))
      trainer.train(iterations)
      const file = exportStrategy(trainer)
      const out = `src/gto/holdem/preflop-${players}max-${stack}.json`
      writeFileSync(out, JSON.stringify(file))
      const seconds = ((Date.now() - started) / 1000).toFixed(0)
      const shipped = Object.keys(file.decisions).length
      let line = `${players}-handed ${stack}bb: ${trainer.tree.decisions.length} decisions (${shipped} shipped), ${seconds}s -> ${out}`
      if (players <= 4 && checkSamples > 0) {
        const gains = Array.from({ length: players }, (_, seat) => bestResponseGain(trainer, seat, checkSamples))
        const total = gains.reduce((sum, g) => sum + g, 0)
        line += `\n  best-response gain per seat (bb/hand, an upper bound): ${gains.map((g) => g.toFixed(3)).join(' ')}; NashConv <= ${total.toFixed(3)}`
      }
      console.log(line)
    }
  }
}
