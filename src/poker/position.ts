import type { GameState } from './game-state'

export type PositionLabel =
  | 'BTN'
  | 'SB'
  | 'BB'
  | 'UTG'
  | 'UTG+1'
  | 'UTG+2'
  | 'MP'
  | 'MP+1'
  | 'MP+2'
  | 'HJ'
  | 'CO'

/**
 * Names for the seats between the big blind and the button, in the order they
 * act preflop, indexed by how many such seats there are.
 *
 * Shorter tables do not simply truncate the full-ring list: the seat next to
 * the blinds keeps its name (UTG) and the seat on the button's right keeps
 * its own (CO); it is the middle that collapses. That is why six-max reads
 * UTG / MP / CO rather than MP+1 / HJ / CO.
 */
const MIDDLE_SEATS: PositionLabel[][] = [
  [],
  ['CO'],
  ['UTG', 'CO'],
  ['UTG', 'MP', 'CO'],
  ['UTG', 'MP', 'HJ', 'CO'],
  ['UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
  ['UTG', 'UTG+1', 'MP', 'MP+1', 'HJ', 'CO'],
  ['UTG', 'UTG+1', 'UTG+2', 'MP', 'MP+1', 'HJ', 'CO'],
  ['UTG', 'UTG+1', 'UTG+2', 'MP', 'MP+1', 'MP+2', 'HJ', 'CO'],
]

/**
 * Maps each live seat to its poker position name. Heads-up has only the two
 * blinds, and the dealer is also the small blind.
 */
export function positionLabels(state: GameState): Map<string, PositionLabel> {
  const labels = new Map<string, PositionLabel>()
  const live = state.players.filter((p) => !p.isEliminated)
  if (live.length < 2 || state.dealerIndex < 0) return labels

  const button = state.players[state.dealerIndex]
  const smallBlind = state.players[state.smallBlindIndex]
  const bigBlind = state.players[state.bigBlindIndex]
  if (!button || !smallBlind || !bigBlind) return labels

  labels.set(smallBlind.id, 'SB')
  labels.set(bigBlind.id, 'BB')
  // Heads-up: the button posts the small blind, so 'BTN' would overwrite 'SB'.
  if (live.length > 2) labels.set(button.id, 'BTN')

  const n = state.players.length
  const between: string[] = []
  for (let step = 1; step <= n; step++) {
    const player = state.players[(state.bigBlindIndex + step) % n]
    if (player.id === button.id) break
    if (player.isEliminated) continue
    between.push(player.id)
  }

  const names = MIDDLE_SEATS[between.length] ?? MIDDLE_SEATS[MIDDLE_SEATS.length - 1]
  between.forEach((id, i) => {
    const name = names[i]
    if (name) labels.set(id, name)
  })

  return labels
}
