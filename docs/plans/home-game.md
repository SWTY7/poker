# Plan: home game (real cards, phones as chips)

*Decided with the user 2026-09-28. Built after game-modes step 3 (Career seasons), on its own branch
(`claude/home-game-*`). Part of the game-elements track: see `README.md`.*

## What it is

Friends sit at a real table with a real deck. There are no chips. The app keeps the money: every player's
stack, the blinds and the button, whose turn it is, what's been bet on each street, and the pot and side
pots. One person is the **host** (the dealer). Everyone else **joins** from their own phone through the
github.io link and a **4-digit room number**.

The app never sees a card. Hands aren't dealt or evaluated. The host moves the hand from preflop through
the flop, turn and river (after dealing the real cards) to the showdown, and at the showdown **picks the
winner or winners of each pot by hand**. The app then pays the pots out.

It's also the groundwork for online multiplayer later: the room, the connection and the shared table
state are the same pieces, and only card dealing is missing.

## Decisions already made

- **Transport: PeerJS** (WebRTC, using PeerJS's free public signaling server). No backend and no account.
  **Replaced 2026-09-29** by a Cloudflare Worker (see "Phase 2" below): direct phone-to-phone connections
  failed on a phone hotspot, and online cards need a server anyway.
  The host's device holds the real game state, and every joiner connects straight to it.
  - Room number → peer id `swty7-poker-<4 digits>`. Creating a room draws a random code and draws again if
    that id is taken.
  - Known limits, to say in the UI: the host's tab has to stay open, and a direct connection can fail on
    some strict networks (certain mobile carriers, corporate Wi-Fi). Players in the same room on the same
    Wi-Fi is the case it's built for.
- **Order:** after Career seasons (game-modes step 3), before timing tells and achievements.

## How it plays

- **Lobby:** a third mode, **Home Game**, next to Quick Play and Career. Its screen has two doors:
  **Host a game** and **Join a game** (a 4-digit code plus your name).
- **Host setup:** starting stack, blinds (and ante), and whether the host plays too or only deals.
  The host sees the room number in large type to read out, plus a list of who has joined. Seats can be
  reordered to match the real table, and the host starts the game.
- **One hand:**
  1. The host presses **New hand**. The button moves, the blinds are posted automatically, and it's preflop.
  2. Each player acts on their own phone when it's their turn: fold, check, call, bet or raise with an
     amount, all-in. Only legal actions are offered, and the minimum raise is enforced.
  3. When a street's betting closes, the host deals the real cards and presses **Flop**, then **Turn**,
     then **River**. If everyone but one folds, that player wins at once and no showdown is needed.
  4. **Showdown:** the host sees each pot (main pot and side pots, with who's eligible for each) and taps the
     winner(s) of each. A split is allowed, and odd chips go by seat order. The host confirms, stacks update,
     and a short summary shows on every phone.
- **Every phone shows:** the pot, the street, each seat's stack and bet this street, whose turn it is, and the
  dealer, small blind and big blind markers. It never shows cards, since there are none.
- **The host can also:**
  - act for a player whose phone died, or who has no phone
  - undo the last action (a real table misclick)
  - adjust a stack (rebuys, corrections)
  - seat or remove a player between hands, and pause
- **Reconnecting:** a joiner's id is kept in `localStorage`. After a reload or dropped connection they rejoin
  the same code and get their seat back. The host's own state is saved to `localStorage` after every change,
  so a host reload restores the table, and joiners reconnect to it.

## Build steps (each its own small PR)

### 1. The chips-only table, as pure logic — done 2026-09-28

*`src/home/table.ts`, tests in `tests/home/table.test.ts` (18, including a 4,000-step random session that
checks no chip is ever created or lost). `poker/betting.ts` needed no logic change: its functions now take
a `BettingState` (the card-free part of `GameState`), so the same rules run both games. Undo reaches back
as far as the current hand's deal, including a mis-tapped award, and never into the previous hand.
Joining mid-hand seats you folded until the next deal. A busted player is back in after a rebuy
(`adjustStack`).*

- `src/home/table.ts`: a reducer. `(state, command) → state`, with commands such as `join`, `seat`,
  `startHand`, `act`, `advanceStreet`, `award`, `undo`, `adjustStack`. No networking, no React.
- Reuse the engine's betting rules and side-pot math where they don't depend on cards (`src/poker/betting.ts`,
  `pot.ts`'s `computePots` / `distributePots`). Check at build time how much of `betting.ts` is card-free.
  Where it isn't, pull the pure part out rather than duplicating it.
- Tests: blinds and button rotation, legal actions and min-raise, a street closing, fold-to-one, side pots
  with a short all-in, split pots and odd chips, undo, and chips conserved across a whole session.

### 2. The room: PeerJS host and joiners — done 2026-09-28

*`src/home/room.ts` (`HostCore`, the protocol, no network; tests in `tests/home/room.test.ts`) and
`src/home/peer.ts` (the PeerJS wiring, `peerjs` 1.5). Joiners may only send `act` for their own id; every
other command is the host's alone. Phones get the table without its undo history, plus who's connected.
Joiners ping every 4 s and treat three missed beats as a lost host. A host reopening its own room number
retries for about 30 s while the signalling server lets go of the old id. Checked in two browser tabs over
the real PeerJS server: join, a raise round trip, an out-of-turn move refused with its reason, and a host
reload with the joiner reconnecting to the same seat mid-hand.*

- Add the `peerjs` dependency. `src/home/room.ts`: the host creates the peer and joiners connect.
  - Joiners send commands; the host validates them with the reducer and broadcasts the new state.
  - The host is the only source of truth. A joiner's own command is echoed back as state, never applied
    locally first.
- A message protocol with a version number, plus reconnection (heartbeat, rejoin by player id).
- Tests: the protocol and reducer glue, with a fake in-memory transport. The real connection is checked in
  the browser with two tabs.

### 3. Screens — done 2026-09-28

*Home Game is a third lobby mode (`mode.ts`), with Host / Join doors and "Reopen room N" when this phone
was hosting. `src/ui/home/`: `HomeEntry` (host setup: stakes and "I'm playing too"; join: room number and
name), `HomeTable` (shared by host and players; dealer controls, showdown picker, seat and stack editing,
and blinds only on the host), and `useHomeRoom` (hooks around `peer.ts`). `src/home/saved.ts` keeps the
host's room (`poker.home.host`) and this phone's player id (`poker.home.me`). A link `…/?room=1234` opens
straight onto joining. Found and fixed during the browser check:*
- *the host's own seat read as offline*
- *"all-in" labels outlived the hand*
- *a joiner could hang on an attempt that neither opened nor failed, so it now retries after 8 s*
- *a signalling reconnect could start a second connection*

*Checked with a host and two joiners in three tabs over real PeerJS: join by link, a stack edit, a
three-way all-in with a side pot, dealing the board out, a split main pot, undo, a host reload with "Reopen
room" (both joiners back within about 2 s), joiners reloading into their own seats, and phone width.*

- Lobby Home Game mode, Host setup, Join, the shared table view (phone-first), the host's dealer controls,
  and the showdown picker. Built on the existing `menu-*` and table visual vocabulary.
- Browser check: host plus two joiners in separate tabs, through a full hand with a side pot and a split.

## Phase 2: rooms on a server, and online cards (decided 2026-09-29)

*One branch, `claude/home-game-online`, a commit per step, one PR (the user's preference from now on).*

Why: phones couldn't reach each other on a phone hotspot (PeerJS's direct WebRTC connection, with its
free relay as a best-effort fallback). And the user wants a second card mode where the app deals, with
**nobody able to peek**, which means the deck can't live on any player's phone, the host's included.

Decisions:
- **Server: a Cloudflare Worker with a Durable Object per room, on Cloudflare's free plan.** Every phone
  holds a WebSocket to its room over ordinary HTTPS, so any network that loads a web page works: hotspot,
  cellular, school Wi-Fi. The free plan allows 100,000 requests a day, with incoming WebSocket messages
  billed 20:1, which is far more than friends' games use. Firebase was considered, but hiding the deck needs
  server code, and Firebase only deploys Cloud Functions on its paid Blaze plan.
- **The room runs on the server, not the host's phone.** The same `src/home/table.ts` reducer, bundled into
  the Worker. The host is whoever created the room: they get a secret host token (kept in `localStorage`),
  and dealer commands need it. Their tab no longer has to stay open for the room to live. PeerJS is removed.
- **Two card modes, picked when the room is created:**
  - **Real cards** (today's game): the host deals the real deck, advances the streets and picks each pot's
    winner.
  - **Online cards:** the server shuffles (crypto-random), deals, and sends each phone **only its own hole
    cards**. The board is dealt automatically when a street's betting closes, and the showdown is
    evaluated with the engine's own `hand-evaluator.ts`. Cards still in at showdown are shown to everyone.
    Folded hands are never revealed. The host keeps seat, stack, blind and pause controls, but has no
    dealing or award buttons and never sees a card that isn't theirs.
- **Room numbers** stay 4 digits. The Worker maps a number to its Durable Object, refuses to create a room
  that already exists, and lets an idle room expire.

Steps:
1. **Table: card mode.** *Done 2026-09-29.* `table.ts` gains `cards: 'real' | 'online'`. In online mode the reducer keeps a
   deck and hole cards, advances streets by itself, and settles the showdown itself. There's a per-player
   `viewFor(state, playerId)` that strips every other player's hole cards and the deck. Tests: no view ever
   contains another player's cards or the deck; the showdown pays the best hand with side pots; chips are
   conserved over a long random session in both modes.
2. **The server.** *Done 2026-09-29. Added along the way: a private per-phone **seat key**. Every phone
   sees every player id, so an id alone could have taken over someone's seat and seen their cards. Seats
   are now claimed with the key, and the server refuses anyone else.* `server/` holds a Worker plus a `Room` Durable Object (`wrangler.toml`), running the
   reducer. It speaks the existing protocol over WebSocket and sends per-player views. Create / join / host
   token. Tests: the room logic runs on a fake socket under vitest. `wrangler dev` runs it locally with no
   account.
3. **Client.** *Done 2026-09-29. Checked in three tabs against `wrangler dev`: each page held only its own
   two cards, the host had no dealing or award buttons, the board dealt itself, and the showdown paid the
   right hand (a pair of jacks over eights and sevens) with the hands still in shown.* `src/home/socket.ts` replaces `peer.ts`, connecting to `VITE_ROOM_SERVER` and reconnecting.
   The host setup gets a Real cards / Online cards toggle. `HomeTable` shows your own cards and the board
   using the existing `CardView`, and cards turned over at showdown. Browser check in three tabs against
   `wrangler dev`.
4. **Deploy.** The user creates a free Cloudflare account and runs `npx wrangler login`, then
   `npm run server:deploy` publishes the Worker. Its URL goes in the Pages build (`VITE_ROOM_SERVER`).
   Checked on real phones, including the hotspot that failed before.

## The host's role (decided 2026-09-29)

Everyone brings their own phone and bets on it, so **nobody can act for another seat, the host included**.
The host runs the game's flow and nothing else:
- **Deals each hand.** With real cards, the host also turns the streets and picks each pot's winner.
- **Keeps the table in order, between hands:** seat order to match the real table, removing someone who
  left, and the blinds.

Taken away from the host: acting for other players, and setting stacks. Nobody sets a stack; chips move only
by playing. A busted player **rebuys** from their own phone, between hands, for the starting stack. **Undo**
belongs to whoever took the last step: a player can take back their own last move, and the host its own
last deal or payout. The server enforces all of this (`RoomCore.authorise`), not just the screens.

## Rising blinds, a house rule (decided 2026-10-02)

A cash game's blinds never move, and that's the default here too. But a home game is usually played until
one player has everything, and with fixed blinds a careful table never gets there. So the host can turn on
**rising blinds** (off by default, set when hosting or between hands): a live-style clock of 15, 20 or 30
minutes a level, started by the first deal. Each level's small blind is about half again the last, on
round amounts (5/10, 8/16, 15/30, 25/50, 40/80...: `game/blinds.ts`), and the big blind and ante keep
their proportion. A level that runs out mid-hand applies from the next deal. The clock is the server's
(`RoomCore` stamps `now` on every deal and every view), so no phone's clock matters, and every phone shows
the same countdown. Tournaments and Career seasons already rise on their own structures; cash games and
Quick Play stay fixed.

## Out of scope for now

- Online multiplayer with strangers (matchmaking, no host). The server room built in phase 2 is the piece it
  needs; what's missing is a lobby for finding a game.
- Any record in the profile or Career: home game money is play money between friends and never touches
  the bankroll.

## Done means

Each step: tests for the pure logic, `npx tsc -b`, `npx oxlint`, `npx vitest run`, and a browser check
(multi-tab for steps 2 and 3). `docs/PROGRESS.md` gets a line per step, and this file's steps are ticked.
