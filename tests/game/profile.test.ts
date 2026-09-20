import { describe, expect, it, beforeEach } from 'vitest'
import {
  DAILY_STAKE_AMOUNT,
  DAILY_STAKE_THRESHOLD,
  STARTING_BANKROLL,
  applyBuyIn,
  canAffordBuyIn,
  canClaimDailyStake,
  claimDailyStake,
  defaultProfile,
  loadProfile,
  migrateProfile,
  recordCashSession,
  recordTournamentResult,
  saveProfile,
  type Profile,
} from '../../src/game/profile'

/** A fake localStorage, since these tests run under Node rather than a browser. */
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  clear() {
    this.store.clear()
  }
}

beforeEach(() => {
  // vitest's default environment has no localStorage; the module under test
  // talks to it directly (via utils/storage.ts), so a fresh fake is swapped
  // in before every test rather than assumed to exist.
  // @ts-expect-error -- test-only global shim
  globalThis.localStorage = new MemoryStorage()
})

describe('a fresh profile', () => {
  it('starts with the advertised bankroll and no history', () => {
    const profile = defaultProfile()
    expect(profile.bankroll).toBe(STARTING_BANKROLL)
    expect(profile.history).toEqual([])
    expect(profile.lifetime).toEqual({ handsPlayed: 0, gamesPlayed: 0, biggestPot: 0, bestFinish: null })
  })
})

describe('migration', () => {
  it('accepts a well-formed v1 profile unchanged', () => {
    const profile: Profile = {
      version: 1,
      bankroll: 4200,
      lifetime: { handsPlayed: 50, gamesPlayed: 3, biggestPot: 900, bestFinish: 2 },
      history: [{ at: '2026-01-01T00:00:00.000Z', mode: 'cash', buyIn: 1000, result: 200 }],
      dailyStake: { lastClaimedDate: '2026-01-01' },
    }
    expect(migrateProfile(profile)).toEqual(profile)
  })

  it('falls back to a fresh profile for anything unrecognised, rather than throwing', () => {
    for (const garbage of [null, undefined, 'not an object', 42, {}, { version: 2 }, { version: 1, bankroll: 'lots' }]) {
      expect(() => migrateProfile(garbage)).not.toThrow()
    }
    expect(migrateProfile(null)).toEqual(defaultProfile())
  })

  it('repairs a v1 profile with a corrupted field instead of discarding the whole thing', () => {
    const repaired = migrateProfile({
      version: 1,
      bankroll: 500,
      lifetime: { handsPlayed: 'ten' }, // corrupted
      history: 'not an array', // corrupted
      dailyStake: {},
    })
    expect(repaired.bankroll).toBe(500)
    expect(repaired.lifetime.handsPlayed).toBe(0)
    expect(repaired.history).toEqual([])
  })

  it('drops history entries that are not shaped like history entries', () => {
    const repaired = migrateProfile({
      version: 1,
      bankroll: 500,
      lifetime: {},
      history: [{ at: '2026-01-01T00:00:00.000Z', buyIn: 100, mode: 'cash', result: 0 }, { garbage: true }, 'nope'],
      dailyStake: {},
    })
    expect(repaired.history).toHaveLength(1)
  })
})

describe('persistence round-trips through storage', () => {
  it('saves and loads the same profile', () => {
    const profile = recordCashSession(defaultProfile(), {
      buyIn: 1000,
      finalStack: 1400,
      handsPlayed: 30,
      biggestPot: 300,
    })
    saveProfile(profile)
    expect(loadProfile()).toEqual(profile)
  })

  it('loads a fresh profile when nothing has ever been saved', () => {
    expect(loadProfile()).toEqual(defaultProfile())
  })
})

