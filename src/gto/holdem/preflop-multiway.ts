import { CLASS_COUNT, classLabel, classOf } from '../../math/combos'
import { realization, type HandType } from '../../math/realization'
import { DECK_SIZE } from '../../poker/fast/cards'
import { evaluate7 } from '../../poker/fast/eval7'
import { preflopSeatOrder, type PositionLabel } from '../../poker/position'
import { createRng, type Rng } from '../../utils/random'
import { classEquity } from './preflop'

/**
 * Preflop with more than two players, solved.
 *
 * The heads-up blueprint (abstract-holdem.ts) is a real equilibrium: two
 * players, zero-sum, and CFR is proven to converge on it. Past two players
 * neither of those holds — there is no single equilibrium to converge on, and
 * the proof is gone. It is still what everyone does: Pluribus, the program
 * that beat professionals at six-handed no-limit, trained its whole strategy
 * with exactly this algorithm (Monte Carlo CFR, external sampling) and it
 * converged in practice to something no human could exploit. Preflop is the
 * part of that where it works best, because the game is small enough to walk
 * all of it: every seat, every action, 169 hand classes.
 *
 * The game, per table size and stack depth (in big blinds, everyone equally
 * deep):
 *
 *   - seats act in the real preflop order, blinds posted (0.5 and 1);
 *   - first in, a seat folds, raises (2.5bb; 3 from the small blind) or
 *     moves all in — no limping, which is how preflop charts are built;
 *   - facing a raise: fold, call, re-raise, or all in. A 3-bet goes to 3x
 *     (4x out of position, from the blinds) plus one raise per caller; a
 *     4-bet to 2.3x; after that, all in is the only raise left. A raise
 *     that would commit most of the stack anyway is folded into all in.
 *
 * How a hand ends decides what it is worth:
 *
 *   - everyone else folds: the pot, exactly;
 *   - all in and called: the pot split by all-in equity — exact, from the
 *     precomputed class-against-class table, when two are left; by the
 *     actual cards on a board dealt for this iteration (an unbiased sample
 *     of the same thing) when more are;
 *   - called, with chips still behind, so there is a flop to play: the pot
 *     is paid out by *realized* equity, since nothing here solves the play
 *     after the flop. Each player keeps the share of the pot they would win
 *     at showdown (measured the same way as all in) scaled by math/realization.ts's factor for their seat and
 *     hand type (capped at 1), and what the out-of-position hands fail to
 *     keep goes to the players behind them, weighted toward the button.
 *     That is the one modelled part, and it is where the solve is only as
 *     good as those factors.
 *
 * Nothing here knows about chips or seats at a real table; looking a
 * real spot up lives in preflop-multiway-bot.ts.
 */

export type PreflopLetter = 'f' | 'c' | 'r' | 'a'

/** Open-raise size, in big blinds, from every seat but the small blind. */
export const OPEN_SIZE = 2.5
/** The small blind opens bigger: it is out of position to everyone left in. */
export const SB_OPEN_SIZE = 3
/** Open, 3-bet, 4-bet: after this many raises, all in is the only raise. */
export const MAX_RAISES = 3
/** Seats that may flat-call a raise with nothing in the pot by choice — see `mayCall`. */
const MAX_COLD_CALLERS = 1
/** A raise to more than this share of the stack is played as all in. */
const RAISE_CAP_SHARE = 0.45

export interface MultiwaySpot {
  players: number
  /** Stack depth, in big blinds, everyone equal. */
  stack: number
}

/** One decision point or one ending of the preflop tree. */
export interface TreeNode {
  /** The letters played to get here, one per action, e.g. "frc". */
  history: string
  /** The seat to act (0 = first to act preflop), or -1 at an ending. */
  actor: number
  letters: PreflopLetter[]
  children: TreeNode[]
  /** Position of this decision in the tree's decision list, or -1 at an ending. */
  index: number
  // --- endings ---
  /** Seats still in. */
  survivors: number[]
  /** Chips each seat put in, in big blinds. */
  contributions: number[]
  /** Everyone left is all in — the board decides it, not realization. */
  allIn: boolean
  pot: number
}

interface BuildState {
  contributions: number[]
  folded: boolean[]
  allIn: boolean[]
  pending: boolean[]
  level: number
  raises: number
  callersSinceRaise: number
  actor: number
  history: string
}

