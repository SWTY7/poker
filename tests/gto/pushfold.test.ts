import { describe, expect, it } from 'vitest'
import { CLASS_COUNT, classFromLabel, classLabel } from '../../src/math/combos'
import { frequencies, frequencyOf, pushFold } from '../../src/gto/holdem/pushfold'
import { edges, solvePushFold } from '../../src/gto/holdem/pushfold-solver'
import { classEquity, rangeWidth } from '../../src/gto/holdem/preflop'
import { train } from '../../src/gto/cfr'
import { exploitability, strategyValue } from '../../src/gto/exploitability'

const STACK = 10
const game = pushFold(STACK)
const cfr = train(game, 300, { plus: true })
const cfrShove = frequencies(cfr.strategy, 'SB')
const cfrCall = frequencies(cfr.strategy, 'BB')
const fp = solvePushFold(STACK, 1_500)

describe('the game', () => {
  it('has one decision per hand class per seat, and no more', () => {
    // 169 hands for the small blind and 169 for the big blind. Every one of
    // them faces real cards, real equities and real card removal — and it is
    // still small enough to solve exactly.
    expect(cfr.nodeCount).toBe(2 * CLASS_COUNT)
  })

  it('refuses a stack the blinds have already swallowed', () => {
    expect(() => pushFold(0.5)).toThrow()
  })

  it('prices the three ways a hand ends', () => {
    const shove = (history: string, hands: number[]) => game.utility({ hands, history })
    const aces = classFromLabel('AA')
    const deuces = classFromLabel('72o')
    // Fold: half a blind. Shove through: the big blind's blind.
    expect(shove('f', [aces, deuces])).toBe(-0.5)
    expect(shove('sf', [aces, deuces])).toBe(1)
    // Called: the whole stack, and equity decides what comes back. Aces
    // against seven-deuce are about 87%, so about 7.5 blinds of a 10 blind
    // stack come back on top of it.
    expect(shove('sc', [aces, deuces])).toBeGreaterThan(7)
    expect(shove('sc', [deuces, aces])).toBeLessThan(-7)
  })
})

/**
 * The reason this game is in the repo: it can be solved twice, by two methods
 * that share no code, and the answers can be held up against each other.
 */
describe('two solvers, one answer', () => {
  it('agrees on how wide each seat plays, to within a point', () => {
    expect(rangeWidth(cfrShove)).toBeCloseTo(rangeWidth(fp.shove), 1)
    expect(rangeWidth(cfrCall)).toBeCloseTo(rangeWidth(fp.call), 1)
  })

  it('agrees on what the game is worth', () => {
    expect(strategyValue(game, cfr.strategy)).toBeCloseTo(fp.value, 1)
  })

  it('agrees hand by hand except where the equilibrium does not care', () => {
    // Where they differ, they differ on hands that are indifferent: shoving
    // and folding are worth the same to within a hundredth of a blind, so the
    // equilibrium genuinely does not specify which, and two correct solvers
    // will settle it differently. A disagreement on a hand with a real edge
    // would be a bug, and this is the test that tells them apart.
    const edge = edges(STACK, fp)
    let disagreements = 0
    for (let index = 0; index < CLASS_COUNT; index++) {
      const shoveGap = Math.abs(fp.shove[index] - cfrShove[index])
      const callGap = Math.abs(fp.call[index] - cfrCall[index])
      if (shoveGap > 0.25) {
        disagreements++
        expect(Math.abs(edge.shove[index]), `${classLabel(index)} shove`).toBeLessThan(0.05)
      }
      if (callGap > 0.25) {
        disagreements++
        expect(Math.abs(edge.call[index]), `${classLabel(index)} call`).toBeLessThan(0.05)
      }
    }
    // And there are only a handful of them: the boundary of a range is thin.
    expect(disagreements).toBeLessThan(12)
  })

  it('leaves the CFR solution close to unexploitable', () => {
    // Under ten thousandths of a big blind per hand, in a game where coin
    // flipping every decision costs whole blinds.
    expect(exploitability(game, cfr.strategy)).toBeLessThan(0.01)
  })
})

