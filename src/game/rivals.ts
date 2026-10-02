import type { GameState } from '../poker/game-state'
import { CAST, randomizeProfile, type PsychProfile } from '../ai/psychology/profile'
import type { PsychBot } from '../ai/psychology/psych-bot'
import { OpponentModel, showdownOf, type OpponentModelData } from '../ai/psychology/opponent-model'
import { createRng, shuffle, type Rng } from '../utils/random'
import { readJSON, writeJSON } from '../utils/storage'

/**
 * Rivals: a fixed roster of characters who remember you, and whom you get to
 * remember, across sessions. Everything learned in both directions comes from
 * what anyone at the table could see — public actions and cards turned over at
 * showdown — the same information the bots get.
 *
 * Not everyone at a Career table is a rival. Some seats go to walk-ins: a
 * random character with a random name, never seen before and never
 * remembered. A rival is recognisable; a walk-in is an unknown.
 */

export interface Rival {
  id: string
  name: string
  /** Which `CAST` character this rival is built on, by its profile name. */
  archetype: string
  /**
   * Fixes the rival's own jitter on that archetype (`randomizeProfile`), so
   * Nadia plays like Nadia every time rather than a fresh draw of her type.
   */
  seed: number
}

/** Twelve regulars across the cast's seven characters. */
export const ROSTER: readonly Rival[] = [
  { id: 'nadia', name: 'Nadia', archetype: 'Iris', seed: 0x51a7e1 },
  { id: 'otto', name: 'Otto', archetype: 'Iris', seed: 0x0770 },
  { id: 'rosa', name: 'Rosa', archetype: 'Vera', seed: 0x2054 },
  { id: 'gus', name: 'Gus', archetype: 'Vera', seed: 0x6a5 },
  { id: 'jax', name: 'Jax', archetype: 'Rex', seed: 0x1a3 },
  { id: 'mona', name: 'Mona', archetype: 'Rex', seed: 0x40a },
  { id: 'wes', name: 'Wes', archetype: 'Marlowe', seed: 0x3e5 },
  { id: 'lina', name: 'Lina', archetype: 'Marlowe', seed: 0x11aa },
  { id: 'hal', name: 'Hal', archetype: 'Dorothy', seed: 0x4a1 },
  { id: 'pia', name: 'Pia', archetype: 'Bunny', seed: 0x919 },
  { id: 'tomas', name: 'Tomas', archetype: 'Bunny', seed: 0x70a5 },
  { id: 'eli', name: 'Eli', archetype: 'Ambrose', seed: 0xe11 },
]

/** Names for walk-ins, apart from the roster so a stranger is never mistaken for someone you know. */
export const WALK_IN_NAMES: readonly string[] = ['Sam', 'Kit', 'Dee', 'Ray', 'Jo', 'Max', 'Bea', 'Cal', 'Fay', 'Ned', 'Ivy', 'Lou']

function archetypeProfile(name: string): PsychProfile {
  return CAST.find((p) => p.name === name) ?? CAST[0]
}

/** A rival's playing character: the same every time, by construction. */
export function rivalProfile(rival: Rival): PsychProfile {
  return randomizeProfile(archetypeProfile(rival.archetype), createRng(rival.seed))
}

// ---------- what is remembered ----------

/** Counts from public play only. Rates are read off these, never stored. */
export interface PublicStats {
  hands: number
  /** Hands where they put money in before the flop by choice (a blind isn't a choice). */
  vpip: number
  /** Hands where they bet or raised before the flop. */
  pfr: number
  actions: number
  aggressive: number
  facedBet: number
  foldedToBet: number
  /** River bets seen at showdown, and how many of those were bluffs (scored the way the bots score them). */
  riverBetsShown: number
  riverBluffsShown: number
}

export interface RivalRecord {
  stats: PublicStats
  /** Chips you have won from this rival, lifetime; negative when they are ahead. */
  netVsYou: number
  sessions: number
  /** The table's read on you, saved from the last session this rival sat in. */
  readOnYou: OpponentModelData | null
  /**
   * How hot they arrive next time, 0..1, on `PsychBot.startTilted`'s scale:
   * busted by you, a big pot lost to you, or simply still steaming when the
   * session ended.
   */
  carryTilt: number
}

export interface RivalsData {
  version: 1
  rivals: Record<string, RivalRecord>
}

export const RIVALS_STORAGE_KEY = 'poker.rivals'

const emptyStats = (): PublicStats => ({
  hands: 0,
  vpip: 0,
  pfr: 0,
  actions: 0,
  aggressive: 0,
  facedBet: 0,
  foldedToBet: 0,
  riverBetsShown: 0,
  riverBluffsShown: 0,
})

