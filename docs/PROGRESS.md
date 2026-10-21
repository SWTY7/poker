# Current status

*Read this first. It's the accurate, current picture — the other docs are either historical
(`v1-architecture-plan.md`) or scoped to one initiative (`cfr-distillation-plan.md`). Update this file
whenever a meaningful piece lands; it's meant to stay current, not to be rewritten from scratch.*

## What this is

A client-side, No-Limit Texas Hold'em web app — React + TypeScript + Vite, deployed to GitHub Pages, no
backend, no LLM. What makes it more than a poker engine with a UI on top is the AI opponent layer: every
bot is a full psychological model, anchored (as far as its character has studied) to a CFR-solved "GTO"
strategy for heads-up spots, with a different character in each seat, drawn fresh every game.

## Doc map

- **This file** — current state, updated as things land.
- [`v1-architecture-plan.md`](./v1-architecture-plan.md) — the original design plan, written before any
  of it was built. Historical from here; its layering principles and the `AIObservation` information
  boundary are still followed, its milestone list and scope are long since exceeded (see its own header
  note and annotated milestones for what actually shipped against each one).
- [`cfr-distillation-plan.md`](./cfr-distillation-plan.md) — the one initiative currently in progress
  (solve a much higher-resolution CFR "teacher" once, distill it into a small fast "student"). Phase 1's
  pilot is measured; no decision yet on how far to take it. Read its own progress log before continuing it.
- [`combined-bot.md`](./combined-bot.md) — how the one bot kind blends its own instinct with the solved
  strategy, why reads don't loosen discipline, and the heads-up benchmark numbers behind both.
- [`human-strategy-gaps.md`](./human-strategy-gaps.md) — poker strategies real players use that no bot does
  yet, basics and advanced, each with a concrete implementation suggestion and a suggested order. Not a
  plan; nothing in it is scoped or committed to.
- [`plans/`](./plans/README.md) — the two tracks in progress and how they share the code: game modes /
  career / rivals (`plans/game-modes.md`), the home game for real cards (`plans/home-game.md`), and reading
  the human → personality lab (`plans/psychology-lab.md`).
  Start here if you're picking up either one.
- [`multiway-preflop.md`](./multiway-preflop.md) — the solved preflop book for three to six players: the
  game, how it's trained, and how far from equilibrium it measures.

## Engine & rules — `src/poker/`

Deck, hand evaluator, game state, betting/pot logic (side pots, all-ins), dealer/blind rotation, table
position labels. `src/poker/fast/` is a separate, optimized hand-evaluation path used by the GTO solver's
equity sampling, where raw speed matters (millions of evaluations per training run). Complete and tested;
this layer hasn't needed rework since the milestones in the v1 plan.

## Bankroll, profile, tournaments — `src/game/`

- `profile.ts`: a versioned, `localStorage`-backed bankroll with lifetime stats and a daily stake (a
  small top-up once per calendar day if the bankroll runs low).
- `tournament.ts`: blind structures, geometric blind escalation, payout brackets, standings.
- `mode.ts`: Quick Play or Career, saved under `poker.mode` (Career by default), and
  `profileAfterTableExit`, which settles a cash game against its buy-in and leaves the profile untouched
  for Quick Play.
- `rivals.ts`: twelve rivals who remember you and whom you remember, across sessions, saved under
  `poker.rivals`. Each rival is a `CAST` character with a fixed seed, so it plays the same every time. A solo
  Career table (cash game or World Tour) seats rivals plus about a third walk-ins, who are random and never
  remembered. `RivalSession` pools the seated rivals' saved reads on you (averaged, faded by 0.7), seats
  anyone who left steaming already tilted, and after every hand saves each rival's public stats (VPIP, PFR,
  fold-to-bet, river bluffs seen at showdown), your net against them, their read on you, and how hot
  they'll arrive next time. Pass-and-play and Quick Play have no rivals.
- `tour.ts`: the World Tour, saved under `poker.tour` (the old `poker.career` season save is dropped on load).
  Nine casino cities from Lisbon ($100) to Sydney ($10,000), each a six-handed tournament with its own buy-in,
  rivals and difficulty. The top three are paid 50/30/20 of a purse above the money bought in, so 1st pays at
  least 4x the buy-in (numbers in `docs/decisions/2026-10-21-world-tour.md`). A city opens after a top 3 in the
  one before it, and needs the bankroll for its buy-in. Screens: `TourHub` (cities, buy-ins, prizes, lock reason,
  best finish, Play) and `TournamentResults` with a top-3 payout line, reached from the World Tour door in the
  Career lobby. The buy-in is taken on sitting down and the prize credited on the way out through the profile.
  The standalone Tournament setup is gone; `tournament.ts` stays as the engine.
