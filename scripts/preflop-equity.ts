import { writeFileSync } from 'node:fs'
import { CLASS_COUNT, COMBO_A, COMBO_B, allClassIndices, classCombos, classLabel } from '../src/math/combos'
import { DECK_SIZE } from '../src/poker/fast/cards'
import { evaluateHand } from '../src/poker/fast/eval7'
import { createRng } from '../src/utils/random'

/**
 * Builds the 169 x 169 table of all-in preflop equity, class against class.
 *
 * Every solve of a preflop game needs this and none of them can afford to
 * compute it while running: there are 14,365 distinct matchups and an exact
 * answer for one is 1.7 million board run-outs. So it is measured once, here,
 * and checked in.
 *
 * Class against class is already an abstraction — AKs against QQ is not quite
 * the same hand when they share a suit — so each matchup is sampled over
 * randomly chosen *combos* of the two classes as well as over boards, which
 * makes the entry the correctly weighted average over suit configurations
 * rather than one arbitrary representative.
 *
 * Ties count half to each side, so equity(a, b) + equity(b, a) is exactly 1
 * and only the upper triangle is stored.
 */

const SAMPLES = 20_000

export default function main(): void {
  const classes = allClassIndices()
  const combosByClass = classes.map((index) => classCombos(index))
  const rng = createRng(20260919)

  const size = (CLASS_COUNT * (CLASS_COUNT + 1)) / 2
  const equity = new Array<number>(size)

  const heroHand = [0, 0, 0, 0, 0, 0, 0]
  const villainHand = [0, 0, 0, 0, 0, 0, 0]
  const dead = new Uint8Array(DECK_SIZE)
  const deck: number[] = []

  const started = Date.now()
  let done = 0

  for (let a = 0; a < CLASS_COUNT; a++) {
    for (let b = a; b < CLASS_COUNT; b++) {
      const heroCombos = combosByClass[a]
      const villainCombos = combosByClass[b]
      let score = 0
      let counted = 0

      while (counted < SAMPLES) {
        const hero = heroCombos[Math.floor(rng() * heroCombos.length)]
        const villain = villainCombos[Math.floor(rng() * villainCombos.length)]
        const h0 = COMBO_A[hero]
        const h1 = COMBO_B[hero]
        const v0 = COMBO_A[villain]
        const v1 = COMBO_B[villain]
        // Two hands wanting the same card is not a matchup; redraw rather
        // than substitute, which would bias the suit mix.
        if (h0 === v0 || h0 === v1 || h1 === v0 || h1 === v1) continue

        dead.fill(0)
        dead[h0] = 1
        dead[h1] = 1
        dead[v0] = 1
        dead[v1] = 1
        deck.length = 0
        for (let card = 0; card < DECK_SIZE; card++) if (!dead[card]) deck.push(card)

        heroHand[0] = h0
        heroHand[1] = h1
        villainHand[0] = v0
        villainHand[1] = v1
        for (let i = 0; i < 5; i++) {
          const j = i + Math.floor(rng() * (deck.length - i))
          const swap = deck[i]
          deck[i] = deck[j]
          deck[j] = swap
          heroHand[2 + i] = deck[i]
          villainHand[2 + i] = deck[i]
        }

        const hs = evaluateHand(heroHand)
        const vs = evaluateHand(villainHand)
        if (hs > vs) score += 1
        else if (hs === vs) score += 0.5
        counted++
      }

      equity[index(a, b)] = Math.round((score / counted) * 1000)
      done++
    }
    if (a % 20 === 0) {
      const elapsed = (Date.now() - started) / 1000
      console.log(`${classLabel(a)}: ${done}/${size} matchups, ${elapsed.toFixed(0)}s`)
    }
  }

  const output = { samples: SAMPLES, classCount: CLASS_COUNT, equity }
  writeFileSync('src/gto/holdem/preflop-equity.json', JSON.stringify(output))
  console.log(`wrote ${size} matchups in ${((Date.now() - started) / 1000).toFixed(0)}s`)
}

/** Upper-triangle index, row-major, for a <= b. */
function index(a: number, b: number): number {
  return (a * (2 * CLASS_COUNT - a + 1)) / 2 + (b - a)
}