export function emptyRecord(): RivalRecord {
  return { stats: emptyStats(), netVsYou: 0, sessions: 0, readOnYou: null, carryTilt: 0 }
}

export function emptyRivals(): RivalsData {
  return { version: 1, rivals: {} }
}

function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0
}

/** Anything unrecognisable becomes a fresh start for that rival, not a crash. */
export function migrateRivals(raw: unknown): RivalsData {
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return emptyRivals()
  const saved = (raw as { rivals?: unknown }).rivals
  const data = emptyRivals()
  if (!saved || typeof saved !== 'object') return data
  for (const rival of ROSTER) {
    const r = (saved as Record<string, Partial<RivalRecord> | undefined>)[rival.id]
    if (!r || typeof r !== 'object') continue
    const stats = emptyStats()
    for (const key of Object.keys(stats) as (keyof PublicStats)[]) stats[key] = num(r.stats?.[key])
    data.rivals[rival.id] = {
      stats,
      netVsYou: num(r.netVsYou),
      sessions: num(r.sessions),
      readOnYou: r.readOnYou && typeof r.readOnYou === 'object' ? r.readOnYou : null,
      carryTilt: Math.min(Math.max(num(r.carryTilt), 0), 1),
    }
  }
  return data
}

export function loadRivals(): RivalsData {
  return migrateRivals(readJSON<unknown>(RIVALS_STORAGE_KEY, null))
}

export function saveRivals(data: RivalsData): void {
  writeJSON(RIVALS_STORAGE_KEY, data)
}

// ---------- reading one finished hand ----------

const VOLUNTARY = new Set(['call', 'bet', 'raise', 'all-in'])
const AGGRESSIVE = new Set(['bet', 'raise', 'all-in'])

/**
 * What one player showed in one finished hand, as counts. Actions are the
 * engine's own record of voluntary actions (blinds aren't in it), each
 * stamped with its street; whether an action faced a bet is rebuilt by
 * walking each street's betting from the blinds up.
 */
export function handStats(state: GameState, playerId: string): PublicStats {
  const stats = emptyStats()
  const dealtIn = state.players.some((p) => p.id === playerId && p.holeCards.length === 2)
  if (!dealtIn) return stats
  stats.hands = 1

  let street = 'preflop'
  let toMatch = 0
  const committed = new Map<string, number>()
  for (const entry of state.handLog) {
    if (entry.kind !== 'blind' || !entry.playerId) continue
    committed.set(entry.playerId, entry.amount ?? 0)
    toMatch = Math.max(toMatch, entry.amount ?? 0)
  }

  let vpip = false
  let pfr = false
  for (const action of state.actionHistory) {
    const actionStreet = action.street ?? 'preflop'
    if (actionStreet !== street) {
      street = actionStreet
      toMatch = 0
      committed.clear()
    }
    const facing = toMatch - (committed.get(action.playerId) ?? 0) > 0
    if (action.playerId === playerId) {
      stats.actions++
      if (AGGRESSIVE.has(action.type)) stats.aggressive++
      if (facing) {
        stats.facedBet++
        if (action.type === 'fold') stats.foldedToBet++
      }
      if (street === 'preflop') {
        if (VOLUNTARY.has(action.type)) vpip = true
        if (AGGRESSIVE.has(action.type)) pfr = true
      }
    }
    if (action.type === 'call') committed.set(action.playerId, toMatch)
    else if (AGGRESSIVE.has(action.type) && action.amount !== undefined) {
      committed.set(action.playerId, action.amount)
      toMatch = Math.max(toMatch, action.amount)
    }
  }
  stats.vpip = vpip ? 1 : 0
  stats.pfr = pfr ? 1 : 0

  const showdown = showdownOf(state)
  if (showdown) {
    // Scored exactly as the bots score a shown bet, by running this one
    // showdown through a throwaway read.
    const scratch = new OpponentModel()
    scratch.observeShowdown(showdown)
    const tally = scratch.toJSON([playerId]).players[playerId]?.shown
    if (tally) {
      stats.riverBetsShown = tally.small.bets + tally.large.bets
      stats.riverBluffsShown = tally.small.bluffs + tally.large.bluffs
    }
  }
  return stats
}

/** Each player's chips won minus chips put in, for the hand that just finished. */
export function handNet(state: GameState): Map<string, number> {
  const net = new Map<string, number>()
  for (const player of state.players) net.set(player.id, -player.totalContributed)
  for (const result of state.lastResults) {
    const share = result.potAmount / result.winnerIds.length
    for (const id of result.winnerIds) net.set(id, (net.get(id) ?? 0) + share)
  }
  return net
}

/**
 * Chips `heroId` took from `otherId` this hand (negative: lost to them).
 * Heads-up that is exact. Multiway, a winner's gain is split across the
 * losers in proportion to what each lost, which keeps the books balanced:
 * every chip anyone lost is owed to someone who won it.
 */
