import { beforeEach, describe, expect, it } from 'vitest'
import {
  BUTTONS,
  COLORS,
  CORNERS,
  DEFAULT_LOOK,
  FONTS,
  LAYOUTS,
  LOOK_STORAGE_KEY,
  PRESETS,
  loadLook,
  sameLook,
  setLook,
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

describe('the look', () => {
  it('opens on the original: classic colours, standard layout, classic serif, standard buttons, soft corners', () => {
    expect(loadLook()).toEqual(DEFAULT_LOOK)
    expect(DEFAULT_LOOK).toEqual({ color: 'classic', layout: 'standard', font: 'classic', buttons: 'standard', corners: 'soft' })
  })

  it('remembers each choice, and shows them all on the page', () => {
    const look = { color: 'neon', layout: 'round', font: 'warm', buttons: 'glow', corners: 'sharp' } as const
    setLook(look)
    expect(loadLook()).toEqual(look)
    expect(document.documentElement.dataset).toMatchObject(look)
  })

  it('lets one choice change without touching the others', () => {
    setLook({ ...DEFAULT_LOOK, color: 'poster' })
    expect(loadLook()).toEqual({ ...DEFAULT_LOOK, color: 'poster' })
  })

  it('falls back to the default for any one choice it does not recognise', () => {
    localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify({ color: 'neon', layout: 'hexagon', font: 7 }))
    expect(loadLook()).toEqual({ ...DEFAULT_LOOK, color: 'neon' })
  })

  it('carries over the single theme chosen before the look was split up', () => {
    localStorage.setItem('poker.theme', 'cardroom')
    expect(loadLook()).toEqual(PRESETS.find((p) => p.id === 'cardroom')!.look)
  })
})

describe('the presets and options', () => {
  it('start with Classic, and every preset uses only options that exist', () => {
    expect(PRESETS[0].look).toEqual(DEFAULT_LOOK)
    for (const { look } of PRESETS) {
      expect(COLORS.some((o) => o.id === look.color)).toBe(true)
      expect(LAYOUTS.some((o) => o.id === look.layout)).toBe(true)
      expect(FONTS.some((o) => o.id === look.font)).toBe(true)
      expect(BUTTONS.some((o) => o.id === look.buttons)).toBe(true)
      expect(CORNERS.some((o) => o.id === look.corners)).toBe(true)
    }
  })

  it('are told apart by sameLook, and the presets are all different', () => {
    expect(sameLook(DEFAULT_LOOK, { ...DEFAULT_LOOK })).toBe(true)
    expect(sameLook(DEFAULT_LOOK, { ...DEFAULT_LOOK, corners: 'round' })).toBe(false)
    const keys = PRESETS.map((p) => JSON.stringify(p.look))
    expect(new Set(keys).size).toBe(PRESETS.length)
  })

  it('have unique ids within each choice', () => {
    for (const options of [COLORS, LAYOUTS, FONTS, BUTTONS, CORNERS]) {
      expect(new Set(options.map((o) => o.id)).size).toBe(options.length)
    }
  })
})
