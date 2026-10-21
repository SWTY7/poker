/**
 * Chips drawn in CSS, for the Realistic theme (Classic hides them and keeps
 * its coin icon). Purely decorative: the amount is always written out beside
 * the pile, so nothing is carried by the chips alone. The pile maths lives in
 * chip-piles.ts.
 */
import type { Pile } from './chip-piles'

export function ChipPile({ piles, className = '' }: { piles: Pile[]; className?: string }) {
  if (piles.length === 0) return null
  return (
    <span className={`chip-pile ${className}`.trim()} aria-hidden="true">
      {piles.map((pile, p) => (
        <span key={p} className="chip-col" style={{ '--n': pile.count } as React.CSSProperties}>
          {Array.from({ length: pile.count }, (_, k) => (
            <i key={k} className={`chip chip-${pile.colour}`} style={{ '--k': k } as React.CSSProperties} />
          ))}
        </span>
      ))}
    </span>
  )
}
