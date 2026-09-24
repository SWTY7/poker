import { describe, expect, it } from 'vitest'
import { BlueprintSetBot } from '../../src/gto/holdem/blueprint-set'
import type { BlueprintFile } from '../../src/gto/holdem/blueprint'
import { HeuristicBot } from '../../src/ai/heuristic-bot'
import { createRng } from '../../src/utils/random'
import { classFromLabel } from '../../src/math/combos'
import type { AIObservation } from '../../src/ai/observation'

/**
 * A trained-at-`stack` file that answers exactly one spot — the small
 * blind's very first decision with pocket aces — deterministically, so a
 * test can tell which file answered from the action alone. `f, c, h, p, a`
 * is legalLetters' own order for that spot (see blueprint-bot.ts): fold,
 * call, half-pot, pot, all-in.
 */
function fileAnsweringFoldOrCall(stack: number, fold: boolean): BlueprintFile {
  const key = `0|${classFromLabel('AA')}|`
  return {
    options: { stack, buckets: 8, betCap: 3 },
    iterations: 1,
    strategy: { [key]: fold ? [1000, 0, 0, 0, 0] : [0, 1000, 0, 0, 0] },
  }
}

/** The small blind's opening decision, heads-up, nothing replayed yet. */
function openingSpot(effectiveBb: number): AIObservation {
  const bigBlind = 10
  const stack = effectiveBb * bigBlind
  return {
    playerId: 'hero',
    ownCards: [
      { rank: 'A', suit: 'spades' },
      { rank: 'A', suit: 'hearts' },
    ],
    communityCards: [],
    potSize: 15,
    players: [
      { id: 'hero', stack, betThisStreet: 5, folded: false, isAllIn: false, position: 'SB' },
      { id: 'villain', stack, betThisStreet: 10, folded: false, isAllIn: false, position: 'BB' },
    ],
    legalActions: ['fold', 'call', 'raise'],
    street: 'preflop',
    currentBet: 10,
    toCall: 5,
    minRaiseTo: 20,
    maxRaiseTo: stack,
    actionHistory: [],
    bigBlind,
  }
}

describe('BlueprintSetBot', () => {
  it('answers from whichever trained depth is closest to the actual effective stack', () => {
    const shortFile = fileAnsweringFoldOrCall(10, true) // trained shove-or-fold territory: this file folds
    const deepFile = fileAnsweringFoldOrCall(100, false) // trained deep: this file calls
    const bot = new BlueprintSetBot([shortFile, deepFile], { fallback: new HeuristicBot(createRng(1)), rng: createRng(1) })

    expect(bot.decideAction(openingSpot(10)).type).toBe('fold')
    expect(bot.decideAction(openingSpot(100)).type).toBe('call')
  })

  it('picks the file whose trained depth is nearer even off-center', () => {
    const shortFile = fileAnsweringFoldOrCall(10, true)
    const deepFile = fileAnsweringFoldOrCall(100, false)
    const bot = new BlueprintSetBot([shortFile, deepFile], { fallback: new HeuristicBot(createRng(1)), rng: createRng(1) })

    // 15bb is closer to 10 than to 100, and still within the 10bb file's own
    // trusted depth band ([0.5, 2] x trained stack — BlueprintBot's own
    // default) — picking the nearer file is only half the claim; it has to
    // be a file that can actually answer, or this would just be testing the
    // fallback again.
    expect(bot.decideAction(openingSpot(15)).type).toBe('fold')
    // 60bb is closer to 100 than to 10, and within the 100bb file's band.
    expect(bot.decideAction(openingSpot(60)).type).toBe('call')
  })

  it('falls back when the table is not heads-up', () => {
    const shortFile = fileAnsweringFoldOrCall(10, true)
    const fallback = new HeuristicBot(createRng(1))
    const bot = new BlueprintSetBot([shortFile], { fallback, rng: createRng(1) })

    const threeHanded: AIObservation = {
      ...openingSpot(10),
      players: [
        ...openingSpot(10).players,
        { id: 'extra', stack: 100, betThisStreet: 0, folded: false, isAllIn: false, position: null },
      ],
    }
    const action = bot.decideAction(threeHanded)
    expect(threeHanded.legalActions).toContain(action.type)
    expect(bot.answered).toBe(0)
  })

  it('sums asked/answered across every trained depth', () => {
    const shortFile = fileAnsweringFoldOrCall(10, true)
    const deepFile = fileAnsweringFoldOrCall(100, false)
    const bot = new BlueprintSetBot([shortFile, deepFile], { fallback: new HeuristicBot(createRng(1)), rng: createRng(1) })

    bot.decideAction(openingSpot(10))
    bot.decideAction(openingSpot(100))
    expect(bot.asked).toBe(2)
    expect(bot.answered).toBe(2)
  })

  it('refuses an empty set of trained depths', () => {
    expect(() => new BlueprintSetBot([], { fallback: new HeuristicBot(createRng(1)) })).toThrow()
  })
})