export interface MultiwayTree {
  spot: MultiwaySpot
  root: TreeNode
  decisions: TreeNode[]
  /** Position names, in preflop acting order. */
  seats: PositionLabel[]
}

export function buildTree(spot: MultiwaySpot): MultiwayTree {
  const { players: n, stack } = spot
  if (n < 2) throw new Error(`A preflop tree needs at least two players, got ${n}`)
  if (!(stack > 1)) throw new Error(`Stacks must be deeper than the big blind, got ${stack}`)
  const decisions: TreeNode[] = []

  const contributions = new Array<number>(n).fill(0)
  contributions[n - 2] = 0.5
  contributions[n - 1] = 1
  const start: BuildState = {
    contributions,
    folded: new Array<boolean>(n).fill(false),
    allIn: new Array<boolean>(n).fill(false),
    pending: new Array<boolean>(n).fill(true),
    level: 1,
    raises: 0,
    callersSinceRaise: 0,
    actor: 0,
    history: '',
  }

  const build = (state: BuildState): TreeNode => {
    const live = state.folded.flatMap((folded, seat) => (folded ? [] : [seat]))
    const toAct = nextToAct(state, state.actor)
    // No limping: with nobody raising, the big blind never has anything to
    // decide, and folds around to it are a walk.
    const walk = state.raises === 0 && toAct === n - 1
    if (live.length === 1 || toAct < 0 || walk) {
      const pot = state.contributions.reduce((sum, c) => sum + c, 0)
      const survivors = walk ? [n - 1] : live
      return {
        history: state.history,
        actor: -1,
        letters: [],
        children: [],
        index: -1,
        survivors,
        contributions: [...state.contributions],
        allIn: survivors.length > 1 && survivors.every((seat) => state.allIn[seat]),
        pot,
      }
    }

    const letters = legalLetters(state, toAct, stack, n)
    const node: TreeNode = {
      history: state.history,
      actor: toAct,
      letters,
      children: [],
      index: decisions.length,
      survivors: [],
      contributions: [],
      allIn: false,
      pot: 0,
    }
    decisions.push(node)
    node.children = letters.map((letter) => build(applyLetter(state, toAct, letter, stack, n)))
    return node
  }

  return { spot, root: build(start), decisions, seats: preflopSeatOrder(n) }
}

function nextToAct(state: BuildState, from: number): number {
  const n = state.pending.length
  for (let step = 0; step < n; step++) {
    const seat = (from + step) % n
    if (state.pending[seat] && !state.folded[seat] && !state.allIn[seat]) return seat
  }
  return -1
}

/** Where a raise by `seat` would go, in big blinds. */
export function raiseTarget(level: number, raises: number, callers: number, seat: number, players: number): number {
  if (raises === 0) return seat === players - 2 ? SB_OPEN_SIZE : OPEN_SIZE
  if (raises === 1) return (seat >= players - 2 ? 4 : 3) * level + level * callers
  return 2.3 * level
}

/**
 * Whether a seat may flat-call. Anyone already in the pot by choice may; a
 * seat calling cold — nothing in but a blind — may only if nobody else has
 * cold-called this raise yet, or if it is the big blind closing the action.
 *
 * That cap is what keeps six-handed trees small enough to train and ship:
 * without it every raise can be called by everyone behind it, and every one
 * of those pots can be re-raised again, and the tree runs to tens of
 * thousands of decisions, nearly all of them lines that almost never happen
 * (the fourth cold-caller of a 3-bet). With it, the common multiway pots —
 * open, one caller, the big blind defends — are all there.
 */
function mayCall(state: BuildState, seat: number, players: number): boolean {
  const blind = seat === players - 1 ? 1 : seat === players - 2 ? 0.5 : 0
  const cold = state.contributions[seat] <= blind
  return !cold || state.callersSinceRaise < MAX_COLD_CALLERS || seat === players - 1
}

function legalLetters(state: BuildState, seat: number, stack: number, players: number): PreflopLetter[] {
  const letters: PreflopLetter[] = ['f']
  if (state.raises > 0 && mayCall(state, seat, players)) letters.push('c')
  if (state.level >= stack) return letters
  const target = raiseTarget(state.level, state.raises, state.callersSinceRaise, seat, players)
  if (state.raises < MAX_RAISES && target <= RAISE_CAP_SHARE * stack) letters.push('r')
  letters.push('a')
  return letters
}

