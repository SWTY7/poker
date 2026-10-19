import { useMemo } from 'react'
import { qrMatrix } from '../../home/p2p'

/** Modules of white around the code. Scanners need it; it is part of the code, not decoration. */
const QUIET = 4

/**
 * A QR code as SVG: dark modules on a white tile, in every theme (a dark
 * background would invert the code and most scanners would refuse it).
 * The colours live on `.nearby-qr`, which is fixed white and black on purpose.
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const matrix = useMemo(() => {
    try {
      return qrMatrix(text)
    } catch {
      return null
    }
  }, [text])
  if (!matrix) return null
  const size = matrix.length + QUIET * 2
  let path = ''
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + QUIET} ${y + QUIET}h1v1h-1z`
    }),
  )
  return (
    <svg className="nearby-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <path d={path} fill="currentColor" />
    </svg>
  )
}
