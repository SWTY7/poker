import type { GameState } from '../poker/game-state'
import { evaluateBestHand } from '../poker/hand-evaluator'
import { readJSON, writeJSON } from '../utils/storage'
import { CHAMPIONSHIP, TIERS, type CareerData } from './career'

/**
 * Career achievements. Each is earned once, and remembered with the date.
 * They're detected from what already happened (the hand as the engine left
 * it, a tournament's finish, the season before and after an event), so
 * nothing here watches the game as it's played. Quick Play and pass-and-play
 * earn none: Quick Play records nothing, and pass-and-play has no one "you".
 */

export type AchievementId =
  | 'first-pot'
  | 'seven-deuce'
  | 'hero-call'
  | 'bust-rival'
  | 'tournament-win'
  | 'season-win'
  | 'reach-regional'
  | 'reach-national'
  | 'reach-championship'
  | 'title'

export interface Achievement {
  id: AchievementId
  name: string
  description: string
}

/** In the order they're listed. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-pot', name: 'On the board', description: 'Win your first pot at a Career table.' },
  { id: 'seven-deuce', name: 'The worst hand', description: 'Win a pot holding 7-2.' },
  { id: 'hero-call', name: 'Hero call', description: 'Call a river bet with one pair or less, and win at showdown.' },
  { id: 'bust-rival', name: 'Sent home', description: 'Win the pot that busts a rival.' },
  { id: 'tournament-win', name: 'Last one standing', description: 'Win a tournament.' },
  { id: 'season-win', name: 'Top of the table', description: 'Finish a season first in the standings.' },
  { id: 'reach-regional', name: 'Regional', description: 'Get promoted out of Local.' },
  { id: 'reach-national', name: 'National', description: 'Get promoted out of Regional.' },
  { id: 'reach-championship', name: 'The Championship', description: 'Qualify for the Championship.' },
  { id: 'title', name: 'Champion', description: 'Win the Championship.' },
]

export interface AchievementsData {
  version: 1
  /** When each was earned (ISO date), by id. */
  earned: Partial<Record<AchievementId, string>>
}

export const ACHIEVEMENTS_STORAGE_KEY = 'poker.achievements'

export function loadAchievements(): AchievementsData {
  const raw = readJSON<Partial<AchievementsData>>(ACHIEVEMENTS_STORAGE_KEY, {})
  const known = new Set<string>(ACHIEVEMENTS.map((a) => a.id))
  const earned = Object.fromEntries(Object.entries(raw.earned ?? {}).filter(([id, date]) => known.has(id) && typeof date === 'string'))
  return { version: 1, earned }
}

export function saveAchievements(data: AchievementsData): void {
  writeJSON(ACHIEVEMENTS_STORAGE_KEY, data)
}

/** Records any of `ids` not already earned. `fresh` is the newly earned ones, for a toast. */
export function earn(data: AchievementsData, ids: AchievementId[], now: Date = new Date()): { data: AchievementsData; fresh: Achievement[] } {
  const fresh = ACHIEVEMENTS.filter((a) => ids.includes(a.id) && !data.earned[a.id])
  if (fresh.length === 0) return { data, fresh }
  const earned = { ...data.earned }
  for (const a of fresh) earned[a.id] = now.toISOString()
  return { data: { ...data, earned }, fresh }
}

/**
 * What one finished hand earned. `rivalIds` are the seats rivals sit in
 * (walk-ins aren't rivals). Call it once the hand is over.
 */
export function handAchievements(state: GameState, humanId: string, rivalIds: ReadonlySet<string>): AchievementId[] {
  const won = state.lastResults.some((r) => r.winnerIds.includes(humanId))
  if (!won) return []
  const ids: AchievementId[] = ['first-pot']
  const me = state.players.find((p) => p.id === humanId)
  const hole = me?.holeCards ?? []

  const ranks = hole.map((c) => c.rank).sort()
  if (ranks.length === 2 && ranks[0] === '2' && ranks[1] === '7') ids.push('seven-deuce')

  if (heroCalled(state, humanId) && hole.length === 2 && state.communityCards.length === 5) {
    const category = evaluateBestHand([...hole, ...state.communityCards]).category
    if (category === 'high-card' || category === 'pair') ids.push('hero-call')
  }

  // A rival who put chips in this hand and has none left went broke in it; you won (some of) it.
  const inThisHand = new Set(state.handLog.filter((e) => (e.amount ?? 0) > 0).map((e) => e.playerId))
  if (state.players.some((p) => rivalIds.has(p.id) && p.stack === 0 && inThisHand.has(p.id))) ids.push('bust-rival')

  return ids
}

/** You called a river bet (or raise) and the hand went on to a showdown. */
function heroCalled(state: GameState, humanId: string): boolean {
  const river = state.handLog.filter((e) => e.street === 'river' && e.kind === 'action')
  const call = river.findLastIndex((e) => e.playerId === humanId && e.actionType === 'call')
  if (call < 0) return false
  const facedBet = river
    .slice(0, call)
    .some((e) => e.playerId !== humanId && (e.actionType === 'bet' || e.actionType === 'raise' || e.actionType === 'all-in'))
  const showdown = state.handLog.some((e) => e.kind === 'reveal')
  return facedBet && showdown
}

/** What a finished tournament earned, by your place (1 is a win). */
export function tournamentAchievements(finish: number): AchievementId[] {
  return finish === 1 ? ['tournament-win'] : []
}

/** What closing a season earned: `after` is the career once the event was recorded. */
export function seasonAchievements(after: CareerData): AchievementId[] {
  const season = after.lastSeason
  if (!season) return []
  const ids: AchievementId[] = []
  if (season.place === 1) ids.push('season-win')
  if (season.result === 'title') ids.push('title')
  if (season.result === 'promoted') {
    const reached = TIERS[after.tier]?.name
    if (reached === 'Regional') ids.push('reach-regional')
    if (reached === 'National') ids.push('reach-national')
    if (after.tier === CHAMPIONSHIP) ids.push('reach-championship')
  }
  return ids
}
