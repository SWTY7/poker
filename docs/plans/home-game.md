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

### 2. The room: PeerJS host and joiners

- Add the `peerjs` dependency. `src/home/room.ts`: the host creates the peer and joiners connect.
  - Joiners send commands; the host validates them with the reducer and broadcasts the new state.
  - The host is the only source of truth. A joiner's own command is echoed back as state, never applied
    locally first.
- A message protocol with a version number, plus reconnection (heartbeat, rejoin by player id).
- Tests: the protocol and reducer glue, with a fake in-memory transport. The real connection is checked in
  the browser with two tabs.

### 3. Screens

- Lobby Home Game mode, Host setup, Join, the shared table view (phone-first), the host's dealer controls,
  and the showdown picker. Built on the existing `menu-*` and table visual vocabulary.
- Browser check: host plus two joiners in separate tabs, through a full hand with a side pot and a split.

## Out of scope for now

- Online play with dealt cards (the app shuffling and dealing to each phone privately). The pieces above are
  built so it can follow.
- Any record in the profile or Career: home game money is play money between friends and never touches
  the bankroll.
- A self-hosted signaling or TURN server. Revisit only if PeerJS's public server proves unreliable in use.

## Done means

Each step: tests for the pure logic, `npx tsc -b`, `npx oxlint`, `npx vitest run`, and a browser check
(multi-tab for steps 2 and 3). `docs/PROGRESS.md` gets a line per step, and this file's steps are ticked.
