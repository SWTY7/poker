import { DECK_SIZE, type CardInt } from '../poker/fast/cards'
import { evaluateHand, categoryRankOfScore } from '../poker/fast/eval7'
import type { HandCategory } from '../poker/hand-evaluator'
import { COMBO_A, COMBO_B, COMBO_COUNT } from './combos'
import type { Range } from './range'

const CATEGORY_RANK: Record<HandCategory, number> = {
  'high-card': 0,
  pair: 1,
  'two-pair': 2,
  trips: 3,
  straight: 4,
  flush: 5,
  'full-house': 6,
  quads: 7,
  'straight-flush': 8,
}

/**
 * The chance a draw gets there, counted exactly rather than approximated.
 *
 * With two cards to come the complement is the clean way to say it: the draw
 * misses only if BOTH cards miss, and the second card comes from a deck one
 * smaller than the first.
 */
export function equityFromOuts(outs: number, cardsToCome: 1 | 2, unseen = 47): number {
  if (outs <= 0) return 0
  if (cardsToCome === 1) return Math.min(outs / unseen, 1)
  const missFirst = (unseen - outs) / unseen
  const missSecond = (unseen - 1 - outs) / (unseen - 1)
  return 1 - missFirst * missSecond
}

/**
 * The mental shortcut, implemented so its error can be measured rather than
 * asserted.
 *
 * One card to come: twice the outs. Two cards: four times, minus the excess
 * over eight — the correction matters, because without it fifteen outs reads
 * as 60% when the true figure is 54%.
 *
 * The rule of four is only honest when both cards are guaranteed to come,
 * which means you are already all-in. With another betting round to survive
 * you face another bet before seeing the river, so the rule of two is the one
 * that applies unless implied odds are being counted separately.
 */
export function ruleOfTwoFour(outs: number, cardsToCome: 1 | 2): number {
  if (cardsToCome === 1) return (outs * 2) / 100
  const raw = outs * 4
  return (raw - Math.max(0, outs - 8)) / 100
}

/**
 * Unseen cards that would lift the hero's hand to at least `target`.
 *
 * This counts outs to a named destination, which is what "nine outs to the
 * flush" means — not every card that improves the hand at all. A flush draw
 * that also holds two overcards has nine outs to a flush and six to a pair,
 * and adding them would be double-counting a decision, not an improvement.
 */
export function outsTo(
  hole: readonly [CardInt, CardInt],
  board: CardInt[],
  target: HandCategory,
): number {
  const targetRank = CATEGORY_RANK[target]
  const seen = new Uint8Array(DECK_SIZE)
  for (const card of [...hole, ...board]) seen[card] = 1

  const hand = [hole[0], hole[1], ...board, 0]
  const slot = hand.length - 1

  let outs = 0
  for (let card = 0; card < DECK_SIZE; card++) {
    if (seen[card]) continue
    hand[slot] = card
    if (categoryRankOfScore(evaluateHand(hand)) >= targetRank) outs++
  }
  return outs
}

/** Every unseen card, with the hand category it would give the hero. */
export function outsByCategory(
  hole: readonly [CardInt, CardInt],
  board: CardInt[],
): Partial<Record<HandCategory, number>> {
  const names = Object.keys(CATEGORY_RANK) as HandCategory[]
  const counts: Partial<Record<HandCategory, number>> = {}
  for (const name of names) {
    const n = outsTo(hole, board, name)
    if (n > 0) counts[name] = n
  }
  return counts
}

export interface DiscountedOuts {
  /** Outs weighted by how often they actually win, 0..1 each. */
  discounted: number
  /** Cards that improve the hand at all, counted whole. */
  raw: number
  /** Per-card detail, for explaining a number rather than asserting it. */
  cards: { card: CardInt; winProb: number }[]
}

/**
 * Outs, weighted by how often each one actually wins.
 *
 * Counting outs whole assumes every card that improves you also wins, which
 * is the mistake reverse implied odds names: the card that completes your
 * flush also completes a better one, and the card that fills your straight
 * pairs the board into a full house. Rather than hand-maintaining a list of
 * dirty outs, each candidate card is scored by the hero's chance of winning
 * if it comes, against the villain's actual range — so an out to the
 * fifth-nut flush is worth less than an out to the nuts automatically, and by
 * the right amount.
 *
 * Only meaningful with one card to come; with two, use `handVsRange`, which
 * answers the same question without going through outs at all.
 */
export function discountedOuts(
  hole: readonly [CardInt, CardInt],
  board: CardInt[],
  villainRange: Range,
  improvesOnly = true,
): DiscountedOuts {
  const seen = new Uint8Array(DECK_SIZE)
  for (const card of [...hole, ...board]) seen[card] = 1

  const heroNow = evaluateHand([hole[0], hole[1], ...board])
  const nowRank = categoryRankOfScore(heroNow)

  const heroHand = [hole[0], hole[1], ...board, 0]
  const villainHand = [0, 0, ...board, 0]
  const heroSlot = heroHand.length - 1
  const villainSlot = villainHand.length - 1

  const cards: { card: CardInt; winProb: number }[] = []
  let discounted = 0
  let raw = 0

  for (let card = 0; card < DECK_SIZE; card++) {
    if (seen[card]) continue
    heroHand[heroSlot] = card
    const heroScore = evaluateHand(heroHand)
    if (improvesOnly && categoryRankOfScore(heroScore) <= nowRank) continue
    raw++

    villainHand[villainSlot] = card
    let winWeight = 0
    let totalWeight = 0
    for (let id = 0; id < COMBO_COUNT; id++) {
      const weight = villainRange[id]
      if (weight <= 0) continue
      const a = COMBO_A[id]
      const b = COMBO_B[id]
      if (seen[a] || seen[b] || a === card || b === card) continue
      villainHand[0] = a
      villainHand[1] = b
      const villainScore = evaluateHand(villainHand)
      if (heroScore > villainScore) winWeight += weight
      else if (heroScore === villainScore) winWeight += weight / 2
      totalWeight += weight
    }

    const winProb = totalWeight === 0 ? 1 : winWeight / totalWeight
    discounted += winProb
    cards.push({ card, winProb })
  }

  return { discounted, raw, cards }
}
