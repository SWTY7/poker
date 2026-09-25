import { RANK_COUNT, SUIT_COUNT, rankOf, suitOf, type CardInt } from '../../poker/fast/cards'

/**
 * A coarse classification of what kind of board this is, not which board it
 * is.
 *
 * Three prior attempts at board-aware postflop keying (see
 * docs/cfr-distillation-plan.md's phase 1 log) all put the board's own
 * canonical identity in the information-set key, at whatever resolution —
 * and all failed the same way: there are so many distinct canonical boards
 * that almost none of them get visited more than once or twice within an
 * affordable training run, so the key space grows without bound regardless
 * of how coarsely a hand is described within a board. This sidesteps that by
 * never keying on board identity at all — only on which of a small, fixed
 * number of texture categories the board falls into, the same three things a
 * human player reads a board for: how flush-possible it is, how paired it
 * is, how straight-possible it is. Many different boards share a category,
 * the same way many different hands already share a strength bucket, so this
 * is bounded the way that is, not the way canonical-board-keying wasn't.
 */
export const TEXTURE_COUNT = 27

export function textureOf(board: readonly CardInt[]): number {
  const suitCounts = new Array(SUIT_COUNT).fill(0)
  const rankCounts = new Array(RANK_COUNT).fill(0)
  for (const card of board) {
    suitCounts[suitOf(card)]++
    rankCounts[rankOf(card)]++
  }

  // 0 rainbow, 1 two-tone, 2 flush-heavy (three or more of one suit).
  const flush = Math.min(Math.max(...suitCounts) - 1, 2)
  // 0 unpaired, 1 one pair, 2 trips or better.
  const paired = Math.min(Math.max(...rankCounts) - 1, 2)

  // How much wider than the tightest possible run the board's own ranks
  // span — 0 means the distinct ranks are already consecutive.
  const ranks = [...new Set(board.map(rankOf))].sort((a, b) => a - b)
  const spread = ranks[ranks.length - 1] - ranks[0] - (ranks.length - 1)
  // 0 coordinated (straights already live or one card away), 1 semi, 2 dry.
  const straight = spread <= 1 ? 0 : spread <= 4 ? 1 : 2

  return (flush * 3 + paired) * 3 + straight
}