function applyLetter(state: BuildState, seat: number, letter: PreflopLetter, stack: number, players: number): BuildState {
  const next: BuildState = {
    contributions: [...state.contributions],
    folded: [...state.folded],
    allIn: [...state.allIn],
    pending: [...state.pending],
    level: state.level,
    raises: state.raises,
    callersSinceRaise: state.callersSinceRaise,
    actor: (seat + 1) % players,
    history: state.history + letter,
  }
  next.pending[seat] = false
  if (letter === 'f') {
    next.folded[seat] = true
    return next
  }
  if (letter === 'c') {
    next.contributions[seat] = Math.min(state.level, stack)
    if (next.contributions[seat] >= stack) next.allIn[seat] = true
    next.callersSinceRaise++
    return next
  }
  const target =
    letter === 'a' ? stack : raiseTarget(state.level, state.raises, state.callersSinceRaise, seat, players)
  next.contributions[seat] = target
  if (target >= stack) next.allIn[seat] = true
  if (target > state.level) {
    next.level = target
    next.raises = state.raises + 1
    next.callersSinceRaise = 0
    for (let other = 0; other < players; other++) {
      if (other !== seat && !next.folded[other] && !next.allIn[other]) next.pending[other] = true
    }
  }
  return next
}

// --- hand types, for realization ----------------------------------------------

/**
 * Which of realization.ts's three kinds a class is: big pairs and big
 * broadway hands are made hands, small pairs and suited connectors and
 * suited aces are speculative (they win big when they hit and fold cheaply
 * when they don't), and everything else is marginal — the hands that make
 * second-best pairs and are forced to guess.
 */
export function handTypeOf(classIndex: number): HandType {
  const label = classLabel(classIndex)
  const high = '23456789TJQKA'.indexOf(label[0])
  const low = '23456789TJQKA'.indexOf(label[1])
  const suited = label.endsWith('s')
  if (high === low) return high >= 6 ? 'made' : 'speculative' // 88+ made
  if (high >= 10 && low >= 9) return 'made' // AK, AQ, AJ, KQ
  if (suited && (high === 12 || high - low <= 2)) return 'speculative'
  return 'marginal'
}

// --- training -------------------------------------------------------------------

export interface TrainOptions {
  rng?: Rng
  /** Called every `reportEvery` iterations with the iteration count. */
  onProgress?: (iteration: number) => void
  reportEvery?: number
}

/**
 * Regret and average-strategy tables for one tree: one row of 169 x actions
 * per decision. Kept as a class so a long run can be trained in stages and
 * checked between them.
 */
export class MultiwayTrainer {
  readonly tree: MultiwayTree
  readonly regrets: Float64Array[]
  readonly strategySums: Float64Array[]
  iterations = 0
  private scratch: Float64Array[]
  private realized: Float64Array[]
  private postflopRank: number[]
  private rng: Rng
  // Per-iteration deal.
  private classes: Int32Array
  private scores: Int32Array
  private deck = new Int32Array(DECK_SIZE)

  constructor(spot: MultiwaySpot, rng: Rng = createRng(1)) {
    this.tree = buildTree(spot)
    this.rng = rng
    this.regrets = this.tree.decisions.map((d) => new Float64Array(CLASS_COUNT * d.letters.length))
    this.strategySums = this.tree.decisions.map((d) => new Float64Array(CLASS_COUNT * d.letters.length))
    this.scratch = this.tree.decisions.map((d) => new Float64Array(d.letters.length))
    const n = spot.players
    this.classes = new Int32Array(n)
    this.scores = new Int32Array(n)
    // How much of their equity each seat keeps with each class, capped at 1:
    // above 1 would mean taking chips from the others by position alone, and
    // the position edge already comes back through who inherits the rest.
    this.realized = this.tree.seats.map((label) => {
      const row = new Float64Array(CLASS_COUNT)
      for (let c = 0; c < CLASS_COUNT; c++) row[c] = Math.min(1, realization(label, handTypeOf(c)))
      return row
    })
    this.postflopRank = postflopRanks(n)
    for (let card = 0; card < DECK_SIZE; card++) this.deck[card] = card
  }

