import type { CSSProperties } from 'react'

/** Gradient pairs picked for contrast against the dark table, cycled by name hash so each player keeps a stable color for the session. */
const AVATAR_PALETTES: [string, string][] = [
  ['#4a8a82', '#2c5850'],
  ['#cf6f8f', '#8f3f58'],
  ['#c99a4e', '#8a6524'],
  ['#5f8fd0', '#34568f'],
  ['#7fb86b', '#4a7a3a'],
  ['#c76b6b', '#8a3a3a'],
  ['#9a7fd8', '#5f4a9a'],
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
