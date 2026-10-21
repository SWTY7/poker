import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { bustSpec } from '../../src/ui/avatar'
import { Avatar } from '../../src/ui/AvatarBust'
import { Seat } from '../../src/ui/Seat'

const NAMES = Array.from({ length: 400 }, (_, i) => `Player ${i} ${String.fromCharCode(65 + (i % 26))}`)

describe('bust avatar', () => {
  it('gives the same spec for the same name', () => {
    expect(bustSpec('Coco')).toEqual(bustSpec('Coco'))
    expect(renderToStaticMarkup(<Avatar name="Coco" />)).toBe(renderToStaticMarkup(<Avatar name="Coco" />))
  })

  it('reaches every hair/hat style, eyewear option, skin and backdrop', () => {
    const specs = NAMES.map(bustSpec)
    expect(new Set(specs.map((s) => s.style))).toEqual(new Set([0, 1, 2, 3, 4]))
    expect(new Set(specs.map((s) => s.eyewear))).toEqual(new Set([0, 1, 2]))
    expect(new Set(specs.map((s) => s.skin)).size).toBe(6)
    expect(new Set(specs.map((s) => s.backdrop)).size).toBe(7)
  })

  it('has no external references', () => {
    for (const n of NAMES) {
      const svg = renderToStaticMarkup(<Avatar name={n} />)
      expect(svg).not.toMatch(/href|url\(|<image|http/i)
      expect(svg).toContain('aria-hidden="true"')
    }
  })

  it('is rendered by Seat next to the initial', () => {
    const html = renderToStaticMarkup(
      <Seat
        name="Coco"
        stack={1000}
        betThisStreet={0}
        folded={false}
        isAllIn={false}
        isEliminated={false}
        isDealer={false}
        isSmallBlind={false}
        isBigBlind={false}
        isCurrentTurn={false}
        isWinner={false}
        cards={[]}
        revealCards={false}
      />,
    )
    expect(html).toContain('avatar-bust')
    expect(html).toContain('avatar-initial')
  })
})