  train(iterations: number, options: TrainOptions = {}): void {
    const n = this.tree.spot.players
    const reportEvery = options.reportEvery ?? 10_000
    for (let i = 0; i < iterations; i++) {
      this.iterations++
      this.deal()
      // Linear CFR: iteration t counts t times, so the early, random-ish
      // iterations fade instead of weighing on the average forever.
      const weight = this.iterations
      for (let traverser = 0; traverser < n; traverser++) this.walk(this.tree.root, traverser, weight)
      if (options.onProgress && this.iterations % reportEvery === 0) options.onProgress(this.iterations)
    }
  }

  /** The average strategy at one decision for one class, and how much play it rests on. */
  average(decision: number, classIndex: number): { probabilities: number[]; weight: number } {
    const k = this.tree.decisions[decision].letters.length
    const sums = this.strategySums[decision]
    let total = 0
    for (let a = 0; a < k; a++) total += sums[classIndex * k + a]
    const probabilities: number[] = []
    for (let a = 0; a < k; a++) probabilities.push(total > 0 ? sums[classIndex * k + a] / total : 1 / k)
    return { probabilities, weight: total }
  }

  private deal(): void {
    const n = this.tree.spot.players
    const deck = this.deck
    const need = 2 * n + 5
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(this.rng() * (DECK_SIZE - i))
      const tmp = deck[i]
      deck[i] = deck[j]
      deck[j] = tmp
    }
    const b = 2 * n
    for (let seat = 0; seat < n; seat++) {
      const x = deck[2 * seat]
      const y = deck[2 * seat + 1]
      this.classes[seat] = classOf(x, y)
      this.scores[seat] = evaluate7(x, y, deck[b], deck[b + 1], deck[b + 2], deck[b + 3], deck[b + 4])
    }
  }

  private walk(node: TreeNode, traverser: number, weight: number): number {
    if (node.actor < 0) return this.payoff(node, traverser)

    const k = node.letters.length
    const base = this.classes[node.actor] * k
    const regrets = this.regrets[node.index]
    const strategy = this.scratch[node.index]
    let positive = 0
    for (let a = 0; a < k; a++) {
      const r = regrets[base + a]
      strategy[a] = r > 0 ? r : 0
      positive += strategy[a]
    }
    for (let a = 0; a < k; a++) strategy[a] = positive > 0 ? strategy[a] / positive : 1 / k

    if (node.actor !== traverser) {
      const sums = this.strategySums[node.index]
      for (let a = 0; a < k; a++) sums[base + a] += weight * strategy[a]
      let roll = this.rng()
      let pick = k - 1
      for (let a = 0; a < k; a++) {
        roll -= strategy[a]
        if (roll <= 0) {
          pick = a
          break
        }
      }
      return this.walk(node.children[pick], traverser, weight)
    }

    // The traverser's own decision: every action is tried. (`strategy` is
    // safe to keep reading afterwards — a path never passes the same node
    // twice, so nothing below reuses this node's scratch row.)
    const values = new Float64Array(k)
    let nodeValue = 0
    for (let a = 0; a < k; a++) {
      values[a] = this.walk(node.children[a], traverser, weight)
      nodeValue += strategy[a] * values[a]
    }
    for (let a = 0; a < k; a++) regrets[base + a] += weight * (values[a] - nodeValue)
    return nodeValue
  }

  /** Big blinds won or lost by `seat` at an ending, on this iteration's cards. */
  payoff(node: TreeNode, seat: number): number {
    return payoffAt(node, seat, this.classes, this.scores, this.realized, this.postflopRank)
  }
}

/**
 * Order of acting after the flop, 1 first: the blinds, then everyone else
 * with the button last. Heads-up the button is the small blind, and last.
 */
export function postflopRanks(players: number): number[] {
  if (players === 2) return [2, 1]
  return Array.from({ length: players }, (_, seat) => (seat >= players - 2 ? seat - (players - 2) + 1 : seat + 3))
}

/**
 * Big blinds won or lost by `seat` at an ending of the tree, given everyone's
 * class and seven-card score on one board. Shared by training and by the
 * best-response check, so both judge the same game.
 */
