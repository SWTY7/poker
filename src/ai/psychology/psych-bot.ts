import type { PokerAction } from '../../poker/game-state'
import { toCardInts } from '../../poker/fast/cards'
import type { CardInt } from '../../poker/fast/cards'
import { multiwayEquity } from '../../math/equity'
import { emptyRange, type Range } from '../../math/range'
import { topPercentRange } from '../../math/realization'
import { COMBO_COUNT } from '../../math/combos'
import type { Rng } from '../../utils/random'
import { createRng } from '../../utils/random'
import type { Agent, HandOutcome } from '../agent'
import type { AIObservation } from '../observation'
import { subjectiveValue, type Outcome, type ProspectParams } from './prospect'
import { referencePoint, type SessionState } from './accounting'
import { decayTilt, tiltEffects, updateTilt } from './tilt'
import { believedOpponentStrategy } from './level-k'
import type { PsychProfile } from './profile'
import { AVERAGE_HUMAN } from './profile'

/**
 * One bot, three biases, one decision rule.
 *
 * The rule is: score every legal action as a gamble and take the best one.
 * What makes it psychological rather than rational is *which* scoring
 * function — `subjectiveValue` rather than expected value — and where zero
 * sits when the payoffs are measured. Nothing in here says "call more when
 * losing" or "bet more when tilted". Those behaviours are supposed to fall
 * out, and if they have to be written down the model is not doing its job.
 *
 * Each layer enters at exactly one place:
 *
 *   level-k       decides what range the opponent is betting, and how often
 *                 they fold to a bet
 *   equity        measures the hand against that range, truthfully
 *   accounting    decides where the reference point is
 *   prospect      converts chips and probabilities into felt value
 *   tilt          scales loss aversion, inflates belief in bluffs, and
 *                 inflates belief in fold equity
 *
 * The lookahead is one street deep with no future betting: a call is priced
 * as though the hand checks down from here, and a bet as though the opponent
 * folds or calls but never raises. That understates implied odds and
 * therefore draws, and it flatters aggression, and both are the first things
 * to fix if these bots are ever meant to be strong rather than human. Neither
 * affects the three behaviours this layer exists to produce, all of which are
 * about how the same numbers are felt rather than about what they are.
 *
 * Bluffing is not a separate decision here. A bet with no equity wins the
 * hand when everyone folds, and that branch is already in the valuation, so
 * the bot bluffs exactly when fold equity pays for it — which is what a bluff
 * is. `maybeBluff` in bluff.ts belongs to PersonalityBot, where a bluff is a
 * deliberate override of an honest strength estimate; that is a different
 * model and this one does not route through it.
 */

/** How wide a range a bet is assumed to be value-betting. */
const VALUE_WIDTH = 0.2
/** How wide the range is that a player takes to the flop at all. */
const CONTINUING_WIDTH = 0.45
/**
 * The share of a continuing range that is a real hand rather than a
 * bluff-catcher — the part that calls a bet whatever it thinks of the bettor.
 */
const VALUE_SHARE = VALUE_WIDTH / CONTINUING_WIDTH

export class PsychBot implements Agent {
  readonly profile: PsychProfile
  private rng: Rng
  private session: SessionState
  private tilt = 0
  /** The equity behind this bot's last committing action, for judging the beat afterwards. */
  private lastEquity = 0
  private committedThisHand = false

  constructor(profile: PsychProfile = AVERAGE_HUMAN, buyIn = 1000, rng: Rng = createRng()) {
    this.profile = profile
    this.rng = rng
    this.session = { buyIn, stack: buyIn }
  }

  /** Current emotional state, for tests and for a future tell in the UI. */
  get tiltLevel(): number {
    return this.tilt
  }

