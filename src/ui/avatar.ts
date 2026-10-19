import type { CSSProperties } from 'react'

/**
 * Gradient pairs for the avatar disc, cycled by name hash so each player keeps a
 * stable color for the session. The initial is white on top, so every stop
 * (the lighter one included) keeps at least 4.5:1 against white; a test checks it.
 */
export const AVATAR_PALETTES: [string, string][] = [
  ['#447e77', '#2c5850'],
  ['#c24971', '#8f3f58'],
  ['#956e2e', '#8a6524'],
  ['#3a75c5', '#34568f'],
  ['#50813e', '#4a7a3a'],
  ['#be5353', '#8a3a3a'],
  ['#8160ce', '#5f4a9a'],
]

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export function avatarStyle(name: string): CSSProperties {
  const [from, to] = AVATAR_PALETTES[hashString(name) % AVATAR_PALETTES.length]
  return { background: `linear-gradient(155deg, ${from}, ${to})` }
}

export function avatarInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}
