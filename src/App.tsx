import './App.css'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { MenuScreen } from './ui/MenuScreen'
import { Lobby } from './ui/Lobby'
import { RoomLobby } from './ui/RoomLobby'
import { getLook, subscribeLook } from './game/settings'
import { TournamentResults } from './ui/TournamentResults'
import { YourPlay } from './ui/YourPlay'
import { SettingsScreen } from './ui/Settings'
import { TableSeating } from './ui/TableSeating'
import { TourHub } from './ui/TourHub'
import { HostEntry, JoinEntry, type HostSetup } from './ui/home/HomeEntry'
import { RoomScreen } from './ui/home/HomeScreens'
import { NearbyIntro } from './ui/home/NearbyIntro'
import { NearbyHostScreen } from './ui/home/NearbyHostScreen'
import { NearbyJoin } from './ui/home/NearbyJoin'
import { loadNearbyRoom, type NearbyStart } from './home/p2p'
import { isRoomCode } from './home/room'
import { loadHost, loadMe, saveHost, saveMe } from './home/saved'
import { createRoom, roomStatus, type RoomInfo } from './home/socket'
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
  cityById,
  loadTour,
  planEvent,
  prizeFor,
  purseFor,
  recordTourResult,
  saveTour,
  structureFor,
  type City,
  type TourData,
} from './game/tour'

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
  /** The World Tour city this table is in. */
  cityId: string
}

type GameEntry = CashEntry | QuickEntry | TournamentGameEntry

type Screen =
  | { kind: 'lobby' }
  | { kind: 'cash-setup' }
  | { kind: 'quick-setup' }
  | { kind: 'seating'; config: GameConfigOptions; entry: CashEntry | TournamentGameEntry; seats: SeatPlan[]; title: string }
  | { kind: 'game'; config: GameConfigOptions; entry: GameEntry }
  | { kind: 'results'; outcome: TournamentOutcome }
  | { kind: 'tour' }
  | { kind: 'home-host-setup' }
  | { kind: 'home-join'; code: string }
  | { kind: 'home-room'; code: string; playerId: string; seatKey: string; name?: string; hostToken?: string }
  | { kind: 'nearby-intro' }
  | { kind: 'nearby-host-setup' }
  | { kind: 'nearby-host'; resume?: boolean; setup?: HostSetup; start: NearbyStart }
  | { kind: 'nearby-join' }
  | { kind: 'your-play' }
  | { kind: 'settings' }

interface TournamentExitPayload {
  standings: Standing[]
  names: Record<string, string>
  humanId: string
  /** True when the human quit rather than the tournament actually concluding — see LeaveDialog's note on what that does and doesn't tell you. */
  forfeited: boolean
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
      readOnYou={game.isSolo ? game.readOnYou : undefined}
      reviewHand={config.handReview ? game.lastHand : null}
      hint={game.hint}
    />
  )
}

