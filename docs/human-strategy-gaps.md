# What human players do that these bots can't

*Reference doc, not a plan — nothing here is scoped or committed to. See `docs/PROGRESS.md` for what's
actually built and `docs/cfr-distillation-plan.md` for the one gap (blockers/card-removal) that has real
investigation behind it. This is the rest of the list, for whenever one of these becomes the next thing
worth building.*

Grounded in what's actually in the codebase (`src/ai/heuristic-bot.ts`, `src/ai/psychology/personality-bot.ts`,
`src/ai/psychology/psych-bot.ts`, `src/gto/holdem/blueprint-bot.ts`), not poker theory in the abstract.

## Basics — partly covered, partly missing

**Already covered somewhere in the mix:**
- Pot odds (`HeuristicBot` and up).
- Position (`PsychBot` uses real per-seat opening widths via `math/realization.ts`).
- Fold equity / bluff frequency (`PsychBot`'s level-k layer; `PersonalityBot`'s fixed bluff trait).
- Multiway equity — `PsychBot` runs equity against several opponent ranges at once via `multiwayEquity`,
  not just heads-up.

**Missing, and it's not subtle — it's in the code's own comments:**
- **Implied odds.** `psych-bot.ts`'s own top comment: *"a call is priced as though the hand checks down
  from here... that understates implied odds and therefore draws."* A human calls a draw partly for what
  they'll win later if it hits; nothing here prices that in. The mirror image, **reverse implied odds** (a
  non-nut draw that costs more when it does hit and you're still behind), is missing for the same reason.
- **Multi-street plans.** A human decides "call the flop, bluff the turn if a scare card comes" or "I've
  barrelled three streets, my range looks strong, keep firing." Every bot here decides one street at a time.
  `psych-bot.ts` again: *"the lookahead is one street deep with no future betting... a bet is priced as
  though the opponent folds or calls but never raises."* No bot has a forward plan for its own line.

## Advanced

- **Card removal / blockers.** The one gap with real work behind it — see `docs/cfr-distillation-plan.md`.
  Structural: the bucket abstraction (`buckets.ts`) and everything built on it only ever knows a hand's
  strength percentile, never which specific cards produced it.
- **Range reading across a whole hand.** A strong human tracks every action from preflop on and narrows the
  opponent to a specific set of combos ("he'd have 3-bet AA preflop, so this line rules it out"). `PsychBot`'s
  `OpponentModel` tracks one number per opponent (aggression frequency) plus board texture — real, but
  coarse. Nothing builds or narrows an actual combo-level range hand by hand.
- **Exploitative deviation from equilibrium.** The GTO blueprint plays one fixed, trained strategy —
  unexploitable by design, which also means it never adapts to a bad opponent. A strong human deliberately
  plays *off*-equilibrium against weak players (bluff less at a calling station, fold less to a maniac).
  `PsychBot`'s level-k/opponent-model layer is a real, working version of this instinct; the solved bot has
  none of it — it's the same strategy against everyone.
- **Bet sizing as a signal.** The solver only offers three sizes (half-pot/pot/all-in) — a deliberate
  simplification stated up front in `abstract-holdem.ts`. Real strong play uses size itself as information:
  small "blocker" bets with a specific part of the range, huge overbets polarized toward nuts-or-bluffs. That
  vocabulary doesn't exist in this abstraction.
- **Table image / meta-game across hands.** A human might show a bluff deliberately to get paid off later, or
  lean on a tight image to bluff more. No bot has memory of its own image or plans around it.
- **ICM / tournament equity.** `game/tournament.ts` has blind structures and payouts, but nothing adjusts
  *strategy* for the fact that chips aren't worth face value near a pay jump or the bubble — a hand near the
  money often folds what would be a clear call in a cash game. No mention of ICM anywhere in the code.
- **Short-stack push/fold beyond heads-up.** `pushfold.ts` solves heads-up shove/fold exactly; three-or-more
  handed short-stack shoving charts, which humans lean on constantly late in a tournament, aren't solved here
  — same heads-up-only ceiling as the main GTO solver, and for the same reason (no CFR convergence guarantee
  past two players).
- **Timing / physical tells.** Structurally out of scope for a simulated app — there's no "time to act"
  signal in `AIObservation` for any bot to read or fake, so this category doesn't really transfer here.

## If one of these becomes worth building

The position-aware and board-texture-aware work already shipped in `PsychBot` (`math/realization.ts`,
reusing `gto/holdem/buckets.ts`) is the template for "already-built-elsewhere machinery, just needs wiring
in" — implied odds and multi-street lookahead are the most promising next candidates in that shape, per
`psych-bot.ts`'s own top comment.
