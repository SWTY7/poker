import type { Card } from './card'
import { rankValue } from './card'

export type HandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'trips'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'quads'
  | 'straight-flush'

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

export interface HandValue {
  category: HandCategory
  categoryRank: number
  /** Values that break ties within a category, most significant first. */
  tiebreakers: number[]
}

/** Positive if a beats b, negative if b beats a, 0 if they tie. */
export function compareHandValues(a: HandValue, b: HandValue): number {
  if (a.categoryRank !== b.categoryRank) return a.categoryRank - b.categoryRank
  const length = Math.max(a.tiebreakers.length, b.tiebreakers.length)
  for (let i = 0; i < length; i++) {
    const av = a.tiebreakers[i] ?? 0
    const bv = b.tiebreakers[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}

/** Evaluates exactly 5 cards. */
export function evaluateFiveCardHand(cards: Card[]): HandValue {
  if (cards.length !== 5) {
    throw new Error(`evaluateFiveCardHand requires exactly 5 cards, got ${cards.length}`)
  }

  const values = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a)
  const isFlush = cards.every((c) => c.suit === cards[0].suit)

  const uniqueValues = Array.from(new Set(values)).sort((a, b) => b - a)
  let straightHigh = 0
  if (uniqueValues.length === 5) {
    if (uniqueValues[0] - uniqueValues[4] === 4) {
      straightHigh = uniqueValues[0]
    } else if (uniqueValues.join(',') === '14,5,4,3,2') {
      // wheel: A-2-3-4-5, ace plays low
      straightHigh = 5
    }
  }
  const isStraight = straightHigh > 0

  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const groups = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])

  const category: HandCategory = (() => {
    if (isStraight && isFlush) return 'straight-flush'
    if (groups[0][1] === 4) return 'quads'
    if (groups[0][1] === 3 && groups[1]?.[1] === 2) return 'full-house'
    if (isFlush) return 'flush'
    if (isStraight) return 'straight'
    if (groups[0][1] === 3) return 'trips'
    if (groups[0][1] === 2 && groups[1]?.[1] === 2) return 'two-pair'
    if (groups[0][1] === 2) return 'pair'
    return 'high-card'
  })()

  const tiebreakers: number[] = (() => {
    switch (category) {
      case 'straight-flush':
      case 'straight':
        return [straightHigh]
      case 'quads':
        return [groups[0][0], groups[1][0]]
      case 'full-house':
        return [groups[0][0], groups[1][0]]
      case 'flush':
      case 'high-card':
        return values
      case 'trips':
        return [groups[0][0], ...groups.slice(1).map((g) => g[0])]
      case 'two-pair':
        return [groups[0][0], groups[1][0], groups[2][0]]
      case 'pair':
        return [groups[0][0], ...groups.slice(1).map((g) => g[0])]
    }
  })()

  return { category, categoryRank: CATEGORY_RANK[category], tiebreakers }
}

function* combinations<T>(items: T[], size: number): Generator<T[]> {
  const n = items.length
  if (size > n) return
  const indices = Array.from({ length: size }, (_, i) => i)
  while (true) {
    yield indices.map((i) => items[i])
    let i = size - 1
    while (i >= 0 && indices[i] === i + n - size) i--
    if (i < 0) return
    indices[i]++
    for (let j = i + 1; j < size; j++) indices[j] = indices[j - 1] + 1
  }
}

/** Evaluates the best possible 5-card hand out of 5+ cards (e.g. 2 hole + 5 community). */
export function evaluateBestHand(cards: Card[]): HandValue {
  if (cards.length < 5) {
    throw new Error(`evaluateBestHand requires at least 5 cards, got ${cards.length}`)
  }
  if (cards.length === 5) return evaluateFiveCardHand(cards)

  let best: HandValue | null = null
  for (const combo of combinations(cards, 5)) {
    const value = evaluateFiveCardHand(combo)
    if (!best || compareHandValues(value, best) > 0) best = value
  }
  return best as HandValue
}