export function netBetween(net: Map<string, number>, heroId: string, otherId: string): number {
  const hero = net.get(heroId) ?? 0
  const other = net.get(otherId) ?? 0
  if (hero > 0 && other < 0) {
    const losses = [...net.values()].filter((v) => v < 0).reduce((s, v) => s - v, 0)
    return losses > 0 ? (hero * -other) / losses : 0
  }
  if (hero < 0 && other > 0) {
    const gains = [...net.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0)
    return gains > 0 ? -(-hero * other) / gains : 0
  }
  return 0
}

export function addStats(a: PublicStats, b: PublicStats): PublicStats {
  const sum = emptyStats()
  for (const key of Object.keys(sum) as (keyof PublicStats)[]) sum[key] = a[key] + b[key]
  return sum
}

// ---------- seating a table ----------

/** How much a saved read still weighs one sitting later. */
export const READ_DECAY = 0.7

export type SeatPlan =
  | { kind: 'rival'; rival: Rival; profile: PsychProfile; name: string }
  | { kind: 'walk-in'; profile: PsychProfile; name: string }

/**
 * How many of the bot seats go to walk-ins: about a third, at least one at
 * any table with more than one opponent. Heads-up it's a rival three times
 * in four.
 */
export function walkInCount(botSeats: number, rng: Rng): number {
  if (botSeats <= 0) return 0
  if (botSeats === 1) return rng() < 0.75 ? 0 : 1
  return Math.max(1, Math.floor(botSeats / 3))
}

/** Who sits where: some rivals from the roster, the rest walk-ins, in a shuffled seat order. */
export function planTable(botSeats: number, rng: Rng): SeatPlan[] {
  const walkIns = walkInCount(botSeats, rng)
  const rivals = [...ROSTER]
  shuffle(rivals, rng)
  const names = [...WALK_IN_NAMES]
  shuffle(names, rng)
  const seats: SeatPlan[] = []
  for (let i = 0; i < botSeats - walkIns && i < rivals.length; i++) {
    const rival = rivals[i]
    seats.push({ kind: 'rival', rival, profile: rivalProfile(rival), name: rival.name })
  }
  let nextName = 0
  while (seats.length < botSeats) {
    // A walk-in is any character at all, pro or recreational, drawn fresh.
    const archetype = CAST[Math.floor(rng() * CAST.length)]
    seats.push({ kind: 'walk-in', profile: randomizeProfile(archetype, rng), name: names[nextName++ % names.length] })
  }
  shuffle(seats, rng)
  return seats
}

// ---------- scouting ----------

/** Hands seen before a rival's tendencies are worth a note. */
export const SCOUTING_MIN_HANDS = 30

function pct(part: number, whole: number): string {
  return `${Math.round((100 * part) / Math.max(whole, 1))}%`
}

function money(amount: number): string {
  const rounded = Math.round(amount)
  return `${rounded < 0 ? '−' : '+'}$${Math.abs(rounded).toLocaleString()}`
}

/**
 * What you'd have jotted down about a rival: how loose they play, what their
 * river bets turned out to be, where you stand against them. Null until
 * enough has been seen to say anything.
 */
export function scoutingNote(rival: Rival, record: RivalRecord | undefined): string | null {
  const details = scoutingDetails(rival, record)
  return details === null ? null : `${rival.name}: ${details}.`
}

/** The note without the name: "plays 41% of hands, …". */
export function scoutingDetails(rival: Rival, record: RivalRecord | undefined): string | null {
  if (!record || record.stats.hands < SCOUTING_MIN_HANDS) return null
  const s = record.stats
  const parts = [`plays ${pct(s.vpip, s.hands)} of hands, raises ${pct(s.pfr, s.hands)} before the flop`]
  if (s.facedBet >= 10) parts.push(`folds to ${pct(s.foldedToBet, s.facedBet)} of bets`)
  if (s.riverBetsShown >= 3) {
    parts.push(`${Math.round(s.riverBluffsShown)} of ${Math.round(s.riverBetsShown)} river bets you've seen were bluffs`)
  }
  if (Math.round(record.netVsYou) !== 0) parts.push(`you're ${money(record.netVsYou)} against ${rival.name}`)
  return parts.join(', ')
}

// ---------- one session with rivals at the table ----------

/** A saved read is stored under this id, whichever seat you had. */
const HERO_KEY = 'hero'

function renameRead(data: OpponentModelData, from: string, to: string): OpponentModelData {
  const player = data.players[from]
  return { version: 1, players: player ? { [to]: player } : {} }
}

export interface TableHooks {
  opponentModel: OpponentModel
  humanIds: string[]
  /** Bot seats in seat order, the same order as the plan's seats. */
  botSeats: { id: string; bot: PsychBot }[]
}