export function payoffAt(
  node: TreeNode,
  seat: number,
  classes: ArrayLike<number>,
  scores: ArrayLike<number>,
  realized: Float64Array[],
  postflopRank: number[],
): number {
  const survivors = node.survivors
  const paid = node.contributions[seat]
  if (survivors.length === 1) return (survivors[0] === seat ? node.pot : 0) - paid
  if (!survivors.includes(seat)) return -paid

  // Two left: the exact all-in equity of one class against the other, over
  // every board — no sampling noise at all for the most common kind of pot.
  // Three or more: this iteration's board decides, which is right on
  // average and noisy on any one deal.
  let showdownShare: (s: number) => number
  if (survivors.length === 2) {
    const [a, b] = survivors
    const equityA = classEquity(classes[a], classes[b])
    showdownShare = (s) => (s === a ? equityA : 1 - equityA)
  } else {
    let best = -1
    let winners = 0
    for (const s of survivors) {
      if (scores[s] > best) {
        best = scores[s]
        winners = 1
      } else if (scores[s] === best) winners++
    }
    showdownShare = (s) => (scores[s] === best ? 1 / winners : 0)
  }
  if (node.allIn) return showdownShare(seat) * node.pot - paid

  // A flop is still to be played: realized equity. What the winner fails to
  // keep is spread over everyone in, weighted by acting later.
  let kept = 0
  let rankTotal = 0
  for (const s of survivors) {
    kept += showdownShare(s) * realized[s][classes[s]]
    rankTotal += postflopRank[s]
  }
  const share = showdownShare(seat) * realized[seat][classes[seat]] + (1 - kept) * (postflopRank[seat] / rankTotal)
  return share * node.pot - paid
}

// --- the shipped form -------------------------------------------------------------

/**
 * A trained strategy as it ships: for each decision worth shipping (keyed by
 * its history), the letters on offer and every class's mix over them.
 *
 * `mix` is one character per class and action, a digit in base 62 standing
 * for that many 61sts — a resolution of under two percent, which is finer
 * than the solve itself is converged to — or a single `.` in place of a
 * class the solve never saw reach the spot often enough to trust. Strings
 * rather than arrays of numbers because the difference is most of the file:
 * this ships to a browser.
 */