describe('buy-in and cash-out', () => {
  it('never lets a buy-in exceed the bankroll', () => {
    const profile = defaultProfile()
    expect(canAffordBuyIn(profile.bankroll, profile.bankroll)).toBe(true)
    expect(canAffordBuyIn(profile.bankroll, profile.bankroll + 1)).toBe(false)
    expect(canAffordBuyIn(profile.bankroll, 0)).toBe(false)
    expect(canAffordBuyIn(profile.bankroll, -50)).toBe(false)
  })

  it('deducts a buy-in immediately, before any hand is dealt', () => {
    const profile = applyBuyIn(defaultProfile(), 300)
    expect(profile.bankroll).toBe(STARTING_BANKROLL - 300)
  })

  it('adds back exactly what is left on the table, win or lose', () => {
    const afterBuyIn = applyBuyIn(defaultProfile(), 500)
    const winner = recordCashSession(afterBuyIn, { buyIn: 500, finalStack: 900, handsPlayed: 20, biggestPot: 150 })
    expect(winner.bankroll).toBe(STARTING_BANKROLL - 500 + 900)

    const loser = recordCashSession(afterBuyIn, { buyIn: 500, finalStack: 0, handsPlayed: 40, biggestPot: 80 })
    expect(loser.bankroll).toBe(STARTING_BANKROLL - 500)
  })

  it('records the session in history with the net result', () => {
    const profile = recordCashSession(defaultProfile(), {
      buyIn: 1000,
      finalStack: 750,
      handsPlayed: 15,
      biggestPot: 220,
    })
    expect(profile.history).toHaveLength(1)
    expect(profile.history[0]).toMatchObject({ mode: 'cash', buyIn: 1000, result: -250 })
  })

  it('rolls hands, games and the biggest pot into lifetime totals', () => {
    let profile = defaultProfile()
    profile = recordCashSession(profile, { buyIn: 100, finalStack: 50, handsPlayed: 10, biggestPot: 40 })
    profile = recordCashSession(profile, { buyIn: 100, finalStack: 300, handsPlayed: 25, biggestPot: 500 })
    expect(profile.lifetime.handsPlayed).toBe(35)
    expect(profile.lifetime.gamesPlayed).toBe(2)
    expect(profile.lifetime.biggestPot).toBe(500)
  })

  it('caps stored history so a long career does not grow storage without bound', () => {
    let profile = defaultProfile()
    for (let i = 0; i < 250; i++) {
      profile = recordCashSession(profile, { buyIn: 10, finalStack: 10, handsPlayed: 1, biggestPot: 0 })
    }
    expect(profile.history.length).toBeLessThanOrEqual(200)
    // Lifetime totals are not truncated even though the log is.
    expect(profile.lifetime.handsPlayed).toBe(250)
  })
})

describe('tournament results', () => {
  it('adds the prize, not the buy-in, to the bankroll', () => {
    const afterBuyIn = applyBuyIn(defaultProfile(), 100)
    const profile = recordTournamentResult(afterBuyIn, {
      buyIn: 100,
      finish: 1,
      field: 6,
      prize: 390,
      handsPlayed: 80,
      biggestPot: 1200,
    })
    expect(profile.bankroll).toBe(STARTING_BANKROLL - 100 + 390)
  })

  it('tracks the best finish ever, and only improves it', () => {
    let profile = defaultProfile()
    profile = recordTournamentResult(profile, { buyIn: 50, finish: 3, field: 9, prize: 0, handsPlayed: 1, biggestPot: 0 })
    expect(profile.lifetime.bestFinish).toBe(3)
    profile = recordTournamentResult(profile, { buyIn: 50, finish: 1, field: 9, prize: 500, handsPlayed: 1, biggestPot: 0 })
    expect(profile.lifetime.bestFinish).toBe(1)
    profile = recordTournamentResult(profile, { buyIn: 50, finish: 5, field: 9, prize: 0, handsPlayed: 1, biggestPot: 0 })
    // A worse finish afterwards does not erase the record.
    expect(profile.lifetime.bestFinish).toBe(1)
  })
})

describe('the daily stake', () => {
  const morning = new Date('2026-03-01T09:00:00')
  const sameDayLater = new Date('2026-03-01T22:00:00')
  const nextDay = new Date('2026-03-02T00:05:00')

  it('is not offered while the bankroll can still cover the smallest buy-in', () => {
    const profile = { ...defaultProfile(), bankroll: DAILY_STAKE_THRESHOLD + 1 }
    expect(canClaimDailyStake(profile, morning)).toBe(false)
  })

  it('is offered once the bankroll cannot cover a table', () => {
    const profile = { ...defaultProfile(), bankroll: DAILY_STAKE_THRESHOLD }
    expect(canClaimDailyStake(profile, morning)).toBe(true)
    const broke = { ...defaultProfile(), bankroll: 0 }
    expect(canClaimDailyStake(broke, morning)).toBe(true)
  })

  it('can be claimed once and adds the advertised amount', () => {
    const profile = { ...defaultProfile(), bankroll: 0 }
    const claimed = claimDailyStake(profile, morning)
    expect(claimed.bankroll).toBe(DAILY_STAKE_AMOUNT)
  })

  it('refuses a second claim on the same calendar day', () => {
    const profile = { ...defaultProfile(), bankroll: 0 }
    const claimed = claimDailyStake(profile, morning)
    expect(canClaimDailyStake(claimed, sameDayLater)).toBe(false)
  })

  it('opens back up the next calendar day, even if still broke', () => {
    const profile = { ...defaultProfile(), bankroll: 0 }
    const claimed = claimDailyStake(profile, morning)
    // Spent the whole stake and then some.
    const spent = { ...claimed, bankroll: 0 }
    expect(canClaimDailyStake(spent, nextDay)).toBe(true)
  })
})
