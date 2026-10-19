/**
 * What goes over a data channel: one JSON message per frame. Browsers differ
 * on how big a message a data channel takes, so a long one (a table with an
 * undo history) is cut into chunks, `~<id>.<index>.<count>:<piece>`, and put
 * back together on the other side. A whole message always starts with `{`.
 */

/** The longest frame sent, in UTF-16 units. */
export const FRAME_MAX = 8000
/** Room in a chunk for its `~id.index.count:` header. */
const HEADER_ROOM = 32
/** The longest message accepted, in UTF-16 units. */
export const MESSAGE_MAX = 1_000_000
/** A message missing a chunk this long after its first is dropped. */
export const REASSEMBLE_MS = 10000
/** Messages being put together at once; more than this and the oldest goes. */
const MAX_PARTIAL = 8

const CHUNK = /^~(\w{1,8})\.(\d{1,5})\.(\d{1,5}):/

/** The frames to send for one message. */
export function toFrames(text: string, id: string): string[] {
  if (text.length <= FRAME_MAX) return [text]
  const pieces: string[] = []
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + FRAME_MAX - HEADER_ROOM, text.length)
    // Never cut an emoji in half: a lone surrogate doesn't survive the wire.
    if (end < text.length && /[\ud800-\udbff]/.test(text[end - 1])) end--
    pieces.push(text.slice(start, end))
    start = end
  }
  return pieces.map((piece, i) => `~${id}.${i}.${pieces.length}:${piece}`)
}

interface Pending {
  pieces: (string | undefined)[]
  have: number
  size: number
  startedAt: number
}

/** Puts frames back into messages. */
export class Reassembler {
  private readonly partial = new Map<string, Pending>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** The message this frame completes, or null if it needs more or isn't acceptable. */
  push(frame: string): string | null {
    if (frame.startsWith('{')) return frame.length <= MESSAGE_MAX ? frame : null
    const header = CHUNK.exec(frame)
    if (!header) return null
    const now = this.now()
    for (const [id, p] of this.partial) if (now - p.startedAt > REASSEMBLE_MS) this.partial.delete(id)
    const [, id, indexText, countText] = header
    const index = Number(indexText)
    const count = Number(countText)
    if (count < 2 || index >= count || count * (FRAME_MAX - HEADER_ROOM) > MESSAGE_MAX + FRAME_MAX) return null

    let entry = this.partial.get(id)
    if (!entry) {
      if (this.partial.size >= MAX_PARTIAL) this.partial.delete(this.partial.keys().next().value!)
      entry = { pieces: new Array<string | undefined>(count), have: 0, size: 0, startedAt: now }
      this.partial.set(id, entry)
    }
    if (entry.pieces.length !== count || entry.pieces[index] !== undefined) return null
    const piece = frame.slice(header[0].length)
    entry.pieces[index] = piece
    entry.have++
    entry.size += piece.length
    if (entry.size > MESSAGE_MAX) {
      this.partial.delete(id)
      return null
    }
    if (entry.have < count) return null
    this.partial.delete(id)
    return entry.pieces.join('')
  }
}