export interface MultiwayStrategyFile {
  players: number
  stack: number
  iterations: number
  decisions: Record<string, { letters: string; mix: string }>
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LEVELS = DIGITS.length - 1
const UNREACHED = '.'

/**
 * A decision is shipped only if hands reach it at least this often (per hand
 * dealt). Most of a six-handed tree is lines like "open, cold call, squeeze,
 * cold call" that come up once in tens of thousands of hands; shipping them
 * would be most of the file for a sliver of the play, and a bot that meets
 * one simply decides without the book.
 */
const MIN_DECISION_REACH = 5e-4

/**
 * A class's row within a shipped decision is kept only if that class got
 * there at least this often per hand — at a few million iterations, a
 * hundred or more visits. Fewer is noise, not a strategy.
 */
const MIN_ROW_REACH = 5e-6

export function exportStrategy(trainer: MultiwayTrainer): MultiwayStrategyFile {
  const decisions: MultiwayStrategyFile['decisions'] = {}
  // Iteration t adds weight t on each of the (players - 1) passes where the
  // actor is not the one being updated, so reaching a decision with
  // probability p on every hand adds up to about p * (players - 1) * T^2 / 2.
  const t = trainer.iterations
  const perHand = ((trainer.tree.spot.players - 1) * t * (t + 1)) / 2
  trainer.tree.decisions.forEach((node, index) => {
    const rows = Array.from({ length: CLASS_COUNT }, (_, c) => trainer.average(index, c))
    const reach = rows.reduce((sum, row) => sum + row.weight, 0) / perHand
    if (reach < MIN_DECISION_REACH) return
    let mix = ''
    for (const row of rows) {
      if (row.weight / perHand < MIN_ROW_REACH) mix += UNREACHED
      else for (const p of row.probabilities) mix += DIGITS[Math.round(p * LEVELS)]
    }
    decisions[node.history] = { letters: node.letters.join(''), mix }
  })
  return { players: trainer.tree.spot.players, stack: trainer.tree.spot.stack, iterations: t, decisions }
}

/**
 * Unpacks one decision's `mix` into a row per class — probabilities that add
 * to one, or null for a class the file has nothing trustworthy on.
 */
export function decodeMix(mix: string, actions: number): (number[] | null)[] {
  const rows: (number[] | null)[] = []
  let at = 0
  for (let c = 0; c < CLASS_COUNT; c++) {
    if (mix[at] === UNREACHED) {
      rows.push(null)
      at++
      continue
    }
    const raw: number[] = []
    for (let a = 0; a < actions; a++) raw.push(DIGITS.indexOf(mix[at++]))
    const total = raw.reduce((sum, x) => sum + x, 0)
    rows.push(total > 0 ? raw.map((x) => x / total) : null)
  }
  return rows
}

// --- checking a solve --------------------------------------------------------------

/**
 * How much one seat could gain by deviating from the average strategy while
 * everyone else keeps playing it, in big blinds per hand — the seat's
 * best-response gain. Summed over seats it is NashConv, the standard measure
 * of distance from equilibrium for games with more than two players (zero
 * exactly at an equilibrium).
 *
 * Estimated rather than exact: the other seats' hands and the board are
 * sampled, and for each sample the whole tree is walked with everyone
 * else's reach probability attached, so every ending gets an unbiased
 * estimate of what it is worth to each of this seat's classes. The best
 * response then takes the best action at each of the seat's decisions, from
 * the leaves up. Taking a maximum over noisy estimates can only read high,
 * so this is an upper bound that tightens with `samples`.
 */
export function bestResponseGain(trainer: MultiwayTrainer, seat: number, samples: number, rng: Rng = createRng(7)): number {
  const tree = trainer.tree
  const n = tree.spot.players
  const averages = tree.decisions.map((node, index) => {
    const k = node.letters.length
    const table = new Float64Array(CLASS_COUNT * k)
    for (let c = 0; c < CLASS_COUNT; c++) {
      const { probabilities } = trainer.average(index, c)
      for (let a = 0; a < k; a++) table[c * k + a] = probabilities[a]
    }
    return table
  })
  const endings = new Map<TreeNode, Float64Array>()
  const collect = (node: TreeNode) => {
    if (node.actor < 0) endings.set(node, new Float64Array(CLASS_COUNT))
    else node.children.forEach(collect)
  }
  collect(tree.root)
  const counts = new Float64Array(CLASS_COUNT)

  const realized = tree.seats.map((label) => {
    const row = new Float64Array(CLASS_COUNT)
    for (let c = 0; c < CLASS_COUNT; c++) row[c] = Math.min(1, realization(label, handTypeOf(c)))
    return row
  })
  const ranks = postflopRanks(n)
  const deck = new Int32Array(DECK_SIZE)
  for (let card = 0; card < DECK_SIZE; card++) deck[card] = card
  const classes = new Int32Array(n)
  const scores = new Int32Array(n)

  const accumulate = (node: TreeNode, reach: number) => {
    if (reach === 0) return
    if (node.actor < 0) {
      endings.get(node)![classes[seat]] += reach * payoffAt(node, seat, classes, scores, realized, ranks)
      return
    }
    if (node.actor === seat) {
      node.children.forEach((child) => accumulate(child, reach))
      return
    }
    const k = node.letters.length
    const table = averages[node.index]
    const base = classes[node.actor] * k
    node.children.forEach((child, a) => accumulate(child, reach * table[base + a]))
  }

  for (let s = 0; s < samples; s++) {
    for (let i = 0; i < 2 * n + 5; i++) {
      const j = i + Math.floor(rng() * (DECK_SIZE - i))
      const tmp = deck[i]
      deck[i] = deck[j]
      deck[j] = tmp
    }
    const b = 2 * n
    for (let p = 0; p < n; p++) {
      classes[p] = classOf(deck[2 * p], deck[2 * p + 1])
      scores[p] = evaluate7(deck[2 * p], deck[2 * p + 1], deck[b], deck[b + 1], deck[b + 2], deck[b + 3], deck[b + 4])
    }
    counts[classes[seat]]++
    accumulate(tree.root, 1)
  }

  // From the leaves up, per class: the best response maximizes at this
  // seat's decisions; the average strategy mixes by its own probabilities.
  const value = (node: TreeNode, c: number, best: boolean): number => {
    if (node.actor < 0) return endings.get(node)![c]
    if (node.actor !== seat) return node.children.reduce((sum, child) => sum + value(child, c, best), 0)
    const childValues = node.children.map((child) => value(child, c, best))
    if (best) return Math.max(...childValues)
    const k = node.letters.length
    const table = averages[node.index]
    return childValues.reduce((sum, v, a) => sum + table[c * k + a] * v, 0)
  }

  let gain = 0
  for (let c = 0; c < CLASS_COUNT; c++) {
    if (counts[c] === 0) continue
    gain += (value(tree.root, c, true) - value(tree.root, c, false)) / samples
  }
  return gain
}