  decideAction(obs: AIObservation): PokerAction {
    const me = obs.players.find((p) => p.id === obs.playerId)
    this.session.stack = me?.stack ?? this.session.stack

    const effects = tiltEffects(this.tilt)
    const prospect: ProspectParams = {
      ...this.profile.prospect,
      lambda: 1 + (this.profile.prospect.lambda - 1) * effects.lambdaScale,
    }
    const reference = referencePoint(this.session, this.profile.accounting)

    const hole = toCardInts(obs.ownCards) as [CardInt, CardInt]
    const board = toCardInts(obs.communityCards)
    const stack = this.session.stack
    const pot = obs.potSize
    const toCall = obs.toCall

    const read = readOpponents(obs)
    const opponents = Math.max(read.aggressors + read.callers + read.unknown, 1)

    // What the opponent is betting, and therefore what to measure against.
    const believed = believedOpponentStrategy(
      this.profile.level,
      toCall > 0 ? toCall : Math.round(pot * 0.6),
      Math.max(pot - toCall, 1),
      this.profile.confidence,
    )
    const bluffBelief = clamp01(believed.bluffFrequency + effects.bluffBeliefBoost)

    // The hand has to beat everyone still in, and they are not all telling
    // the same story — so each opponent is dealt from the range their own
    // actions imply, all in the same sample.
    const sample = { samples: this.profile.equitySamples, rng: this.rng }
    const ranges: Range[] = []
    const participation: number[] = []
    for (let i = 0; i < read.aggressors; i++) {
      ranges.push(bettingRange(bluffBelief))
      participation.push(1)
    }
    for (let i = 0; i < read.callers; i++) {
      ranges.push(continuingRange())
      participation.push(1)
    }
    for (let i = 0; i < read.unknown; i++) {
      // Someone yet to act is in the hand exactly when they hold a hand worth
      // continuing with, so one number does both jobs: how often they are
      // there, and what they have when they are.
      ranges.push(continuingRange())
      participation.push(CONTINUING_WIDTH)
    }
    const equity = multiwayEquity(hole, ranges, board, { ...sample, participation })
    this.lastEquity = equity

    // How often a bet takes it down.
    //
    // Two translations happen here. The level-k defence frequency is about a
    // bluff-catcher, because that is the hand the toy game gives its
    // defender — but a real opponent is holding a whole range, and the part
    // of it that is a genuine hand calls whatever it thinks of the bettor.
    // Reading the toy game's number as the whole range's fold rate says a
    // half-pot bet wins outright three quarters of the time, which is how a
    // bot talks itself into betting every hand it is dealt.
    //
    // Then the exponent: everybody has to fold, not just the one being bet
    // at, which is why a bluff into four players is not the same proposition
    // as the same bluff heads-up.
    const defence = clamp01(VALUE_SHARE + (1 - VALUE_SHARE) * believed.defenceFrequency)
    const foldEquity = Math.pow(clamp01(1 - defence + effects.aggressionBoost), opponents)

    type Candidate = { action: PokerAction; outcomes: Outcome[] }
    const candidates: Candidate[] = []
    const relative = (finalStack: number) => finalStack - reference

    if (obs.legalActions.includes('fold')) {
      candidates.push({
        action: { playerId: obs.playerId, type: 'fold' },
        // Folding is the certain outcome, and being certain is exactly what
        // makes it feel worse than it is once the reference point is above
        // the stack. This line is the whole "people call too much" result.
        outcomes: [{ payoff: relative(stack), probability: 1 }],
      })
    }

    if (obs.legalActions.includes('check')) {
      candidates.push({
        action: { playerId: obs.playerId, type: 'check' },
        outcomes: [
          { payoff: relative(stack + pot), probability: equity },
          { payoff: relative(stack), probability: 1 - equity },
        ],
      })
    }

    if (obs.legalActions.includes('call')) {
      candidates.push({
        action: { playerId: obs.playerId, type: 'call' },
        outcomes: [
          { payoff: relative(stack + pot), probability: equity },
          { payoff: relative(stack - toCall), probability: 1 - equity },
        ],
      })
    }

    const aggressive = obs.legalActions.includes('bet')
      ? ('bet' as const)
      : obs.legalActions.includes('raise')
        ? ('raise' as const)
        : null

    if (aggressive) {
      for (const fraction of [0.5, 1]) {
        // A size the pot can explain: raise to the current bet plus a share of
        // what would be in the middle after calling it. Sizing off the minimum
        // raise instead — which is what the heuristic bot does — compounds,
        // because the minimum is already a function of the last raise, and a
        // table of bots doing it three-bets itself all in by the fourth street.
        const target = clamp(
          obs.currentBet + Math.round(fraction * (pot + toCall)),
          obs.minRaiseTo,
          obs.maxRaiseTo,
        )
        const added = target - (me?.betThisStreet ?? 0)
        if (added <= 0) continue
        const extraCalled = Math.max(added - toCall, 0)

        // The hand that calls is not the hand that was there before the bet.
        // Betting folds out the part of their range the hero was beating and
        // keeps the part beating the hero, so equity in the called branch has
        // to be measured against the range that actually continues — the top
        // `defence` share of it. Leaving this out is what makes a bot a
        // maniac: every bet looks like it either wins the pot outright or
        // goes to showdown against the same range it faced before.
        const called = topSlice(CONTINUING_WIDTH * defence)
        const equityIfCalled = multiwayEquity(hole, new Array<Range>(opponents).fill(called), board, {
          ...sample,
          participation: participation.map(() => 1),
        })

        candidates.push({
          action: { playerId: obs.playerId, type: aggressive, amount: target },
          outcomes: [
            { payoff: relative(stack + pot), probability: foldEquity },
            { payoff: relative(stack + pot + extraCalled), probability: (1 - foldEquity) * equityIfCalled },
            { payoff: relative(stack - added), probability: (1 - foldEquity) * (1 - equityIfCalled) },
          ],
        })
      }
    }

    if (candidates.length === 0) {
      return { playerId: obs.playerId, type: obs.legalActions[0] ?? 'fold' }
    }

    let best = candidates[0]
    let bestValue = subjectiveValue(best.outcomes, prospect)
    for (const candidate of candidates.slice(1)) {
      const value = subjectiveValue(candidate.outcomes, prospect)
      if (value > bestValue) {
        best = candidate
        bestValue = value
      }
    }

    // Anything but a fold means this hand belongs to them, and a hand they
    // were in is a hand that can tilt them. Checking a monster down and
    // losing it is a bad beat too — being cheap about it does not make it
    // sting less.
    if (best.action.type !== 'fold') this.committedThisHand = true
    return best.action
  }

