/**
 * A casino chip, colour-coded by denomination the way a real rack is —
 * white, red, green, black, purple, in the conventional order. This is
 * distinct from the little coin glyph (`CoinIcon`) that marks bets and pots
 * at the table: those are frequent, small, and already established, so they
 * stay a coin. This is for the two screens where a person is actually
 * choosing a stake — the lobby's bankroll and a buy-in tier — where the
 * point is exactly the thing chip colour has always been for: telling
 * denominations apart at a glance rather than reading every number.
 *
 * The colours are fixed hex values rather than design tokens on purpose.
 * A $5 chip is red in every cardroom regardless of house style, and tying
 * that to an accent colour that might change with a future theme would
 * break the one part of this that is supposed to be a universal convention.
 */

const THRESHOLDS: { max: number; face: string; rim: string; edge: string }[] = [
  { max: 24, face: '#f2efe6', rim: '#c7c2b4', edge: '#8a6a3c' }, // white — $1s
  { max: 99, face: '#a5333f', rim: '#7a2530', edge: '#f2efe6' }, // red — $5s
  { max: 499, face: '#3f7a52', rim: '#2c5a3a', edge: '#f2efe6' }, // green — $25s
  { max: 999, face: '#231f1c', rim: '#100e0c', edge: '#cdae70' }, // black — $100s
  { max: Infinity, face: '#5a3c7a', rim: '#3e2a56', edge: '#f2efe6' }, // purple — $500s and up
]

function chipColors(amount: number) {
  return THRESHOLDS.find((t) => amount <= t.max) ?? THRESHOLDS[THRESHOLDS.length - 1]
}

interface ChipIconProps {
  amount: number
  className?: string
}

/** The notched-edge disc every casino chip has, so it reads as a chip and not a coin or a button. */
export function ChipIcon({ amount, className }: ChipIconProps) {
  const { face, rim, edge } = chipColors(amount)
  const notches = 8
  const spokes = Array.from({ length: notches }, (_, i) => (360 / notches) * i)

  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill={rim} />
      {spokes.map((angle) => (
        <rect key={angle} x="14.5" y="1.5" width="3" height="7" fill={edge} transform={`rotate(${angle} 16 16)`} />
      ))}
      <circle cx="16" cy="16" r="10.5" fill={face} stroke={rim} strokeWidth="1.4" />
    </svg>
  )
}
