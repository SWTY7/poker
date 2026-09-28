import './App.css'
import { useEffect, useRef, useState } from 'react'
import { MenuScreen } from './ui/MenuScreen'
import { Lobby } from './ui/Lobby'
import { TournamentSetup } from './ui/TournamentSetup'
import type { TournamentEntry } from './ui/TournamentSetup'
import { TournamentResults } from './ui/TournamentResults'
import { TableSeating } from './ui/TableSeating'
import { CareerHub } from './ui/CareerHub'
import type { TournamentOutcome } from './ui/TournamentResults'
import { Table } from './ui/Table'
import { useHoldemGame } from './ui/useHoldemGame'
import type { GameConfigOptions } from './ui/useHoldemGame'
import {
  applyBuyIn,
  canAffordBuyIn,
  claimDailyStake,
  defaultProfile,
  loadProfile,
  recordTournamentResult,
  saveProfile,
  type Profile,
} from './game/profile'
import {
  blindLevel,
  isTournamentOver,
  prizeForPosition,
  tournamentHudInfo,
  tournamentStandings,
  type Standing,
  type TournamentStructure,
} from './game/tournament'
import { loadMode, profileAfterTableExit, saveMode, type GameMode } from './game/mode'
import { RivalSession, loadRivals, planTable, saveRivals, type SeatPlan } from './game/rivals'
import { createRng } from './utils/random'
import {
  FIELD_SIZE,
  YOU,
  finishingOrder,
  loadCareer,
  nextEvent,
  planEvent,
  recordEvent,
  saveCareer,
  type CareerData,
} from './game/career'

interface CashEntry {
  mode: 'cash'
  buyIn: number
}

/** Quick Play: nothing was bought in, so there is nothing to settle on the way out. */
interface QuickEntry {
  mode: 'quick'
  buyIn: 0
}

interface TournamentGameEntry {
  mode: 'tournament'
  buyIn: number
  fieldSize: number
  structure: TournamentStructure
  prizePool: number
  /**
   * A Career season event: who each seat is in the season's standings, by
   * player id (`p0` is you; a walk-in is null).
   */
  career?: { entrants: Record<string, string | null> }
}

type GameEntry = CashEntry | QuickEntry | TournamentGameEntry

type Screen =
  | { kind: 'lobby' }
  | { kind: 'cash-setup' }
  | { kind: 'quick-setup' }
  | { kind: 'tournament-setup' }
  | { kind: 'seating'; config: GameConfigOptions; entry: CashEntry | TournamentGameEntry; seats: SeatPlan[]; title: string }
  | { kind: 'game'; config: GameConfigOptions; entry: GameEntry }
  | { kind: 'results'; outcome: TournamentOutcome; backTo: 'lobby' | 'career' }
  | { kind: 'career' }

interface TournamentExitPayload {
  standings: Standing[]
  names: Record<string, string>
  humanId: string
  /** True when the human quit rather than the tournament actually concluding — see LeaveDialog's note on what that does and doesn't tell you. */
  forfeited: boolean
  /** Every player id, best finish first (`career.ts`'s `finishingOrder`). */
  order: string[]
  handsPlayed: number
  biggestPot: number
}

interface GameScreenProps {
  config: GameConfigOptions
  entry: GameEntry
  onTableExit: (finalStack: number, handsPlayed: number, biggestPot: number) => void
  onTournamentExit: (payload: TournamentExitPayload) => void
}

/**
 * Wraps the table with the one thing neither `useHoldemGame` nor `Table`
 * know anything about: what kind of session this is, and what "leaving"
 * means for it. A cash game's stack converts back to bankroll at face value;
 * a tournament's doesn't — a bust or a quit is the only outcome the profile
 * ever sees.
 */
