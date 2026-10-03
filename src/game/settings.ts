import { readEnum, readJSON, writeJSON } from '../utils/storage'

/**
 * The look of the app, kept on this device. It is five independent choices,
 * each one a `data-*` attribute on <html> that `styles/themes.css` and
 * `styles/layout-round.css` answer to, so any colours go with any layout,
 * fonts, buttons and corners. A preset is just a saved set of the five.
 */

export type ColorId = 'classic' | 'cardroom' | 'broadcast' | 'poster' | 'neon'
export type LayoutId = 'standard' | 'round'
export type FontId = 'classic' | 'warm' | 'condensed' | 'grotesque' | 'rounded'
export type ButtonsId = 'standard' | 'brass' | 'caps' | 'hard' | 'glow'
export type CornersId = 'soft' | 'sharp' | 'square' | 'round'

export interface Look {
  color: ColorId
  layout: LayoutId
  font: FontId
  buttons: ButtonsId
  corners: CornersId
}

interface Option<Id extends string> {
  id: Id
  name: string
  description: string
}

export const COLORS: readonly (Option<ColorId> & { swatch: [string, string, string] })[] = [
  { id: 'classic', name: 'Classic', description: 'Near-black, felt green and brass.', swatch: ['#100e0c', '#1b3527', '#cdae70'] },
  { id: 'cardroom', name: 'Card room', description: 'Walnut, worn felt, warm brass.', swatch: ['#16100b', '#1f4a31', '#d9a24a'] },
  { id: 'broadcast', name: 'Broadcast', description: 'Midnight blue and signal red.', swatch: ['#0a0d14', '#12303a', '#ff4a3a'] },
  { id: 'poster', name: 'Poster', description: 'Light paper, flat green, vermilion.', swatch: ['#efe6d2', '#1f5a3d', '#e8452c'] },
  { id: 'neon', name: 'Neon', description: 'Purple night, glowing pink.', swatch: ['#170a1f', '#0d4a45', '#ff4fa3'] },
]

export const LAYOUTS: readonly Option<LayoutId>[] = [
  { id: 'standard', name: 'Standard', description: 'Seats in a row above the board. The original arrangement.' },
  { id: 'round', name: 'Round table', description: 'An oval table with the seats around its rail, and your cards at the bottom edge.' },
]

export const FONTS: readonly (Option<FontId> & { family: string })[] = [
  { id: 'classic', name: 'Classic serif', description: 'Source Serif and Space Mono.', family: "'Source Serif 4', Georgia, serif" },
  { id: 'warm', name: 'Warm serif', description: 'Fraunces, with quiet italic labels.', family: "'Fraunces', Georgia, serif" },
  { id: 'condensed', name: 'Condensed', description: 'Barlow Condensed, like TV graphics.', family: "'Barlow Condensed', 'Arial Narrow', sans-serif" },
  { id: 'grotesque', name: 'Grotesque', description: 'Bricolage Grotesque, a bold poster sans.', family: "'Bricolage Grotesque', system-ui, sans-serif" },
  { id: 'rounded', name: 'Rounded', description: 'Fredoka, friendly and chunky.', family: "'Fredoka', system-ui, sans-serif" },
]

export const BUTTONS: readonly Option<ButtonsId>[] = [
  { id: 'standard', name: 'Standard', description: 'Flat, with a thin outline.' },
  { id: 'brass', name: 'Brass and leather', description: 'Raised brass plates; Fold in oxblood.' },
  { id: 'caps', name: 'Capitals', description: 'Upper case, spaced out, squared off.' },
  { id: 'hard', name: 'Hard shadow', description: 'Heavy outline and an offset shadow that presses in.' },
  { id: 'glow', name: 'Glow', description: 'Lit from within, like a sign.' },
]

export const CORNERS: readonly Option<CornersId>[] = [
  { id: 'soft', name: 'Soft', description: 'Gently rounded.' },
  { id: 'sharp', name: 'Sharp', description: 'Barely rounded.' },
  { id: 'square', name: 'Square', description: 'Square corners.' },
  { id: 'round', name: 'Round', description: 'Big, pill-like curves.' },
]

export const DEFAULT_LOOK: Look = { color: 'classic', layout: 'standard', font: 'classic', buttons: 'standard', corners: 'soft' }

/** The five looks the app has been built with, each one a whole set of choices. */
export const PRESETS: readonly { id: string; name: string; description: string; look: Look }[] = [
  { id: 'classic', name: 'Classic', description: 'The original look.', look: DEFAULT_LOOK },
  { id: 'cardroom', name: 'Card room', description: 'An oval table under a lamp.', look: { color: 'cardroom', layout: 'round', font: 'warm', buttons: 'brass', corners: 'soft' } },
  { id: 'broadcast', name: 'Broadcast', description: 'TV poker.', look: { color: 'broadcast', layout: 'standard', font: 'condensed', buttons: 'caps', corners: 'sharp' } },
  { id: 'poster', name: 'Poster', description: 'Light paper and hard shadows.', look: { color: 'poster', layout: 'standard', font: 'grotesque', buttons: 'hard', corners: 'square' } },
  { id: 'neon', name: 'Neon', description: 'Retro casino sign.', look: { color: 'neon', layout: 'standard', font: 'rounded', buttons: 'glow', corners: 'round' } },
]

export function sameLook(a: Look, b: Look): boolean {
  return a.color === b.color && a.layout === b.layout && a.font === b.font && a.buttons === b.buttons && a.corners === b.corners
}

export const LOOK_STORAGE_KEY = 'poker.look'
/** The single theme the app had before the look was split into choices. */
const LEGACY_THEME_KEY = 'poker.theme'

/** The saved look; a value that isn't recognised falls back to the default for that choice. */
export function loadLook(): Look {
  const saved = readJSON<Partial<Look> | null>(LOOK_STORAGE_KEY, null)
  if (saved) {
    const pick = <T extends string>(value: unknown, options: readonly { id: T }[], fallback: T): T =>
      options.some((o) => o.id === value) ? (value as T) : fallback
    return {
      color: pick(saved.color, COLORS, DEFAULT_LOOK.color),
      layout: pick(saved.layout, LAYOUTS, DEFAULT_LOOK.layout),
      font: pick(saved.font, FONTS, DEFAULT_LOOK.font),
      buttons: pick(saved.buttons, BUTTONS, DEFAULT_LOOK.buttons),
      corners: pick(saved.corners, CORNERS, DEFAULT_LOOK.corners),
    }
  }
  // Someone who picked a theme before: that theme's whole look.
  const legacy = readEnum(LEGACY_THEME_KEY, PRESETS.map((p) => p.id), 'classic')
  return PRESETS.find((p) => p.id === legacy)?.look ?? DEFAULT_LOOK
}

let current: Look | null = null
const listeners = new Set<() => void>()

/** The look on the page now, for components that pick a layout (see `useSyncExternalStore`). */
export function getLook(): Look {
  return (current ??= loadLook())
}

export function subscribeLook(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Shows `look` on the page and remembers it. */
export function setLook(look: Look): void {
  current = look
  applyLook(look)
  writeJSON(LOOK_STORAGE_KEY, look)
  for (const listener of listeners) listener()
}

export function applyLook(look: Look): void {
  const root = document.documentElement.dataset
  root.color = look.color
  root.layout = look.layout
  root.font = look.font
  root.buttons = look.buttons
  root.corners = look.corners
}
