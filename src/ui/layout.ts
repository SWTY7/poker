/**
 * Seat 0 (the human player) is always at the bottom; other seats are spread
 * evenly around the ellipse in seat order. The dealer button then rotates
 * independently across these fixed visual seats, same as a real table.
 */
export function seatPosition(index: number, total: number): { left: number; top: number } {
  const angle = 90 - (index * 360) / total
  const rad = (angle * Math.PI) / 180
  const rx = 44
  const ry = 40
  return {
    left: 50 + rx * Math.cos(rad),
    top: 50 + ry * Math.sin(rad),
  }
}
