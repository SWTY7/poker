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

export const BUST_SKINS = ['#f1c9a0', '#d9a273', '#b87a4b', '#8a5a38', '#5c3a24', '#e8b98f']
export const BUST_HAIR = ['#1c1410', '#4a2a14', '#8a5a22', '#c9a24a', '#7a2a1a', '#d8d4cc']
export const BUST_BACKDROPS = ['#2f6f66', '#a23a5a', '#3a62a8', '#6a4aa8', '#a85a2a', '#3f7a3a', '#9a2f2f']

/** 0 short crop, 1 long, 2 fedora, 3 cap over short hair, 4 top knot. */
export type BustStyle = 0 | 1 | 2 | 3 | 4
/** 0 plain eyes, 1 shades, 2 round glasses. */
export type BustEyewear = 0 | 1 | 2

export interface BustSpec {
  skin: string
  hair: string
  backdrop: string
  style: BustStyle
  eyewear: BustEyewear
  shades: string
}

/** The same name always gives the same bust. */
export function bustSpec(name: string): BustSpec {
  const k = hashString(name)
  return {
    skin: BUST_SKINS[k % 6],
    hair: BUST_HAIR[(k >> 3) % 6],
    backdrop: BUST_BACKDROPS[(k >> 5) % 7],
    style: ((k >> 7) % 5) as BustStyle,
    eyewear: ((k >> 10) % 3) as BustEyewear,
    shades: (k >> 12) % 2 ? '#2a2a30' : '#e8e0cc',
  }
}
