import { beforeEach, describe, expect, it } from 'vitest'
import { THEMES, THEME_STORAGE_KEY, loadTheme, setTheme } from '../../src/game/settings'

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
}

beforeEach(() => {
  // @ts-expect-error -- test-only global shim
  globalThis.localStorage = new MemoryStorage()
  // @ts-expect-error -- just enough of a page for applyTheme
  globalThis.document = { documentElement: { dataset: {} as Record<string, string> } }
})

describe('themes', () => {
  it('open on Classic, the look the app shipped with', () => {
    expect(loadTheme()).toBe('classic')
    expect(THEMES[0].id).toBe('classic')
  })

  it('remember the pick, and show it on the page', () => {
    setTheme('neon')
    expect(loadTheme()).toBe('neon')
    expect(document.documentElement.dataset.theme).toBe('neon')
  })

  it('fall back to Classic when the saved value is unknown', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'not-a-theme')
    expect(loadTheme()).toBe('classic')
  })

  it('each have a name, a description and three swatch colours', () => {
    for (const theme of THEMES) {
      expect(theme.name).not.toBe('')
      expect(theme.description).not.toBe('')
      expect(theme.swatch).toHaveLength(3)
    }
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length)
  })
})
