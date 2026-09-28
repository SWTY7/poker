# What human players do that these bots can't — and how each could be built

*Reference doc, not a plan. Nothing here is scoped or committed to. `docs/PROGRESS.md` says what's actually
built; `docs/combined-bot.md` covers how the table's one bot kind combines instinct with the solved strategy;
`docs/cfr-distillation-plan.md` covers the one gap (blockers) that already has measured investigation behind
it. Each suggestion below names the files it would touch and how to tell whether it worked, because a
change to a bot that isn't measured against `npm run benchmark:pro` is a guess.*

Every bot seat is a `PsychBot` (`src/ai/psychology/psych-bot.ts`), anchored to the CFR blueprint
(`src/gto/holdem/`) wherever a hand is heads-up at a trained depth. That's the baseline these gaps are measured
against.

## Already covered

Pot odds, position (per-seat opening widths via `math/realization.ts`), fold equity and bluff frequency
(level-k), multiway equity against several opponent ranges at once, board-texture-aware ranges, tilt, loss
aversion, a learned per-opponent aggression read, and — heads-up — the solved strategy as a studied default.

## The gaps, with suggestions

### 1. Implied odds (and reverse implied odds) — *built (2026-09-27)*

**Built:** `math/equity.ts`'s `multiwayShowdown` samples the rest of the hand as before, and also records,
per run-out, whether both hands end up good enough to keep betting. "Good enough" is judged by how far each
hand rises above what the board makes alone: two categories or more is strong (sets, two pair from both
hole cards, a straight or flush of its own), one is medium only for top pair or an overpair, anything else
folds to a bet. Strong against strong puts in the half-pot bets of every street left; strong against medium
puts in one of them. PsychBot adds those chips to the showdown outcomes of check, call and the called branch
of every bet. On the river nothing is left and the old two-outcome gamble is exactly what's priced. It
replaced `shrinkTowardCoinFlip`.

**What it does:** the same turn draw at the same price is called more with money behind than without
(test). Top pair against a set-heavy range now carries the cost of paying it off. A loss-averse character
now shies from big pots it can lose, which is how "scared money" plays.

### 2. Multi-street plans — *partly built*

**Built:** the future streets are *priced* (item 1): a bet or call is valued with the money later streets
add. **Still missing:** the opponent raising back (a bet is priced as folded to or called, never
re-raised), and plans that carry across streets.

**Suggestion for the rest:**
- **One extra ply:** when pricing a bet, split "called" into "called" and "called, then raised back",
  with the raise-back probability from the level-k defence numbers already computed.
- **A per-hand plan:** a small `HandPlan` object on the bot, made when it first puts money in ("value",
  "semi-bluff with a flush draw", "float"), and consulted on later streets: a semi-bluff that picked up
  equity keeps betting, a float bets when checked to, a bluff gives up when the scare card doesn't come.
  Reset on `observeResult`. Heads-up, the solve already plays multi-street lines — this matters for
  multiway pots, where nothing else does.

**Effort:** small (ply), medium (plans). **Check:** the existing "neither a maniac nor a calling station"
aggression-ratio test, plus the six-handed A/B.

### 3. Card removal / blockers — *built (2026-09-25)*

**Built:** fold equity is now worked out per opponent from their range, in `range-reading.ts`'s
`splitAgainstBet`. The opponent continues with anything genuinely strong, plus at least the top `defence`
share of their *own* range, chosen without knowing the hero's cards. A capped range still defends itself
rather than folding everything. Then every combo using one of the hero's cards is removed, and what's left
decides the fold share. Blocker bluffs fall out of that: holding the ace of the flush suit removes their nut
flushes from the part that calls. Showdown equity already accounted for card removal.

**Honest limit:** a blocker only matters when the hands it blocks are actually in the opponent's range. After
a line that caps their range (call, call, check) there's little left to block. Probing a three-heart river
found spots where the ace of hearts didn't change the decision at all, which is also true of real play. It
decides close spots, not clear ones. Tested at the level of the math (`range-reading.test.ts`).

### 4. Range reading across a whole hand — *built (2026-09-25), with one measured exception*

**Built:** `range-reading.ts`'s `readRanges`. Every opponent who has acted this hand is read by Bayes' rule
over all 1,326 combos, one action at a time, on the board as it was on that street. The engine now stamps
each recorded action with its street. After the flop, each action is cut *relative to what the player can
still hold* and *at the rate that player takes it*: someone who bets 60% of the time when checked to is
betting their top 60%. Those rates come from the opponent model, blended toward measured normals. Preflop
uses population widths by position. Nothing is ever ruled out completely.

**The exception:** a *bettor's* range is not used for deciding whether to call them. It still feeds how
they'd respond to a raise. Reading a bet needs a bluff share, and actions alone only give the level-k
belief (about one bet in eight). Measured against an opponent who really bets two hands in three, reading
bets as mostly value made the bot lose 83 bb/100 heads-up (`docs/combined-bot.md`).

**Showdown memory, built (2026-09-27):** the opponent model now learns each player's real bluff share from
the river bets they turn over, per size (`OpponentModel.observeShowdown`). That feeds the air share of the
value-plus-air mixture used for bettors. Switching bettors over to the fully read range once enough
showdowns were seen was also tried: six-handed it measured no better (and leaned worse) than not
switching, so it was dropped. The exception stands.