  /**
   * How the hand ended, from this bot's point of view. Tilt needs it, and
   * tilt is the only thing that does — the strategy itself has no memory,
   * because level-k depth is a trait rather than something learned.
   */
  observeResult(outcome: HandOutcome): void {
    this.session.stack = outcome.stack
    if (!this.committedThisHand) {
      this.tilt = decayTilt(this.tilt, this.profile.tilt)
    } else {
      this.tilt = updateTilt(
        this.tilt,
        { equityWhenCommitted: this.lastEquity, shareWon: outcome.shareWon, potSize: outcome.potSize },
        this.profile.tilt,
      )
    }
    this.committedThisHand = false
    this.lastEquity = 0
  }
}

// --- reading the table -------------------------------------------------------

interface TableRead {
  /** Opponents still in who have bet or raised this hand. */
  aggressors: number
  /** Opponents still in who have only called or checked. */
  callers: number
  /** Opponents still in who have not voluntarily done anything yet. */
  unknown: number
}

/**
 * Who is representing what.
 *
 * The distinction that matters is between a bet and a blind. Preflop every
 * seat faces a bet it did not choose to face, and reading the big blind as
 * strength is the kind of mistake that turns a bot into a nit — folding the
 * whole table because six people are apparently betting at it. Only the
 * action history counts as information, because only it was voluntary.
 */
function readOpponents(obs: AIObservation): TableRead {
  let aggressors = 0
  let callers = 0
  let unknown = 0
  for (const player of obs.players) {
    if (player.id === obs.playerId || player.folded) continue
    let acted = false
    let aggressive = false
    for (const action of obs.actionHistory) {
      if (action.playerId !== player.id) continue
      acted = true
      if (action.type === 'bet' || action.type === 'raise' || action.type === 'all-in') aggressive = true
    }
    if (aggressive) aggressors++
    else if (acted) callers++
    else unknown++
  }
  return { aggressors, callers, unknown }
}

// --- ranges ------------------------------------------------------------------

let valueRange: Range | null = null
let airRange: Range | null = null

/**
 * The strongest `width` of all hands, remembered.
 *
 * Deriving one of these walks all 1326 combos against the measured strength
 * order, which is not something to do twice per decision — and the widths
 * asked for repeat constantly, because they come from a handful of level-k
 * frequencies. Rounding to the nearest percent before looking it up is what
 * makes the cache hit.
 */
const sliceCache = new Map<number, Range>()
function topSlice(width: number): Range {
  const key = Math.max(1, Math.min(100, Math.round(width * 100)))
  let range = sliceCache.get(key)
  if (!range) {
    range = topPercentRange(key / 100)
    sliceCache.set(key, range)
  }
  return range
}

function continuingRange(): Range {
  return topSlice(CONTINUING_WIDTH)
}

/**
 * The range a bet represents, given how often the bettor is believed to be
 * bluffing: that share of hands they would never have played for value, the
 * rest the top of their range.
 *
 * Built as a weighted mixture rather than a widened range, because those are
 * different shapes and the difference is the point. A bluffing range is not a
 * looser value range — it is the hands at the *other* end, which is why a
 * bluff-catcher beats all of them and none of the others.
 */
function bettingRange(bluffFrequency: number): Range {
  if (!valueRange) valueRange = topSlice(VALUE_WIDTH)
  if (!airRange) {
    const value = valueRange
    const air = emptyRange()
    const wide = continuingRange()
    for (let id = 0; id < COMBO_COUNT; id++) air[id] = value[id] > 0 ? 0 : wide[id] > 0 ? 0 : 1
    airRange = air
  }

  const mixed = emptyRange()
  const valueWeight = 1 - bluffFrequency
  for (let id = 0; id < COMBO_COUNT; id++) {
    mixed[id] = valueWeight * valueRange[id] + bluffFrequency * airRange[id]
  }
  return mixed
}

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1)
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(Math.max(x, min), max)
}
