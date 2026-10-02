import type { ActionType } from '../poker/game-state'
import type { PsychProfile } from '../ai/psychology/profile'

/**
 * Timing tells, for Career: how long a character takes to act depends on the
 * decision and on who they are. A close decision takes longer than an obvious
 * one, and each character has their own tempo. Nothing here is random, so a
 * character's pattern is the same every time and can be learned: if Tomas
 * tanks and then bets, he was torn; if he snaps, he wasn't.
 *
 * Who gives away more: a studied player (high discipline) keeps a steadier
 * rhythm, the way a pro acts in about the same time whatever they hold. A
 * recreational player's timing swings with how hard the spot is. Deeper
 * thinkers (higher level) are slower across the board.
 */

export interface Tempo {
  /** Multiplies every pause: under 1 is quick, over 1 deliberate. */
  pace: number
  /** 0..1, how much a decision's difficulty shows in its timing. */
  tell: number
}

/** The base pause for each kind of action, in ms, before tempo. Bigger moves take a beat longer. */
const BASE_TIME: Record<ActionType, number> = {
  fold: 340,
  check: 420,
  call: 620,
  bet: 900,
  raise: 950,
  'all-in': 1200,
}

/** A margin (in pots, see PsychBot's `DecisionInfo`) this size or more is an easy call. */
const EASY_MARGIN = 0.25
/** At the hardest decision, the pause stretches by up to this much on top of the base (for a full tell). */
const TANK = 2.2
/** At the easiest, it shrinks by up to this fraction (for a full tell). */
const SNAP = 0.45

/** A steady 0..1 number from a string, so the same character always gets the same quirk. */
function hashUnit(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/** A character's tempo. `key` names the character (a rival's id, or a walk-in's name). */
export function tempoFor(profile: Pick<PsychProfile, 'discipline' | 'level'>, key: string): Tempo {
  const quirk = hashUnit(key)
  const pace = (0.75 + 0.5 * quirk) * (0.9 + 0.1 * Math.min(Math.max(profile.level, 0), 3))
  const tell = Math.min(Math.max(1 - 0.75 * profile.discipline, 0.15), 1)
  return { pace, tell }
}

/**
 * How long a decision takes, in ms, before the table's speed setting.
 * `margin` is how close it was (null: there was only one kind of thing to do,
 * which is never hard).
 */
export function thinkTime(type: ActionType, margin: number | null, tempo: Tempo): number {
  const ease = margin === null ? 1 : Math.min(Math.max(margin / EASY_MARGIN, 0), 1)
  // Hard decisions (ease 0) stretch; easy ones (ease 1) snap; the tell scales both.
  const difficulty = (1 - ease) * TANK - ease * SNAP
  return Math.round(BASE_TIME[type] * tempo.pace * (1 + tempo.tell * difficulty))
}

/** Today's fixed pacing, for tables without timing tells (Quick Play, cash and pass-and-play outside Career). */
export function fixedThinkTime(type: ActionType): number {
  return BASE_TIME[type]
}
