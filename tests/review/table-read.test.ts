import { describe, expect, it } from 'vitest'
import { OpponentModel } from '../../src/ai/psychology/opponent-model'
import { MIN_ACTIONS, describeRead } from '../../src/review/table-read'

const multiway = (facingBet = false) => ({ playersInHand: 5, facingBet })

describe('what the table thinks of you, in words', () => {
  it('says nothing before there is enough to say', () => {
    const model = new OpponentModel()
    expect(describeRead(model, 'you')).toEqual([])
    for (let i = 0; i < MIN_ACTIONS - 1; i++) model.observe({ playerId: 'you', type: 'raise', amount: 30 }, multiway())
    expect(describeRead(model, 'you')).toEqual([])
  })

  it('calls a raiser aggressive, with the number it rests on', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 30; i++) model.observe({ playerId: 'you', type: i % 2 ? 'raise' : 'call', amount: 30 }, multiway())
    const [line] = describeRead(model, 'you')
    expect(line.text).toContain('50%')
    expect(line.text).toContain('aggressive')
    expect(line.sample).toBe(30)
  })

  it('tells an over-folder they get bluffed more', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 30; i++) model.observe({ playerId: 'you', type: 'fold' }, multiway(true))
    const text = describeRead(model, 'you').map((l) => l.text).join(' ')
    expect(text).toContain('fold 100%')
    expect(text).toContain('bluff you more')
  })

  it('reads the saved read of a rival the same way', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 30; i++) model.observe({ playerId: 'you', type: 'call' }, multiway(true))
    const restored = OpponentModel.fromJSON(model.toJSON(), 1)
    expect(describeRead(restored, 'you')).toEqual(describeRead(model, 'you'))
  })
})
