import { HoldemEngine } from '../poker/game-engine'
import { buildObservation } from '../ai/observation'
import type { Agent } from '../ai/agent'
import { PsychBot, type Fundamentals } from '../ai/psychology/psych-bot'
import { OpponentModel, actionContext, showdownOf } from '../ai/psychology/opponent-model'
import { HandLogger, type HandRecord } from '../review/log'
import { createRng } from '../utils/random'
import { drawTruth, profileOf, type Truth } from './draw'

/**
 * One lab table: bots with drawn characters play each other, and every seat is
 * logged exactly the way the human is (`HandLogger`), so the same summary
 * statistics that describe a person describe a seat here.
 */

export interface SeatRun {
  truth: Truth
  hands: HandRecord[]
}

export interface SessionOptions {
  /** Seats at the table. */
  seats?: number
  /** Hands each seat is logged for, exactly. */
  hands: number
  seed: number
  bigBlind?: number
  /** Stacks in big blinds, refreshed every `block` hands (a rebuy, so nobody busting skews the sample). */
  stackBb?: number
  block?: number
  fundamentals?: Fundamentals
}

export function runSession(options: SessionOptions): SeatRun[] {
  const seats = options.seats ?? 6
  const bigBlind = options.bigBlind ?? 10
  const stack = (options.stackBb ?? 100) * bigBlind
  const block = options.block ?? 10
  const rng = createRng(options.seed)

  const truths = Array.from({ length: seats }, () => drawTruth(rng))
  const opponents = new OpponentModel()
  const ids = truths.map((_, i) => `p${i}`)
  const bots = truths.map((truth, i) => {
    const bot = new PsychBot(profileOf(truth, `Lab ${i}`), stack, createRng(options.seed * 31 + i), opponents)
    if (options.fundamentals) bot.useFundamentals(options.fundamentals)
    return bot
  })
  const agents: Record<string, Agent> = Object.fromEntries(ids.map((id, i) => [id, bots[i]]))
  const loggers = ids.map((id) => new HandLogger(id, `lab-${options.seed}-${id}`))
  const runs: SeatRun[] = truths.map((truth) => ({ truth, hands: [] }))

  // A seat that busts sits out the rest of its block, so keep dealing until
  // every seat has the hands asked for, then cut each to exactly that many.
  let played = 0
  while (runs.some((run) => run.hands.length < options.hands)) {
    const players = ids.map((id) => ({ id, name: id, stack }))
    const engine = new HoldemEngine(players, { smallBlind: bigBlind / 2, bigBlind, ante: 0 }, createRng(options.seed * 7919 + played))
    for (let i = 0; i < block && engine.canStartHand(); i++, played++) {
      engine.startHand()
      loggers.forEach((logger) => logger.startHand(engine.state))
      let guard = 0
      while (engine.state.handInProgress) {
        if (guard++ > 500) throw new Error('hand never finished')
        const actor = engine.state.players[engine.state.currentPlayerIndex]
        const action = agents[actor.id].decideAction(buildObservation(engine, actor.id))
        loggers[ids.indexOf(actor.id)].decision(engine.state, action)
        opponents.observe(action, actionContext(engine.state, actor.id))
        engine.act(action)
      }
      reportResults(engine, agents)
      const showdown = showdownOf(engine.state)
      if (showdown) opponents.observeShowdown(showdown)
      loggers.forEach((logger, seat) => {
        const record = logger.endHand(engine.state)
        if (record) runs[seat].hands.push(record)
      })
    }
  }
  for (const run of runs) run.hands.length = options.hands
  return runs
}

/** The same call the app makes when a hand ends (`useHoldemGame.ts`'s `reportResults`). */
function reportResults(engine: HoldemEngine, agents: Record<string, Agent>): void {
  const results = engine.state.lastResults
  const potSize = results.reduce((sum, r) => sum + r.potAmount, 0)
  if (potSize === 0) return
  for (const player of engine.state.players) {
    const agent = agents[player.id]
    if (!agent?.observeResult) continue
    const won = results.reduce(
      (sum, r) => sum + (r.winnerIds.includes(player.id) ? r.potAmount / r.winnerIds.length : 0),
      0,
    )
    agent.observeResult({ stack: player.stack, shareWon: won / potSize, potSize })
  }
}
