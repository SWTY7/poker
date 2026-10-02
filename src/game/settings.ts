import { readEnum, writeString } from '../utils/storage'

/**
 * Settings that belong to this device. Right now: the look of the app. A
 * theme is a block of design tokens in `styles/themes.css`, picked by the
 * `data-theme` attribute on the page, so changing one never touches a screen.
 */

export interface Theme {
  id: ThemeId
  name: string
  description: string
  /** Three colours for the swatch on the settings screen: ground, felt, accent. */
  swatch: [string, string, string]
}

export type ThemeId = 'classic' | 'cardroom' | 'broadcast' | 'poster' | 'neon'

/** Classic is the look the app shipped with; it stays exactly as it was. */
export const THEMES: readonly Theme[] = [
  { id: 'classic', name: 'Classic', description: 'The original: near-black, brass and a serif.', swatch: ['#100e0c', '#1b3527', '#cdae70'] },
  { id: 'cardroom', name: 'Card room', description: 'Worn felt under a lamp, leather rail, brass.', swatch: ['#16100b', '#1f4a31', '#d9a24a'] },
  { id: 'broadcast', name: 'Broadcast', description: 'TV poker: bold condensed type, hot colour.', swatch: ['#0a0d14', '#12303a', '#ff4a3a'] },
  { id: 'poster', name: 'Poster', description: 'Light paper, flat colour, hard shadows.', swatch: ['#efe6d2', '#1f5a3d', '#e8452c'] },
  { id: 'neon', name: 'Neon', description: 'Retro casino sign: purple night, glowing pink.', swatch: ['#170a1f', '#0d4a45', '#ff4fa3'] },
]

export const THEME_STORAGE_KEY = 'poker.theme'

const IDS = THEMES.map((t) => t.id)

export function loadTheme(): ThemeId {
  return readEnum(THEME_STORAGE_KEY, IDS, 'classic')
}

/** Shows `theme` on the page and remembers it. */
export function setTheme(theme: ThemeId): void {
  applyTheme(theme)
  writeString(THEME_STORAGE_KEY, theme)
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme
}
