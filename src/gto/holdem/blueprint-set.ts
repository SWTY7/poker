import type { Agent } from '../../ai/agent'
import type { AIObservation } from '../../ai/observation'
import type { PokerAction } from '../../poker/game-state'
import type { Rng } from '../../utils/random'
import { BlueprintBot } from './blueprint-bot'
import type { BlueprintFile } from './blueprint'

/**
 * The solved bot, at whichever trained depth is actually closest to the
 * table — rather than one fixed depth with a tolerance band around it.
 *
 * `BlueprintBot` already does the hard part correctly: it only ever plays
 * the solved strategy heads-up, within a depth it trusts, and defers to its
 * fallback for everything else (see blueprint-bot.ts). This wraps one
 * `BlueprintBot` per trained file and, each decision, hands off to whichever
 * one was trained closest to the table's actual effective stack — every
 * other rule (heads-up only, depth band, key-miss handling) stays exactly
 * `BlueprintBot`'s own, unchanged, since the delegate for the picked depth
 * is a real `BlueprintBot` and not a reimplementation of one.
 */
export interface BlueprintSetOptions {
  /** Plays every spot no trained depth can answer. */
  fallback: Agent
  rng?: Rng
}

export class BlueprintSetBot implements Agent {
  private entries: { stack: number; bot: BlueprintBot }[]
  private fallback: Agent

  constructor(files: BlueprintFile[], options: BlueprintSetOptions) {
    if (files.length === 0) throw new Error('BlueprintSetBot needs at least one trained depth')
    this.fallback = options.fallback
    this.entries = files.map((file) => ({
      stack: file.options.stack,
      bot: new BlueprintBot(file, { fallback: options.fallback, rng: options.rng }),
    }))
  }

  decideAction(obs: AIObservation): PokerAction {
    const nearest = this.nearestEntry(obs)
    return (nearest ?? this.fallback).decideAction(obs)
  }

  /** Summed across every trained depth, for the same "did it actually answer" check `BlueprintBot` itself supports. */
  get asked(): number {
    return this.entries.reduce((sum, e) => sum + e.bot.asked, 0)
  }

  get answered(): number {
    return this.entries.reduce((sum, e) => sum + e.bot.answered, 0)
  }

  /**
   * Whichever trained depth's stack is numerically closest to the table's
   * actual effective stack, in big blinds — the same quantity
   * `BlueprintBot.lookUp` computes internally to check its own depth band,
   * recomputed here only to choose *among* depths, not to decide whether
   * the pick is trustworthy (that's still each `BlueprintBot`'s own job).
   * Null when there's nothing sensible to compute yet (not heads-up, no
   * big blind), in which case the fallback plays exactly as it would if
   * this class didn't exist.
   */
  private nearestEntry(obs: AIObservation): BlueprintBot | null {
    const live = obs.players.filter((p) => !p.folded)
    if (live.length !== 2 || !(obs.bigBlind > 0)) return null

    const effective = (Math.min(...live.map((p) => p.stack)) + obs.potSize / live.length) / obs.bigBlind
    let best = this.entries[0]
    for (const entry of this.entries) {
      if (Math.abs(entry.stack - effective) < Math.abs(best.stack - effective)) best = entry
    }
    return best.bot
  }
}
