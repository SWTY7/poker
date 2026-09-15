import { useEffect, useMemo, useState } from 'react'
import type { ActionType, GameState, HandLogEntry } from '../poker/game-state'
import { getLegalActions, minRaiseTargetAmount, maxRaiseTargetAmount } from '../poker/betting'
import { committedPot, streetBetTotal, totalPot } from '../poker/pot'
import { positionLabels } from '../poker/position'
import { cardToString } from '../poker/card'
import { estimateHandOdds } from '../poker/equity'
import { currentHandName } from '../poker/hand-name'
import { Seat } from './Seat'
import { HeroZone } from './HeroZone'
import { Board } from './Board'
import { HandPotential } from './HandPotential'
import { Controls, SpectatingBar, WaitingBar, IdleBar, RevealGate } from './Controls'
import { HandFeed } from './HandFeed'
import { TableHud } from './TableHud'
import { PositionLegend } from './PositionLegend'
import { LeaveDialog } from './LeaveDialog'
import { useMediaQuery } from './useMediaQuery'
import type { Speed } from './useHoldemGame'

interface TableProps {
  state: GameState
  humanIds: string[]
  isSolo: boolean
  activeHumanId: string | null
  isHumanTurn: boolean
  needsReveal: boolean
  onRevealCurrentPlayer: () => void
  waitingOn: string | null
  dealingStreet: string | null
  session: { handsPlayed: number; netByPlayer: Record<string, number> }
  speed: Speed
  onSpeed: (speed: Speed) => void
  paused: boolean
  onSetPaused: (paused: boolean) => void
  onStep: () => void
  onSkipToEnd: () => void
  /** Fast-forwards the opponents and stops when the action reaches the hero. */
  onSkipToMyTurn: () => void
  isSpectating: boolean
  autoNextHand: boolean
  onSetAutoNextHand: (value: boolean) => void
  onAction: (type: ActionType, amount?: number) => void
  onNextHand: () => void
  onExit: () => void
  showHandOdds: boolean
  startingStack: number
  /** False once fewer than two players still have chips — the table is finished. */
  canStartHand: boolean
}

const STREET_BANNER: Record<string, string> = {
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
}

/**
 * What this player did on the CURRENT street. Scanning the whole hand instead
 * — as this used to — leaves a preflop "Raise $30" pinned to a seat while the
 * turn is being bet, which is worse than showing nothing.
 */
function lastActionThisStreet(log: HandLogEntry[], playerId: string, street: string): string | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i]
    if (entry.street !== street) break
    if (entry.kind !== 'action' || entry.playerId !== playerId) continue
    switch (entry.actionType) {
      case 'fold':
        return 'Folded'
      case 'check':
        return 'Check'
      case 'call':
        return `Call $${entry.amount?.toLocaleString()}`
      case 'bet':
        return `Bet $${entry.toAmount?.toLocaleString()}`
      case 'raise':
        return `Raise $${entry.toAmount?.toLocaleString()}`
      case 'all-in':
        return 'All-in'
    }
  }
  return undefined
}

/** One line of plain English for the screen-reader live region. */
function announce(log: HandLogEntry[], isHumanTurn: boolean, toCall: number): string {
  if (isHumanTurn) return toCall > 0 ? `Your turn. $${toCall.toLocaleString()} to call.` : 'Your turn. You can check.'
  const last = log[log.length - 1]
  if (!last) return ''
  if (last.kind === 'result') return last.message ?? ''
  if (last.kind === 'deal') return `${last.street}: ${last.cards?.map(cardToString).join(', ')}`
  if (last.kind !== 'action') return ''
  const verb =
    last.actionType === 'fold'
      ? 'folds'
      : last.actionType === 'check'
        ? 'checks'
        : last.actionType === 'call'
          ? `calls $${last.amount?.toLocaleString()}`
          : last.actionType === 'bet'
            ? `bets $${last.toAmount?.toLocaleString()}`
            : last.actionType === 'raise'
              ? `raises to $${last.toAmount?.toLocaleString()}`
              : 'is all-in'
  return `${last.playerName} ${verb}`
}

