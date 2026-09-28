import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLASS_COUNT, classComboCount, classFromLabel, classLabel } from '../../src/math/combos'
import {
  MultiwayTrainer,
  bestResponseGain,
  buildTree,
  decodeMix,
  exportStrategy,
  handTypeOf,
  type MultiwayStrategyFile,
} from '../../src/gto/holdem/preflop-multiway'
import { edges, solvePushFold } from '../../src/gto/holdem/pushfold-solver'
import { rangeWidth } from '../../src/gto/holdem/preflop'
import { createRng } from '../../src/utils/random'

describe('the preflop tree', () => {
  const tree = buildTree({ players: 3, stack: 20 })

  it('seats in the real preflop order, button first three-handed', () => {
    expect(tree.seats).toEqual(['BTN', 'SB', 'BB'])
    expect(buildTree({ players: 6, stack: 100 }).seats).toEqual(['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'])
  })

  it('offers no limp first in, and a walk when everyone folds to the big blind', () => {
    expect(tree.root.actor).toBe(0)
    expect(tree.root.letters).toEqual(['f', 'r', 'a'])
    const walk = tree.root.children[0].children[0]
    expect(walk.actor).toBe(-1)
    expect(walk.survivors).toEqual([2])
    // Small blind's half blind and the big blind's blind, back to the big blind.
    expect(walk.pot).toBe(1.5)
  })

  it('lets the big blind call, raise or shove an open — and only call or shove when a 3-bet would commit it', () => {
    const deep = buildTree({ players: 3, stack: 40 })
    const deepBigBlind = deep.root.children[1].children[0]
    expect(deepBigBlind.actor).toBe(2)
    expect(deepBigBlind.letters).toEqual(['f', 'c', 'r', 'a'])
    // At 20bb a 3-bet out of position goes to 10, more than 45% of the stack:
    // it is played as all in.
    const open = tree.root.children[1]
    // The small blind folds; the big blind is left facing the open.
    const bigBlind = open.children[0]
    expect(bigBlind.actor).toBe(2)
    expect(bigBlind.letters).toEqual(['f', 'c', 'a'])
  })

  it('ends an all-in called by everyone as a showdown with nothing behind', () => {
    const shove = tree.root.children[2]
    const allCall = shove.children[1].children[1]
    expect(allCall.actor).toBe(-1)
    expect(allCall.allIn).toBe(true)
    expect(allCall.pot).toBe(60)
  })

  it('stays small enough to train and ship at six-handed and 100bb', () => {
    // The cold-call cap is what keeps it here rather than at tens of thousands.
    expect(buildTree({ players: 6, stack: 100 }).decisions.length).toBeLessThan(12_000)
  })
})

describe('hand types for realization', () => {
  it('sorts the classes the way a player would', () => {
    expect(handTypeOf(classFromLabel('AA'))).toBe('made')
    expect(handTypeOf(classFromLabel('AKo'))).toBe('made')
    expect(handTypeOf(classFromLabel('22'))).toBe('speculative')
    expect(handTypeOf(classFromLabel('76s'))).toBe('speculative')
    expect(handTypeOf(classFromLabel('A5s'))).toBe('speculative')
    expect(handTypeOf(classFromLabel('K7o'))).toBe('marginal')
  })
})

/**
 * The same check the heads-up solvers pass (pushfold.test.ts): with two
 * players and a stack too short for any raise but all in, the multiway
 * solver's game *is* heads-up push/fold, which is solved exactly elsewhere by
 * a different method. Getting the same answer is evidence that the N-player
 * trainer, the tree and the payoffs are right.
 */
