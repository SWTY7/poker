import type { HandRecord } from '../review/log'
import { kindOf } from '../review/log'
import { styleProfile } from '../review/style'

/**
 * What a seat's play looks like, as numbers: `review/style.ts`'s profile plus
 * the three things the plan adds (the tilt signature as a difference, sizing,
 * and how the seat's river bets do at showdown). A feature is null when the
 * seat never had the chance, which at 50 hands is common; the recovery step
 * decides what to do about that, not this one.
 */

export const FEATURES = [
  'vpip',
  'pfr',
  'threeBet',
  'aggressionFactor',
  'cbet',
  'foldToCbet',
  'wtsd',
  'wsd',
  'bbPer100',
  'tiltVpip',
  'tiltPfr',
  'betSize',
  'largeBetShare',
  'postflopFoldToBet',
  'preflopFoldToRaise',
  'riverBetWin',
] as const

export type FeatureKey = (typeof FEATURES)[number]
export type FeatureVector = Record<FeatureKey, number | null>

/** A bet this large, as a share of the pot, is a large one. */
const LARGE_BET = 0.75

const rate = (hit: number, of: number): number | null => (of > 0 ? hit / of : null)

export function featuresOf(hands: HandRecord[]): FeatureVector {
  const style = styleProfile(hands)
  const diff = (after: number | null, otherwise: number | null) =>
    after !== null && otherwise !== null ? after - otherwise : null

  let bets = 0
  let betFractionSum = 0
  let large = 0
  let faced = 0
  let foldedToBet = 0
  let preflopFaced = 0
  let preflopFolded = 0
  let riverBets = 0
  let riverBetsWon = 0

  for (const hand of hands) {
    let riverBetThisHand = false
    for (const decision of hand.decisions) {
      const action = hand.actions[decision.index]
      if (!action) continue
      const kind = kindOf(action.type, action.amount, decision.toCall > 0 ? decision.toCall : 0)
      const postflop = decision.street !== 'preflop'
      if (postflop && decision.toCall === 0 && kind === 'aggressive' && decision.pot > 0) {
        const amount = action.type === 'all-in' ? decision.stack : (action.amount ?? 0)
        bets++
        betFractionSum += amount / decision.pot
        if (amount / decision.pot >= LARGE_BET) large++
      }
      if (postflop && decision.toCall > 0) {
        faced++
        if (kind === 'fold') foldedToBet++
      }
      if (!postflop && decision.toCall > hand.bigBlind) {
        preflopFaced++
        if (kind === 'fold') preflopFolded++
      }
      if (decision.street === 'river' && kind === 'aggressive') riverBetThisHand = true
    }
    if (riverBetThisHand && hand.showdown) {
      riverBets++
      if (hand.won) riverBetsWon++
    }
  }

  return {
    vpip: style.vpip.rate,
    pfr: style.pfr.rate,
    threeBet: style.threeBet.rate,
    aggressionFactor: style.aggressionFactor.value,
    cbet: style.cbet.rate,
    foldToCbet: style.foldToCbet.rate,
    wtsd: style.wtsd.rate,
    wsd: style.wsd.rate,
    bbPer100: style.bbPer100,
    tiltVpip: diff(style.tilt.after.vpip.rate, style.tilt.otherwise.vpip.rate),
    tiltPfr: diff(style.tilt.after.pfr.rate, style.tilt.otherwise.pfr.rate),
    betSize: rate(betFractionSum, bets),
    largeBetShare: rate(large, bets),
    postflopFoldToBet: rate(foldedToBet, faced),
    preflopFoldToRaise: rate(preflopFolded, preflopFaced),
    riverBetWin: rate(riverBetsWon, riverBets),
  }
}