export function Table({
  state,
  humanIds,
  isSolo,
  activeHumanId,
  isHumanTurn,
  needsReveal,
  onRevealCurrentPlayer,
  waitingOn,
  dealingStreet,
  session,
  speed,
  onSpeed,
  paused,
  onSetPaused,
  onStep,
  onSkipToEnd,
  onSkipToMyTurn,
  isSpectating,
  autoNextHand,
  onSetAutoNextHand,
  onAction,
  onNextHand,
  onExit,
  showHandOdds,
  startingStack,
  canStartHand,
}: TableProps) {
  /**
   * "Compact" is about how much room the dock may take, so it is a question
   * of height as much as width. A landscape phone is 844px wide and 390px
   * tall: wide enough to have matched the desktop rules, and far too short to
   * afford the inline bet sizer, which pushed the pot off the table. Either
   * constraint puts bet sizing behind the Raise button instead.
   */
  const compact = useMediaQuery('(max-width: 820px), (max-height: 620px)')

  const activePlayer = state.players.find((p) => p.id === activeHumanId)
  const currentPlayer = state.handInProgress ? state.players[state.currentPlayerIndex] : undefined
  const positions = positionLabels(state)
  const dealerId = state.players[state.dealerIndex]?.id
  const smallBlindId = state.players[state.smallBlindIndex]?.id
  const bigBlindId = state.players[state.bigBlindIndex]?.id
  // Every seat renders in the seat row except whichever human is currently
  // revealed — that one gets the fixed hero zone at the bottom, large cards
  // and all, regardless of where they'd sit around a real table. In
  // pass-and-play, between two humans' turns nobody is revealed, so everyone
  // (humans included) shows up as a plain seat.
  const opponents = state.players.filter((p) => p.id !== activeHumanId)

  // The hand log is opt-in — most players only want the table itself in
  // front of them, not a running transcript, so it starts closed.
  const [showLog, setShowLog] = useState(false)
  const [showPositions, setShowPositions] = useState(false)
  const [showLeave, setShowLeave] = useState(false)
  const [showPotential, setShowPotential] = useState(false)

  // Keyed by the actual cards rather than object identity — the GameState
  // reference changes on every action (including opponents' actions that
  // don't touch the hero's cards or the board at all), which would
  // otherwise re-run the flop/turn enumeration far more than the cards
  // it depends on actually change.
  const holeKey = activePlayer?.holeCards.map(cardToString).join('') ?? ''
  const boardKey = state.communityCards.map(cardToString).join('')
  const handOdds = useMemo(() => {
    if (!showHandOdds || !activePlayer || activePlayer.holeCards.length < 2) return null
    return estimateHandOdds(activePlayer.holeCards, state.communityCards)
    // Deliberately keyed on the derived card strings, not on activePlayer/
    // state.communityCards themselves — see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHandOdds, holeKey, boardKey])

  const madeHand = useMemo(() => {
    if (!activePlayer || activePlayer.holeCards.length < 2) return null
    return currentHandName(activePlayer.holeCards, state.communityCards)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeKey, boardKey])

  // At showdown the engine has already swept the bets into `pots`; before that
  // the middle holds only what earlier streets contributed.
  const settled = state.pots.length > 0
  const middlePot = settled ? state.pots.reduce((s, p) => s + p.amount, 0) : committedPot(state.players)
  const inPlay = settled ? 0 : streetBetTotal(state.players)
  const potForSizing = totalPot(state.players)

  const heroLegalActions = activePlayer && isHumanTurn ? getLegalActions(state, activePlayer.id) : []
  const revealAll = state.street === 'showdown'
  const lastResult = !state.handInProgress && state.lastResults.length > 0 ? state.lastResults : null
  const winnerIds = new Set(lastResult?.flatMap((r) => r.winnerIds) ?? [])

  const soleNet = isSolo && humanIds[0] !== undefined ? (session.netByPlayer[humanIds[0]] ?? 0) : null

  /**
   * There is something to skip past: a hand is running, it isn't your turn,
   * and you still have a decision coming. Pass-and-play is excluded — nobody
   * is holding the device on anyone's behalf between two humans' turns.
   */
  const canSkipToMyTurn = Boolean(
    isSolo && state.handInProgress && !isHumanTurn && !isSpectating && !needsReveal && !paused,
  )

  /**
   * The winning hand by name — "Kings full of fours", not "full-house". The
   * engine records the category only, but at showdown every winner's cards
   * are known, so the table can say what a dealer would say.
   */
  const nameWinningHand = (winnerId: string, fallback?: string): string | undefined => {
    const winner = state.players.find((p) => p.id === winnerId)
    if (!winner || winner.holeCards.length < 2) return fallback?.replace(/-/g, ' ')
    return currentHandName(winner.holeCards, state.communityCards) ?? fallback?.replace(/-/g, ' ')
  }
  const heroToCall = activePlayer ? Math.max(state.currentBet - activePlayer.betThisStreet, 0) : 0

  /**
   * Space means one thing throughout: skip whatever you are waiting on and
   * get to the next decision that is actually yours. What that is depends on
   * where the hand is — deal the next one, run out a hand you can no longer
   * act in, or fast-forward the opponents back round to you. P pauses; S
   * single-steps while paused.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      if (event.key === ' ') {
        if (lastResult && canStartHand) {
          event.preventDefault()
          onNextHand()
        } else if (isSpectating) {
          event.preventDefault()
          onSkipToEnd()
        } else if (canSkipToMyTurn) {
          event.preventDefault()
          onSkipToMyTurn()
        }
      } else if (event.key.toLowerCase() === 'p') {
        onSetPaused(!paused)
      } else if (event.key.toLowerCase() === 's' && paused) {
        onStep()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    lastResult,
    canStartHand,
    isSpectating,
    canSkipToMyTurn,
    onNextHand,
    onSkipToEnd,
    onSkipToMyTurn,
    onSetPaused,
    onStep,
    paused,
  ])

  return (
    <div className="table-scene">
      <TableHud
        handNumber={state.handNumber}
        smallBlind={state.config.smallBlind}
        bigBlind={state.config.bigBlind}
        street={state.street}
        handsPlayed={session.handsPlayed}
        net={soleNet}
        speed={speed}
        onSpeed={onSpeed}
        paused={paused}
        onTogglePause={() => onSetPaused(!paused)}
        onStep={onStep}
        autoNextHand={autoNextHand}
        onToggleAutoNextHand={() => onSetAutoNextHand(!autoNextHand)}
        showLog={showLog}
        onToggleLog={() => setShowLog((v) => !v)}
        onShowPositions={() => setShowPositions(true)}
        onExit={() => setShowLeave(true)}
      />

      <div className="table-body">
        <div className="table-main">
          {/* The felt is a real object, not a background: everything that
              belongs to the table — the seats around it and the board in the
              middle — lives inside this one bounded surface, which is what
              makes it read as the centre of the screen rather than as another
              row of panels. */}
          {/* Tapping the felt is the touch equivalent of Space: the table is
              the biggest target on screen and there is nothing else to press
              while you're waiting. Buttons inside it keep their own handlers. */}
          <section
            className={`felt ${canSkipToMyTurn ? 'felt-skippable' : ''}`}
            aria-label="Table"
            onClick={(event) => {
              if (!canSkipToMyTurn) return
              if ((event.target as HTMLElement).closest('button, input, a')) return
              onSkipToMyTurn()
            }}
          >
            <div className="felt-seats" data-count={opponents.length}>
              {opponents.map((player) => (
                <Seat
                  key={player.id}
                  name={player.name}
                  stack={player.stack}
                  betThisStreet={player.betThisStreet}
                  folded={player.folded}
                  isAllIn={player.isAllIn}
                  isEliminated={player.isEliminated}
                  isDealer={player.id === dealerId}
                  isSmallBlind={player.id === smallBlindId}
                  isBigBlind={player.id === bigBlindId}
                  isCurrentTurn={state.handInProgress && player.id === currentPlayer?.id && !paused}
                  isWinner={winnerIds.has(player.id)}
                  // Once a hand has been decided, everyone who didn't win it
                  // steps back so the seat that did is the one you see.
                  hasLost={Boolean(lastResult) && !winnerIds.has(player.id)}
                  position={positions.get(player.id)}
                  lastAction={lastActionThisStreet(state.handLog, player.id, state.street)}
                  cards={revealAll ? player.holeCards : []}
                  revealCards={revealAll && !player.folded}
                />
              ))}
            </div>

            <Board
              communityCards={state.communityCards}
              potSize={middlePot}
              inPlay={inPlay}
              street={state.street}
            />

            {dealingStreet && STREET_BANNER[dealingStreet] && (
              <div className="street-banner" key={dealingStreet}>
                {STREET_BANNER[dealingStreet]}
              </div>
            )}

            {paused && <div className="paused-badge">Paused — S to step, P to resume</div>}
          </section>

          {activePlayer && (
            <HeroZone
              name={activePlayer.name}
              stack={activePlayer.stack}
              cards={activePlayer.holeCards}
              position={positions.get(activePlayer.id)}
              isDealer={activePlayer.id === dealerId}
              toCall={heroToCall}
              potOdds={heroToCall > 0 ? heroToCall / (potForSizing + heroToCall) : null}
              folded={activePlayer.folded}
              isAllIn={activePlayer.isAllIn}
              isMyTurn={isHumanTurn}
              madeHand={madeHand}
              onShowPotential={handOdds ? () => setShowPotential(true) : undefined}
              potentialOpen={showPotential}
            />
          )}

          {lastResult && !canStartHand ? (
            /* Terminal state. Offering "Next hand" here used to throw — the
               engine refuses to deal with fewer than two funded players — so
               the button that could not work is replaced by the one that
               can. */
            <div className="dock dock-result dock-over">
              <div className="result-lines">
                <div className="result-line">
                  <span className="result-winner">
                    {(activePlayer?.stack ?? 0) > 0 ? 'You took the table' : 'You’re out of chips'}
                  </span>
                  <span className="result-how">
                    {(activePlayer?.stack ?? 0) > 0
                      ? 'Everyone else is busted — there’s no one left to deal to.'
                      : 'That’s the session. Cash out to set up a new table.'}
                  </span>
                </div>
              </div>
              <button type="button" className="btn btn-lg btn-primary" onClick={() => setShowLeave(true)}>
                Cash out
              </button>
            </div>
          ) : lastResult ? (
            <div className="dock dock-result">
              <div className="result-lines">
                {lastResult.map((r, i) => (
                  <div key={i} className="result-line">
                    <span className="result-winner">
                      {r.winnerIds.map((id) => state.players.find((p) => p.id === id)?.name).join(' & ')}
                    </span>
                    <span className="result-amount money">+${r.potAmount.toLocaleString()}</span>
                    {r.category && (
                      <span className="result-how">{nameWinningHand(r.winnerIds[0], r.category)}</span>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-lg btn-primary" onClick={onNextHand}>
                Next hand <kbd>Space</kbd>
              </button>
            </div>
          ) : isHumanTurn && activePlayer ? (
            <Controls
              legalActions={heroLegalActions}
              toCall={heroToCall}
              minRaiseTo={minRaiseTargetAmount(state)}
              maxRaiseTo={maxRaiseTargetAmount(state, activePlayer.id)}
              potSize={potForSizing}
              stack={activePlayer.stack}
              compact={compact}
              onAction={onAction}
            />
          ) : needsReveal && currentPlayer ? (
            <RevealGate playerName={currentPlayer.name} onReveal={onRevealCurrentPlayer} />
          ) : isSpectating ? (
            <SpectatingBar
              message={
                isSolo
                  ? `You${activePlayer?.isAllIn ? "'re all-in" : ' folded'} — the hand plays on…`
                  : 'No more decisions for your table — the hand plays on…'
              }
              onSkip={onSkipToEnd}
            />
          ) : isSolo && state.handInProgress ? (
            <WaitingBar
              waitingOn={waitingOn}
              dealing={dealingStreet !== null}
              onSkip={onSkipToMyTurn}
            />
          ) : state.handInProgress ? (
            <IdleBar label={currentPlayer ? `${currentPlayer.name} is deciding…` : 'Waiting…'} />
          ) : null}
        </div>

        {/* On a wide screen the log is a side panel beside the table. On a
            phone there is no "beside", and stacking it under the table put it
            below the action dock — off the bottom of the screen, under the
            one thing that must always be reachable. So it becomes a sheet,
            like every other secondary surface on a phone. */}
        {showLog && !compact && <HandFeed log={state.handLog} activeId={activeHumanId} />}
      </div>

      {showLog && compact && (
        <div className="overlay overlay-sheet" onClick={() => setShowLog(false)}>
          <div
            className="sheet sheet-log"
            role="dialog"
            aria-modal="true"
            aria-label="Hand log"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-head">
              <h2 className="dialog-title">This hand</h2>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowLog(false)}>
                Done
              </button>
            </div>
            <HandFeed log={state.handLog} activeId={activeHumanId} />
          </div>
        </div>
      )}

      {/* Everything the table does, in one sentence, for anyone who can't see
          the seats light up. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announce(state.handLog, isHumanTurn, heroToCall)}
      </div>

      {showPositions && (
        <PositionLegend inUse={new Set(positions.values())} onClose={() => setShowPositions(false)} />
      )}

      {showPotential && handOdds && (
        <HandPotential odds={handOdds} madeHand={madeHand} onClose={() => setShowPotential(false)} />
      )}

      {showLeave && (
        <LeaveDialog
          handsPlayed={session.handsPlayed}
          net={soleNet}
          stack={activePlayer?.stack ?? startingStack}
          startingStack={startingStack}
          handInProgress={state.handInProgress}
          onConfirm={onExit}
          onCancel={() => setShowLeave(false)}
        />
      )}
    </div>
  )
}