describe('two players deep enough only to shove', () => {
  const trainer = new MultiwayTrainer({ players: 2, stack: 6 }, createRng(3))
  trainer.train(600_000)
  const exact = solvePushFold(6, 1_500)
  const shove: number[] = []
  const call: number[] = []
  for (let c = 0; c < CLASS_COUNT; c++) {
    shove.push(trainer.average(0, c).probabilities[1])
    call.push(trainer.average(1, c).probabilities[1])
  }

  it('is exactly the push/fold game', () => {
    expect(trainer.tree.decisions.map((d) => d.letters.join(''))).toEqual(['fa', 'fc'])
  })

  it('shoves and calls as wide as the exact solve, to within two points', () => {
    expect(Math.abs(rangeWidth(shove) - rangeWidth(exact.shove))).toBeLessThan(0.02)
    expect(Math.abs(rangeWidth(call) - rangeWidth(exact.call))).toBeLessThan(0.02)
  })

  it('disagrees hand by hand only where the hand is close to indifferent', () => {
    // Sampled training settles the hands at the edge of a range less exactly
    // than the exact solvers do — a hand worth a tenth of a blind either way,
    // in a pot of twelve, can land on either side — but never a hand with a
    // real edge, and never many of them.
    const edge = edges(6, exact)
    let disagreements = 0
    for (let c = 0; c < CLASS_COUNT; c++) {
      if (Math.abs(shove[c] - exact.shove[c]) > 0.25) {
        disagreements++
        expect(Math.abs(edge.shove[c]), `shove ${classLabel(c)}`).toBeLessThan(0.15)
      }
      if (Math.abs(call[c] - exact.call[c]) > 0.25) {
        disagreements++
        expect(Math.abs(edge.call[c]), `call ${classLabel(c)}`).toBeLessThan(0.15)
      }
    }
    expect(disagreements).toBeLessThan(16)
  })
})

describe('three players', () => {
  it('trains to within a small distance of equilibrium', { timeout: 60_000 }, () => {
    const trainer = new MultiwayTrainer({ players: 3, stack: 20 }, createRng(5))
    const nashConv = () =>
      [0, 1, 2].reduce((sum, seat) => sum + bestResponseGain(trainer, seat, 60_000, createRng(seat + 11)), 0)
    const untrained = nashConv()
    trainer.train(300_000)
    const trained = nashConv()
    // Random play gives away several big blinds a hand to a best response;
    // trained, what is left is mostly the estimate's own upward bias.
    expect(untrained).toBeGreaterThan(3)
    expect(trained).toBeLessThan(0.4)
  })
})

describe('the shipped form', () => {
  it('round-trips a trained strategy, dropping only rows it never reached', () => {
    const trainer = new MultiwayTrainer({ players: 3, stack: 20 }, createRng(8))
    trainer.train(50_000)
    const file = exportStrategy(trainer)
    const root = file.decisions['']
    expect(root.letters).toBe('fra')
    const rows = decodeMix(root.mix, 3)
    expect(rows).toHaveLength(CLASS_COUNT)
    for (const row of rows) {
      // Every class is dealt at the first decision, so every row is there.
      expect(row).not.toBeNull()
      expect(row!.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 6)
    }
  })
})

/** What the trained files on disk say, checked for the shape any preflop chart has. */
describe('the trained files', () => {
  const dir = 'src/gto/holdem'
  const files = readdirSync(dir)
    .filter((name) => /^preflop-\dmax-\d+\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(`${dir}/${name}`, 'utf-8')) as MultiwayStrategyFile)

  /** Share of all dealt hands that open (raise or shove) at a first-in decision. */
  const openWidth = (file: MultiwayStrategyFile, history: string) => {
    const decision = file.decisions[history]
    const rows = decodeMix(decision.mix, decision.letters.length)
    let open = 0
    let total = 0
    rows.forEach((row, c) => {
      if (!row) return
      const combos = classComboCount(c)
      total += combos
      open += combos * (1 - row[0])
    })
    return open / total
  }

  it('covers three to six players at four depths', () => {
    const have = new Set(files.map((f) => `${f.players}x${f.stack}`))
    for (const players of [3, 4, 5, 6]) for (const stack of [8, 20, 40, 100]) expect(have.has(`${players}x${stack}`)).toBe(true)
  })

  it('opens wider the later the seat, six-handed at 100bb', () => {
    const file = files.find((f) => f.players === 6 && f.stack === 100)!
    const utg = openWidth(file, '')
    const cutoff = openWidth(file, 'ff')
    const button = openWidth(file, 'fff')
    expect(utg).toBeLessThan(cutoff)
    expect(cutoff).toBeLessThan(button)
    // Charts open roughly 12-20% under the gun and 40-50% on the button.
    expect(utg).toBeGreaterThan(0.08)
    expect(utg).toBeLessThan(0.25)
    expect(button).toBeGreaterThan(0.3)
    expect(button).toBeLessThan(0.65)
  })

  it('always opens aces and never opens seven-deuce under the gun', () => {
    for (const file of files) {
      const decision = file.decisions['']
      const rows = decodeMix(decision.mix, decision.letters.length)
      expect(rows[classFromLabel('AA')]![0], `${file.players}x${file.stack}`).toBeLessThan(0.05)
      expect(rows[classFromLabel('72o')]![0], `${file.players}x${file.stack}`).toBeGreaterThan(0.95)
    }
  })
})