### 5. Exploitative deviation from equilibrium — *built (2026-09-25)*

**Built, in two parts:**
- **Calibrated reads** (`opponent-model.ts`). Every action is recorded with its setting (heads-up or
  multiway, facing a bet or not) and compared with a *measured* normal for that setting
  (`npm run calibrate:reads`: the solve playing itself heads-up, the bot cast playing itself six-handed).
  There are two reads, aggression and fold-to-bet. Confidence grows with evidence instead of switching on at
  a cutoff.
- **Targeted exploits** (`exploits.ts`). Heads-up, a read adjusts the solved mix directly before the blend.
  Against an over-aggressive player it moves weight from fold to call; against a passive one, the reverse.
  Against an over-folder it bets more. Against a calling station it bluffs less and value-bets more. Weight
  only ever moves between actions the solve already plays. Multiway, the fold read moves that opponent's
  own fold share in the fold-equity math above.

**What was learned:** the old 35% baseline really was miscalibrated, but at *full tables*, where people bet
about 12% of the time. It read nearly everyone as passive, making the bots under-believe bluffs. An earlier
version of this doc blamed heads-up instead; measured, heads-up play sits right around 35%. See
`docs/combined-bot.md`.

### 6. Bet sizing as a signal — *built (2026-09-27)*

**Using it:** PsychBot prices five sizes (a third, half, three quarters, pot, 1.5× pot). Each is priced
separately. The defence it faces comes from the level-k frequencies at that price, so a bigger bet folds
out more and is called by stronger hands, and the called branch is measured against those hands. The solve
still has three sizes; adding more there multiplies the CFR tree and should be piloted first.

**Reading it:** `sizing.ts` rebuilds the pot through the hand, so every bet is known as a fraction of the
pot it went into. The opponent model learns how often each player's bets are big (≥ 60% pot). Range
reading takes a big bet from the top of the range (the big-bet share of it, with the bluffs believed for
that size) and a small bet from just below it, with the top only partly removed, since strong hands bet
small too. The bluff belief itself is per size: level-k at that price, the aggression read, then showdown
memory for that size.

### 7. Table image / meta-game across hands — *advanced, missing*

**Suggestion:** the shared `OpponentModel` already watches every seat, *including each bot*, so a bot can
ask how it looks to the table: `aggressionBias(myOwnId)`. A loose, aggressive image means opponents call
wider, so value-bet thinner and bluff less. A tight image means bluffs get more respect. That's one term on
the believed defence frequency. Deliberately showing a bluff to shape image would need engine support for
voluntarily showing cards, so that part would come later.

**Effort:** small (image-aware defence). **Check:** a bot with an artificially loose record should bluff
less in the same spot.

### 8. ICM (tournament equity) — *advanced, missing*

**What's wrong:** in a tournament, chips aren't money. Losing your stack near the bubble costs more than
doubling it gains. `game/tournament.ts` has payouts, but no bot ever uses them.

**Suggestion:** add an ICM function (the standard Malmuth–Harville model) to `game/`: given every stack
and the payout table, each player's expected prize money. Then, in tournaments, have PsychBot convert
every outcome's chip stack into ICM money *before* prospect theory values it. Nothing else changes.
Bubble tightening, short-stack desperation and big-stack bullying all come out of the currency change,
the same way house money and chasing already come out of the reference point. Harville is exponential in
players but fine for ≤ 9 with memoization.

**Effort:** medium. **Check:** near the bubble, the same hand at the same price should call less often in
a tournament than in a cash game.

### 9. Multiway preflop, short stacks included — *built (2026-09-27)*

**Built, and wider than suggested:** a full multiway preflop solve rather than push/fold only. Three to six
players, open/3-bet/4-bet/all in, at 8, 20, 40 and 100bb (`docs/multiway-preflop.md`). The 8bb files are
close to push/fold charts. It is validated against the exact heads-up push/fold solution and by a sampled
best response, not by trusting convergence. It plugs in through `Fundamentals` ahead of the heads-up
blueprints. **Still missing:** ICM (item 8), so in a tournament it plays chips, not prize money.

### 10. Timing / physical tells — *mostly out of scope*

Physical tells don't exist in a browser. **Timing does**, one way. `useHoldemGame.ts`'s `THINK_TIME` already
makes bots pause by action type. Scale that pause by *how close the decision was*: the gap between the best
and second-best action's value, which PsychBot already computes. Close decisions then take longer and
obvious ones snap, which is a real, learnable tell for the human to pick up. Reading the human's timing is
technically possible (time from prompt to click) but a questionable thing to feed a bot, so give it low
priority.

**Effort:** small. **Check:** it's a feel thing — play it.

## Suggested order

1. ~~Blockers (3)~~, ~~range reading (4)~~, ~~calibrated reads and exploits (5)~~, ~~implied odds (1)~~,
   ~~bet sizing (6)~~ and ~~multiway preflop (9)~~: built. Showdown memory, which item 4's exception
   asked for, is built too (see `docs/combined-bot.md` for what it measured).
2. **The raise-back ply (2)**: the last lookahead flaw PsychBot's own header names.
3. **ICM (8)**: makes the preflop book and every decision tournament-aware.
4. **Image (7)** and **timing (10)**: flavor, cheap.