function App() {
  const [profile, setProfile] = useState<Profile>(() => loadProfile())
  // A shared link (.../?room=1234) opens straight onto joining that room.
  const [linkedRoom] = useState(() => {
    const code = new URLSearchParams(location.search).get('room')
    return code && isRoomCode(code) ? code : null
  })
  const [screen, setScreen] = useState<Screen>(() => (linkedRoom ? { kind: 'home-join', code: linkedRoom } : { kind: 'lobby' }))
  const [pendingNearby, setPendingNearby] = useState<HostSetup | null>(null)
  const [mode, setMode] = useState<GameMode>(() => (linkedRoom ? 'home' : loadMode()))
  const [tour, setTour] = useState<TourData>(() => loadTour())
  const look = useSyncExternalStore(subscribeLook, getLook)
  useEffect(() => {
    saveTour(tour)
  }, [tour])

  // The bankroll is the one thing in this app that has to survive a closed
  // tab, so every change to it is written straight through rather than only
  // on the way out — a crash mid-session should lose at most the hand in
  // progress, not the last several buy-ins.
  useEffect(() => {
    saveProfile(profile)
  }, [profile])

  const goLobby = () => setScreen({ kind: 'lobby' })

  // The room you were hosting: is it still there, and how many are seated? Asked of the server whenever the lobby opens.
  const savedRoom = loadHost()?.code ?? null
  const [fetchedRoom, setFetchedRoom] = useState<{ code: string; info: RoomInfo | null } | null>(null)
  const inLobby = screen.kind === 'lobby'
  useEffect(() => {
    if (!savedRoom || !inLobby) return
    let current = true
    void roomStatus(savedRoom).then((info) => {
      if (current) setFetchedRoom({ code: savedRoom, info })
    })
    return () => {
      current = false
    }
  }, [savedRoom, inLobby])
  const savedRoomStatus = fetchedRoom?.code === savedRoom ? fetchedRoom.info : null

  /** Makes the room on the server; returns a message to show if that failed. */
  const handleOpenRoom = async ({ config, hostName, cards }: HostSetup): Promise<string | null> => {
    let room: { code: string; hostToken: string }
    try {
      room = await createRoom(config, cards)
    } catch (error) {
      return error instanceof Error ? error.message : 'Couldn’t open a room.'
    }
    const me = loadMe()
    if (hostName) saveMe({ ...me, name: hostName })
    saveHost({ ...room, playerId: me.playerId, seatKey: me.seatKey })
    setScreen({ kind: 'home-room', code: room.code, playerId: me.playerId, seatKey: me.seatKey, name: hostName ?? undefined, hostToken: room.hostToken })
    return null
  }

  /** Back to the room this phone is hosting: the seat and dealer's rights come back with the token. */
  const handleResumeRoom = () => {
    const saved = loadHost()
    if (!saved) return
    setScreen({ kind: 'home-room', code: saved.code, playerId: saved.playerId, seatKey: saved.seatKey, hostToken: saved.hostToken })
  }

  const handleJoinRoom = (code: string, name: string) => {
    const me = { ...loadMe(), name, code }
    saveMe(me)
    setScreen({ kind: 'home-room', code, playerId: me.playerId, seatKey: me.seatKey, name })
  }

  /** Opens a nearby table on this phone: no server, so nothing can fail but the browser itself. */
  const handleOpenNearby = async (setup: HostSetup, confirmed = false): Promise<string | null> => {
    // A new table overwrites the saved one, so ask first when there is an unfinished table.
    if (!confirmed && loadNearbyRoom()) {
      setPendingNearby(setup)
      return null
    }
    setPendingNearby(null)
    if (setup.hostName) saveMe({ ...loadMe(), name: setup.hostName })
    setScreen({ kind: 'nearby-host', setup, start: { config: setup.config, cards: setup.cards } })
    return null
  }

  const handleResumeNearby = () => {
    const saved = loadNearbyRoom()
    if (saved) setScreen({ kind: 'nearby-host', resume: true, start: { resume: saved } })
  }

  const leaveHome = () => {
    // Drop a ?room= link from the address bar, so a reload lands in the lobby rather than rejoining.
    if (location.search) history.replaceState(null, '', location.pathname)
    goLobby()
  }

  const handleModeChange = (next: GameMode) => {
    setMode(next)
    saveMode(next)
  }

  const handleStartQuick = (config: GameConfigOptions) => {
    setScreen({ kind: 'game', config, entry: { mode: 'quick', buyIn: 0 } })
  }

  /** Takes the buy-in and deals. The one place a game's money leaves the bankroll. */
  const beginGame = (config: GameConfigOptions, entry: CashEntry | TournamentGameEntry) => {
    if (!canAffordBuyIn(profile.bankroll, entry.buyIn)) return
    setProfile((p) => applyBuyIn(p, entry.buyIn))
    setScreen({ kind: 'game', config, entry })
  }

  /**
   * A solo table seats rivals and walk-ins, and you see who's there
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
      beginGame(config, entry)
      return
    }
    setScreen({ kind: 'seating', config, entry, seats, title })
  }

  const handleSit = () => {
    if (screen.kind !== 'seating') return
    const rivals = new RivalSession(loadRivals(), screen.seats, screen.config.startingStack, saveRivals)
    beginGame({ ...screen.config, rivals }, screen.entry)
  }

  const handleStartCash = (config: GameConfigOptions) => {
    toTable(
      config,
      { mode: 'cash', buyIn: config.startingStack },
      `$${config.smallBlind}/$${config.bigBlind} cash game, $${config.startingStack.toLocaleString()} buy-in`,
    )
  }

  /** A World Tour table: the city's rivals and a walk-in, seated at the city's strength; the buy-in is taken when you sit. */
  const handlePlayCity = (city: City) => {
    toTable(
      tournamentConfig(structureFor(city), FIELD_SIZE),
      {
        mode: 'tournament',
        buyIn: city.buyIn,
        fieldSize: FIELD_SIZE,
        structure: structureFor(city),
        prizePool: purseFor(city),
        cityId: city.id,
      },
      `${city.city}, ${city.room}: $${city.buyIn.toLocaleString()} buy-in`,
      planEvent(city.id, createRng()),
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
    const city = cityById(entry.cityId)
    if (city) setTour((t) => recordTourResult(t, city.id, finish))
    // A quit pays exactly what that finish is worth, same as busting there
    // naturally would — real tournaments don't confiscate money you'd
    // already locked up just because you stopped playing it out. `forfeited`
    // only changes what the results screen says about the rest of the field.
    const prize = city ? prizeFor(city, finish) : 0

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
        city: city?.city,
        forfeited: payload.forfeited,
      },
    })
  }

  return (
    <>
      {renderScreen()}
    </>
  )

  function renderScreen() {
  switch (screen.kind) {
    case 'lobby': {
      const LobbyView = look.theme === 'realistic' ? RoomLobby : Lobby
      return (
        <LobbyView
          profile={profile}
          mode={mode}
          onModeChange={handleModeChange}
          onChooseQuick={() => setScreen({ kind: 'quick-setup' })}
          onClaimDailyStake={() => setProfile((p) => claimDailyStake(p))}
          onResetProfile={() => setProfile(defaultProfile())}
          onChooseCash={() => setScreen({ kind: 'cash-setup' })}
          tour={tour}
          onChooseTour={() => setScreen({ kind: 'tour' })}
          savedRoom={savedRoom}
          savedRoomStatus={savedRoomStatus}
          onHostGame={() => setScreen({ kind: 'home-host-setup' })}
          onResumeRoom={handleResumeRoom}
          onJoinGame={() => setScreen({ kind: 'home-join', code: '' })}
          onNearby={() => setScreen({ kind: 'nearby-intro' })}
          onResumeNearby={handleResumeNearby}
          onOpenYourPlay={() => setScreen({ kind: 'your-play' })}
          onOpenSettings={() => setScreen({ kind: 'settings' })}
        />
      )
    }
    case 'cash-setup':
      return <MenuScreen bankroll={profile.bankroll} onBack={goLobby} onStart={handleStartCash} />
    case 'quick-setup':
      return <MenuScreen variant="quick" onBack={goLobby} onStart={handleStartQuick} />
    case 'seating':
      return (
        <TableSeating
          seats={screen.seats}
          rivals={loadRivals()}
          title={screen.title}
          onSit={handleSit}
          onBack={screen.entry.mode === 'tournament' ? () => setScreen({ kind: 'tour' }) : goLobby}
        />
      )
    case 'home-host-setup':
      return <HostEntry initialName={loadMe().name} onOpen={handleOpenRoom} onBack={goLobby} />
    case 'home-join':
      return <JoinEntry initialName={loadMe().name} initialCode={screen.code} lastCode={loadMe().code} onJoin={handleJoinRoom} onBack={leaveHome} />
    case 'nearby-intro':
      return <NearbyIntro onHost={() => setScreen({ kind: 'nearby-host-setup' })} onJoin={() => setScreen({ kind: 'nearby-join' })} onBack={goLobby} />
    case 'nearby-host-setup':
      return (
        <>
          <HostEntry nearby initialName={loadMe().name} onOpen={(setup) => handleOpenNearby(setup)} onBack={() => setScreen({ kind: 'nearby-intro' })} />
          {pendingNearby && (
            <div className="nearby-host-bar" role="alertdialog" aria-label="Unfinished table">
              <span className="home-leave-confirm">
                You have an unfinished table. Starting a new one discards it.
                <button type="button" className="lobby-reset-link" onClick={() => setPendingNearby(null)}>
                  Cancel
                </button>
                <button type="button" className="lobby-reset-link" onClick={() => void handleOpenNearby(pendingNearby, true)}>
                  Start new
                </button>
              </span>
            </div>
          )}
        </>
      )
    case 'nearby-host':
      return <NearbyHostScreen start={screen.start} name={screen.setup?.hostName ?? undefined} onExit={goLobby} />
    case 'nearby-join':
      return <NearbyJoin initialName={loadMe().name} onBack={goLobby} />
    case 'home-room':
      return (
        <RoomScreen
          code={screen.code}
          playerId={screen.playerId}
          seatKey={screen.seatKey}
          name={screen.name}
          hostToken={screen.hostToken}
          onExit={leaveHome}
        />
      )
    case 'tour':
      return (
        <TourHub
          tour={tour}
          bankroll={profile.bankroll}
          onPlay={(cityId) => {
            const city = cityById(cityId)
            if (city) handlePlayCity(city)
          }}
          onBack={goLobby}
        />
      )
    case 'game':
      return (
        <GameScreen
          config={screen.config}
          entry={screen.entry}
          onTableExit={handleTableExit}
          onTournamentExit={handleTournamentExit}
        />
      )
    case 'results':
      return (
        <TournamentResults
          outcome={screen.outcome}
          onBackToLobby={() => setScreen({ kind: 'tour' })}
          backLabel="Back to the World Tour"
        />
      )
    case 'your-play':
      return <YourPlay onBack={goLobby} />
    case 'settings':
      return <SettingsScreen onBack={goLobby} />
  }
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
