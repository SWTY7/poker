import { readJSON, writeJSON } from '../utils/storage'

/**
 * The look of the app, kept on this device. Two choices: a theme (how the
 * table and controls are drawn) and a mode (light or dark). Each is a `data-*`
 * attribute on <html> that the stylesheets answer to.
 */

export type Theme = 'classic' | 'realistic'
export type Mode = 'light' | 'dark'

export interface Look {
  theme: Theme
  mode: Mode
}

interface Option<Id extends string> {
  id: Id
  name: string
  description: string
}

export const THEMES: readonly Option<Theme>[] = [
  { id: 'classic', name: 'Classic', description: 'Slate and paper, plain and flat' },
  { id: 'realistic', name: 'Realistic', description: 'A casino table with felt, leather and chips' },
]

export const MODES: readonly Option<Mode>[] = [
  { id: 'light', name: 'Light', description: 'Bright surfaces' },
  { id: 'dark', name: 'Dark', description: 'Dim surfaces' },
]

export const DEFAULT_LOOK: Look = { theme: 'classic', mode: 'dark' }

export const LOOK_STORAGE_KEY = 'poker.look'
/** The single theme the app had before the look was split into choices. */
const LEGACY_THEME_KEY = 'poker.theme'

function pick<T extends string>(value: unknown, options: readonly { id: T }[], fallback: T): T {
  return options.some((o) => o.id === value) ? (value as T) : fallback
}

/** Reads the older five-choice shape (or the single legacy theme) as a theme. */
function themeFromOld(layout: unknown, color: unknown): Theme {
  return layout === 'round' || color === 'cardroom' ? 'realistic' : 'classic'
}

/** The saved look; a value that isn't recognised falls back to the default for that choice. */
export function loadLook(): Look {
  const saved = readJSON<Record<string, unknown> | null>(LOOK_STORAGE_KEY, null)
  if (saved && typeof saved === 'object') {
    if ('layout' in saved || 'color' in saved) {
      return { theme: themeFromOld(saved.layout, saved.color), mode: 'dark' }
    }
    return {
      theme: pick(saved.theme, THEMES, DEFAULT_LOOK.theme),
      mode: pick(saved.mode, MODES, DEFAULT_LOOK.mode),
    }
  }
  // Someone who picked a single theme before: 'cardroom' was the round table.
  let legacy: string | null = null
  try {
    legacy = localStorage.getItem(LEGACY_THEME_KEY)
  } catch {
    legacy = null
  }
  if (legacy) return { theme: themeFromOld(undefined, legacy), mode: 'dark' }
  return { ...DEFAULT_LOOK }
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
  root.theme = look.theme
  root.mode = look.mode
  // The round-table stylesheets still key on data-layout.
  root.layout = look.theme === 'realistic' ? 'round' : 'standard'
  // The status bar follows the page background (the --bg of each theme and mode).
  const meta = document.querySelector?.('meta[name="theme-color"]')
  meta?.setAttribute('content', THEME_COLOR[look.theme][look.mode])
}

/** Page background per theme and mode; keep equal to --bg in theme-classic.css and theme-realistic.css. */
const THEME_COLOR: Record<Look['theme'], Record<Look['mode'], string>> = {
  classic: { dark: '#1a1d24', light: '#eef1f5' },
  realistic: { dark: '#0a0a0c', light: '#d9d4c8' },
}
