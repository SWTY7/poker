import { describe, expect, it } from 'vitest'
import {
  earn,
  handAchievements,
  seasonAchievements,
  tournamentAchievements,
  type AchievementsData,
} from '../../src/game/achievements'
import { newCareer, recordEvent, YOU, TIERS } from '../../src/game/career'
import type { GameState, HandLogEntry } from '../../src/poker/game-state'
import type { Card } from '../../src/poker/card'

const card = (s: string): Card => ({ rank: s[0], suit: s[1] }) as Card
const cards = (s: string) => s.split(' ').map(card)

let seq = 0
const log = (entry: Partial<HandLogEntry>): HandLogEntry => ({ seq: seq++, street: 'preflop', kind: 'action', potAfter: 0, ...entry })

/** Just enough of a finished hand for the detectors. */
function hand(opts: {
  hole: string
  board?: string
  winners: string[]
  players?: { id: string; stack: number }[]
  handLog?: HandLogEntry[]
}): GameState {
  return {
    players: [
      { id: 'me', stack: 1000, holeCards: cards(opts.hole) },
      ...(opts.players ?? [{ id: 'bot', stack: 1000 }]).map((p) => ({ ...p, holeCards: [] })),
    ],
    communityCards: opts.board ? cards(opts.board) : [],
    lastResults: [{ potAmount: 100, winnerIds: opts.winners }],
    handLog: opts.handLog ?? [],
  } as unknown as GameState
}

const none = new Set<string>()

describe('hand achievements', () => {
  it('a lost hand earns nothing; any won pot is the first', () => {
    expect(handAchievements(hand({ hole: 'As Ks', winners: ['bot'] }), 'me', none)).toEqual([])
    expect(handAchievements(hand({ hole: 'As Ks', winners: ['me'] }), 'me', none)).toEqual(['first-pot'])
  })

  it('winning with 7-2, either way round, suited or not', () => {
    expect(handAchievements(hand({ hole: '7h 2c', winners: ['me'] }), 'me', none)).toContain('seven-deuce')
    expect(handAchievements(hand({ hole: '2d 7d', winners: ['me'] }), 'me', none)).toContain('seven-deuce')
    expect(handAchievements(hand({ hole: '7h 3c', winners: ['me'] }), 'me', none)).not.toContain('seven-deuce')
  })

  it('a hero call: a river bet called with one pair or less, won at showdown', () => {
    const riverCall = [
      log({ street: 'river', playerId: 'bot', actionType: 'bet', amount: 50 }),
      log({ street: 'river', playerId: 'me', actionType: 'call', amount: 50 }),
      log({ street: 'showdown', kind: 'reveal', playerId: 'me' }),
    ]
    const weak = hand({ hole: 'Qh 9c', board: '9s 5d 4h 2c Kd', winners: ['me'], handLog: riverCall })
    expect(handAchievements(weak, 'me', none)).toContain('hero-call')
    // Two pair isn't a bluff-catcher.
    const strong = hand({ hole: 'Kh 9c', board: '9s 5d 4h 2c Kd', winners: ['me'], handLog: riverCall })
    expect(handAchievements(strong, 'me', none)).not.toContain('hero-call')
    // Checked down, no bet to call.
    const checked = hand({
      hole: 'Qh 9c',
      board: '9s 5d 4h 2c Kd',
      winners: ['me'],
      handLog: [log({ street: 'river', playerId: 'me', actionType: 'check' }), log({ street: 'showdown', kind: 'reveal' })],
    })
    expect(handAchievements(checked, 'me', none)).not.toContain('hero-call')
  })

  it('busting a rival who played the hand, but not a walk-in', () => {
    const busted = (id: string) =>
      hand({ hole: 'As Ks', winners: ['me'], players: [{ id, stack: 0 }], handLog: [log({ playerId: id, actionType: 'all-in', amount: 400 })] })
    expect(handAchievements(busted('rival-seat'), 'me', new Set(['rival-seat']))).toContain('bust-rival')
    expect(handAchievements(busted('walk-in-seat'), 'me', new Set(['rival-seat']))).not.toContain('bust-rival')
  })
})

describe('tournaments and seasons', () => {
  it('a tournament win', () => {
    expect(tournamentAchievements(1)).toEqual(['tournament-win'])
    expect(tournamentAchievements(2)).toEqual([])
  })

  it('winning a Local season: top of the table, and promoted to Regional', () => {
    let career = newCareer()
    const order = [YOU, ...TIERS[0].field, null]
    for (let i = 0; i < TIERS[0].events.length - 1; i++) {
      career = recordEvent(career, order)
      expect(seasonAchievements(career)).toEqual([])
    }
    career = recordEvent(career, order)
    expect(seasonAchievements(career)).toEqual(['season-win', 'reach-regional'])
  })

  it('reaching the Championship, and winning it', () => {
    const national = { ...newCareer(), tier: 2, points: Object.fromEntries([YOU, ...TIERS[2].field].map((id) => [id, 0])) }
    let career = national
    const order = [TIERS[2].field[0], YOU, ...TIERS[2].field.slice(1), null]
    for (let i = 0; i < TIERS[2].events.length; i++) career = recordEvent(career, order)
    expect(seasonAchievements(career)).toEqual(['reach-championship'])
    career = recordEvent(career, [YOU, ...TIERS[3].field, null])
    expect(seasonAchievements(career)).toEqual(['season-win', 'title'])
  })
})

describe('earning', () => {
  it('records each once, with the date, and reports only the new ones', () => {
    const empty: AchievementsData = { version: 1, earned: {} }
    const day = new Date('2026-10-02T12:00:00Z')
    const first = earn(empty, ['first-pot', 'seven-deuce'], day)
    expect(first.fresh.map((a) => a.id)).toEqual(['first-pot', 'seven-deuce'])
    expect(first.data.earned['first-pot']).toBe(day.toISOString())
    const again = earn(first.data, ['first-pot'])
    expect(again.fresh).toEqual([])
    expect(again.data).toBe(first.data)
  })
})
