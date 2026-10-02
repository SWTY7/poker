import { describe, expect, it } from 'vitest'
import { risingBlinds } from '../../src/game/blinds'

const ladder = (smallBlind: number, levels: number) =>
  Array.from({ length: levels }, (_, i) => risingBlinds({ smallBlind, bigBlind: smallBlind * 2, ante: 0 }, i + 1).smallBlind)

describe('rising blinds', () => {
  it('climbs about half again a level, on round amounts', () => {
    expect(ladder(5, 10)).toEqual([5, 8, 15, 25, 40, 60, 100, 150, 250, 400])
    expect(ladder(1, 6)).toEqual([1, 2, 3, 5, 8, 15])
    expect(ladder(100, 4)).toEqual([100, 150, 250, 400])
  })

  it('keeps level 1 as given, and the big blind and ante in proportion', () => {
    expect(risingBlinds({ smallBlind: 5, bigBlind: 10, ante: 1 }, 1)).toEqual({ smallBlind: 5, bigBlind: 10, ante: 1 })
    expect(risingBlinds({ smallBlind: 5, bigBlind: 10, ante: 1 }, 3)).toEqual({ smallBlind: 15, bigBlind: 30, ante: 3 })
    expect(risingBlinds({ smallBlind: 10, bigBlind: 25, ante: 0 }, 2)).toEqual({ smallBlind: 15, bigBlind: 38, ante: 0 })
  })
})
