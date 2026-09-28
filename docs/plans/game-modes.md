# Plan: game modes, career, rivals

*Decided with the user 2026-09-28. Branch: a new one of its own (not the psychology branch). Read
`docs/plans/README.md` for how this track shares the codebase with the psychology track.*

## Decisions already made

- Two modes, switched from a toggle on the lobby screen (remembered per browser):
  - **Quick Play**: the simple test mode. No buy-ins, no tournaments, no bankroll. Only quick game settings:
    number of players, human seats, stack depth, blinds, speed. Bots get random characters every game, as now.
    A **hand review** toggle lives here (built by the psychology track; see the README).
  - **Career**: today's lobby (bankroll, cash games, tournaments) plus everything below. Cash games live
    only here.
- Rivals remember you, and you them, across sessions (two-way memory).
- Seasons: about 5 events each, 4 tiers.
- No explicit rivalry labels ("nemesis", "pigeon"). Memory and pre-tilt, yes.
- **Timing tells** in Career: how long a character takes to act depends on the decision and the character.
- **Basic achievements.**
- **Not every opponent is a rival.** Tables mix persistent rivals with **walk-ins**: random pros and random
  recreational players with no history, who are never remembered. A rival is recognizable; a walk-in is an
  unknown.

## Steps, in order (each its own small PR)

### 1. Mode toggle + Quick Play — done 2026-09-28

*Built as planned. The mode and the exit rule live in `src/game/mode.ts` (tested in `tests/game/mode.test.ts`);
Quick Play's setup is `MenuScreen variant="quick"`. Speed stays the table's own control, not a setup field.
The psychology track's hand-review toggle goes in `MenuScreen`'s "Study aids" group, shown only when
`variant === 'quick'`.*

- `src/ui/Lobby.tsx`: Quick / Career toggle, saved under a `localStorage` key (`poker.mode`).
- A Quick Play setup screen, built from `MenuScreen.tsx`'s settings minus buy-in and bankroll. It starts a game
  with no bankroll entry. `App.tsx`'s game exit must not record anything to the profile in this mode.
- Tests: Quick Play never changes the profile; the lobby toggle persists.

### 2. Rivals — done 2026-09-28

*Built in `src/game/rivals.ts` (tests: `tests/game/rivals.test.ts`) with two calls in `useHoldemGame.ts`
(`rivals.seated` when the table is built, `rivals.handEnded` when a hand ends) and a `TableSeating` screen.
Decisions made along the way:*
- *Rivals sit only at **solo** Career tables. Pass-and-play has no single "you" to remember, so it keeps the
  random table.*
- *Reads: when several rivals sit together they saw the same hands, so their saved reads are averaged, not
  added, then faded by `READ_DECAY` (0.7). After every hand each seated rival saves the table's read on you.*
- *Net against a rival: exact heads-up. Multiway, a winner's gain is split across the losers by what each lost.*
- *Pre-tilt (`carryTilt`, 0..1): the larger of busted by you (1), the biggest pot lost to you as a share of
  the starting stack, and their tilt at the last hand divided by their own `kappa`.*
- *Everything is saved after every hand, so there's no "session end" step to miss if the tab closes.*
- *Walk-ins: about a third of the bot seats (`walkInCount`), names from a separate pool.*

- `src/game/rivals.ts`: a fixed roster (about 12). Each rival has a stable id, name, avatar, archetype from
  `ai/psychology/profile.ts`'s `CAST`, and a **personality seed**, so `randomizeProfile` gives the same jitter
  every time (Scarlet always plays like Scarlet).
- Storage `poker.rivals` (own versioned schema). Per rival:
  - public stats from the table: VPIP, PFR, aggression, fold-to-bet, bluffs vs value seen at showdown
  - lifetime head-to-head net against the player
  - the rival's serialized `OpponentModel` read *on the player*, from the psychology track's
    `toJSON`/`fromJSON`
  - last-session tilt, for coming back steaming
- Stats are computed from public actions only: the same information the bots get.
- **Scouting note** before a table with rivals, only for rivals with enough data. For example: "Scarlet —
  plays 41% of hands, 3 of 5 river bets you've seen were bluffs, you're −$420 against her."
- **Pre-tilt:** a rival who busted or lost a big pot to the player last time starts the next event tilted,
  scaled by their own tilt profile (psychology track's `startTilted`).
- **Walk-ins:** every Career table fills some seats with random characters (`randomizeProfile` with a fresh
  seed, random names from a separate pool). No memory, no notes.
- Hook: one `onHandEnd` call in `useHoldemGame.ts` updates rival stats. The logic lives in `rivals.ts`.

### 3. Career seasons

- `src/game/career.ts`, storage `poker.career`: tier, season number, event index, points table, titles.
- **Tiers:** Local → Regional → National → Championship. Each tier's field is a fixed group of rivals plus a
  walk-in or two. Stronger tiers seat stronger characters: higher `discipline` (closer to the solve) and
  deeper level-k. That's real difficulty from existing parameters, not a fake knob.
- **Season:** ~5 single-table events built on `game/tournament.ts`'s structures (Sit & Go early, Deep for the
  final). Points by finish (e.g. 10/6/4/3/2/1). Entry fees and prizes still move the bankroll.
- **End of season:** top 2 promoted, the bottom finisher repeats the tier. The Championship is a single deep
  final, and winning it is a title.
- Screens: a career hub (current tier, standings, next event, scouting notes) and a season summary.

### 4. Timing tells

- Replace `useHoldemGame.ts`'s fixed `THINK_TIME` per action type with a function of the decision's
  **margin** (`PsychBot.lastDecision.margin`, built by the psychology track; small = close) and a
  per-character tempo. Close decisions take longer, obvious ones snap. Each character's pattern must be **consistent**, so it can be learned.
- Career only. Quick Play keeps today's fixed pacing.

### 5. Basic achievements

- `src/game/achievements.ts`, storage `poker.achievements`: detected at hand end / event end from the hand
  log. First win, first title, win a hand with 7-2, win a showdown with a bluff-catcher, bust a rival, win
  a season, promotion to each tier. Show a toast and list them on the profile.

## Done means

Each step: tests for the pure logic in `src/game/`, `npx tsc -b`, `npx oxlint`, `npx vitest run`, and a
browser check. `docs/PROGRESS.md` gets a line per step, and this file's steps are ticked off.
