import { readFileSync } from 'node:fs'
import { HoldemEngine } from '../src/poker/game-engine'
import { buildObservation } from '../src/ai/observation'
import type { Agent } from '../src/ai/agent'
import { PsychBot } from '../src/ai/psychology/psych-bot'
import { OpponentModel } from '../src/ai/psychology/opponent-model'
import { AVERAGE_HUMAN, PRO, type PsychProfile } from '../src/ai/psychology/profile'
import { BlueprintSetBot } from '../src/gto/holdem/blueprint-set'
import type { BlueprintFile } from '../src/gto/holdem/blueprint'
import { createRng } from '../src/utils/random'

/**
 * Does leaning on the solve while still reading the opponent actually play
 * better than either on its own? Heads-up at 20bb, where the solve applies,
 * duplicate-scored the same way tests/gto/blueprint-bot.test.ts scores the
 * pure blueprint:
 *
 *   pure solve   vs recreational   — what playing the book alone earns
 *   pro          vs recreational   — what the book plus reads earns
 *   pro          vs pure solve     — what the reads cost against someone who can't be read
 *
 * Every bot at a real table gets the solve, so the recreational opponent
 * here has it too — at its own low discipline, which is how it's seated.
 *
 *   npm run benchmark:pro -- [pairs] [proDiscipline] [dealSet]
 *
 * `dealSet` shifts every seed, so a result can be re-checked on deals it has
 * never seen rather than re-measured on the same ones.
 */

const BIG_BLIND = 10
const STACK = 20 * BIG_BLIND

function playHand(a: Agent, b: Agent, seed: number, model: OpponentModel): number {
  const players = [
    { id: 'p0', name: 'P0', stack: STACK },
    { id: 'p1', name: 'P1', stack: STACK },
  ]
  const engine = new HoldemEngine(players, { smallBlind: BIG_BLIND / 2, bigBlind: BIG_BLIND, ante: 0 }, createRng(seed))
  const agents: Record<string, Agent> = { p0: a, p1: b }
  engine.startHand()
  let guard = 0
  while (engine.state.handInProgress) {
    if (guard++ > 400) throw new Error('hand never finished')
    const actor = engine.state.players[engine.state.currentPlayerIndex]
    const action = agents[actor.id].decideAction(buildObservation(engine, actor.id))
    model.observe(action)
    engine.act(action)
  }
  // Tilt only moves if a bot is told how its hands went, same as at the table.
  const results = engine.state.lastResults
  const potSize = results.reduce((sum, r) => sum + r.potAmount, 0)
  for (const player of engine.state.players) {
    const won = results.reduce((sum, r) => sum + (r.winnerIds.includes(player.id) ? r.potAmount / r.winnerIds.length : 0), 0)
    agents[player.id].observeResult?.({ stack: player.stack, shareWon: potSize ? won / potSize : 0, potSize })
  }
  return (engine.state.players[0].stack - STACK) / BIG_BLIND
}

function duplicate(
  make: (model: OpponentModel) => [Agent, Agent],
  pairs: number,
  base: number,
): { rate: number; error: number } {
  const model = new OpponentModel()
  const [a, b] = make(model)
  const results: number[] = []
  for (let i = 0; i < pairs; i++) {
    const seed = base * 1_000_003 + i
    results.push(playHand(a, b, seed, model) - playHand(b, a, seed, model))
  }
  const mean = results.reduce((sum, value) => sum + value, 0) / results.length
  const variance = results.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (results.length - 1)
  return { rate: (mean / 2) * 100, error: (Math.sqrt(variance / results.length) / 2) * 100 }
}

function report(label: string, result: { rate: number; error: number }): void {
  const verdict =
    result.rate - 2 * result.error > 0 ? 'ahead' : result.rate + 2 * result.error < 0 ? 'behind' : 'no clear edge'
  const sign = result.rate >= 0 ? '+' : ''
  console.log(`  ${label}: ${sign}${result.rate.toFixed(1)} +/- ${result.error.toFixed(1)} bb/100 (${verdict})`)
}

export default function main(args: string[]): void {
  const pairs = Number(args[0] ?? 1_000)
  const proDiscipline = args[1] === undefined ? PRO.discipline : Number(args[1])
  const dealSet = Number(args[2] ?? 0)

  const files = [10, 20, 40, 75].map(
    (depth) => JSON.parse(readFileSync(`src/gto/holdem/blueprint-${depth}.json`, 'utf-8')) as BlueprintFile,
  )
  const solve = () => new BlueprintSetBot(files, { rng: createRng(9) })

  const seat = (profile: PsychProfile, rngSeed: number, model: OpponentModel) => {
    const bot = new PsychBot(profile, STACK, createRng(rngSeed), model)
    bot.useFundamentals(solve())
    return bot
  }
  const pro = { ...PRO, discipline: proDiscipline }

  console.log(`heads-up at 20bb, ${pairs} duplicate pairs per matchup, pro discipline ${proDiscipline}, deal set ${dealSet}\n`)
  const started = Date.now()
  report('pure solve vs recreational', duplicate((m) => [solve(), seat(AVERAGE_HUMAN, 3, m)], pairs, 3 + dealSet * 10))
  report('pro        vs recreational', duplicate((m) => [seat(pro, 5, m), seat(AVERAGE_HUMAN, 3, m)], pairs, 3 + dealSet * 10))
  report('pro        vs pure solve  ', duplicate((m) => [seat(pro, 5, m), solve()], pairs, 1 + dealSet * 10))
  console.log(`\n  ${((Date.now() - started) / 1000).toFixed(0)}s`)
}
