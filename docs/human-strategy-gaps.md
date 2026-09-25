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

### 1. Implied odds (and reverse implied odds) — *basic, missing*

**What's wrong:** `psych-bot.ts` prices a call as if the hand checks down from here. A flush draw is worth
more than its current equity because it wins extra bets when it hits; a non-nut draw is worth *less* because
it sometimes hits and still loses a big pot.

**Suggestion:** give the `call` candidate a future-street branch instead of the current two outcomes.
`buckets.ts`'s `strengthOf` already separates E[HS] (average strength) from E[HS²] (how "swingy" the hand is)
— their gap is exactly how drawy a hand is. Estimate the chance the hand improves to the top of the range
from that gap, and the extra chips won when it does as *remaining stack × the opponent's believed calling
frequency × a typical bet size*. Reverse implied odds is the same branch with a loss: the share of "hits"
that are still beaten (a non-nut flush draw's hits against the nut flush). This can replace the
`shrinkTowardCoinFlip` discount, which is a stand-in for exactly this.

**Effort:** small. **Check:** multiway play (where no solve applies) should call draws wider at deep
stacks than shallow ones, and `benchmark:pro` shouldn't regress.

### 2. Multi-street plans — *basic, missing*

**What's wrong:** every decision is one street deep. No bot plans "call the flop, bluff the turn if a
scare card comes", or keeps firing because the line so far tells a strong story.

**Suggestion:** two steps, cheapest first.
- **One extra ply** (scoped in an earlier plan, never built): when pricing a bet, split "called" into
  "called and it goes to showdown" and "called, then raised back", with the raise-back probability from the
  same level-k defence numbers already computed. This is the fix `psych-bot.ts`'s own header asks for — it
  says the current shape "flatters aggression".
- **A per-hand plan:** a small `HandPlan` object on the bot, made when it first puts money in ("value",
  "semi-bluff with a flush draw", "float"), and consulted on later streets: a semi-bluff that picked up
  equity keeps betting, a float bets when checked to, a bluff gives up when the scare card doesn't come.
  Reset on `observeResult`. Heads-up, the solve already plays multi-street lines — this matters for
  multiway pots, where nothing else does.

**Effort:** small (ply), medium (plans). **Check:** the existing "neither a maniac nor a calling station"
aggression-ratio test, plus `benchmark:pro`.

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
bets as mostly value made the bot lose 83 bb/100 heads-up (`docs/combined-bot.md`). The fix is **showdown
information**: learning each player's real bluff share from the hands they turn over. That's the natural
next step for this item.

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

### 6. Bet sizing as a signal — *advanced, missing*

**Using it:** PsychBot only prices half-pot and pot. Its `raiseCandidate` already values any size, so adding
33% and 75% pot and a 150% overbet is a few lines. The solve can't follow cheaply: every extra size
multiplies the CFR tree, and (lesson from the pilots) that should be measured with the pilot script before
anyone trains on it.

**Reading it:** facing a bet, the believed range ignores the size. Make `bettingRange` take the bet-to-pot
ratio. Small bets come from a wider, merged range (medium hands and some air); big bets and overbets are
*polarized* — mostly very strong or nothing. Concretely: shrink the value slice's width and raise the air
share as size grows.

**Effort:** small (sizes), small (reading). **Check:** spot tests — the same hand should call a small bet
more readily than an overbet with an equal price.

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

### 9. Short-stack push/fold beyond heads-up — *advanced, missing*

**Suggestion:** the heads-up push/fold solver (`pushfold.ts`, 338 information sets) extends to three- and
four-handed shove/call/overcall with a few thousand information sets, still tiny. Honest caveat: CFR has no
convergence *guarantee* past two players, so validate against the widely published 3-max push/fold Nash
charts rather than trusting convergence. With ICM payouts (item 8) this becomes the tournament endgame
chart. It plugs into the combined bot through the same `Fundamentals` interface the blueprint uses, as the
anchor for short-stack spots at any table size.

**Effort:** medium. **Check:** agreement with published 3-max charts; short-stack tournament benchmarks.

### 10. Timing / physical tells — *mostly out of scope*

Physical tells don't exist in a browser. **Timing does**, one way. `useHoldemGame.ts`'s `THINK_TIME` already
makes bots pause by action type. Scale that pause by *how close the decision was*: the gap between the best
and second-best action's value, which PsychBot already computes. Close decisions then take longer and
obvious ones snap, which is a real, learnable tell for the human to pick up. Reading the human's timing is
technically possible (time from prompt to click) but a questionable thing to feed a bot, so give it low
priority.

**Effort:** small. **Check:** it's a feel thing — play it.

## Suggested order

1. ~~Blockers (3)~~, ~~range reading (4)~~ and ~~calibrated reads and exploits (5)~~: built. Next,
   **bet-size reading (6)**: small, self-contained, and noticeable at the table.
2. **Implied odds (1)** and **one extra ply (2)**: fix the lookahead flaws PsychBot's own header names.
3. **ICM (8) → multiway push/fold (9)**: together, only when tournaments are the focus.
4. **Image (7)** and **timing (10)**: flavor, cheap.
