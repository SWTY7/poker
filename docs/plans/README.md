# Plans, and how the two tracks are worked on

*Written 2026-09-28 so a fresh session can pick up either track without the conversation that produced it.
Read `docs/PROGRESS.md` first, then the plan for your track.*

| track | plan | branch | owns |
|---|---|---|---|
| Game elements (modes, career, rivals, timing, achievements) | [`game-modes.md`](./game-modes.md) | its own branch, e.g. `claude/game-modes-*` | `src/game/career*`, `src/game/rivals*`, `src/game/achievements*`, lobby / setup / career screens in `src/ui/` |
| Home game (real cards, phones as chips; same track, after game-modes step 3) | [`home-game.md`](./home-game.md) | `claude/home-game-*` | `src/home/**`, home game screens in `src/ui/` |
| Psychology (read-your-play, hand review, personality lab, real players) | [`psychology-lab.md`](./psychology-lab.md) | `claude/poker-bot-psychology-*` | `src/ai/**`, `src/review/**`, `src/gto/**`, research scripts |

## How to work on both

- **One session per track.** Each session gets its own branch and its own container, and never sees the
  other's conversation. The plan files are the handoff. A fresh session that reads `PROGRESS.md` and one
  plan is much cheaper than a long session carrying both tracks' history.
- **Start both from the same `main`.** Merge the open PR first (#19), then start or refresh each branch from
  the latest `main`.
- **Small PRs, merged often.** Conflicts grow with the time two branches stay apart, not with how many
  there are. Merge `main` into a long-running branch whenever the other track lands something.
- **Update `docs/PROGRESS.md` and your own plan file** at the end of each piece of work. Don't edit the other
  track's plan beyond a one-line note.

## Where the two tracks touch, and how to keep them from colliding

The hotspots:

1. **`src/ui/useHoldemGame.ts`**. Both tracks hook into "a hand ended" and into how seats are built. Keep
   additions there to a single call each (`onHandEnd(state)`-style), with the logic living in the track's
   own module.
2. **`src/game/profile.ts`**. Don't both bump the profile `version`. Each feature keeps its **own
   `localStorage` key** (`poker.career`, `poker.rivals`, `poker.review`, `poker.achievements`) via
   `src/utils/storage.ts`, each with its own versioned schema. Then neither track touches the other's
   saved data, and the existing profile needs no migration.
3. **`src/ai/psychology/*`**. The game track needs three small things from the bots. They're built in the
   **psychology** track first and merged, so the game track only calls them:
   - `OpponentModel` serialize/restore (`toJSON` / `restore` / `fromJSON`) with evidence decay between
     sessions, so a rival's read on you persists without freezing.
   - A way to start a bot tilted (`PsychBot.startTilted(strength)`), for "a rival you busted comes back
     steaming".
   - A per-decision **margin** (`PsychBot.lastDecision.margin`: the gap between the best action and the best
     action of another kind, in pots; small = close call), for timing tells.
   All three are built: step 0 in `psychology-lab.md` has the exact API.
4. **Hand review** belongs to the psychology track (it uses the same engine as the leak finder). Its on/off
   toggle goes in Quick Play, which the game track creates. Order it this way: the game track lands the mode
   toggle and the Quick Play screen early, then the psychology track adds the review toggle there. If the
   psychology track gets there first, it adds the toggle to the existing cash setup screen, and the game
   track moves it.

## Token-efficiency notes

- Compact or restart a session once a piece of work is committed and its plan file is updated. The plan
  file carries what matters. The transcript doesn't need to.
- Long benchmarks (A/B runs) belong in background jobs with one line of output each. Don't read their full
  logs into the conversation.
- Point a new session at files, not at history: "Read docs/PROGRESS.md and docs/plans/game-modes.md, then
  do step 1."