/**
 * The glue between a live table and the saved rivals: hands the table what
 * the rivals remember when it's built, and works out what they learned after
 * every hand, so a closed tab loses at most the hand in play.
 *
 * Memory of you is kept only in a solo game. With several people passing one
 * device there is no single "you" for a rival to know; their public stats
 * are still kept.
 */
export class RivalSession {
  private data: RivalsData
  private readonly plan: SeatPlan[]
  private readonly startingStack: number
  private seatToRival = new Map<string, Rival>()
  private lastHand = -1
  /** The worst thing that happened to each rival this session at your hands, 0..1. */
  private worst = new Map<string, number>()
  private readonly persist?: (data: RivalsData) => void

  /** `persist` is handed the updated data after every hand (the app saves it; tests needn't). */
  constructor(data: RivalsData, plan: SeatPlan[], startingStack: number, persist?: (data: RivalsData) => void) {
    this.data = data
    this.plan = plan
    this.startingStack = startingStack
    this.persist = persist
  }

  /** Names and characters for the bot seats, in seat order. */
  get seats(): { name: string; profile: PsychProfile }[] {
    return this.plan.map(({ name, profile }) => ({ name, profile }))
  }

  /** The table seats a rival sits in (not the walk-ins'). Known once `seated` has run. */
  get rivalSeatIds(): ReadonlySet<string> {
    return new Set(this.seatToRival.keys())
  }

  get snapshot(): RivalsData {
    return this.data
  }

  /** Once the table exists: pool the seated rivals' reads on you, and seat anyone still steaming. */
  seated({ opponentModel, humanIds, botSeats }: TableHooks): void {
    this.seatToRival.clear()
    botSeats.forEach(({ id }, i) => {
      const seat = this.plan[i]
      if (seat?.kind === 'rival') this.seatToRival.set(id, seat.rival)
    })
    if (humanIds.length !== 1) return
    const heroId = humanIds[0]

    const reads = [...this.seatToRival.values()]
      .map((rival) => this.data.rivals[rival.id]?.readOnYou)
      .filter((read): read is OpponentModelData => read != null)
    // Rivals who sat together saw the same hands, so their reads are
    // averaged rather than stacked: the pool counts each sitting once.
    for (const read of reads) opponentModel.restore(renameRead(read, HERO_KEY, heroId), READ_DECAY / reads.length)

    for (const { id, bot } of botSeats) {
      const rival = this.seatToRival.get(id)
      const carry = rival ? (this.data.rivals[rival.id]?.carryTilt ?? 0) : 0
      if (carry > 0) bot.startTilted(carry)
    }
  }

  /**
   * After each hand: every seated rival's public stats, and in a solo game
   * their record against you, their read on you, and how hot they'll arrive
   * next time.
   */
  handEnded(state: GameState, { opponentModel, humanIds, botSeats }: TableHooks): RivalsData {
    if (state.handInProgress || state.handNumber === this.lastHand) return this.data
    const firstHand = this.lastHand < 0
    this.lastHand = state.handNumber

    const solo = humanIds.length === 1
    const heroId = humanIds[0]
    const net = handNet(state)
    const read = solo ? renameRead(opponentModel.toJSON([heroId]), heroId, HERO_KEY) : null
    const rivals = { ...this.data.rivals }

    for (const { id, bot } of botSeats) {
      const rival = this.seatToRival.get(id)
      if (!rival) continue
      const before = rivals[rival.id] ?? emptyRecord()
      const record: RivalRecord = {
        ...before,
        stats: addStats(before.stats, handStats(state, id)),
        sessions: before.sessions + (firstHand ? 1 : 0),
      }
      if (solo) {
        const fromRival = netBetween(net, heroId, id)
        record.netVsYou = before.netVsYou + fromRival
        record.readOnYou = read

        const player = state.players.find((p) => p.id === id)
        const bustedByYou = player !== undefined && player.stack === 0 && fromRival > 0
        const bigLoss = Math.min(Math.max(fromRival, 0) / Math.max(this.startingStack, 1), 1)
        const worst = Math.max(this.worst.get(id) ?? 0, bustedByYou ? 1 : bigLoss)
        this.worst.set(id, worst)
        // Tilt back on the 0..1 scale it's started from, via the character's own sensitivity.
        const kappa = archetypeProfile(rival.archetype).tilt.kappa
        const steaming = kappa > 0 ? Math.min(bot.tiltLevel / kappa, 1) : 0
        record.carryTilt = Math.max(worst, steaming)
      }
      rivals[rival.id] = record
    }
    this.data = { version: 1, rivals }
    this.persist?.(this.data)
    return this.data
  }
}
