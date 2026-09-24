import { useCallback, useEffect, useRef, useState } from 'react'
import { HoldemEngine } from '../poker/game-engine'
import type { PlayerSetup } from '../poker/game-engine'
import type { ActionType, GameState, PokerAction, Street } from '../poker/game-state'
import { HeuristicBot } from '../ai/heuristic-bot'
import { buildObservation } from '../ai/observation'
import type { Agent } from '../ai/agent'
import { PsychBot } from '../ai/psychology/psych-bot'
import { PersonalityBot } from '../ai/psychology/personality-bot'
import { randomizePersonalityProfile } from '../ai/psychology/personality'
import { OpponentModel } from '../ai/psychology/opponent-model'
import { CAST, randomizeProfile } from '../ai/psychology/profile'
import { blindLevel, levelForHandsCompleted, type TournamentStructure } from '../game/tournament'
import { createRng, shuffle } from '../utils/random'
import { readEnum, writeString } from '../utils/storage'

const BOT_NAMES = ['Chip', 'Chris', 'Darla', 'Holly', 'Scarlet', 'Sparky', 'Connie', 'Lars', 'Nova']

export type Speed = 'slow' | 'normal' | 'fast'

/** Wall-clock multiplier applied to every scripted pause. */
const SPEED_FACTOR: Record<Speed, number> = { slow: 1.7, normal: 1, fast: 0.4 }

/**
 * How long an opponent appears to think, by what they decided. A snap-fold
 * and a big raise landing at the same tempo is what makes a table feel like a
 * conveyor belt rather than a game with other people at it.
 */
const THINK_TIME: Record<ActionType, number> = {
  fold: 340,
  check: 420,
  call: 620,
  bet: 900,
  raise: 950,
  'all-in': 1200,
}

/** Beat held after cards hit the board, before anyone may act on them. */
const DEAL_PAUSE = 950
/** Gap before the next hand when auto-deal is on. */
const NEXT_HAND_PAUSE = 2400

export interface GameConfigOptions {
  playerCount: number
  /**
   * How many of the seats (starting from seat 0) are human-controlled, on
   * this one shared device. 1 is the normal solo game. >1 is local
   * pass-and-play: everyone takes turns handing the device to whoever is up.
   */
  humanCount: number
  startingStack: number
  smallBlind: number
  bigBlind: number
  ante: number
  /** Shows the hero the exact probability of ending up with each hand category, computed purely from their own cards and the board — a study aid, not something a real player would see. */
  showHandOdds: boolean
  /**
   * Present for a tournament: blinds escalate on the structure's own
   * schedule instead of staying fixed at `smallBlind`/`bigBlind`/`ante`
   * above, which still supply the opening level.
   */
  tournament?: { structure: TournamentStructure }
}

export interface SessionStats {
  handsPlayed: number
  /** Net profit/loss per human seat, keyed by player id. */
  netByPlayer: Record<string, number>
  /** Largest pot won by anyone, any hand, this session — a lifetime-stat feed, not shown at the table. */
  biggestPot: number
}

/**
 * Which model plays a given bot seat. Four flavors, so a table isn't one
 * kind of opponent wearing different names:
 *
 *   equity      — HeuristicBot. Hand strength and pot odds, nothing else.
 *   personality — PersonalityBot. Fixed aggression/tightness/bluff traits
 *                 bending those same thresholds, no memory, no psychology.
 *   psych       — PsychBot. The full prospect-theory/level-k/tilt/opponent-
 *                 learning model — see psych-bot.ts.
 *   solved      — a psych bot that gets upgraded, once the CFR blueprint
 *                 finishes downloading, to actually play the solved strategy
 *                 whenever a hand is genuinely heads-up at a trusted stack
 *                 depth (see the effect below), and plays as a psych bot the
 *                 rest of the time.
 *
 * RandomBot deliberately isn't in this mix: it shoves at random often enough
 * that hands stop being readable — the player can't form a story about what
 * just happened, which reads as the game jerking them around rather than
 * another kind of opponent.
 */
