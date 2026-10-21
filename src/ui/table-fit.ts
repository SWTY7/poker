/**
 * How tall the felt has to be for a crowded round table (8-10 players, so 7-9
 * opponents) on a phone in portrait. Owner decision (RUN.md): no player cap;
 * the table scrolls vertically and keeps every seat.
 *
 * Budget at 375x667 (portrait phone), approximate:
 *   header 56-72 + hero panel ~120 + action dock ~110 + gaps/padding ~50
 *   => about 310-330px left for the felt. A 9-opponent ring does not fit that,
 *   so the felt keeps at least `minFeltHeight()` px and the area above the
 *   sticky hero/buttons scrolls.
 *
 * The seat minimum is the smallest readable chip the CSS already uses for
 * 6+ opponents on a phone: avatar 1.7rem, name/stack 2xs text, chip about
 * 56px wide and 64px tall (21px above the anchor point, 43px below it).
 * Seats are laid out exactly like layout-round.css: an ellipse (rx, ry, cy as
 * fractions of the felt) over a 290deg arc centred on straight up, each seat
 * nudged by the same small deterministic jitter, and the two side seats
 * dropped by cos^6 * rdrop. The board and pot occupy a 200x112px box at the
 * ellipse centre.
 *
 * The CSS in layout-round.css (`.table-main[data-crowded]`) must use the same
 * numbers as RING below.
 */

export const RING = { rx: 0.4, ry: 0.4, cy: 0.5, rdrop: 0.06, span: 290 }
export const SEAT_BOX = { w: 56, above: 21, below: 43 }
/**
 * The Realistic theme's phone seat: a portrait over a plate, measured in a
 * browser at 6-9 opponents (about 69x71px, shifted up 1.3rem, so 21px above the
 * anchor and 50px below). Classic keeps SEAT_BOX.
 */
export const SEAT_BOX_REALISTIC = { w: 70, above: 21, below: 50 }
export type SeatBox = typeof SEAT_BOX

/** The seat box of the theme on screen (read from data-theme), so callers need not pass it. */
export function currentSeatBox(): SeatBox {
  const theme = typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme
  return theme === 'realistic' ? SEAT_BOX_REALISTIC : SEAT_BOX
}
export const BOARD_BOX = { w: 200, h: 112 }
/** Breathing room kept between any two boxes, in px. */
const GAP = 2

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/** Seat boxes for `seats` opponents on a felt of the given size, in px. */
export function seatBoxes(seats: number, width: number, height: number, box: SeatBox = currentSeatBox()): Box[] {
  const step = Math.min(60, RING.span / seats)
  const boxes: Box[] = []
  for (let i = 0; i < seats; i++) {
    const a = ((270 + (i - (seats - 1) / 2) * step) * Math.PI) / 180
    const j = Math.sin(i * 2.4 + 0.7)
    const c = Math.cos(a)
    const drop = c ** 6 * RING.rdrop
    const x = width * 0.5 + c * RING.rx * width * (1 + j * 0.035)
    const y = height * (RING.cy + drop) + Math.sin(a) * RING.ry * height * (1 + j * 0.035)
    boxes.push({
      left: x - box.w / 2,
      right: x + box.w / 2,
      top: y - box.above,
      bottom: y + box.below,
    })
  }
  return boxes
}

export function boardBox(width: number, height: number): Box {
  const cx = width / 2
  const cy = height * RING.cy
  return { left: cx - BOARD_BOX.w / 2, right: cx + BOARD_BOX.w / 2, top: cy - BOARD_BOX.h / 2, bottom: cy + BOARD_BOX.h / 2 }
}

function overlap(a: Box, b: Box): boolean {
  return a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP
}

/** True when every seat is inside the felt and touches no other seat or the board. */
export function layoutFits(seats: number, width: number, height: number, seat: SeatBox = currentSeatBox()): boolean {
  const boxes = seatBoxes(seats, width, height, seat)
  const board = boardBox(width, height)
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (b.left < 0 || b.right > width || b.top < 0 || b.bottom > height) return false
    if (overlap(b, board)) return false
    for (let k = i + 1; k < boxes.length; k++) if (overlap(b, boxes[k])) return false
  }
  return true
}

/**
 * Smallest felt height (px, multiple of 4) where nothing overlaps, never less
 * than `floor`. Gives up at `ceiling` and returns that, so the table still
 * renders (and scrolls) rather than failing.
 */
export function minFeltHeight(
  seats: number,
  width: number,
  floor = 320,
  ceiling = 1400,
  seat: SeatBox = currentSeatBox(),
): number {
  for (let h = Math.ceil(floor / 4) * 4; h <= ceiling; h += 4) {
    if (layoutFits(seats, width, h, seat)) return h
  }
  return ceiling
}

/** Opponent count from which a phone-portrait round table scrolls (8+ players). */
export const CROWDED_FROM = 7
