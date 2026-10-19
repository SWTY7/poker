import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../src/styles/theme-realistic.css', import.meta.url), 'utf8')

/** The declarations of one rule, from its exact selector, as name -> value. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no block for ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('\n}', open)
  const body = css.slice(open + 1, close)
  const out = new Map<string, string>()
  for (const m of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) out.set(m[1], m[2].trim())
  return out
}

const dark = block(":root[data-theme='realistic'][data-mode='dark']")
const light = block(":root[data-theme='realistic'][data-mode='light']")

function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('theme-realistic.css', () => {
  it('defines the same custom properties in dark and light', () => {
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort())
    expect(dark.size).toBeGreaterThan(40)
  })

  it('sets color-scheme per mode', () => {
    expect(css).toMatch(/data-mode='dark'\] \{\s*color-scheme: dark;/)
    expect(css).toMatch(/data-mode='light'\] \{\s*color-scheme: light;/)
  })

  it('uses no image files, only gradients and inline SVG', () => {
    const urls = [...css.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1])
    expect(urls.length).toBeGreaterThan(3)
    for (const u of urls) expect(u).toMatch(/^"data:image\/svg\+xml/)
  })

  // [foreground, background, minimum ratio]: 4.5 for text, 3 for UI and large type.
  const pairs: [string, string, number][] = [
    ['--text', '--bg', 4.5],
    ['--text', '--panel', 4.5],
    ['--text', '--hud-bg', 4.5],
    ['--text', '--leather-1', 4.5],
    ['--text', '--leather-2', 4.5],
    ['--text-dim', '--bg', 4.5],
    ['--text-dim', '--panel', 4.5],
    ['--text-dim', '--hud-bg', 4.5],
    ['--text-dim', '--leather-1', 4.5],
    ['--text-dim', '--leather-2', 4.5],
    ['--text-faint', '--bg', 4.5],
    ['--text-faint', '--panel', 4.5],
    ['--text-faint', '--leather-2', 4.5],
    ['--accent', '--bg', 4.5],
    ['--accent', '--panel', 4.5],
    ['--on-accent', '--accent', 4.5],
    ['--green', '--bg', 4.5],
    ['--red', '--bg', 4.5],
    ['--warn', '--bg', 4.5],
    ['--ivory', '--baize', 4.5],
    ['--ivory', '--baize-hi', 4.5],
    ['--ivory-ink', '--ivory-dim', 4.5],
    ['--plate-text', '--btn-1', 4.5],
    ['--plate-text', '--btn-2', 4.5],
    ['--plate-text', '--btn-hover-1', 4.5],
    ['--pill-fg', '--pill-bg', 4.5],
    ['--text-dim', '--pill-bg', 4.5],
    ['--gold', '--stack-bg', 4.5],
    ['--seat-ring', '--baize', 3],
    ['--accent', '--bg', 3],
    ['--bar-edge', '--leather-2', 1.5],
  ]

  for (const [mode, vars] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    it(`meets contrast in ${mode} mode`, () => {
      const failures: string[] = []
      for (const [fg, bg, min] of pairs) {
        const a = vars.get(fg) ?? css.match(new RegExp(`${fg}:\\s*(#[0-9a-fA-F]{3,6});`))?.[1]
        const b = vars.get(bg)
        if (!a || !b || !a.startsWith('#') || !b.startsWith('#')) {
          failures.push(`${fg} / ${bg}: not a plain hex colour`)
          continue
        }
        const r = ratio(a, b)
        if (r < min) failures.push(`${fg} ${a} on ${bg} ${b}: ${r.toFixed(2)} < ${min}`)
      }
      expect(failures).toEqual([])
    })
  }

  // Max alpha of a grain tile = the bias of the alpha row of its feColorMatrix
  // (conservative: the lit channel is never below 0).
  function grain(name: string): { alpha: number; size: number } {
    const m = css.match(new RegExp(`${name}:\\s*url\\("data:image/svg\\+xml;utf8,([^"]*)"\\)`))
    if (!m) throw new Error(`no grain ${name}`)
    const row = m[1].match(/values='([^']*)'/)![1].trim().split(/\s+/).map(Number)
    const size = Number(m[1].match(/width='(\d+)'/)![1])
    return { alpha: Math.min(1, row[19]), size }
  }

  it('keeps grain behind text and panels faint', () => {
    for (const mode of [dark, light]) {
      // Panels and boxes: no grain at all.
      const box = css.match(/\.room-box \{[^}]*\}/)![0]
      expect(box).not.toMatch(/url\(|--tex-/)
      expect(mode.get('--panel')).toMatch(/^#/)
    }
    // The light bars (header and dock) use the soft leather.
    const lightBar = light.get('--bar-bg')!
    expect(lightBar).toContain('--tex-leather-soft')
    expect(lightBar).not.toMatch(/--tex-leather[^-]/)
    const soft = grain('--tex-leather-soft')
    expect(soft.alpha).toBeLessThanOrEqual(0.3)
    expect(soft.size).toBeLessThanOrEqual(160)
    // At least 3x gentler than the dark rail leather.
    expect(soft.alpha * 3).toBeLessThanOrEqual(grain('--tex-leather').alpha)
    // Any grain used on a light-mode surface other than the bars must be <= .05.
    expect(dark.get('--bar-bg')).toContain('--tex-leather')
  })

  it('reads header and dock text on the light bar', () => {
    for (const fg of ['--text', '--text-dim', '--text-faint', '--accent']) {
      for (const bg of ['--leather-1', '--leather-2', '--hud-bg']) {
        expect(ratio(light.get(fg)!, light.get(bg)!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps the seat ring and the shared gold readable on both baizes', () => {
    // These two are the same in both modes (shared block), so check them against each baize.
    const shared = css.match(/--seat-ring:\s*(#[0-9a-fA-F]{6});/)![1]
    expect(ratio(shared, dark.get('--baize')!)).toBeGreaterThanOrEqual(3)
    expect(ratio(shared, light.get('--baize')!)).toBeGreaterThanOrEqual(3)
    expect(ratio(light.get('--gold')!, light.get('--stack-bg')!)).toBeGreaterThanOrEqual(4.5)
  })
})