const BOT_KINDS = ['equity', 'personality', 'psych', 'solved'] as const
type BotKind = (typeof BOT_KINDS)[number]

/**
 * Builds the table once: the engine, the human seat ids, one bot per
 * remaining seat, and which of those seats want the solved strategy once it
 * loads.
 *
 * Every table draws its own mix — which kind sits in which seat, which psych
 * archetype it plays, and how that archetype plays it — fresh, so a table
 * you've played before is not a table you've already solved.
 */
function buildTable(options: GameConfigOptions): {
  engine: HoldemEngine
  agents: Record<string, Agent>
  humanIds: string[]
  opponentModel: OpponentModel
  /** Bot seat ids waiting on the CFR blueprint to finish downloading. */
  solvedSeatIds: string[]
} {
  const humanCount = Math.min(Math.max(options.humanCount, 1), options.playerCount)

  const players: PlayerSetup[] = Array.from({ length: options.playerCount }, (_, i) => {
    const isHuman = i < humanCount
    return {
      id: `p${i}`,
      name: isHuman ? (humanCount === 1 ? 'You' : `Player ${i + 1}`) : BOT_NAMES[(i - humanCount) % BOT_NAMES.length],
      stack: options.startingStack,
    }
  })

  const engine = new HoldemEngine(players, {
    smallBlind: options.smallBlind,
    bigBlind: options.bigBlind,
    ante: options.ante,
  })

  const humanIds = players.slice(0, humanCount).map((p) => p.id)
  const agents: Record<string, Agent> = {}
  const opponentModel = new OpponentModel()
  const tableRng = createRng()
  const cast = [...CAST]
  shuffle(cast, tableRng)
  const solvedSeatIds: string[] = []

  players.slice(humanCount).forEach((p, i) => {
    const kind: BotKind = BOT_KINDS[Math.floor(tableRng() * BOT_KINDS.length)]
    const psychBot = () =>
      new PsychBot(randomizeProfile(cast[i % cast.length], tableRng), options.startingStack, createRng(), opponentModel)

    switch (kind) {
      case 'equity':
        agents[p.id] = new HeuristicBot(createRng())
        break
      case 'personality':
        agents[p.id] = new PersonalityBot(randomizePersonalityProfile(tableRng), createRng())
        break
      case 'solved':
        // A psych bot until the blueprint lands and this seat's hand is
        // actually heads-up at a depth it trusts — see the swap effect.
        agents[p.id] = psychBot()
        solvedSeatIds.push(p.id)
        break
      case 'psych':
        agents[p.id] = psychBot()
        break
    }
  })

  return { engine, agents, humanIds, opponentModel, solvedSeatIds }
}