/**
 * The published Nash push-fold charts are the other oracle. These are the
 * figures a tournament player has memorised, reproduced by a solver that was
 * given nothing but a deck and the blinds.
 */
describe('against the charts', () => {
  const solutions = new Map([5, 10, 15, 20].map((stack) => [stack, solvePushFold(stack, 1_500)]))
  const widths = [...solutions].map(([stack, solution]) => ({
    stack,
    shove: rangeWidth(solution.shove),
    call: rangeWidth(solution.call),
    value: solution.value,
  }))

  it('lands on the published widths at every depth', () => {
    const at = (stack: number) => widths.find((w) => w.stack === stack)!
    // Roughly 70/60 at five blinds, 58/37 at ten, 40/22 at twenty — the
    // shape of every chart in print.
    expect(at(5).shove).toBeGreaterThan(0.65)
    expect(at(5).call).toBeGreaterThan(0.55)
    expect(at(10).shove).toBeGreaterThan(0.53)
    expect(at(10).shove).toBeLessThan(0.63)
    expect(at(10).call).toBeGreaterThan(0.33)
    expect(at(10).call).toBeLessThan(0.43)
    expect(at(20).shove).toBeLessThan(0.45)
    expect(at(20).call).toBeLessThan(0.26)
  })

  it('widens both ranges as the stack gets shorter', () => {
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i].shove).toBeLessThan(widths[i - 1].shove)
      expect(widths[i].call).toBeLessThan(widths[i - 1].call)
    }
  })

  it('always shoves wider than it calls, because folding wins the blind', () => {
    for (const width of widths) expect(width.shove).toBeGreaterThan(width.call)
  })

  it('shoves and calls the top of the deck at every depth, and the bottom at none', () => {
    for (const stack of [5, 10, 20]) {
      const solution = solutions.get(stack)!
      for (const label of ['AA', 'KK', 'AKs']) {
        expect(solution.shove[classFromLabel(label)]).toBeGreaterThan(0.99)
        expect(solution.call[classFromLabel(label)]).toBeGreaterThan(0.99)
      }
      expect(solution.call[classFromLabel('32o')]).toBeLessThan(0.01)
    }
  })

  it('makes the small blind money at five blinds and cost them at twenty', () => {
    // With half a blind at risk and a whole one to win, shoving into a range
    // that can only call 60% of the time is profitable. Deep, being forced to
    // choose between all-in and folding is itself the handicap, and the seat
    // that has to choose first pays for it.
    expect(widths.find((w) => w.stack === 5)!.value).toBeGreaterThan(0)
    expect(widths.find((w) => w.stack === 20)!.value).toBeLessThan(-0.1)
  })

  it('shoves 97o and folds J7o, which looks like a bug and is not', () => {
    // The first thing that looks wrong in the printed chart. It is real: a
    // calling range this tight is full of pairs and big aces, and against
    // those, cards that can make a straight together beat one high card with
    // a junk kicker that is dominated whenever it connects. The independent
    // equity function agrees — 97o holds 17.1% against aces and J7o 14.0% —
    // so the chart is reporting poker rather than an indexing mistake.
    const solution = solutions.get(10)!
    expect(solution.shove[classFromLabel('97o')]).toBeGreaterThan(0.9)
    expect(solution.shove[classFromLabel('J7o')]).toBeLessThan(0.1)
    expect(classEquity(classFromLabel('97o'), classFromLabel('AA'))).toBeGreaterThan(
      classEquity(classFromLabel('J7o'), classFromLabel('AA')),
    )
  })

  it('reads back as a chart', () => {
    expect(frequencyOf(cfr.strategy, 'SB', 'AA')).toBeGreaterThan(0.99)
    expect(frequencyOf(cfr.strategy, 'BB', '72o')).toBeLessThan(0.01)
  })
})
