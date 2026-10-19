import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_LOOK,
  LOOK_STORAGE_KEY,
  MODES,
  THEMES,
  applyLook,
  getLook,
  loadLook,
  setLook,
  subscribeLook,
} from '../../src/game/settings'

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
  // @ts-expect-error -- just enough of a page for applyLook
  globalThis.document = { documentElement: { dataset: {} as Record<string, string> } }
})

const dataset = () => document.documentElement.dataset as Record<string, string>

describe('the look', () => {
  it('opens on Classic, dark', () => {
    expect(loadLook()).toEqual(DEFAULT_LOOK)
    expect(DEFAULT_LOOK).toEqual({ theme: 'classic', mode: 'dark' })
  })

  it('remembers both choices as {theme, mode}', () => {
    setLook({ theme: 'realistic', mode: 'light' })
    expect(loadLook()).toEqual({ theme: 'realistic', mode: 'light' })
    expect(JSON.parse(localStorage.getItem(LOOK_STORAGE_KEY)!)).toEqual({ theme: 'realistic', mode: 'light' })
  })

  it('tells anything listening when the look changes', () => {
    let calls = 0
    const stop = subscribeLook(() => calls++)
    setLook({ theme: 'realistic', mode: 'dark' })
    expect(calls).toBe(1)
    expect(getLook().theme).toBe('realistic')
    stop()
    setLook(DEFAULT_LOOK)
    expect(calls).toBe(1)
  })

  it('falls back per field for a value it does not recognise', () => {
    localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify({ theme: 'realistic', mode: 'sepia' }))
    expect(loadLook()).toEqual({ theme: 'realistic', mode: 'dark' })
    localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify({ theme: 7, mode: 'light' }))
    expect(loadLook()).toEqual({ theme: 'classic', mode: 'light' })
    localStorage.setItem(LOOK_STORAGE_KEY, '"nonsense"')
    expect(loadLook()).toEqual(DEFAULT_LOOK)
    localStorage.setItem(LOOK_STORAGE_KEY, 'not json')
    expect(loadLook()).toEqual(DEFAULT_LOOK)
  })
})

describe('migration from older saved looks', () => {
  const old = (color: string, layout: string) =>
    JSON.stringify({ color, layout, font: 'warm', buttons: 'brass', corners: 'soft' })

  it('turns the round layout into Realistic, dark', () => {
    localStorage.setItem(LOOK_STORAGE_KEY, old('neon', 'round'))
    expect(loadLook()).toEqual({ theme: 'realistic', mode: 'dark' })
  })

  it('turns the Card room colours into Realistic, dark', () => {
    localStorage.setItem(LOOK_STORAGE_KEY, old('cardroom', 'standard'))
    expect(loadLook()).toEqual({ theme: 'realistic', mode: 'dark' })
  })

  it('turns anything else into Classic, dark', () => {
    localStorage.setItem(LOOK_STORAGE_KEY, old('broadcast', 'standard'))
    expect(loadLook()).toEqual({ theme: 'classic', mode: 'dark' })
  })

  it('reads the single legacy poker.theme', () => {
    localStorage.setItem('poker.theme', 'cardroom')
    expect(loadLook()).toEqual({ theme: 'realistic', mode: 'dark' })
    localStorage.setItem('poker.theme', 'neon')
    expect(loadLook()).toEqual({ theme: 'classic', mode: 'dark' })
  })

  it('prefers poker.look over the legacy key', () => {
    localStorage.setItem('poker.theme', 'cardroom')
    localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify({ theme: 'classic', mode: 'light' }))
    expect(loadLook()).toEqual({ theme: 'classic', mode: 'light' })
  })
})

describe('applyLook', () => {
  it('writes data-theme and data-mode, and a data-layout derived from the theme', () => {
    applyLook({ theme: 'realistic', mode: 'light' })
    expect(dataset()).toEqual({ theme: 'realistic', mode: 'light', layout: 'round' })
    applyLook({ theme: 'classic', mode: 'dark' })
    expect(dataset()).toEqual({ theme: 'classic', mode: 'dark', layout: 'standard' })
  })

  it('sets the status bar colour to the page background of each look', () => {
    const meta = { content: '', setAttribute(_: string, v: string) { this.content = v } }
    // @ts-expect-error -- test-only page shim with a theme-color meta
    document.querySelector = () => meta
    const cases: [Parameters<typeof applyLook>[0], string][] = [
      [{ theme: 'classic', mode: 'dark' }, '#1a1d24'],
      [{ theme: 'classic', mode: 'light' }, '#eef1f5'],
      [{ theme: 'realistic', mode: 'dark' }, '#0a0a0c'],
      [{ theme: 'realistic', mode: 'light' }, '#d9d4c8'],
    ]
    for (const [look, color] of cases) {
      applyLook(look)
      expect(meta.content).toBe(color)
    }
  })

  it('shows the look on the page when it is set', () => {
    setLook({ theme: 'realistic', mode: 'dark' })
    expect(dataset().theme).toBe('realistic')
  })
})

describe('the options', () => {
  it('list both themes and both modes with unique ids', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['classic', 'realistic'])
    expect(MODES.map((m) => m.id)).toEqual(['light', 'dark'])
    expect(THEMES[0].description).toBe('Slate and paper, plain and flat')
    expect(THEMES[1].description).toBe('A casino table with felt, leather and chips')
  })
})
