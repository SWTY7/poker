import type { WeightedAction } from '../../ai/agent'
import type { AIObservation } from '../../ai/observation'
import { classOf } from '../../math/combos'
import { toCardInts } from '../../poker/fast/cards'
import type { PokerAction } from '../../poker/game-state'
import { preflopSeatOrder } from '../../poker/position'
import {
  buildTree,
  decodeMix,
  raiseTarget,
  type MultiwayStrategyFile,
  type PreflopLetter,
  type TreeNode,
} from './preflop-multiway'

/**
 * The multiway preflop solves (preflop-multiway.ts), looked up from a real
 * table: what a studied player would do before the flop with three or more
 * players dealt in, where the heads-up blueprint has nothing to say.
 *
 * Looking a spot up is replaying the hand so far through the solved tree:
 * each real action becomes the tree's letter for it (a raise is "the raise",
 * whatever its exact size; a raise of most of a stack is all in), and the
 * spot is found if every step is one the tree has. A limp, a check, or a
 * line the file didn't ship is a spot the book doesn't cover — the answer is
 * null, and the player decides on their own, as they would without a book.
 *
 * The answer comes back as real table actions: a raise at the tree's size
 * for the real price of the pot (2.5 big blinds to open, 3x to 3-bet, and
 * so on), an all in as a raise to everything.
 */

interface Entry {
  file: MultiwayStrategyFile
  root: TreeNode
  decoded: Map<string, (number[] | null)[]>
}

export interface MultiwayBookOptions {
  /**
   * How far the real stack depth may be from a trained one, as a ratio, and
   * still use it. Default [0.5, 2]: the 100bb solve answers for 50-200bb.
   */
  depthBand?: [number, number]
}

export class MultiwayPreflopBook {
  private entries: Entry[]
  private band: [number, number]
  /** How often it was consulted and how often it had an answer, for diagnostics. */
  asked = 0
  answered = 0

  constructor(files: MultiwayStrategyFile[], options: MultiwayBookOptions = {}) {
    this.entries = files.map((file) => ({
      file,
      root: buildTree({ players: file.players, stack: file.stack }).root,
      decoded: new Map(),
    }))
    this.band = options.depthBand ?? [0.5, 2]
  }

  strategyFor(obs: AIObservation): WeightedAction[] | null {
    if (obs.street !== 'preflop' || obs.ownCards.length !== 2 || !(obs.bigBlind > 0)) return null
    const seated = obs.players.filter((p) => p.position !== null)
    const n = seated.length
    if (n < 3) return null
    this.asked++

    const bb = obs.bigBlind
    // Preflop, a stack plus this street's bet is everything a player sat down with this hand.
    const total = (id: string) => {
      const p = obs.players.find((q) => q.id === id)
      return p ? p.stack + p.betThisStreet : 0
    }
    const me = obs.players.find((p) => p.id === obs.playerId)
    if (!me) return null
    const deepestOther = Math.max(0, ...seated.filter((p) => p.id !== me.id && !p.folded).map((p) => total(p.id)))
    const depth = Math.min(total(me.id), deepestOther) / bb
    const entry = this.nearest(n, depth)
    if (!entry) return null

    const order = preflopSeatOrder(n)
    const seatOf = new Map<string, number>()
    for (const p of seated) seatOf.set(p.id, order.indexOf(p.position!))
    if ([...seatOf.values()].some((seat) => seat < 0)) return null

    // Replay: the tree's node, and the real price of things in big blinds,
    // which is what the tree's raise sizes are multiples of.
    let node = entry.root
    let level = 1
    let raises = 0
    let callers = 0
    for (const action of obs.actionHistory) {
      if (node.actor < 0 || seatOf.get(action.playerId) !== node.actor) return null
      const to = (action.amount ?? 0) / bb
      let letter: PreflopLetter | null
      if (action.type === 'fold') letter = 'f'
      else if (action.type === 'check') letter = null
      else if (action.type === 'call' || (action.type === 'all-in' && to <= level)) {
        letter = 'c'
        callers++
      } else {
        const shove = action.type === 'all-in' || to >= 0.6 * (total(action.playerId) / bb)
        letter = pick(node.letters, shove ? ['a', 'r'] : ['r', 'a'])
        if (to > level) {
          level = to
          raises++
          callers = 0
        }
      }
      const index = letter ? node.letters.indexOf(letter) : -1
      if (index < 0) return null
      node = node.children[index]
    }
    const seat = seatOf.get(obs.playerId)
    if (node.actor < 0 || node.actor !== seat) return null

    const row = this.row(entry, node, obs)
    if (!row) return null

    const merged = new Map<string, WeightedAction>()
    node.letters.forEach((letter, i) => {
      if (row[i] <= 0) return
      const action = realise(obs, letter, raiseTarget(level, raises, callers, seat, n) * bb)
      if (!action) return
      const key = `${action.type}:${action.amount ?? ''}`
      const existing = merged.get(key)
      if (existing) existing.probability += row[i]
      else merged.set(key, { action, probability: row[i] })
    })
    const sum = [...merged.values()].reduce((s, w) => s + w.probability, 0)
    if (sum <= 0) return null
    this.answered++
    return [...merged.values()].map((w) => ({ action: w.action, probability: w.probability / sum }))
  }

  /** The solve for this many players at the nearest trained depth, if one is near enough. */
  private nearest(players: number, depth: number): Entry | null {
    let best: Entry | null = null
    for (const entry of this.entries) {
      if (entry.file.players !== players) continue
      if (!best || Math.abs(Math.log(depth / entry.file.stack)) < Math.abs(Math.log(depth / best.file.stack))) {
        best = entry
      }
    }
    if (!best) return null
    const ratio = depth / best.file.stack
    return ratio >= this.band[0] && ratio <= this.band[1] ? best : null
  }

  private row(entry: Entry, node: TreeNode, obs: AIObservation): number[] | null {
    const shipped = entry.file.decisions[node.history]
    if (!shipped) return null
    let rows = entry.decoded.get(node.history)
    if (!rows) {
      rows = decodeMix(shipped.mix, shipped.letters.length)
      entry.decoded.set(node.history, rows)
    }
    const hole = toCardInts(obs.ownCards)
    return rows[classOf(hole[0], hole[1])]
  }
}

function pick(letters: PreflopLetter[], preference: PreflopLetter[]): PreflopLetter | null {
  return preference.find((letter) => letters.includes(letter)) ?? null
}

/** One of the tree's letters as a real action at this table, or null if it has no legal form here. */
function realise(obs: AIObservation, letter: PreflopLetter, raiseTo: number): PokerAction | null {
  const id = obs.playerId
  const legal = obs.legalActions
  if (letter === 'f') {
    if (legal.includes('fold')) return { playerId: id, type: 'fold' }
    return legal.includes('check') ? { playerId: id, type: 'check' } : null
  }
  if (letter === 'c') {
    if (legal.includes('call')) return { playerId: id, type: 'call' }
    return legal.includes('check') ? { playerId: id, type: 'check' } : null
  }
  const type = legal.includes('raise') ? 'raise' : legal.includes('bet') ? 'bet' : null
  if (!type) return legal.includes('all-in') ? { playerId: id, type: 'all-in' } : null
  const amount = letter === 'a' ? obs.maxRaiseTo : Math.min(Math.max(Math.round(raiseTo), obs.minRaiseTo), obs.maxRaiseTo)
  return { playerId: id, type, amount }
}
