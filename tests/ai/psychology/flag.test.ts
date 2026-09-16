import { describe, expect, it } from 'vitest'
import { psychBotsEnabled } from '../../../src/ai/psychology/flag'

describe('the dev flag', () => {
  it('is off, and is off safely where there is no browser to ask', () => {
    // No window, no localStorage, no throw — the layer stays out of the game
    // until somebody deliberately asks for it.
    expect(psychBotsEnabled()).toBe(false)
  })
})