function GameScreen({ config, entry, onTableExit, onTournamentExit }: GameScreenProps) {
  const game = useHoldemGame(config)
  const reportedRef = useRef(false)

  // A tournament ending on its own (down to one seat) has no button press to
  // hang the profile update on, so it's caught here instead: once a hand
  // finishes and only one player is left, that's the whole session.
  useEffect(() => {
    if (entry.mode !== 'tournament' || reportedRef.current) return
    if (!game.state || game.state.handInProgress) return
    if (!isTournamentOver(game.state)) return

    reportedRef.current = true
    const names = Object.fromEntries(game.state.players.map((p) => [p.id, p.name]))
    onTournamentExit({
      standings: tournamentStandings(game.state, entry.fieldSize),
      names,
      humanId: game.humanIds[0],
      forfeited: false,
      order: finishingOrder(game.state, game.humanIds[0], false),
      handsPlayed: game.session.handsPlayed,
      biggestPot: game.session.biggestPot,
    })
  }, [game.state, game.humanIds, game.session, entry, onTournamentExit])

  if (!game.state) {
    return <div className="app-placeholder">Loading…</div>
  }

  const tournamentHud =
    entry.mode === 'tournament' ? tournamentHudInfo(game.state, entry.structure, entry.fieldSize) : undefined

  const handleExit = () => {
    if (reportedRef.current) return
    const humanId = game.humanIds[0]
    const finalStack = game.state?.players.find((p) => p.id === humanId)?.stack ?? config.startingStack

    if (entry.mode !== 'tournament') {
      onTableExit(finalStack, game.session.handsPlayed, game.session.biggestPot)
      return
    }

    reportedRef.current = true
    // A voluntary quit only tells the app one thing for certain: how many
    // seats (including this one) were still alive the moment it happened.
    // That's the human's finish; the rest of the field's eventual order was
    // never played out, so this reports just the one row rather than
    // guessing at standings nobody simulated.
    const playersRemaining = game.state?.players.filter((p) => !p.isEliminated).length ?? entry.fieldSize
    const names = Object.fromEntries((game.state?.players ?? []).map((p) => [p.id, p.name]))
    onTournamentExit({
      standings: [{ playerId: humanId, position: playersRemaining }],
      names,
      humanId,
      forfeited: true,
      order: game.state ? finishingOrder(game.state, humanId, true) : [humanId],
      handsPlayed: game.session.handsPlayed,
      biggestPot: game.session.biggestPot,
    })
  }

  return (
    <Table
      state={game.state}
      humanIds={game.humanIds}
      isSolo={game.isSolo}
      activeHumanId={game.activeHumanId}
      isHumanTurn={game.isHumanTurn}
      needsReveal={game.needsReveal}
      onRevealCurrentPlayer={game.revealCurrentPlayer}
      waitingOn={game.waitingOn}
      dealingStreet={game.dealingStreet}
      session={game.session}
      speed={game.speed}
      onSpeed={game.setSpeed}
      paused={game.paused}
      onSetPaused={game.setPaused}
      onStep={game.step}
      onSkipToEnd={game.skipToEnd}
      onSkipToMyTurn={game.skipToMyTurn}
      isSpectating={game.isSpectating}
      autoNextHand={game.autoNextHand}
      onSetAutoNextHand={game.setAutoNextHand}
      onAction={game.humanAct}
      onNextHand={game.startHand}
      onExit={handleExit}
      showHandOdds={config.showHandOdds}
      startingStack={config.startingStack}
      canStartHand={game.canStartHand()}
      tournament={tournamentHud}
      practice={entry.mode === 'quick'}
    />
  )
}

