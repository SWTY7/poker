import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(resolve(__dirname, '../../src/styles/theme-classic.css'), 'utf8')
const TOKENS = readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf8')

type Vars = Record<string, string>

function block(css: string, selector: string): string {
  const start = css.indexOf(selector + ' {')
  if (start < 0) throw new Error(`no block for ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('\n}', open)
  return css.slice(open + 1, close)
}

function parseVars(body: string): Vars {
  const out: Vars = {}
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim().replace(/\s+/g, ' ')
  return out
}

const dark = parseVars(block(CSS, ":root[data-theme='classic'][data-mode='dark']"))
const light = parseVars(block(CSS, ":root[data-theme='classic'][data-mode='light']"))
const defaults = parseVars(block(TOKENS, ':root'))

function resolveVar(vars: Vars, name: string): string {
  let v = vars[name]
  if (v === undefined) throw new Error(`missing ${name}`)
  for (let i = 0; i < 5; i++) {
    const m = v.match(/^var\((--[\w-]+)\)$/)
    if (!m) break
    v = vars[m[1]]
  }
  return v
}

function toRgb(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  throw new Error(`not a plain hex colour: ${value}`)
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(vars: Vars, fg: string, bg: string): number {
  const a = luminance(toRgb(resolveVar(vars, fg)))
  const b = luminance(toRgb(resolveVar(vars, bg)))
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('classic theme tokens', () => {
  it('defines the same custom properties in dark and light', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort())
    expect(Object.keys(dark).length).toBeGreaterThan(40)
  })

  it('has tokens.css :root defaults equal to the dark values', () => {
    for (const [name, value] of Object.entries(dark)) {
      expect(defaults[name], name).toBe(value)
    }
  })

  const SURFACES = ['--bg', '--panel', '--hud-bg', '--seat-bg']
  const TEXTS = ['--text', '--text-dim', '--text-faint']
  const BODY_PAIRS: [string, string][] = [
    ...SURFACES.flatMap((s) => TEXTS.map((t): [string, string] => [t, s])),
    ...['--accent', '--green', '--red', '--gold', '--info', '--warn'].flatMap((t): [string, string][] => [
      [t, '--bg'],
      [t, '--panel'],
    ]),
    ['--text', '--felt'],
    ['--text-dim', '--felt'],
    ['--on-felt', '--felt'],
    ['--on-accent', '--accent'],
    ['--on-dealer', '--dealer-bg'],
    ['--card-red', '--card-face'],
    ['--card-black', '--card-face'],
  ]
  const UI_PAIRS: [string, string][] = [
    ['--focus', '--bg'],
    ['--focus', '--panel'],
    ['--seat-line', '--seat-bg'],
    ['--accent', '--felt'],
    ['--line', '--bg'],
  ]

  for (const [mode, vars] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    describe(mode, () => {
      for (const [fg, bg] of BODY_PAIRS) {
        it(`${fg} on ${bg} is at least 4.5:1`, () => {
          expect(contrast(vars, fg, bg)).toBeGreaterThanOrEqual(4.5)
        })
      }
      for (const [fg, bg] of UI_PAIRS) {
        it(`${fg} on ${bg} is at least 3:1`, () => {
          expect(contrast(vars, fg, bg)).toBeGreaterThanOrEqual(3)
        })
      }
    })
  }
})
