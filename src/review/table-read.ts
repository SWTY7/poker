import { BASELINES, type OpponentModel, type Setting } from '../ai/psychology/opponent-model'

/**
 * What the bots at this table have learned about a player, said in plain
 * words: the same numbers `OpponentModel` feeds into every bot's decisions,
 * next to what's normal in that spot, and what the bots do about it.
 *
 * Only reads with enough behind them are said at all. A line always carries
 * how many actions it rests on.
 */
export interface ReadLine {
  text: string
  /** Actions (or shown bets) the line rests on. */
  sample: number
}

/** Fewer actions than this in a setting and nothing is said about it. */
export const MIN_ACTIONS = 10
/** Fewer sized bets than this and bet sizing isn't mentioned. */
export const MIN_SIZED = 5

const SETTING_WORDS: Record<Setting, string> = { headsUp: 'heads-up', multiway: 'in pots with three or more' }

const pct = (x: number) => `${Math.round(x * 100)}%`

export function describeRead(model: OpponentModel, playerId: string): ReadLine[] {
  const saved = model.toJSON([playerId]).players[playerId]
  if (!saved) return []
  const lines: ReadLine[] = []

  for (const setting of ['multiway', 'headsUp'] as const) {
    const tally = saved.tallies[setting]
    const normal = BASELINES[setting]
    const where = SETTING_WORDS[setting]

    if (tally.total >= MIN_ACTIONS) {
      const rate = tally.aggressive / tally.total
      const bias = model.aggressionBias(playerId, setting)
      const verdict =
        bias > 0.03
          ? 'They read you as aggressive, so they believe your bets less and call you down lighter.'
          : bias < -0.03
            ? 'They read you as passive, so they give your bets more credit.'
            : 'That reads as about normal.'
      lines.push({
        text: `${cap(where)}, you bet or raise ${pct(rate)} of the time (typical: ${pct(normal.aggression)}). ${verdict}`,
        sample: tally.total,
      })
    }

    if (tally.facingBet >= MIN_ACTIONS) {
      const rate = tally.foldedToBet / tally.facingBet
      const bias = model.foldBias(playerId, setting)
      const verdict =
        bias > 0.04
          ? 'You fold more than most, so they bluff you more.'
          : bias < -0.04
            ? 'You call more than most, so they bluff you less.'
            : 'About normal.'
      lines.push({
        text: `${cap(where)}, facing a bet you fold ${pct(rate)} of the time (typical: ${pct(normal.foldToBet)}). ${verdict}`,
        sample: tally.facingBet,
      })
    }
  }

  const sized = saved.tallies.headsUp.sizedBets + saved.tallies.multiway.sizedBets
  if (sized >= MIN_SIZED) {
    const large = saved.tallies.headsUp.largeBets + saved.tallies.multiway.largeBets
    lines.push({
      text: `${pct(large / sized)} of your bets after the flop are big (over 60% of the pot). They read big bets and small ones separately.`,
      sample: sized,
    })
  }

  if (saved.shown) {
    const bets = saved.shown.small.bets + saved.shown.large.bets
    const bluffs = saved.shown.small.bluffs + saved.shown.large.bluffs
    if (bets > 0) {
      lines.push({
        text: `They've seen ${round(bets)} of your river bets turned over at a showdown, and ${round(bluffs)} ${bluffs === 1 ? 'was a bluff' : 'were bluffs'}. That moves how often they believe your river bets.`,
        sample: bets,
      })
    }
  }
  return lines
}

function cap(text: string): string {
  return text[0].toUpperCase() + text.slice(1)
}

function round(x: number): number {
  return Math.round(x)
}
