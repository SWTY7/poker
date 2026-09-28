import { describe, expect, it, beforeEach } from 'vitest'
import { MODE_STORAGE_KEY, loadMode, profileAfterTableExit, saveMode } from '../../src/game/mode'
import { applyBuyIn, defaultProfile, loadProfile, recordCashSession, saveProfile } from '../../src/game/profile'

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
  // @ts-expect-error -- test-only global shim
  globalThis.localStorage = new MemoryStorage()
})

describe('the lobby mode toggle', () => {
  it('defaults to Career, so a returning player sees the lobby they know', () => {
    expect(loadMode()).toBe('career')
  })

  it('remembers the last mode picked', () => {
    saveMode('quick')
    expect(loadMode()).toBe('quick')
    saveMode('career')
    expect(loadMode()).toBe('career')
  })

  it('falls back to Career on a value it does not recognise', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'tournament-grinder')
    expect(loadMode()).toBe('career')
  })
})

describe('leaving a table', () => {
  const exit = { finalStack: 2400, handsPlayed: 37, biggestPot: 1800 }

  it('Quick Play hands the profile back untouched, win or lose', () => {
    const profile = defaultProfile()
    expect(profileAfterTableExit(profile, { mode: 'quick', buyIn: 0 }, exit)).toBe(profile)
    expect(profileAfterTableExit(profile, { mode: 'quick', buyIn: 0 }, { ...exit, finalStack: 0 })).toBe(profile)
  })

  it('Quick Play leaves the saved profile exactly as it was', () => {
    const before = defaultProfile()
    saveProfile(before)
    saveProfile(profileAfterTableExit(loadProfile(), { mode: 'quick', buyIn: 0 }, exit))
    expect(loadProfile()).toEqual(before)
  })

  it('a cash game still settles against its buy-in', () => {
    const bought = applyBuyIn(defaultProfile(), 1000)
    const after = profileAfterTableExit(bought, { mode: 'cash', buyIn: 1000 }, exit)
    const expected = recordCashSession(bought, { buyIn: 1000, ...exit })
    expect(after.bankroll).toBe(expected.bankroll)
    expect(after.lifetime).toEqual(expected.lifetime)
    expect(after.history.map((h) => h.result)).toEqual([1400])
  })
})