- Achievements were built (ten, with toasts and a screen) and removed again on 2026-10-04 at sunwoo’s request; nothing else depended on them.
- `blinds.ts`: rising blinds for the home game's house rule (about half again a level, on round amounts).

## Home game — `src/home/`

The home game (`docs/plans/home-game.md`): real cards on a real table, with only the chips in the app.
`table.ts` is its pure reducer: seating, blinds and the button, the betting rules from `poker/betting.ts`
(which now take a card-free `BettingState`), streets advanced by the host, side pots, the host's showdown
award with odd chips by seat, rebuys, and undo. It has two card modes: **real cards** (the host deals a real
deck and judges the showdown) and **online cards** (the table deals from a server-shuffled deck, settles the
showdown with the engine's evaluator, and `viewFor` gives each seat only its own cards).

Rooms live on a server: `server/` is a Cloudflare Worker with one Durable Object per 4-digit room (free
plan, WebSocket hibernation, deleted after 12 idle hours). `room.ts`'s `RoomCore` runs every command there.
The host is whoever holds the room's token, and runs only the game's flow: dealing, and with real cards
the streets and the showdown award, plus seat order and blinds between hands. Rising blinds are a house
rule the host can turn on (`config.levelMinutes`): a level clock on the server's time, each level about half
again the last (`game/blinds.ts`), applied from the next deal. Nobody acts for another seat
or sets a stack; busted players rebuy themselves; undo belongs to whoever took the last step. Seats are
claimed with a private per-phone seat key; with
online cards the server shuffles every deck (crypto-random). `socket.ts` is the phone's WebSocket, with
reconnection. `npm run server:dev` runs the server locally; `npm run server:deploy` publishes it, and the
Pages build reads its address from the `ROOM_SERVER` repository variable (`VITE_ROOM_SERVER`). Screens in
`src/ui/home/`: Home Game is a third lobby mode (Host / Join / Reopen room), a share link `?room=1234` opens
onto joining, and one table screen serves everyone, with the dealer's controls on the host's phone.

## Look and settings

`game/settings.ts` holds the device's look, saved as JSON `{theme, mode}` under `poker.look`. Settings has two
controls: **Theme** (Classic or Realistic) and **Mode** (Light or Dark); the Settings screen also has the default
table speed. They are `data-theme` and `data-mode` on `<html>`, plus a derived `data-layout` (`standard` for Classic,
`round` for Realistic). They are set before first paint by an inline script in `index.html` (and by `applyLook` in
`main.tsx`); `applyLook` also updates the `theme-color` meta. Saved looks from the old five-axis model (colour,
layout, font, buttons, corners, presets) are migrated: a round layout or the Card room colour becomes Realistic,
anything else Classic, always Dark. Broadcast, Neon and the font/button/corner choices were removed on 2026-10-19.

- **Classic** (`styles/theme-classic.css`, tokens in `tokens.css`): "slate and paper", cool grey-blue, flat,
  dashed-outline seats, soft buttons, Bricolage Grotesque and DM Mono; dark and light blocks with identical
  property sets (a test checks that and the contrast pairs).
- **Realistic** (`styles/theme-realistic.css`, `layout-round.css`, `room-lobby.css`, `layout-round-screens.css`):
  a casino table: textured baize, a padded leather rail with a gold inlay line and stitching, red chip seats,
  chip-stack pot, leather action bar, Fraunces and Barlow Condensed. Every texture is a CSS gradient or an inline SVG
  data URI of 160px or less (no image files, no large filters); the strong leather grain stays on the dark rail and
  dock, light mode uses a much softer grain and content panels are flat so text never sits on noise.
- The round layout: the oval table, seats placed by CSS trig from `--seat`/`--seats` (set on each `.seat-slot` in
  `Table.tsx`), chip avatars, paper stack tags, your cards at the bottom edge, you as a seat (`HeroZone`), the
  dealer button as a puck, the pot as chips (`PotChips` in `Board.tsx`), its own lobby `ui/RoomLobby.tsx`
  (`room-lobby.css`) and its screens in `layout-round-screens.css`. `App` picks the lobby from `getLook()`
  (`theme === 'realistic'`).
- **Crowded tables.** With 8 to 10 players on a portrait phone (7+ opponents) the round-layout table scrolls
  vertically, keeping every seat; the hero panel and the action buttons stay pinned at the bottom
  (`.table-actions`), and the scroll follows the acting seat only when the acting player changes and the user has
  not just scrolled (`ui/table-fit.ts` holds the seat-fit maths, tested against the CSS numbers). Landscape phones
  and short desktop windows with 8-10 players still use the old fixed oval and are unsolved.

## Offline play (PWA)

The built app installs from the browser's "Add to Home Screen" and plays offline. `vite.config.ts` has a
`poker-sw` plugin that writes `dist/sw.js` at build time: a precache list of every built file (JS, CSS, solver
chunks, self-hosted fonts, icons, manifest), cache-first for those, network-first for navigations with the
cached `index.html` as the fallback. A new version installs in the background and waits; `ui/UpdateBanner.tsx`
shows "New version ready, tap to reload" and the page posts `SKIP_WAITING`, then reloads once. The cache name
changes with the file list and with the contents of files whose names do not (manifest, icons); install
bypasses the HTTP cache. Fonts are self-hosted (`@fontsource*`, latin subset only, `styles/fonts.css`): the old
Google Fonts link would have broken offline use. `scripts/check-pwa.mjs` (a step in `scripts/check.sh`)
checks the manifest, icons, that the precache lists every file in `dist/`, no external URLs and no
`skipWaiting` on install. Verified in a browser pane (service worker active, 47 files cached, app loaded with
the server stopped). Not verified: an install on a real phone, and the update banner in a real browser. Updates
only arrive when the phone has internet.

## Nearby rooms (WebRTC) — `src/home/p2p/`

A home game that needs no internet and no server: one phone hosts (it runs `RoomCore` in its own page), friends
join over a shared local network (a phone hotspot). The two phones swap short codes by QR (Android Chrome
scans with `BarcodeDetector`) or by typing, since text cannot be copied between an iPhone and an Android phone
offline. Plan and the known/unverified table: `plans/w-p2p.md`. Pieces: `codec.ts` (an SDP packed into a
checksummed Crockford base32 code, `P1H...` for the host and `P1G...` for the guest, about 136 characters, QR
alphanumeric), `frame.ts` (chunking), `channel.ts`, `host.ts` (`startNearbyHost`, invites, rejoin by a fresh
invite), `guest.ts`, `saved.ts` (the host's room in `poker.home.nearby`, so a refresh keeps seats and chips),
`qr.ts` (`uqr`, MIT; decision in `docs/decisions/2026-10-19-qr-library.md`). UI in `src/ui/home/Nearby*.tsx`,
`InviteSheet.tsx`, with a "Nearby (no internet)" door in both lobbies. The host's phone holds the deck and every
hand (a notice says so) and the room ends when the host leaves the page. Verified in desktop Chrome in one page and
in two tabs: invite, reply, connected, seated through the UI, host reload + reopen, guest host-lost panel with
Rejoin; unit tests run the whole protocol over a fake WebRTC pair and play a hand. **Not verified:** two real
phones, a hotspot, airplane mode, iPhone Safari (no QR scanner in the browser, so typing only), whether the plane's
Wi-Fi lets phones reach each other (usually not), an iPhone as host (Personal Hotspot needs cellular).

## The table UI — `src/ui/`

The lobby opens on a Quick Play / Career / Home Game toggle (`docs/plans/game-modes.md` step 1). Quick Play is a practice
table: `MenuScreen`'s `variant="quick"` (any stack depth, no bankroll, its own saved setup under
`poker.quickConfig`), and leaving it records nothing. Career is the Cash game and the World Tour (the rest below). A solo Career game shows
`TableSeating` (who's at the table, with scouting notes on rivals seen 30+ hands) before the buy-in is taken.

Lobby → cash-game setup or the World Tour hub → table → results, all built on a shared `menu-*` visual vocabulary. A
poker chip + spade favicon, chip-denomination-colored bankroll/buy-in displays, a positional seat legend, a
hand-strength study aid, a tournament HUD with a blind clock. The bet-sizing slider caps its own draggable
range at `max(5x pot, $2,000)` rather than the full stack, so it stays precise regardless of how deep a
session's bankroll has grown (a fixed-pixel-width linear slider spanning a huge stack otherwise turns a
small drag into a four-figure jump).

## AI opponents — `src/ai/`

Every bot seat is one model — `PsychBot` — and `useHoldemGame.ts`'s `buildTable()` gives each seat a
different character from `profile.ts`'s `CAST`, drawn fresh every game. No settings, no flags. What the
model does, and what the characters vary:

- **`psychology/psych-bot.ts`**, the largest and most-iterated piece:
  - Prospect theory (loss aversion, diminishing sensitivity, probability weighting — `prospect.ts`) and
    mental accounting (where the reference point sits, session vs. hand-to-hand — `accounting.ts`).
  - Tilt as a state variable that decays between hands and spikes on a violated expectation, not just a
    lost pot (`tilt.ts`).
  - Level-k opponent reasoning for how much a bet is believed to be a bluff (`level-k.ts`), floored so no
    profile ever reads a raise as literally unbluffable (`MIN_BLUFF_BELIEF` in `psych-bot.ts`).
  - Loss aversion that scales down as a facing bet becomes a smaller fraction of the stack, so a
    deep-stacked bot doesn't fold a trivial-relative-size raise as readily as a short-stacked one would
    (`STAKE_REFERENCE_FRACTION`).
  - A shared, per-table `OpponentModel` (`opponent-model.ts`): every bot learns each opponent's aggression
    and fold-to-a-bet rates, and how often their bets are big, from their public actions this session.
    Each read is against what's *normal in that setting*, heads-up or multiway: baselines measured by
    `npm run calibrate:reads`, since one fixed number once read a whole full table as passive. Confidence
    grows with the number of actions seen.
  - Showdown memory (`OpponentModel.observeShowdown`): when cards are turned over, every river bet the
    player made is scored as value or bluff by where the hand stood on that board, filed by size. That
    moves the bot's belief about how often this player's bets of that size are bluffs. Only river bets
    count, because bluffs that give up on a later street never reach a showdown. It feeds the air share
    of a bettor's range; the bettor's range itself is still not read from the hand for calling decisions
    (switching to that once showdowns were seen measured no better — `combined-bot.md`).
  - Bet sizes (`sizing.ts`): five sizes priced separately (a third, half, three quarters, pot, 1.5× pot),
    each for what folds to it, what calls, and what those calling hands are. Facing a bet, its size is
    read: big bets from the top of a range with the bluffs believed for that size, small ones from just
    below the top.
  - The streets still to come (`math/equity.ts`'s `multiwayShowdown`): a showdown is valued with the
    money that goes in later when both hands turn out good. Implied odds for draws and hidden strong hands,
    reverse implied odds for top pair against strength. This replaced the old "shrink equity toward a coin
    flip" discount.
  - Range reading across the whole hand (`range-reading.ts`): every opponent who has acted is read street
    by street by Bayes' rule over all 1,326 combos. Each postflop action is cut relative to what they can
    still hold, at the rate that player is seen taking it; the engine stamps each recorded action with its
    street for this. One measured exception: a bettor's range isn't used for deciding whether to call
    them (see showdown memory below).
  - Blocker-aware fold equity (`range-reading.ts`'s `splitAgainstBet`): an opponent continues with strong
    hands plus the top share of their *own* range, decided without seeing the hero's cards. The hero's
    cards are then removed from what's possible, so holding a card their calling hands need makes a bluff
    work more often.
  - Position-aware ranges for an opponent who hasn't voluntarily acted yet, preflop, via
    `math/realization.ts`'s real per-position opening widths (`OPEN_PERCENT`) — a still-to-act UTG seat
    reads tighter than a still-to-act button.
  - Board-texture-aware ranges postflop, reusing the GTO solver's own hand-bucketing machinery
    (`gto/holdem/buckets.ts`'s `bucketOf`) instead of a flat, board-blind percentile cutoff.
  - Hooks for the game-modes track (step 0 of `docs/plans/psychology-lab.md`, none of which changes a
    decision): `OpponentModel.toJSON` / `restore` / `fromJSON` save a read and bring it back faded by a
    `decay` factor, and can pool several saved reads on one player; `PsychBot.startTilted(strength)` seats
    a bot already steaming, scaled by its own tilt sensitivity; `PsychBot.lastDecision.margin` says how
    clear the last choice was, in pots, between kinds of action (fold / check-call / bet-raise), for
    timing tells.
  - Randomized per table: which archetype (`profile.ts`'s `CAST`) sits where, and each instance's own
    level-k depth, confidence and discipline (`randomizeProfile`).
- **Combined with the solved strategy** (`docs/combined-bot.md`): once the trained CFR strategies download,
  every bot gets them (`useFundamentals`): the multiway preflop book first, then the heads-up blueprints
  (`firstAnswer`). Wherever one has an answer (before the flop with three or more dealt in, or any street
  heads-up at a trained depth), the bot blends the solve's mixed strategy with its own valuation,
  KL-regularized ("piKL"). How much it trusts the solve is the character's `discipline`, which tilt wears
  down. `PRO` (discipline 0.85) plays near the solve; the recreational characters (0.1–0.15) mostly play
  instinct. Multiway after the flop, or at an untrained depth, it's pure instinct. Measured heads-up with `npm run benchmark:pro`. A calibrated read on
  the heads-up opponent adjusts the solve's mix directly first (`exploits.ts`): call a bluffer down
  lighter, bluff an over-folder more, stop bluffing a calling station.
- **Not seated any more:** `heuristic-bot.ts` (pot odds and three thresholds) stays as the cheap engine
  test driver and the benchmark floor. The old personality-dial bot was deleted, since a `PsychBot` with
  the right profile covers everything it did.

## Reading the human — `src/review/`

Phase 1 of `docs/plans/psychology-lab.md`. The one part of the app that looks at the human's own hole cards
on purpose, so it lives outside `src/ai/`, and nothing in `src/ai/` or `src/gto/` imports it.

- **`log.ts`**: `HandLogger` follows the solo human through a sitting. `useHoldemGame.ts` makes three
  calls: when a hand is dealt, before each human action (with the table's solve's mix for that spot, where
  one applies), and when the hand ends. Each finished hand is a `HandRecord`: position, players, blinds,
  cards, board, every public action, the human's decisions with pot / to-call / stack, net chips, showdown
  and win. Stored under `localStorage` `poker.review` (versioned, newest 2,000 hands), downloadable as
  JSON. Pass-and-play isn't logged, since one log would mix several people.
- **`style.ts`**: VPIP, PFR, 3-bet, aggression factor, c-bet, fold to c-bet, WTSD, W$SD, bb/100, and a
  tilt signature (VPIP/PFR in the 10 hands after losing 25+ big blinds, same sitting, against every
  other hand). Every stat carries its count and its number of chances.
- **`leaks.ts`**: compares each covered decision's *kind* (fold / check-call / bet-raise) with the solve's
  mix. A kind the solve plays under 10% of the time in that spot is off the book. It's listed only once it
  repeats (2+) in the same spot the same way, ranked by a stand-in cost: (1 − the solve's share) × pot in
  bb. The trained files store frequencies, not values, so this isn't chips lost.
- **`table-read.ts`**: the shared `OpponentModel`'s read on the human in plain words (aggression and
  folding against the measured normal, bet sizing, river bets seen at showdown), with what the bots do
  about it. Only reads with 10+ actions behind them are said.
- UI: the read is on the leave screen ("What the table thinks of you"). A **Your play** screen, from a
  button in the lobby, shows the style profile (all hands or last session), the leaks, the tilt
  signature, and a download and delete of the history.
- **`hand-review.ts`** (Phase 2): one hand gone back over, decision by decision: what you did, the solve's
  mix in words ("raise 85%, call 15%"), a verdict (book play / in the mix / off the book / no solve here),
  your equity against random hands for each opponent still in, and what the `PRO` character (Iris) would
  have done. The pro is asked at the table, at the moment of the decision: a fresh `PsychBot(PRO)` with the
  same observation and the table's shared read, which never acts and never writes back (tested). Its move is
  stored on the decision (`LoggedDecision.pro`, optional, so no schema bump). Only asked while a study aid is
  on, since it's a whole bot decision.
- UI (Phase 2): Quick Play setup → Study aids has **Hand review** (on by default) and **Hints** (off),
  solo only. With review on, the result dock says "N decisions · K off the book" and a **Review** button
  (or R) opens the sheet (`src/ui/HandReview.tsx`). With hints on, a line above the controls shows the
  book's mix and what Iris would do; it is worked out a beat after the turn arrives and again once the solve
  finishes downloading.

- **Personality lab, Phase 3a** (`src/lab/`, `scripts/personality-lab.ts`, 2026-10-04): bot-vs-bot tables with
  characters drawn from wide ranges, every seat logged like the human, and a recovery of each seat's
  parameters from its statistics alone (`npm run lab -- generate|analyze`). Result: loss aversion, level-k
  depth, discipline and probability weighting come back (held-out r 0.69-0.85 at 500 hands); tilt, confidence
  and gains persistence do not. Numbers and caveats in `docs/plans/psychology-lab.md`. The likelihood-fit
  method is not built yet (needs a no-behaviour-change seam on PsychBot).

## The GTO solver — `src/gto/`

From-scratch CFR and Monte Carlo CFR (`cfr.ts`, `mccfr.ts`), verified against solved-game oracles at small
scale (Kuhn, Leduc, heads-up push/fold — each checked against an independently-written second solver
and/or published values) before being pointed at abstracted heads-up hold'em, which has no published
oracle to check against.

- `holdem/abstract-holdem.ts`: the abstracted game CFR actually solves — bucketed hand strength, three bet
  sizes (half-pot/pot/all-in), capped raises. Heads-up only, deliberately: CFR's convergence guarantee is
  a two-player zero-sum theorem. Past two players equilibria still exist, but nothing promises CFR finds
  one, so a multiway solve is only honest where its distance from equilibrium can be measured.
- `holdem/preflop-multiway.ts` / `preflop-multiway-bot.ts`: exactly that case: preflop with three to six
  players, trained by N-player external-sampling MCCFR at 8/20/40/100bb (`npm run train:preflop`, 16 files,
  about 1 MB). It reproduces the exact heads-up push/fold solution when given that game, and a sampled best
  response measures it at ≤ 0.02–0.19 bb/hand from equilibrium where that's affordable to check
  (`docs/multiway-preflop.md`).
- `holdem/buckets.ts`: real, card-removal-correct, run-out-sampled percentile hand strength per board,
  cached per canonical board.
- `holdem/isomorphism.ts`: lossless suit-symmetry board reduction (22,100 flops → 1,755 canonical ones).
- Four trained stack depths shipped as static JSON (`blueprint-{10,20,40,75}.json`, `scripts/train-blueprint.ts`
  generates them, ~400k iterations each). `blueprint-set.ts`'s `BlueprintSetBot` picks whichever trained
  depth is closest to a table's actual effective stack at decision time.
- `holdem/pushfold.ts` / `pushfold-solver.ts`: heads-up push/fold solved exactly (338 information sets,
  real cards, checked against published charts) — the one corner of hold'em small enough to solve without
  any abstraction at all.

## Deploying

Merging to `main` no longer deploys. `ci.yml` runs lint, tests and the production build on every pull
request and on `main`. `deploy.yml` publishes to GitHub Pages only for a version tag
(`git tag v1.1.0 && git push origin v1.1.0`) or from Actions → Deploy to GitHub Pages → Run workflow. The
`github-pages` environment allows `main` and tags matching `v*`. Run `npm run build` before pushing: it is
the only check that parses the CSS.

## Verification, as of this writing

593 tests as of the last full run (2026-09-29); `npx vitest run`, `npx tsc -b` and `npx oxlint` are all clean. Re-run
them rather than trust this number — it moves.

**Use `npx tsc -b`, not `npx tsc --noEmit -p .`**: `tsconfig.json` only lists project references, so
`-p .` typechecks nothing and passes even on a deliberate type error (found 2026-09-25; earlier "tsc clean"
claims made with it were hollow, though the code passed `tsc -b` once checked). `npm run build` runs
`tsc -b` too. Nothing typechecks `tests/` or `scripts/` (`tsconfig.app.json` includes only `src`).

## Deliberately not built

- Omaha or other variants.
- A multiway (3+ player) CFR solve *after the flop*. Preflop is solved (above), where the distance from
  equilibrium can be measured; the full multiway game can't be, which is why `abstract-holdem.ts` stops at
  heads-up.
- A UI toggle or settings screen for anything AI-related — there isn't one, by design; the bot mix is
  always on, always randomized, nothing to configure.
