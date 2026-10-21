/** Chip pile maths for the Realistic theme: how an amount is split into coloured stacks. */

export type ChipColour = 'white' | 'red' | 'green' | 'black' | 'violet' | 'gold'

export interface Pile {
  colour: ChipColour
  count: number
}

const DENOMS: { value: number; colour: ChipColour }[] = [
  { value: 1000, colour: 'gold' },
  { value: 500, colour: 'violet' },
  { value: 100, colour: 'black' },
  { value: 25, colour: 'green' },
  { value: 5, colour: 'red' },
  { value: 1, colour: 'white' },
]

/** Most piles and most chips in one pile a bet is drawn with. */
export const MAX_PILES = 3
export const MAX_PILE_HEIGHT = 5

/**
 * A bet as casino chips: split into denominations (1, 5, 25, 100, 500, 1000),
 * keep the three largest piles, five chips high at most. A bigger bet always
 * gives a pile at least as tall or a bigger denomination.
 */
export function betPiles(amount: number): Pile[] {
  if (!(amount > 0)) return []
  let rest = Math.floor(amount)
  const piles: Pile[] = []
  for (const d of DENOMS) {
    const n = Math.floor(rest / d.value)
    if (n > 0) {
      piles.push({ colour: d.colour, count: Math.min(n, MAX_PILE_HEIGHT) })
      rest -= n * d.value
    }
  }
  if (piles.length === 0) piles.push({ colour: 'white', count: 1 })
  return piles.slice(0, MAX_PILES)
}

/** A whole stack as three piles of red, black and green, taller for a bigger stack. */
export function stackPiles(stack: number): Pile[] {
  if (!(stack > 0)) return []
  const mag = Math.log10(stack + 1)
  const h = (k: number, cap: number) => Math.max(1, Math.min(cap, Math.round(mag * k)))
  return [
    { colour: 'red', count: h(1.6, 7) },
    { colour: 'black', count: h(1.2, 6) },
    { colour: 'green', count: h(0.8, 4) },
  ]
}
