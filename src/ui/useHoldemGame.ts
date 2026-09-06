import { useCallback, useEffect, useRef, useState } from 'react'
import { HoldemEngine } from '../poker/game-engine'
import type { PlayerSetup } from '../poker/game-engine'
import type { ActionType, GameState, PokerAction, Street } from '../poker/game-state'
import { HeuristicBot } from '../ai/heuristic-bot'
import { buildObservation } from '../ai/observation'
import type { Agent } from '../ai/agent'
import { createRng } from '../utils/random'
import { readEnum, writeString } from '../utils/storage'

const BOT_NAMES = ['Chip', 'Chris', 'Darla', 'Holly', 'Scarlet', 'Sparky', 'Connie', 'Lars', 'Nova']

export type Speed = 'slow' | 'normal' | 'fast'

/**
 * A decision the human commits to BEFORE the action reaches them. Real poker
 * clients call these pre-actions; they are the main way a player stays ahead
 * of the table instead of only ever reacting to it.
 *
 * Only offered solo — see `needsReveal` below for why pass-and-play tables
 * don't get this.
 */
export type PreAction = 'check-fold' | 'call-any'

/**
 * Turns a pre-action into a concrete move against the price the player
 * actually faces by the time their turn arrives — which may not be the price
 * they saw when they armed it.
 */
export function resolvePreAction(preAction: PreAction, toCall: number): ActionType {
  if (preAction === 'call-any') return toCall > 0 ? 'call' : 'check'
  return toCall > 0 ? 'fold' : 'check'
}

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
/** Beat held before a pre-action fires, so the player sees it happen. */
const PRE_ACTION_PAUSE = 320
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
}

export interface SessionStats {
  handsPlayed: number
  /** Net profit/loss per human seat, keyed by player id. */
  netByPlayer: Record<string, number>
}

/**
 * Builds the table once: the engine, the human seat ids, and one bot per
 * remaining seat.
 *
 * Every opponent plays the heuristic bot. RandomBot still exists for tests and
 * simulation, but at the table it shoves at random often enough that hands stop
 * being readable — the player can't form a story about what just happened,
 * which reads as the game jerking them around.
 */
function buildTable(options: GameConfigOptions): {
  engine: HoldemEngine
  agents: Record<string, Agent>
  humanIds: string[]
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
  for (const p of players.slice(humanCount)) {
    agents[p.id] = new HeuristicBot(createRng())
  }

  return { engine, agents, humanIds }
}

export function useHoldemGame(options: GameConfigOptions) {
  const hasStartedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Set while fast-forwarding a hand no human can still act in. */
  const turboRef = useRef(false)

  const [{ engine, agents, humanIds }] = useState(() => buildTable(options))
  /** Solo play never gates — there's only ever one person holding the device. */
  const soloHumanId = humanIds.length === 1 ? humanIds[0] : null

  const [state, setState] = useState<GameState | null>(null)
  const [speed, setSpeedState] = useState<Speed>(() => readEnum('poker.speed', ['slow', 'normal', 'fast'] as const, 'normal'))
  const [paused, setPaused] = useState(false)
  const [autoNextHand, setAutoNextHandState] = useState(
    () => readEnum('poker.autoNextHand', ['on', 'off'] as const, 'off') === 'on',
  )
  const [preAction, setPreAction] = useState<PreAction | null>(null)
  /** Non-null while the board is being dealt; nobody may act during it. */
  const [dealingStreet, setDealingStreet] = useState<Street | null>(null)
  const [session, setSession] = useState<SessionStats>({ handsPlayed: 0, netByPlayer: {} })
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

  const commit = useCallback(() => {
    setState({ ...engine.state })
    if (!engine.state.handInProgress) {
      turboRef.current = false
      setSession({
        handsPlayed: engine.state.handNumber,
        netByPlayer: Object.fromEntries(
          humanIds.map((id) => {
            const player = engine.state.players.find((p) => p.id === id)
            return [id, (player?.stack ?? options.startingStack) - options.startingStack]
          }),
        ),
      })
    }
  }, [engine, humanIds, options.startingStack])

  /**
   * Applies an action and, when it turned a new street, holds the table still
   * long enough for the player to actually see the cards land.
   */
  const applyAndPace = useCallback(
    (action: PokerAction) => {
      const streetBefore = engine.state.street
      engine.act(action)
      const streetAfter = engine.state.street
      commit()
      if (streetAfter !== streetBefore && engine.state.handInProgress) {
        setDealingStreet(streetAfter)
      }
    },
    [engine, commit],
  )

  const startHand = useCallback(() => {
    clearTimer()
    turboRef.current = false
    setPreAction(null)
    setDealingStreet(null)
    setRevealedFor(null)
    engine.startHand()
    commit()
  }, [engine, clearTimer, commit])

  /** The human whose action controls are currently live: revealed, and it's their turn. */
  const activeHumanId = soloHumanId ?? revealedFor

  const humanAct = useCallback(
    (type: ActionType, amount?: number) => {
      if (!activeHumanId) return
      setPreAction(null)
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
      // Pre-actions only exist solo — see the PreAction doc comment.
      if (!soloHumanId || !preAction) return
      const resolved = resolvePreAction(preAction, state.currentBet - current.betThisStreet)
      timerRef.current = setTimeout(() => {
        setPreAction(null)
        applyAndPace({ playerId: activeHumanId, type: resolved })
      }, pace(PRE_ACTION_PAUSE))
      return () => clearTimer()
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
    preAction,
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
    turboRef.current = true
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
    isSpectating,
    autoNextHand,
    setAutoNextHand,
    preAction,
    setPreAction,
    startHand,
    humanAct,
    canStartHand: () => engine.canStartHand(),
  }
}
