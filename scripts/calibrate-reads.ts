import { readFileSync } from 'node:fs'
import { HoldemEngine } from '../src/poker/game-engine'
import { buildObservation } from '../src/ai/observation'
import type { Agent } from '../src/ai/agent'
import { PsychBot } from '../src/ai/psychology/psych-bot'
import { actionContext, settingOf, type Setting } from '../src/ai/psychology/opponent-model'
import { CAST, randomizeProfile } from '../src/ai/psychology/profile'
import { BlueprintSetBot } from '../src/gto/holdem/blueprint-set'
import type { BlueprintFile } from '../src/gto/holdem/blueprint'
import { createRng } from '../src/utils/random'

/**
 * Measures what "normal" is, per setting, for opponent-model.ts's BASELINES.
 *
 *   npm run calibrate:reads -- [headsUpHands] [multiwayHands]
 *
 * Heads-up, normal is the solved strategy playing itself at every trained
 * depth — balanced by construction, so anyone betting more than it does is
 * genuinely over-aggressive. Multiway there is no solve, so normal is the
 * bot cast playing itself six-handed, with no opponent model (a read is
 * exactly what these numbers exist to calibrate, so it can't be allowed to
 * shape them). Only multiway spots count from that table.
 */

const BIG_BLIND = 10

interface Count {
  aggressive: number
  total: number
  facingBet: number
  foldedToBet: number
  checkedTo: number
  bets: number
  faced: number
  folds: number
  calls: number
  raises: number
}

function play(engine: HoldemEngine, agents: Record<string, Agent>, counts: Record<Setting, Count>, only?: Setting) {
  engine.startHand()
  let guard = 0
  while (engine.state.handInProgress) {
    if (guard++ > 500) throw new Error('hand never finished')
    const actor = engine.state.players[engine.state.currentPlayerIndex]
    const action = agents[actor.id].decideAction(buildObservation(engine, actor.id))
    const context = actionContext(engine.state, actor.id)
    const setting = settingOf(context.playersInHand)
    if (!only || only === setting) {
      const count = counts[setting]
      count.total++
      if (action.type === 'bet' || action.type === 'raise' || action.type === 'all-in') count.aggressive++
      if (context.facingBet) {
        count.facingBet++
        if (action.type === 'fold') count.foldedToBet++
      }
      const aggressive = action.type === 'bet' || action.type === 'raise' || action.type === 'all-in'
      if (context.postflop && context.facingBet) {
        count.faced++
        if (action.type === 'fold') count.folds++
        else if (aggressive) count.raises++
        else count.calls++
      } else if (context.postflop) {
        count.checkedTo++
        if (aggressive) count.bets++
      }
    }
    engine.act(action)
  }
}

const empty = (): Count => ({
  aggressive: 0,
  total: 0,
  facingBet: 0,
  foldedToBet: 0,
  checkedTo: 0,
  bets: 0,
  faced: 0,
  folds: 0,
  calls: 0,
  raises: 0,
})

function report(label: string, count: Count): void {
  console.log(
    `  ${label}: aggression ${(count.aggressive / count.total).toFixed(3)} (${count.total} actions), ` +
      `fold-to-bet ${(count.foldedToBet / count.facingBet).toFixed(3)} (${count.facingBet} spots facing a bet)`,
  )
  console.log(
    `    postflop: bet when checked to ${(count.bets / count.checkedTo).toFixed(3)} (${count.checkedTo}), ` +
      `facing a bet fold ${(count.folds / count.faced).toFixed(3)} / call ${(count.calls / count.faced).toFixed(3)} / ` +
      `raise ${(count.raises / count.faced).toFixed(3)} (${count.faced})`,
  )
}

export default function main(args: string[]): void {
  const headsUpHands = Number(args[0] ?? 4_000)
  const multiwayHands = Number(args[1] ?? 1_500)

  const files = [10, 20, 40, 75].map(
    (depth) => JSON.parse(readFileSync(`src/gto/holdem/blueprint-${depth}.json`, 'utf-8')) as BlueprintFile,
  )

  // Decoding the four trained depths is the expensive part; do it once.
  const solve = new BlueprintSetBot(files, { rng: createRng(1) })

  const headsUp = { headsUp: empty(), multiway: empty() }
  const perDepth = Math.ceil(headsUpHands / files.length)
  for (const file of files) {
    const stack = file.options.stack * BIG_BLIND
    for (let i = 0; i < perDepth; i++) {
      const players = [
        { id: 'p0', name: 'P0', stack },
        { id: 'p1', name: 'P1', stack },
      ]
      const engine = new HoldemEngine(players, { smallBlind: BIG_BLIND / 2, bigBlind: BIG_BLIND, ante: 0 }, createRng(7_000 + i))
      play(engine, { p0: solve, p1: solve }, headsUp, 'headsUp')
    }
  }

  const table = { headsUp: empty(), multiway: empty() }
  const rng = createRng(20260925)
  const count = 6
  const stack = 100 * BIG_BLIND
  for (let hand = 0; hand < multiwayHands; hand += 25) {
    // Fresh table and fresh stacks every 25 hands, so nobody busting skews the sample.
    const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack }))
    const engine = new HoldemEngine(players, { smallBlind: BIG_BLIND / 2, bigBlind: BIG_BLIND, ante: 0 }, createRng(hand))
    const agents: Record<string, Agent> = {}
    players.forEach((p, i) => {
      const bot = new PsychBot(randomizeProfile(CAST[(i + hand) % CAST.length], rng), stack, createRng(hand * 10 + i))
      bot.useFundamentals(solve)
      agents[p.id] = bot
    })
    for (let i = 0; i < 25 && engine.canStartHand(); i++) play(engine, agents, table, 'multiway')
  }

  console.log('measured baselines (copy into opponent-model.ts BASELINES):')
  report('headsUp  (solve vs solve)', headsUp.headsUp)
  report('multiway (cast, 6-handed)', table.multiway)
}
