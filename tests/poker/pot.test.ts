import { describe, expect, it } from 'vitest'
import { createPlayer } from '../../src/poker/player'
import { computePots, distributePots } from '../../src/poker/pot'

function withContribution(id: string, amount: number, folded = false) {
  const p = createPlayer(id, id, 1000)
  p.totalContributed = amount
  p.folded = folded
  return p
}

describe('computePots', () => {
  it('creates a single pot when all contributions are equal', () => {
    const players = [withContribution('a', 100), withContribution('b', 100), withContribution('c', 100)]
    const pots = computePots(players)
    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(300)
    expect(pots[0].eligiblePlayerIds.sort()).toEqual(['a', 'b', 'c'])
  })

  it('creates a main pot and a side pot for an uneven all-in', () => {
    // a goes all-in for 50, b and c both put in 200
    const players = [withContribution('a', 50), withContribution('b', 200), withContribution('c', 200)]
    const pots = computePots(players)
    expect(pots).toHaveLength(2)
    expect(pots[0]).toEqual({ amount: 150, eligiblePlayerIds: expect.arrayContaining(['a', 'b', 'c']) })
    expect(pots[1]).toEqual({ amount: 300, eligiblePlayerIds: expect.arrayContaining(['b', 'c']) })
    expect(pots[1].eligiblePlayerIds).not.toContain('a')
  })

  it('excludes folded players from eligibility but still counts their chips', () => {
    const players = [withContribution('a', 100, true), withContribution('b', 100), withContribution('c', 100)]
    const pots = computePots(players)
    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(300)
    expect(pots[0].eligiblePlayerIds.sort()).toEqual(['b', 'c'])
  })

  it('handles three-way uneven all-ins with multiple side pots', () => {
    const players = [withContribution('a', 30), withContribution('b', 90), withContribution('c', 150)]
    const pots = computePots(players)
    expect(pots).toHaveLength(3)
    expect(pots[0].amount).toBe(90) // 30 * 3
    expect(pots[0].eligiblePlayerIds.sort()).toEqual(['a', 'b', 'c'])
    expect(pots[1].amount).toBe(120) // 60 * 2
    expect(pots[1].eligiblePlayerIds.sort()).toEqual(['b', 'c'])
    expect(pots[2].amount).toBe(60) // 60 * 1
    expect(pots[2].eligiblePlayerIds).toEqual(['c'])
  })
})

describe('distributePots', () => {
  it('splits a tied pot evenly with the odd chip to the first winner after the dealer', () => {
    const pots = [{ amount: 101, eligiblePlayerIds: ['a', 'b'] }]
    const payouts = distributePots(pots, [['a', 'b']], ['b', 'a'])
    expect(payouts.get('b')).toBe(51)
    expect(payouts.get('a')).toBe(50)
  })

  it('gives the whole pot to a single winner', () => {
    const pots = [{ amount: 300, eligiblePlayerIds: ['a', 'b', 'c'] }]
    const payouts = distributePots(pots, [['a']], ['a', 'b', 'c'])
    expect(payouts.get('a')).toBe(300)
    expect(payouts.has('b')).toBe(false)
  })
})