export function useHoldemGame(options: GameConfigOptions) {
  const hasStartedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Collapses every scripted pause while set. 'hand' runs to the end of the
   * hand; 'turn' stops as soon as the action reaches the player holding the
   * device. Both are the same mechanism — the only difference is when they
   * switch themselves off.
   */
  const turboRef = useRef<false | 'hand' | 'turn'>(false)

  const [{ engine, agents, humanIds, opponentModel, solvedSeatIds }] = useState(() => buildTable(options))
  /** Solo play never gates — there's only ever one person holding the device. */
  const soloHumanId = humanIds.length === 1 ? humanIds[0] : null

  const [state, setState] = useState<GameState | null>(null)
  const [speed, setSpeedState] = useState<Speed>(() => readEnum('poker.speed', ['slow', 'normal', 'fast'] as const, 'normal'))
  const [paused, setPaused] = useState(false)
  const [autoNextHand, setAutoNextHandState] = useState(
    () => readEnum('poker.autoNextHand', ['on', 'off'] as const, 'off') === 'on',
  )
  /** Non-null while the board is being dealt; nobody may act during it. */
  const [dealingStreet, setDealingStreet] = useState<Street | null>(null)
  const [session, setSession] = useState<SessionStats>({ handsPlayed: 0, netByPlayer: {}, biggestPot: 0 })
  /**
   * The running max survives in a ref rather than folding into `session`
   * directly because it has to accumulate across hands while everything
   * else in `session` is a snapshot of the one that just ended — putting it
   * in state too would mean reading the previous state to update it, inside
   * a setter that also needs the engine's fresh numbers.
   */
  const biggestPotRef = useRef(0)
  /**
   * Which human's cards and controls are currently exposed on screen, in a
   * pass-and-play game. Only meaningful when there's more than one human —
   * solo play bypasses it entirely via `soloHumanId`.
   */
  const [revealedFor, setRevealedFor] = useState<string | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** Scales a scripted pause by the current speed, or collapses it in turbo. */
  const pace = useCallback(
    (ms: number) => (turboRef.current ? 0 : Math.round(ms * SPEED_FACTOR[speed])),
    [speed],
  )

  /**
   * Tells every agent that wants to know how the hand it just played ended.
   * Only the psychological bots do — it is what feeds tilt, and tilt is the
   * one part of a bot here that carries anything from one hand to the next.
   */
  const reportResults = useCallback(() => {
    const results = engine.state.lastResults
    if (results.length === 0) return
    const potSize = results.reduce((sum, r) => sum + r.potAmount, 0)
    if (potSize === 0) return
    for (const player of engine.state.players) {
      const agent = agents[player.id]
      if (!agent?.observeResult) continue
      const won = results.reduce(
        (sum, r) => sum + (r.winnerIds.includes(player.id) ? r.potAmount / r.winnerIds.length : 0),
        0,
      )
      agent.observeResult({ stack: player.stack, shareWon: won / potSize, potSize })
    }
  }, [engine, agents])

  const commit = useCallback(() => {
    setState({ ...engine.state })
    if (!engine.state.handInProgress) {
      turboRef.current = false
      reportResults()
      for (const result of engine.state.lastResults) {
        biggestPotRef.current = Math.max(biggestPotRef.current, result.potAmount)
      }
      setSession({
        handsPlayed: engine.state.handNumber,
        biggestPot: biggestPotRef.current,
        netByPlayer: Object.fromEntries(
          humanIds.map((id) => {
            const player = engine.state.players.find((p) => p.id === id)
            return [id, (player?.stack ?? options.startingStack) - options.startingStack]
          }),
        ),
      })
    }
  }, [engine, humanIds, options.startingStack, reportResults])

  /**
   * Swaps the solved bot in, for whichever seats drew 'solved', once its
   * strategies have downloaded.
   *
   * Four trained depths (10/20/40/75bb) are a few megabytes together, which
   * is not something to put in front of a table that has no 'solved' seat
   * this game — so they're fetched only when at least one seat wants them,
   * and those seats keep playing as full psych bots until it lands.
   * `BlueprintSetBot` picks whichever trained depth is closest to the
   * table's actual effective stack, and that pick's own `BlueprintBot` only
   * ever plays the solved strategy when the hand it's actually in has
   * folded down to heads-up at a depth it trusts (see blueprint-bot.ts and
   * blueprint-set.ts) — anywhere else it defers straight back to the psych
   * bot passed as its fallback, which is the seat's whole personality the
   * rest of the time. `agents` is deliberately mutated rather than
   * replaced: the driver reads it by seat id at the moment it needs a
   * decision, so a bot that arrives mid-hand simply takes over from the
   * next one.
   */
  useEffect(() => {
    if (solvedSeatIds.length === 0) return

    let cancelled = false
    void Promise.all([
      import('../gto/holdem/blueprint-set'),
      import('../gto/holdem/blueprint-10.json'),
      import('../gto/holdem/blueprint-20.json'),
      import('../gto/holdem/blueprint-40.json'),
      import('../gto/holdem/blueprint-75.json'),
    ]).then(([module, ...files]) => {
      if (cancelled) return
      const trainedDepths = files.map((f) => f.default as never)
      for (const id of solvedSeatIds) {
        agents[id] = new module.BlueprintSetBot(trainedDepths, {
          fallback: agents[id],
          rng: createRng(),
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [agents, solvedSeatIds])

  /**
   * Applies an action and, when it turned a new street, holds the table still
   * long enough for the player to actually see the cards land.
   */
  const applyAndPace = useCallback(
    (action: PokerAction) => {
      const streetBefore = engine.state.street
      // Every action at the table, human or bot, goes through here — the one
      // place to feed the shared opponent model so every psych bot's read
      // stays current without each of them separately reconstructing it.
      opponentModel.observe(action)
      engine.act(action)
      const streetAfter = engine.state.street
      commit()
      if (streetAfter !== streetBefore && engine.state.handInProgress) {
        setDealingStreet(streetAfter)
      }
    },
    [engine, commit, opponentModel],
  )

  const startHand = useCallback(() => {
    clearTimer()
    turboRef.current = false
    setDealingStreet(null)
    setRevealedFor(null)
    // Rising blinds are a fact about the hand that's about to be dealt, not
    // about the engine, so this is the one line that makes a tournament a
    // tournament: mutate the config the engine is about to read, using
    // however many hands it has played so far to find the level. No engine
    // change earns its keep here — `startHand()` already re-reads
    // `state.config` from scratch every time.
    if (options.tournament) {
      const level = levelForHandsCompleted(options.tournament.structure, engine.state.handNumber)
      const { smallBlind, bigBlind, ante } = blindLevel(options.tournament.structure, level)
      engine.setBlinds({ smallBlind, bigBlind, ante })
    }
    engine.startHand()
    commit()
  }, [engine, clearTimer, commit, options.tournament])

  /** The human whose action controls are currently live: revealed, and it's their turn. */
  const activeHumanId = soloHumanId ?? revealedFor

  const humanAct = useCallback(
    (type: ActionType, amount?: number) => {
      if (!activeHumanId) return
      // Re-lock immediately — before the device visibly changes hands, not
      // after — so nothing from this decision lingers on screen for whoever
      // it's passed to next.
      setRevealedFor(null)
      applyAndPace({ playerId: activeHumanId, type, amount })
    },
    [activeHumanId, applyAndPace],
  )

  /** Called from the "pass the device" gate once the next human confirms it's them. */
  const revealCurrentPlayer = useCallback(() => {
    const current = engine.state.players[engine.state.currentPlayerIndex]
    if (current && humanIds.includes(current.id)) setRevealedFor(current.id)
  }, [engine, humanIds])

  useEffect(() => {
    if (hasStartedRef.current) return
    hasStartedRef.current = true
    startHand()
  }, [startHand])

  // Hold the table while the board is dealt, then release it.
  useEffect(() => {
    if (dealingStreet === null || paused) return
    const timer = setTimeout(() => setDealingStreet(null), pace(DEAL_PAUSE))
    return () => clearTimeout(timer)
  }, [dealingStreet, paused, pace])

  /**
   * Runs exactly one opponent decision. Exposed so the player can single-step
   * the table while paused — the clearest possible answer to "the game is
   * playing itself".
   */
  const step = useCallback(() => {
    const current = engine.state.players[engine.state.currentPlayerIndex]
    if (!engine.state.handInProgress || !current || humanIds.includes(current.id)) return
    applyAndPace(agents[current.id].decideAction(buildObservation(engine, current.id)))
  }, [engine, agents, humanIds, applyAndPace])

  // The driver: decides what happens next and when.
  useEffect(() => {
    if (!state || paused || dealingStreet !== null) return

    if (!state.handInProgress) {
      if (!autoNextHand || !engine.canStartHand()) return
      timerRef.current = setTimeout(startHand, pace(NEXT_HAND_PAUSE))
      return () => clearTimer()
    }

    const current = state.players[state.currentPlayerIndex]
    if (!current) return

    if (current.id === activeHumanId) {
      // Arrived. A "skip to my turn" has done its job and switches itself off
      // here rather than on a timer, so the table is back at normal speed the
      // instant the decision is yours.
      if (turboRef.current === 'turn') turboRef.current = false
      return
    }

    if (humanIds.includes(current.id)) {
      // A different human is up in a pass-and-play game — wait for them to
      // confirm the device has reached them before doing anything else.
      return
    }

    // Decide first, then pause for as long as that decision deserves. Nothing
    // else can touch the engine in between — this timer is the only driver.
    const action = agents[current.id].decideAction(buildObservation(engine, current.id))
    timerRef.current = setTimeout(() => applyAndPace(action), pace(THINK_TIME[action.type]))
    return () => clearTimer()
  }, [
    state,
    paused,
    dealingStreet,
    autoNextHand,
    engine,
    agents,
    humanIds,
    soloHumanId,
    activeHumanId,
    pace,
    applyAndPace,
    startHand,
    clearTimer,
  ])

  useEffect(() => clearTimer, [clearTimer])

  const setSpeed = useCallback((next: Speed) => {
    setSpeedState(next)
    writeString('poker.speed', next)
  }, [])

  const setAutoNextHand = useCallback((next: boolean) => {
    setAutoNextHandState(next)
    writeString('poker.autoNextHand', next ? 'on' : 'off')
  }, [])

  const currentPlayer = state?.handInProgress ? state.players[state.currentPlayerIndex] : undefined
  const isHumanTurn = Boolean(
    activeHumanId && currentPlayer?.id === activeHumanId && dealingStreet === null && !paused,
  )

  /** True when it's a different human's turn than whoever is currently revealed — pass-and-play only. */
  const needsReveal = Boolean(
    !soloHumanId &&
      state?.handInProgress &&
      currentPlayer &&
      humanIds.includes(currentPlayer.id) &&
      currentPlayer.id !== revealedFor &&
      dealingStreet === null &&
      !paused,
  )

  /** True once no human left in the hand can still act — the rest plays out among bots (or one all-in vs. bots). */
  const isSpectating = Boolean(
    state?.handInProgress &&
      currentPlayer &&
      !humanIds.includes(currentPlayer.id) &&
      humanIds.every((id) => {
        const p = state.players.find((pl) => pl.id === id)
        return !p || p.folded || p.isAllIn
      }),
  )

  const skipToEnd = useCallback(() => {
    turboRef.current = 'hand'
    setDealingStreet(null)
    setPaused(false)
  }, [])

  /**
   * Fast-forwards the opponents' deliberation and stops when the action gets
   * back to you. Replaces pre-actions: rather than committing to a decision
   * before seeing the price, you skip the waiting and then decide.
   */
  const skipToMyTurn = useCallback(() => {
    turboRef.current = 'turn'
    setDealingStreet(null)
    setPaused(false)
  }, [])

  return {
    state,
    humanIds,
    /** True for a solo game (one human vs. bots) rather than local pass-and-play. */
    isSolo: soloHumanId !== null,
    activeHumanId,
    activePlayer: state?.players.find((p) => p.id === activeHumanId),
    isHumanTurn,
    needsReveal,
    revealCurrentPlayer,
    /** Name of whoever the table is currently waiting on, if it isn't the revealed human. */
    waitingOn: currentPlayer && currentPlayer.id !== activeHumanId ? currentPlayer.name : null,
    dealingStreet,
    session,
    speed,
    setSpeed,
    paused,
    setPaused,
    step,
    skipToEnd,
    skipToMyTurn,
    isSpectating,
    autoNextHand,
    setAutoNextHand,
    startHand,
    humanAct,
    canStartHand: () => engine.canStartHand(),
  }
}