function App() {
  const [profile, setProfile] = useState<Profile>(() => loadProfile())
  const [screen, setScreen] = useState<Screen>({ kind: 'lobby' })
  const [mode, setMode] = useState<GameMode>(() => loadMode())
  const [career, setCareer] = useState<CareerData>(() => loadCareer())

  useEffect(() => {
    saveCareer(career)
  }, [career])

  // The bankroll is the one thing in this app that has to survive a closed
  // tab, so every change to it is written straight through rather than only
  // on the way out — a crash mid-session should lose at most the hand in
  // progress, not the last several buy-ins.
  useEffect(() => {
    saveProfile(profile)
  }, [profile])

  const goLobby = () => setScreen({ kind: 'lobby' })

  const handleModeChange = (next: GameMode) => {
    setMode(next)
    saveMode(next)
  }

  const handleStartQuick = (config: GameConfigOptions) => {
    setScreen({ kind: 'game', config, entry: { mode: 'quick', buyIn: 0 } })
  }

  /** Takes the buy-in and deals. The one place a Career game's money leaves the bankroll. */
  const beginCareerGame = (config: GameConfigOptions, entry: CashEntry | TournamentGameEntry) => {
    if (!canAffordBuyIn(profile.bankroll, entry.buyIn)) return
    setProfile((p) => applyBuyIn(p, entry.buyIn))
    setScreen({ kind: 'game', config, entry })
  }

  /**
   * A solo Career table seats rivals and walk-ins, and you see who's there
   * before the buy-in is taken. Pass-and-play has no single "you" for a rival
   * to remember, so it deals straight in with a random table as before.
   */
  const toTable = (
    config: GameConfigOptions,
    entry: CashEntry | TournamentGameEntry,
    title: string,
    seats: SeatPlan[] = planTable(config.playerCount - 1, createRng()),
  ) => {
    if (!canAffordBuyIn(profile.bankroll, entry.buyIn)) return
    if (config.humanCount !== 1) {
      beginCareerGame(config, entry)
      return
    }
    setScreen({ kind: 'seating', config, entry, seats, title })
  }

  const handleSit = () => {
    if (screen.kind !== 'seating') return
    const rivals = new RivalSession(loadRivals(), screen.seats, screen.config.startingStack, saveRivals)
    beginCareerGame({ ...screen.config, rivals }, screen.entry)
  }

  const handleStartCash = (config: GameConfigOptions) => {
    toTable(
      config,
      { mode: 'cash', buyIn: config.startingStack },
      `$${config.smallBlind}/$${config.bigBlind} cash game, $${config.startingStack.toLocaleString()} buy-in`,
    )
  }

  const handleRegisterTournament = (registration: TournamentEntry) => {
    const config = tournamentConfig(registration.structure, registration.fieldSize)
    toTable(
      config,
      {
        mode: 'tournament',
        buyIn: registration.buyIn,
        fieldSize: registration.fieldSize,
        structure: registration.structure,
        prizePool: registration.buyIn * registration.fieldSize,
      },
      `${registration.structure.name} tournament, ${registration.fieldSize} players, $${registration.buyIn.toLocaleString()} buy-in`,
    )
  }

  /** The season's next event: the tier's own field, seated at the tier's strength. */
  const handlePlayEvent = () => {
    const event = nextEvent(career)
    const seats = planEvent(career, createRng())
    const entrants: Record<string, string | null> = { p0: YOU }
    seats.forEach((seat, i) => {
      entrants[`p${i + 1}`] = seat.kind === 'rival' ? seat.rival.id : null
    })
    toTable(
      tournamentConfig(event.structure, FIELD_SIZE),
      {
        mode: 'tournament',
        buyIn: event.tier.buyIn,
        fieldSize: FIELD_SIZE,
        structure: event.structure,
        prizePool: event.tier.buyIn * FIELD_SIZE,
        career: { entrants },
      },
      `${event.tier.name} season ${career.season}, event ${event.number} of ${event.of}: ${event.structure.name}, $${event.tier.buyIn} buy-in`,
      seats,
    )
  }

  const handleTableExit = (finalStack: number, handsPlayed: number, biggestPot: number) => {
    if (screen.kind === 'game' && screen.entry.mode !== 'tournament') {
      const entry = screen.entry
      setProfile((p) => profileAfterTableExit(p, entry, { finalStack, handsPlayed, biggestPot }))
    }
    goLobby()
  }

  const handleTournamentExit = (payload: TournamentExitPayload) => {
    if (screen.kind !== 'game' || screen.entry.mode !== 'tournament') {
      goLobby()
      return
    }
    const entry = screen.entry
    const finish = payload.standings.find((s) => s.playerId === payload.humanId)?.position ?? entry.fieldSize
    const careerEntrants = entry.career?.entrants
    if (careerEntrants) {
      setCareer((c) => recordEvent(c, payload.order.map((id) => careerEntrants[id] ?? null)))
    }
    // A quit pays exactly what that finish is worth, same as busting there
    // naturally would — real tournaments don't confiscate money you'd
    // already locked up just because you stopped playing it out. `forfeited`
    // only changes what the results screen says about the rest of the field.
    const prize = prizeForPosition(entry.prizePool, entry.fieldSize, finish)

    setProfile((p) =>
      recordTournamentResult(p, {
        buyIn: entry.buyIn,
        finish,
        field: entry.fieldSize,
        prize,
        handsPlayed: payload.handsPlayed,
        biggestPot: payload.biggestPot,
      }),
    )
    setScreen({
      kind: 'results',
      outcome: {
        standings: payload.standings,
        names: payload.names,
        humanId: payload.humanId,
        fieldSize: entry.fieldSize,
        prizePool: entry.prizePool,
        buyIn: entry.buyIn,
        forfeited: payload.forfeited,
      },
      backTo: careerEntrants ? 'career' : 'lobby',
    })
  }

  switch (screen.kind) {
    case 'lobby':
      return (
        <Lobby
          profile={profile}
          mode={mode}
          onModeChange={handleModeChange}
          onChooseQuick={() => setScreen({ kind: 'quick-setup' })}
          onClaimDailyStake={() => setProfile((p) => claimDailyStake(p))}
          onResetProfile={() => setProfile(defaultProfile())}
          onChooseCash={() => setScreen({ kind: 'cash-setup' })}
          onChooseTournament={() => setScreen({ kind: 'tournament-setup' })}
          career={career}
          onChooseCareer={() => setScreen({ kind: 'career' })}
        />
      )
    case 'cash-setup':
      return <MenuScreen bankroll={profile.bankroll} onBack={goLobby} onStart={handleStartCash} />
    case 'quick-setup':
      return <MenuScreen variant="quick" onBack={goLobby} onStart={handleStartQuick} />
    case 'tournament-setup':
      return <TournamentSetup bankroll={profile.bankroll} onBack={goLobby} onRegister={handleRegisterTournament} />
    case 'seating':
      return (
        <TableSeating
          seats={screen.seats}
          rivals={loadRivals()}
          title={screen.title}
          onSit={handleSit}
          onBack={screen.entry.mode === 'tournament' && screen.entry.career ? () => setScreen({ kind: 'career' }) : goLobby}
        />
      )
    case 'career':
      return (
        <CareerHub
          career={career}
          bankroll={profile.bankroll}
          onPlayEvent={handlePlayEvent}
          onDismissSeason={() => setCareer((c) => ({ ...c, lastSeason: null }))}
          onBack={goLobby}
        />
      )
    case 'game':
      return (
        <GameScreen config={screen.config} entry={screen.entry} onTableExit={handleTableExit} onTournamentExit={handleTournamentExit} />
      )
    case 'results':
      return (
        <TournamentResults
          outcome={screen.outcome}
          onBackToLobby={screen.backTo === 'career' ? () => setScreen({ kind: 'career' }) : goLobby}
          backLabel={screen.backTo === 'career' ? 'Back to the season' : undefined}
        />
      )
  }
}

/** A single-table tournament's table settings, opening at its first blind level. */
function tournamentConfig(structure: TournamentStructure, fieldSize: number): GameConfigOptions {
  const opening = blindLevel(structure, 1)
  return {
    playerCount: fieldSize,
    humanCount: 1,
    startingStack: structure.startingStack,
    smallBlind: opening.smallBlind,
    bigBlind: opening.bigBlind,
    ante: opening.ante,
    showHandOdds: false,
    tournament: { structure },
  }
}

export default App
